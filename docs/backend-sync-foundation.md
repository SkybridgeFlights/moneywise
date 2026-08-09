# Backend Sync Foundation

MoneyWise now ships with a standalone backend under `backend/` that keeps the existing sync API shape but upgrades the implementation to a real SQLite database.

## Stack

- Node built-in `http`
- Node built-in `sqlite`
- `zod`

Why SQLite now:

- real transactional persistence instead of JSON file writes
- no new external database dependency was required in this environment
- keeps the repository layer clean for a future PostgreSQL or hosted database move
- preserves the current sync API contract for desktop and mobile

## Persistence model

Tables:

- `users`
- `sessions`
- `finance_records`

Remote sync records keep:

- `sync_id`
- `user_id`
- `entity_type`
- `record_id`
- `payload_json`
- `created_at`
- `updated_at`
- `deleted_at`
- `version`
- `last_modified_by_device_id`

The backend will also import legacy JSON backend data one time if the SQLite database is empty and a legacy JSON file is found beside it.

## Auth foundation

Supported auth flows:

- `POST /api/auth/dev-session` (development only; always rejected in production)
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/refresh`
- `POST /api/auth/logout`
  - kept for practical local testing and development
- `POST /api/auth/register`
  - email + password account creation
- `POST /api/auth/login`
  - email + password session creation
- `GET /api/auth/session`
  - current authenticated session and user info
- `POST /api/auth/logout`
  - revoke the current session

Session handling:

- opaque bearer token
- token hash stored server-side
- session expiry
- revocation support

Current auth modes:

- `hybrid`
  - password auth plus dev-session support
- `password-only`
  - disables dev-session creation

## Sync API

Health:

- `GET /health`

Sync:

- `GET /api/sync/bootstrap`
- `GET /api/sync/changes?since=<iso timestamp>`
- `POST /api/sync/push`
- `PUT /api/sync/records/:entityType/:recordId`
- `DELETE /api/sync/records/:entityType/:recordId`

These endpoints remain compatible with the existing desktop and mobile sync clients.

## Conflict model

Current conflict strategy remains unchanged:

- client sends `baseVersion` when known
- backend rejects stale writes with `409`
- clients stay local-first and deterministic

## Run

1. Copy `.env.backend.example` to `.env.backend` if needed.
2. Start the backend:

```powershell
npm.cmd run backend:start
```

Default local URL:

- `http://127.0.0.1:8787`

Default SQLite path:

- `backend-data/moneywise-sync.sqlite`

## What remains before production

- password reset / email verification
- stronger auth rate limiting
- refresh-token or short-lived access-token strategy
- hosted database and backup strategy
- end-to-end sync telemetry
