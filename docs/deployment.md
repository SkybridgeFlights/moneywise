# Production deployment runbook

This runbook covers first deployment, upgrades, rollback, backup, restore, and disaster recovery. Production releases use Node 24 and immutable application artifacts. SQLite data and backups must reside on persistent storage.

## Architecture and TLS boundary

The backend listens for HTTP inside its trusted platform network. Render, a load balancer, or a reverse proxy must terminate TLS and forward only HTTPS public traffic. Production startup requires:

- `PUBLIC_BASE_URL` or platform-provided `RENDER_EXTERNAL_URL` beginning with `https://`
- `MONEYWISE_TLS_TERMINATED=true`
- direct access to the backend container port blocked by the hosting network
- TLS 1.2 or newer, automatic certificate renewal, and HTTP-to-HTTPS redirect at the proxy

`MONEYWISE_TLS_TERMINATED=true` is an operator assertion that the proxy configuration has been verified. It does not enable TLS in Node.

## Required production environment

Set secrets in the hosting platform's encrypted environment store, not in repository files or `EXPO_PUBLIC_*` variables.

```text
NODE_ENV=production
HOST=0.0.0.0
PORT=<platform port>
DATABASE_PATH=/data/moneywise-sync.sqlite
BACKUP_DIRECTORY=/data/backups
AUTH_SECRET=<at least 32 cryptographically random characters>
PUBLIC_BASE_URL=https://sync.example.com
MONEYWISE_TLS_TERMINATED=true
MONEYWISE_BACKEND_AUTH_MODE=password-only
MONEYWISE_BACKEND_ACCESS_TOKEN_TTL_MINUTES=15
MONEYWISE_BACKEND_SESSION_TTL_DAYS=30
MONEYWISE_BACKUP_MAX_AGE_HOURS=24
MONEYWISE_BACKUP_INTERVAL_HOURS=24
MONEYWISE_BACKEND_LOG_LEVEL=info
```

Production ignores `.env` and `.env.backend` by default. `MONEYWISE_ALLOW_ENV_FILES=true` exists only for controlled self-hosted environments where file permissions and secret rotation are managed externally.

Desktop and mobile production bundles must use the same origin:

```text
MONEYWISE_SYNC_ENABLED=true
MONEYWISE_SYNC_URL=https://sync.example.com
EXPO_PUBLIC_MONEYWISE_SYNC_ENABLED=true
EXPO_PUBLIC_MONEYWISE_SYNC_URL=https://sync.example.com
```

These client URLs are public configuration. Passwords, API secrets, access tokens, and refresh tokens must never be added to them.

## First deployment

1. Provision persistent storage with separate database and backup paths.
2. Configure TLS termination, certificate renewal, HTTP redirect, and network rules preventing direct container access.
3. Generate `AUTH_SECRET` using a cryptographically secure secret manager. Do not reuse development credentials.
4. Set every required environment variable above.
5. Deploy the immutable backend image built from `backend/Dockerfile`.
6. Confirm startup succeeds and `/health` reports `password-only` and `sqlite`.
7. Register a test account, verify login/refresh/logout, and confirm `/api/auth/dev-session` returns 403.
8. Run the first backup: `npm --prefix backend run backup`.
9. Verify it: `npm --prefix backend run backup:verify`.
10. Build the signed clients and run `npm run release:verify` from the controlled Windows release runner.
11. Perform the cross-client synchronization checklist before enabling general access.

## Upgrades

1. Review schema and dependency changes; never alter the live database manually.
2. Run all CI gates against the exact commit.
3. Put the release in maintenance mode or stop writers.
4. Run and verify a fresh backup.
5. Record the deployed commit, image digest, schema version, artifact hashes, and backup filename.
6. Deploy one backend instance and inspect startup/migration logs.
7. Run health, authentication, migration, and synchronization smoke tests.
8. Deploy signed clients only after the backend is healthy and backward compatibility is confirmed.
9. Retain the previous image and client artifacts through the rollback window.

Migrations create a one-time pre-v2 backup before modifying an existing schema. Operational backups are still required before every deployment.

## Rollback

Application-only rollback is preferred when the previous application version supports the current schema:

1. stop or drain the failing deployment;
2. redeploy the previous immutable image digest;
3. verify health and authentication;
4. run a read/write synchronization smoke test.

If the schema or data is incompatible, use the restore procedure below. Never copy an older database over a live writer. Client rollback requires the previously signed installer and matching SHA-256 record.

## Backup schedule and retention

The backend checks backup freshness at startup and every `MONEYWISE_BACKUP_INTERVAL_HOURS`; only one backup job can run at a time. Also run `npm --prefix backend run backup` immediately before every deployment. Each backup uses SQLite's online backup API and produces:

- `moneywise-<UTC timestamp>.sqlite`
- a matching `.sqlite.json` manifest containing creation time, byte size, and SHA-256

Run `npm --prefix backend run backup:verify` after creation and from monitoring. Alert when no valid backup exists within `MONEYWISE_BACKUP_MAX_AGE_HOURS`.

Copy verified backups to a second encrypted failure domain. Apply retention appropriate to policy; a recommended baseline is 7 daily, 5 weekly, and 12 monthly copies. Test restoration quarterly. Do not treat the migration backup on the primary disk as disaster recovery.

## Restore procedure

1. Stop every backend instance and prevent new writers.
2. Select a backup and matching manifest from the desired recovery point.
3. Verify checksum, age, and SQLite integrity with `npm --prefix backend run backup:verify` when it is the latest backup, or an offline verification copy.
4. Set the normal production environment, including `DATABASE_PATH`.
5. Run:

```powershell
$env:MONEYWISE_CONFIRM_RESTORE='YES'
npm.cmd --prefix backend run restore -- --from=C:\secure-backups\moneywise-<timestamp>.sqlite
```

6. The tool verifies the source, preserves the current database as a timestamped `.pre-restore-*` rollback copy, installs the backup atomically, and verifies the result.
7. Start one backend instance and run migrations.
8. Verify health, account login, record counts, and synchronization before reopening traffic.
9. Retain the pre-restore copy until business validation is complete.

## Disaster recovery

For complete host or region loss:

1. declare the incident and freeze client release activity;
2. provision a clean Node 24 environment and persistent encrypted storage in the recovery region;
3. deploy the last known-good immutable backend image;
4. restore the newest verified off-site backup using the procedure above;
5. configure a new TLS endpoint or update DNS with a deliberately low incident TTL;
6. rotate `AUTH_SECRET` only if compromise is suspected—rotation invalidates active sessions;
7. validate authentication, migrations, record counts, cursor progression, and cross-client synchronization;
8. reopen traffic gradually and monitor errors, latency, storage growth, and backup creation;
9. document recovery-point loss and complete a post-incident review.

Recovery objectives must be set by the operator. With daily backups the technical RPO can be up to 24 hours; RTO depends on platform provisioning and backup size.

## Production smoke checklist

1. production startup accepts the environment;
2. health endpoint is reachable only through HTTPS;
3. dev-session returns 403;
4. register, login, refresh, and logout succeed;
5. desktop and mobile sign in independently;
6. bidirectional synchronization succeeds;
7. offline changes reconnect without duplication;
8. a fresh backup is created and verified;
9. logs contain no credentials or filesystem details in client responses;
10. monitoring and alerts are active.
# Backup retention and infrastructure boundary

The backend retains one backup per hour for `MONEYWISE_BACKUP_KEEP_HOURLY_HOURS`, one per day for `MONEYWISE_BACKUP_KEEP_DAILY_DAYS`, and one per week for `MONEYWISE_BACKUP_KEEP_WEEKLY_WEEKS`. The newest valid backup and any backup carrying a `.lock` verification/restore marker are never removed. `MONEYWISE_BACKUP_MIN_FREE_MB` reserves free space before backup creation.

The default Render configuration still stores `/data/backups` on the same persistent disk as the live SQLite database. This protects against logical corruption and failed upgrades, but **does not protect against disk or service-volume loss**. Production operations must replicate completed `.sqlite` and matching `.json` manifest pairs to an independently managed off-site destination. `MONEYWISE_BACKUP_DIRECTORY` may point to a separately mounted destination; no cloud credentials are included in the repository.

# Trusted proxy and rate limiting

`MONEYWISE_TRUSTED_PROXIES` is mandatory when production TLS is terminated upstream. It accepts explicit peer addresses or the constrained `loopback`, `linklocal`, and `uniquelocal` rules. Forwarded protocol and client-address headers are ignored unless the immediate TCP peer matches a configured rule. The Render deployment uses `uniquelocal`; operators must verify the actual proxy peer range before release and narrow it to explicit addresses where the platform permits.

Rate limiting is bounded but process-local. Multiple backend replicas require enforcement at the trusted gateway or a future shared limiter adapter. The repository does not claim distributed rate limiting without an external shared service.
