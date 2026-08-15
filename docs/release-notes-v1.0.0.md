# MoneyWise v1.0.0 — free unsigned Windows x64 release

MoneyWise v1.0.0 is a free Windows personal-finance application. This release includes:

- an encrypted local desktop financial database with protected per-profile key material;
- password-based account authentication and Turso-backed synchronization;
- exact integer-cent calculations for income, expenses, transfers, debts, budgets, savings goals, and supported financial records;
- account-isolated synchronization using the cross-platform-compatible moneyVersion 2 contract;
- tested failure-recovery and profile-reconstruction paths; and
- an independent encrypted backup and disaster-recovery architecture for synchronized cloud data.

## Important release information

- **FREE:** MoneyWise v1.0.0 is distributed free of charge.
- **UNSIGNED WINDOWS BINARIES:** The installer and portable executable do not have an Authenticode publisher signature. Windows SmartScreen or **Unknown Publisher** may appear because Windows cannot verify the publisher. Download only from the official MoneyWise GitHub release and compare the file's SHA-256 checksum with the published manifest.
- MoneyWise does not include an automatic updater. Obtain future versions from the project's official release source.
- The Render Free backend may have a cold-start delay after inactivity.
- The mobile client remains under development and is not included in, or certified for, this public release.

The absence of an Authenticode signature is disclosed intentionally; this release does not claim that Windows has verified its publisher.
