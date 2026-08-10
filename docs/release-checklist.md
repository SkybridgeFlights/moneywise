# Production release checklist

## Change control

- [ ] Release commit is reviewed, immutable, and the worktree is clean.
- [ ] Version and release notes are approved.
- [ ] CI lint, formatting, type-check, tests, coverage, audits, and builds pass.
- [ ] Database changes have upgrade and recovery tests.
- [ ] Previous backend image and signed client artifacts remain available.

## Backend and data

- [ ] Node runtime is the pinned Node 24 release.
- [ ] Required production variables pass startup validation.
- [ ] `AUTH_SECRET` is unique, protected, and at least 32 characters.
- [ ] Authentication mode is `password-only`.
- [ ] TLS termination and direct-port network restrictions are verified.
- [ ] Persistent database and backup volumes have sufficient free space.
- [ ] A fresh backup and manifest pass integrity, checksum, and age validation.
- [ ] Scheduled backup interval is no greater than the maximum permitted backup age.
- [ ] A recent restore drill has succeeded.
- [ ] Health, login, refresh, logout, dev-session denial, and sync smoke tests pass.

## Windows artifacts

- [ ] `CSC_LINK` and `CSC_KEY_PASSWORD` are supplied only through protected runner secrets.
- [ ] NSIS and portable artifacts are present and plausibly sized.
- [ ] Both artifacts have `Valid` Authenticode signatures and trusted timestamps.
- [ ] Publisher identity and certificate expiry are correct.
- [ ] Packaged application launches and remains responsive.
- [ ] SHA-256 hashes and `release-validation.json` are retained.

## Client configuration

- [ ] Desktop and mobile sync are enabled for the intended environment.
- [ ] Both clients use the same HTTPS backend origin.
- [ ] No password, token, or secret exists in public/build-time variables.
- [ ] Cross-client, offline/reconnect, and account-switching checks pass.

## Go/no-go

- [ ] `npm run release:verify` passes on the controlled Windows release runner.
- [ ] Monitoring, alerting, backup scheduling, and on-call ownership are active.
- [ ] Rollback owner and decision deadline are recorded.
- [ ] Release approver signs off before publication.
