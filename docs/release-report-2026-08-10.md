# Production release hardening report — 2026-08-10

## Outcome

All production blockers that can be completed without external credentials or infrastructure access were implemented. Unsigned Windows packaging is validated for local testing. Publication remains intentionally blocked until a real Authenticode identity, a deployed production environment, and a current production backup are supplied to the strict release verifier.

## Controls added

- Electron Builder automatic `CSC_LINK` and `CSC_KEY_PASSWORD` signing path, with signing left enabled.
- `release:win`, strict `release:verify`, and local-only `release:verify:unsigned` commands.
- Artifact presence, size, freshness, SHA-256, and Authenticode verification.
- Production secret, auth mode, HTTPS origin, TLS assertion, storage path, and client-origin consistency checks.
- Production `.env` files disabled unless explicitly allowed for controlled self-hosting.
- HTTPS proxy enforcement for API routes and HSTS responses.
- SQLite online backups with integrity checks and SHA-256 manifests.
- Startup/interval backup scheduling with overlap protection.
- Backup freshness verification and guarded atomic restore with pre-restore rollback copy.
- Migration and backup mechanism validation in the release verifier.
- CI unsigned-release structural validation.
- First-deployment, upgrade, rollback, restore, disaster recovery, signing, and release-checklist documentation.

## Validation evidence

- Desktop lint: passed with 10 pre-existing warnings and no errors.
- Formatting: passed.
- Desktop type-check: passed.
- Desktop tests: 24/24 passed.
- Desktop build: passed.
- Desktop coverage: 81.84% statements, 82.61% lines.
- Backend tests: 19/19 passed.
- Backend audit: zero findings.
- Mobile lint: passed with 3 pre-existing warnings and no errors.
- Mobile type-check: passed.
- Mobile tests: 7/7 passed.
- Expo Doctor: 20/20 passed.
- Expo web export: passed.
- NSIS installer build: passed.
- Portable Windows build: passed.
- Packaged startup: passed and remained responsive.
- Unsigned release verifier: passed; both artifacts explicitly reported `NotSigned`.
- Strict production verifier without release credentials: failed closed on missing production environment, backup, certificate credentials, and valid signatures.

Unsigned artifact hashes from the final validation build:

- `MoneyWise Setup 1.0.0.exe`: `156f31ef74d0dabff2b28f3b5d190c50f5b7120f3e8997169e9050d13d0db3c9`
- `MoneyWise 1.0.0.exe`: `c2dd68f725d839d8580cea7830f731ad632da6342d644e7f2cbc6a725398145b`

## External conditions still required for publication

1. Supply a trusted Authenticode certificate through protected `CSC_LINK` and `CSC_KEY_PASSWORD` secrets.
2. Deploy behind a verified TLS proxy with direct backend-port access blocked.
3. Supply production environment variables and persistent database/backup volumes.
4. Create and verify the first production backup.
5. Run `npm run release:win`; publication is permitted only when strict verification passes.

No certificate was generated, no production secret was fabricated, no production data was modified, and nothing was pushed.
