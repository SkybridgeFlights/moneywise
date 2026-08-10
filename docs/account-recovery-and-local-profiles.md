# Account recovery and local profile isolation

## Legacy passwordless backend accounts

Backend startup marks every account without a password hash as `recovery-required`. Public registration always rejects an email that already exists, including inactive, migrated, development-session, and passwordless identities. Registration is not an activation mechanism.

MoneyWise does not currently have a verified email-delivery or identity-proofing service. Operators must therefore keep recovery-required accounts locked. Recovery may be performed only through a separately implemented process that proves control of a pre-established verified factor or through documented, authenticated operator identity verification. Knowing the email address, possessing a local database, or presenting historical financial values is not sufficient proof. No password should be assigned manually until that process exists.

The account row and all associated financial records remain unchanged and attached to the original user ID while recovery is pending.

## Desktop local profiles

Desktop finance databases and synchronization state are stored under separate profile directories derived from a SHA-256 hash of the backend user ID. Authentication completes before the profile is selected. Logout closes the account context and retains its files.

On the first profile-aware startup, the former unscoped SQLite database is migrated only when persisted protected synchronization state contains a user ID. SQLite creates and verifies a consistent copy for that profile before the original database and its WAL/SHM files are moved into the quarantine directory. If ownership is unknown, the original files are quarantined without being assigned to an account.

Quarantined data must be recovered through an explicit operator/user-assisted export and import after ownership is independently established. It must never be copied into the profile of whichever user logs in next.

## Mobile local profiles

Mobile finance state, synchronization metadata, access tokens, and refresh tokens use account-specific namespaces derived from an opaque deterministic profile identifier. The active profile is recorded separately. Logout clears the active-profile selection but retains the account namespace.

Legacy mobile data is migrated only when its persisted synchronization state contains an authenticated backend user ID. Otherwise, the legacy finance and sync documents are copied into quarantine keys and are not loaded into an authenticated profile. Legacy tokens with ambiguous ownership are removed from active secure storage.

## Account-transition ordering

Desktop and mobile transitions cancel queued synchronization and wait for the current synchronization operation before changing profile context. Mobile additionally uses an account-generation guard so a stale asynchronous result cannot update the newly selected account. Only after authentication succeeds are the target account's finance and synchronization stores loaded.
