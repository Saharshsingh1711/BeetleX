# API Documentation

This document describes the API endpoints provided by the BeetleX Backend.

## Base URL
Default local endpoint: `http://localhost:4000`

---

## Health Check Endpoint

### GET `/health`
Returns the operational status of the service.

#### Request
- **Method**: `GET`
- **URL**: `/health`
- **Headers**: None

#### Response (Success - 200 OK)
```json
{
  "status": "OK",
  "timestamp": "2026-06-15T11:00:00.000Z",
  "uptime": 12.34
}
```
