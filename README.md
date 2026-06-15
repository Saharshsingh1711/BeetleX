# BeetleX Backend

BeetleX Backend is a Node.js + TypeScript service featuring an Express.js API, Prisma ORM, and PostgreSQL.

## Features

- **TypeScript**: Typed JavaScript environment.
- **Express.js**: Lightweight framework for APIs.
- **Prisma ORM**: Modern database access layer.
- **Docker Support**: Containerized database and app runtime environment.
- **Vitest**: Unit & integration test runner.

## Directory Structure

```
beetlex-backend/
├── prisma/             # Database migrations and Prisma schema
├── src/                # Application source code
│   ├── app.ts          # Express configuration
│   └── index.ts        # Server entry point
├── tests/              # Test suites
├── docs/               # Technical specifications and API documentation
├── Dockerfile          # Production Dockerfile
└── docker-compose.yml  # Docker environment setup
```

## Getting Started

### Prerequisites

- Node.js (v18 or v20 recommended)
- npm
- Docker (optional)

### Installation

1. Clone the repository and navigate into it:
   ```bash
   cd beetlex-backend
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Set up environment variables:
   ```bash
   cp .env.example .env
   ```

### Running Locally

1. Start the database (using Docker):
   ```bash
   docker compose up -d db
   ```

2. Run database migrations:
   ```bash
   npx prisma migrate dev
   ```

3. Start the application in development mode:
   ```bash
   npm run dev
   ```

The application will be running at `http://localhost:4000`.

### Scripts

- `npm run dev`: Starts the application with hot reloading via `tsx`.
- `npm run build`: Compiles TypeScript files into JavaScript in the `dist` directory.
- `npm run start`: Runs the compiled production build.
- `npm test`: Runs test suite.

## Docker Setup

To build and run the entire application using Docker:

```bash
docker compose up --build
```
