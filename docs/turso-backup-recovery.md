# Turso independent backup and recovery

MoneyWise production data is stored in Turso. This runbook covers the independent encrypted logical exports stored in a private Cloudflare R2 bucket. It does not change the Render application database configuration automatically.

## Backup schedule and storage

`.github/workflows/turso-backup.yml` runs daily at 03:17 UTC and can be dispatched manually. It downloads Turso's documented logical SQL dump with a database-scoped read-only token, reconstructs the dump in isolated temporary SQLite storage, validates the schema and invariants, encrypts it with AES-256-GCM, uploads it to R2, and reads the objects back before promotion.

`.github/workflows/turso-backup-verify.yml` runs Sundays at 04:43 UTC and can be dispatched manually. It downloads the latest valid generation, verifies and decrypts it, reconstructs SQLite in temporary storage, and compares its schema, migration history, table counts, foreign keys, maximum revision, idempotency data, ownership relationships, and representative reads with the manifest.

The repository or protected `production-backup` environment must contain these secrets:

- `TURSO_DATABASE_URL`
- `TURSO_BACKUP_TOKEN` — database-scoped and read-only; never reuse the application token
- `BACKUP_ENCRYPTION_KEY` — base64 encoding of exactly 32 random bytes
- `R2_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET`

The R2 credentials must be Object Read & Write credentials scoped to only the private backup bucket. Public bucket access must remain disabled. The encryption key must also be retained in a protected operational password manager independent of GitHub and Cloudflare. Losing this key makes every R2 generation unrecoverable.

## Generation validity and retention

Objects use these keys:

```text
generations/<UTC timestamp>-<UUID>/database.sql.aesgcm
generations/<UTC timestamp>-<UUID>/manifest.json
state/latest-valid.json
state/last-known-good.json
```

A generation starts as `verifying`. It becomes `valid` only after ciphertext and manifest upload, full object readback, metadata/size/hash verification, authenticated decryption, and plaintext comparison. State pointers are uploaded and read back only after that promotion.

Retention preserves the union of seven newest UTC daily generations, four newest ISO-week generations, and three newest monthly generations. It additionally protects the newest valid generation, the generation being verified, and the previously known-good generation. Malformed and unverified generations are reported but never automatically deleted.

## Monitoring

Treat any failed scheduled workflow as an operational incident. Alert if:

- `state/latest-valid.json` is missing or older than 36 hours;
- the weekly verification is older than 8 days;
- a monthly restore drill is older than 35 days;
- export, reconstruction, encryption, upload, readback, promotion, or retention fails;
- R2 usage approaches the configured storage budget;
- the scheduled workflow becomes disabled after repository inactivity.

Workflow logs must contain only generation identifiers, timestamps, counts, and status. Never enable shell tracing or print environment variables. GitHub log retention is not a backup status database; monitor workflow conclusions and backup age independently.

## Choosing PITR or R2

Use Turso point-in-time recovery first for a recent logical incident within the plan's PITR window. PITR creates a new database and is the fastest way to recover a recent accidental write or schema change.

Use the independent R2 export when Turso/account/project data is unavailable, the source database was deleted, the incident predates PITR, or corrupted logical state was discovered late. R2 recovery requires the independent encryption key.

## Non-overwriting restore drill

Never restore into the production database. Never update Render credentials until every verification below passes and an operator explicitly approves cutover.

Prerequisites:

1. Install the current official Turso CLI.
2. Configure bucket-scoped R2 read credentials and `BACKUP_ENCRYPTION_KEY` in the operator environment.
3. Configure an organization-scoped Turso platform token as `TURSO_API_TOKEN` and organization slug as `TURSO_ORG`.
4. Select the generation UUID from `state/latest-valid.json` or another verified manifest.
5. Choose a unique disposable database name beginning with `mw-restore-`.

Run:

```text
npm --prefix backend ci
npm --prefix backend run backup:turso:restore -- --generation <UUID> --database-name mw-restore-<timestamp>
```

The tool downloads the encrypted artifact and manifest, checks ciphertext size/hash, authenticates and decrypts with AES-256-GCM, checks plaintext size/hash, and reconstructs it locally. It then uses Turso's supported `db create --from-dump` path to create a new database, generates a temporary one-hour database token without printing it, and verifies migration history, table counts, foreign keys, revision high-water mark, idempotency JSON, ownership relationships, and representative financial data. Temporary plaintext files are removed in a `finally` path.

The tool stops after verification and has no Render integration or cutover option. Retain the disposable database for review until the drill is signed off, then delete it manually only after resolving its exact name.

## Production recovery after a successful drill

1. Preserve the failed production database for investigation; do not overwrite or delete it.
2. Generate a new long-lived application database token for the verified restored database.
3. Record the restored database identifier, source generation UUID, manifest hash, verification result, and approving operator.
4. Update Render's `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` only after explicit approval.
5. Redeploy Render and run health, authentication, account-isolation, bootstrap, sync, revision, and idempotency smoke checks.
6. Switch user traffic only after all smoke checks pass.
7. Keep the previous database and backup generation until the incident review and rollback window close.
