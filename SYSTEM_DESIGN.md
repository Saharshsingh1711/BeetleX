# BeetleX Backend Assignment: Part 3 System Design Answers

This document provides technically grounded, production-grade solutions to the five architectural and system design scenarios required for the BeetleX Hackathon Platform.

---

## Q1: Real-Time Leaderboard at Scale

### Scenario
The judging window closes and 5,000 participants simultaneously request the leaderboard. Scores are still being actively finalized by 20 concurrent judges.

### Architecture Diagram

```mermaid
flowchart TD
    Judge[Judge client] -->|POST /api/judge/projects/:id/score| Express[Express API Server]
    Express -->|1. Write Transaction| PostgreSQL[(PostgreSQL DB)]
    Express -->|2. Asynchronous Recalculation| Redis[(Redis Cluster)]
    Redis -->|3. Score Updated: ZADD| ZSET[ZSET: leaderboard:event_id]
    
    Participant[Participant Client] -->|GET /api/events/:id/leaderboard| Express
    Express -->|1. Read Rank: ZREVRANGE| ZSET
    
    Express -->|4. Push updates via SSE| Participant
```

### 1. Aggregate Score Computation: On-Write (Materialized in Redis)
*   **Choice**: We use an **on-write caching strategy** leveraging a **Redis Sorted Set (`ZSET`)** to store project scores and ranks.
*   **Why**: 
    *   *On-Read* computation (calculating average scores of 800+ projects from thousands of raw judge scores on every HTTP request) requires expensive table scans, grouping, and ordering. This would lock the database, thrash the CPU, and fail under 5,000 concurrent reads.
    *   *PostgreSQL Materialized Views* require `REFRESH MATERIALIZED VIEW` which locks the table by default and blocks readers unless `CONCURRENTLY` is configured (which requires a unique index and still introduces significant writing overhead and replication lag).
    *   *On-Write* updates offload all computation to Redis. Whenever a judge inserts or updates a score in the relational database, the Express application recalculates the single project's average and pushes it to Redis via `ZADD` in $O(\log N)$ time. Reads are served in $O(1)$ or $O(\log N + M)$ for paginated leaderboard windows.

### 2. Caching Strategy
*   **What is Cached**: 
    1.  **Leaderboard Sorted Set**: Key `leaderboard:{eventId}`. Members are `projectId` strings, and scores are compound weights representing the rank.
    2.  **Project Details Cache**: Key `project:{projectId}`. Stores JSON string containing title, description, team name, and track to avoid DB joins on reads.
*   **TTL Configuration**: 
    *   Leaderboard `ZSET`: No TTL (write-through cache). For resilience against state drift, a background cron rebuilds the set from PostgreSQL once every 2 hours.
    *   Project Details: 1 hour (refreshed on updates).
*   **Cache Invalidation & Updates**:
    1.  Judge updates a score via `PATCH /api/judge/projects/:id/score`.
    2.  The API server updates the record in PostgreSQL inside a database transaction.
    3.  Post-commit, the API server calculates the project's new average score.
    4.  The server updates the Sorted Set:
        ```bash
        ZADD leaderboard:{eventId} {compoundScore} {projectId}
        ```
    5.  To enforce **tie-breaking by submission time (`submittedAt`)** in a single Redis `ZSET` score field:
        $$\text{Compound Score} = \text{Average Score} + \left(1.0 - \frac{\text{submittedAt Timestamp}}{1\text{e}13}\right)$$
        Since higher scores rank first in `ZREVRANGE`, an earlier submission timestamp results in a smaller fractional deduction, ensuring the project with the earlier submission ranks higher in case of identical averages.

### 3. Critical Database Indexes
To support efficient raw queries, background rebuilds, and analytical scoring queries, the following PostgreSQL indexes are created:

```sql
-- 1. Index to filter active, submitted projects within an event instantly
CREATE INDEX idx_projects_leaderboard_filter 
ON projects (event_id, status, is_active) 
WHERE status = 'SUBMITTED' AND is_active = TRUE;

-- 2. Compound index for fast aggregation of scores per project
CREATE INDEX idx_scores_project_aggregation 
ON scores (project_id, total);
```

### 4. Push Updates to Connected Clients
We use **Server-Sent Events (SSE)** coupled with **Redis Pub/Sub**:
1.  When a score is updated, the Express controller publishes an event:
    ```typescript
    redis.publish(`leaderboard:${eventId}:updates`, JSON.stringify({ projectId, eventId }));
    ```
2.  The API servers connected to clients via SSE subscribe to `leaderboard:${eventId}:updates`.
3.  Upon receiving the message, each API server fetches the updated leaderboard slice from the Redis `ZSET` and writes it down the open SSE connection (`text/event-stream`) to all listening clients in a non-blocking asynchronous loop.

---

## Q2: 50,000 Registrations in One Day

### Scenario
A popular newsletter features the platform, driving 50,000 user registrations within a 24-hour window.

### 1. Database-Level Duplicate Prevention
*   **The Guard**: We define a unique constraint on `(event_id, user_id)` in the PostgreSQL `registrations` table:
    ```sql
    ALTER TABLE registrations ADD CONSTRAINT unique_event_user UNIQUE (event_id, user_id);
    ```
*   **Behavior under Load**: When two threads simultaneously attempt to write a registration for the same user, PostgreSQL enforces write serialization on the unique index. The first transaction succeeds and commits. The second transaction immediately fails with a `23505` unique key violation. The Express controller catches this database error code and returns a clean `409 Conflict` response to the client:
    ```json
    { "error": "User is already registered for this event", "code": "DUPLICATE_REGISTRATION", "statusCode": 409 }
    ```

### 2. Multi-Tiered Rate Limiting Strategy
Rate limiting prevents DB connection exhaustion and DDoS. We implement limits at three layers:
1.  **Network/IP Layer (Cloudflare / Nginx)**: Rate limit of 100 requests per 10 seconds per IP. Protects the application server from socket exhaustion.
2.  **User Authentication Layer (Express + Redis)**: Limit users to 10 authentication/registration attempts per minute. Prevents script-based spamming of the signup routes.
3.  **Endpoint Event Layer**: Limiting `POST /api/events/:id/register` to 100 registrations per minute per event. This acts as a circuit breaker during peak registration surges.

### 3. Queue-Based Processing vs Direct Writes
*   **Threshold**: 50,000 registrations over 24 hours averages to ~0.57 writes per second. Even with a 100x surge (57 RPS), direct PostgreSQL writes are highly efficient if they are simple `INSERT` queries.
*   **Direct Writes**: Applied for registering users. This provides immediate, synchronous feedback to the user (`201 Created`), giving them absolute certainty they secured a spot.
*   **Queueing (BullMQ + Redis)**: Necessary for asynchronous side-effects of registration (e.g., generating ticket PDFs, updating third-party CRM tools, and sending transactional emails). The Express controller saves the record to the DB, immediately returns `201`, and publishes a `registration.created` job to BullMQ. Asynchronous workers consume the queue without slowing down the HTTP thread.

### 4. Connection Pool Sizing & PostgreSQL Configuration
To prevent pool starvation under peak load, we tune the pool and database parameters:
*   **PgBouncer Integration**: We deploy PgBouncer in **transaction pooling mode** (`pool_mode = transaction`) between our Express servers and PostgreSQL. This allows thousands of Express sockets to share a tiny pool of active DB server connections.
*   **Prisma Client Connection Limit**: Set to 30 per replica:
    ```env
    DATABASE_URL="postgresql://user:pass@localhost:6432/db?connection_limit=30"
    ```
*   **PostgreSQL Parameter Tuning**:
    ```ini
    max_connections = 200            # Safe limit with PgBouncer
    shared_buffers = 4GB             # 25% of memory for caching hot tables/indexes
    work_mem = 32MB                  # Memory allocated for sorting operations per query
    maintenance_work_mem = 512MB
    effective_cache_size = 12GB
    synchronous_commit = off         # Speeds up writes by letting transactions commit to WAL asynchronously
    ```

### 5. Response Strategy Under Extreme Load
*   If the database connection pool is completely saturated or rate limiters are tripped, requests are rejected at the gateway or Express middleware.
*   The client receives an `HTTP 429 Too Many Requests` or `HTTP 503 Service Unavailable`.
*   **User Experience**: The UI does not crash or spin. The registrant sees a friendly modal: *"The server is processing a large volume of signups. Your spot is reserved. Please wait 15 seconds."* The client-side application automatically retries the request using **exponential backoff with jitter**, preventing a "thundering herd" retry storm.

---

## Q3: Pitch Deck Upload Pipeline

### Scenario
800 teams submit their pitch decks (PDF, max 10MB) in the final 30 minutes before the hackathon submission deadline.

### 1. File Upload Architecture: Direct-to-S3 Presigned URLs
*   **Choice**: **Direct-to-S3 Presigned PUT URLs** (Server-side metadata validation + Client-side S3 direct upload).
*   **Why**: In a server-side multipart upload, the Express server must buffer or stream 10MB files. If 800 teams upload simultaneously, the API process has to handle 8GB of incoming network data. This would lead to event-loop blocking, memory exhaustion (OOM), and socket timeouts. With presigned URLs, the API server handles only tiny JSON handshakes, offloading all raw file upload bandwidth to AWS S3.

```mermaid
sequenceDiagram
    participant Client
    participant API as Express API Server
    participant S3 as AWS S3 Object Storage

    Client->>API: 1. POST /projects/:id/deck-url (filename, size, mimetype)
    Note over API: Validate: file size <= 10MB<br/>MimeType == application/pdf<br/>Deadline not passed
    API-->>Client: 2. Return Presigned PUT URL + S3 Key
    Client->>S3: 3. PUT /object-key (Upload Binary PDF Data)
    Note over S3: Validate Content-Length limits
    S3-->>Client: 4. 200 OK (Upload Success)
    Client->>API: 5. POST /projects/:id/deck-confirm (key)
    API->>API: 6. Verify key exists in S3 & Save to PostgreSQL
    API-->>Client: 7. 200 OK (Project Submission Finalized)
```

### 2. Multi-Layer Validation
*   **Layer 1 (Client-Side UI)**: JavaScript validates `file.size <= 10485760` (10MB) and `file.type === 'application/pdf'` before triggering the request.
*   **Layer 2 (API Gateway/Server)**: Before generating the presigned URL, the server validates the input body:
    ```typescript
    if (size > 10 * 1024 * 1024) throw new AppError('File exceeds 10MB limit', 400);
    if (mimeType !== 'application/pdf') throw new AppError('Only PDF files are allowed', 400);
    ```
*   **Layer 3 (S3 Upload Signature)**: The generated presigned URL signature contains conditions that restrict the uploaded content size and type directly at the S3 bucket entrypoint:
    ```javascript
    s3.getSignedUrlPromise('putObject', {
      Bucket: 'pitch-decks',
      Key: s3Key,
      ContentType: 'application/pdf',
      Expires: 300, // 5 minutes validity
    });
    ```

### 3. PostgreSQL vs Object Storage Partitioning
*   **AWS S3 (Object Storage)**: Stores the raw binary PDF file. Objects are organized using a prefix pattern: `decks/event-{eventId}/team-{teamId}/submission-{timestamp}.pdf`.
*   **PostgreSQL (Metadata)**: Stores the pointer information inside the `Project` model:
    *   `deckUrl`: S3 Object URI.
    *   `deckKey`: Unique S3 Object key.
    *   `deckSize`: File size in bytes (for audit logging).
    *   `submittedAt`: Submission timestamp.

### 4. Handling Partial or Failed Uploads
*   **Client-Side UI Reaction**: The client uses the AWS S3 SDK or an AJAX upload with progress tracking. If the network drops, the client automatically retries chunk uploads. In case of complete failure, the UI displays: *"Upload interrupted. Click retry to resume from last saved chunk."*
*   **Storage Cleanup**: To prevent S3 from accumulating orphaned data from failed uploads, we set an **S3 Lifecycle Policy** on the bucket to automatically clean up incomplete multipart uploads after 24 hours.

### 5. Virus and Malware Scanning
*   **Strategy**: Asynchronous scanning using **AWS Lambda + ClamAV** (S3 Event-Triggered). We do **not** block the client upload response for a virus scan, as scanning a 10MB PDF can take 5–10 seconds.
*   **Flow**:
    1.  The PDF is uploaded to S3.
    2.  S3 fires an ObjectCreated event, triggering an AWS Lambda function running ClamAV.
    3.  The Lambda scans the file:
        *   *Clean*: The Lambda tags the S3 object `status=CLEAN` and marks the PostgreSQL project record as `VERIFIED`.
        *   *Infected*: The Lambda deletes/quarantines the file and updates the PostgreSQL project record to `SCAN_FAILED`. An email and in-app notification are dispatched to the team: *"Your submission was rejected due to a failed security scan. Please upload a valid PDF."*

---

## Q4: Announcement Delivery Under Load

### Scenario
An organizer publishes an urgent announcement: the submission deadline is extended by 30 minutes. It must reach all active participants within 10 seconds.

### 1. Message Broker Selection: Redis Pub/Sub + BullMQ
*   **Choice**: **Redis Pub/Sub** for routing real-time socket events, coupled with **BullMQ** for managing background retries and persistent delivery queues.
*   **Justification**:
    *   *Kafka* is designed for log replayability and massive data pipelines, but introduces high infrastructure complexity and sub-second latency overhead which is unnecessary for 5,000 clients.
    *   *BullMQ* provides the reliability layer (jobs, delays, retries), while *Redis Pub/Sub* provides low-latency broker capabilities to broadcast messages to all active connection servers in micro-seconds.

### 2. High-Performance Socket Fan-Out

```mermaid
flowchart LR
    API[API Instance] -->|Publish| RedisPub[Redis Pub/Sub]
    RedisPub -->|Subscribe| WS1[WS Server 1]
    RedisPub -->|Subscribe| WS2[WS Server 2]
    
    WS1 -->|Active Sockets| ClientA[Client A]
    WS1 -->|Active Sockets| ClientB[Client B]
    WS2 -->|Active Sockets| ClientC[Client C]
```

*   **Architecture**: WebSocket/SSE connection management is split into a dedicated **Real-time Gateway Cluster** (separate Node.js processes or microservices).
*   **Fan-Out Execution**:
    1.  The organizer hits `POST /api/events/:id/announcements`. The API server writes to the DB and publishes the message to Redis Pub/Sub.
    2.  The real-time servers subscribe to the channel and receive the message.
    3.  Each real-time server loops through its locally held, memory-resident list of active participant socket connections and pushes the message over the socket:
        ```typescript
        activeSockets.forEach(socket => socket.send(message));
        ```
    4.  Since this loop runs inside asynchronous, non-blocking processes across clustered servers, fanning out to 5,000 connections takes less than 200 milliseconds, ensuring the main API thread remains fully responsive.

### 3. Delivery Guarantees (Offline Clients)
To ensure no client misses the announcement, we implement a **hybrid push-pull model**:
1.  **Push (Online)**: Immediate delivery via WebSocket/SSE.
2.  **Pull Sync (Offline on Reconnect)**: When a client's socket reconnects, the client-side app immediately queries:
    ```http
    GET /api/events/:id/announcements?since={lastReceivedTimestamp}
    ```
    The server returns all announcements published since the user was last online.

### 4. Read Receipt Database Write-Storm Mitigation
If 5,000 users read an announcement at the same time, hitting the database to create 5,000 rows in the `announcement_reads` table will cause a write-storm.
*   **Mitigation**:
    1.  **Read Action**: We do not create rows for unread status. Instead, the unread count is computed dynamically on the client by comparing the list of published announcements against the read receipts stored locally and in the DB.
    2.  **Write Buffer (Redis-Backed Queue)**: When a user clicks "Mark as Read", the client sends a request. Instead of performing a direct PostgreSQL transaction, the Express server pushes the read receipt to BullMQ:
        ```typescript
        await readReceiptQueue.add('markRead', { userId, announcementId });
        ```
    3.  A worker process consumes these jobs, batching them into a single bulk insert query every 2 seconds, flattening the write peak.

### 5. Priority Routing for Urgent Notifications
Announcements have a `priority` field (`INFO`, `WARNING`, `URGENT`):
*   **Urgent Announcements**: Bypass normal job queues. They are dispatched immediately over a dedicated WebSocket channel. The client UI intercepts this priority tag and displays an intrusive modal dialog with an audio chirp, and triggers a FCM/APNS Mobile Push Notification.
*   **Info Announcements**: Are quietly appended to the user's notification list with a badge increment.

---

## Q5: Race Conditions in Team Operations

### Scenario
Two users concurrently try to join a team with one spot remaining. Both read that the team has capacity, and both attempt to insert their records into `team_members`.

### 1. Locking Strategy: Pessimistic Concurrency Control
*   **Choice**: **Pessimistic Locking** (e.g., `SELECT ... FOR UPDATE`).
*   **Why**:
    *   *Optimistic Locking* (relying on a version number) performs poorly under high contention. If 15 users try to join a team simultaneously, 14 will fail, requiring them to trigger multiple retries and reload the UI.
    *   *Pessimistic Locking* blocks concurrent transactions at the database level. The first transaction locks the row; other incoming transactions wait in queue until the lock is released. This guarantees strict serialized consistency and prevents double-booking.

### 2. Atomic SQL Transaction Design
To guarantee that the team size constraint is checked and updated atomically, the Express controller runs a transaction block:

```sql
BEGIN;

-- 1. Lock the parent team row. Prevents any other transaction from joining this team.
SELECT id FROM teams 
WHERE id = 'team-123' AND is_active = TRUE 
FOR UPDATE;

-- 2. Count current active members of the team.
SELECT COUNT(*) FROM team_members 
WHERE team_id = 'team-123';

-- 3. If count is less than event's maxTeamSize, perform insert.
-- Otherwise, raise an exception to trigger a transaction ROLLBACK.
INSERT INTO team_members (team_id, user_id, role) 
VALUES ('team-123', 'user-abc', 'MEMBER');

COMMIT;
```

In Prisma, we implement this using a raw transaction:
```typescript
await prisma.$transaction(async (tx) => {
  // Lock the team row
  await tx.$executeRaw`SELECT id FROM teams WHERE id = ${teamId} FOR UPDATE`;
  
  const currentCount = await tx.teamMember.count({ where: { teamId } });
  
  if (currentCount >= maxTeamSize) {
    throw new AppError('Team has reached maximum capacity', 409, 'TEAM_FULL');
  }

  return tx.teamMember.create({
    data: { teamId, userId, role: 'MEMBER' }
  });
});
```

### 3. Winning vs Losing Request Responses
*   **Winning Request**: Receives a `201 Created` status with the joined member info.
*   **Losing Request**:
    *   **HTTP Status**: `409 Conflict` (denotes resource state conflict).
    *   **Error Code**: `TEAM_FULL`.
    *   **User-facing Message**: *"Sorry, this team has reached capacity. Please join another team."*

### 4. Application to Event Max Registrations
*   **Similar Solution**: We use a **Pessimistic Write Lock** on the `Event` row to serialize registration checks:
    ```sql
    SELECT max_registrations FROM events WHERE id = 'event-123' FOR UPDATE;
    ```
*   **High-Scale Optimization (Redis Token Bucket)**: If an event has extreme demand (e.g., thousands of users hitting the endpoint at the exact same second), pessimistic DB locks will cause database thread exhaustion. In this scenario, we offload the inventory counter to Redis.
    *   We use a Redis key `event:event-123:slots` containing the number of available slots.
    *   We execute a Lua script to atomically decrement and verify availability:
        ```lua
        local current = redis.call('get', KEYS[1])
        if tonumber(current) > 0 then
            redis.call('decr', KEYS[1])
            return 1
        else
            return 0
        end
        ```
    *   If Redis returns `1`, the registration proceeds to the database. If `0`, we reject immediately with `409` without touching PostgreSQL, protecting the database from load spikes.

### 5. Concurrency Testing Strategy
To prove that our implementation prevents race conditions, we write a Jest integration test using asynchronous concurrency execution:

```typescript
describe('Team Operations Concurrency', () => {
  it('should prevent multiple users from joining when only 1 slot is left', async () => {
    // 1. Seed a team in the database with exactly 3 members (Max capacity: 4)
    const teamId = 'test-team-concurrency';
    
    // 2. Trigger concurrent requests at the exact same millisecond
    const userA_Token = generateAccessToken({ userId: 'user-A', role: 'PARTICIPANT' });
    const userB_Token = generateAccessToken({ userId: 'user-B', role: 'PARTICIPANT' });

    const [resA, resB] = await Promise.all([
      request(app).post(`/api/teams/${teamId}/join`).set('Authorization', `Bearer ${userA_Token}`),
      request(app).post(`/api/teams/${teamId}/join`).set('Authorization', `Bearer ${userB_Token}`)
    ]);

    // 3. Verify exactly one succeeded and the other failed with a conflict
    const successResult = [resA, resB].find(r => r.status === 200 || r.status === 201);
    const failedResult = [resA, resB].find(r => r.status === 409);

    expect(successResult).toBeDefined();
    expect(failedResult).toBeDefined();
    expect(failedResult?.body.code).toBe('TEAM_FULL');

    // 4. Verify team count in database is exactly 4 (capacity met, not exceeded)
    const dbCount = await prisma.teamMember.count({ where: { teamId } });
    expect(dbCount).toBe(4);
  });
});
```
