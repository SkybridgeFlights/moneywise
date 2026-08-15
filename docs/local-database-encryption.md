# Desktop local database encryption

## Architecture decision

MoneyWise uses full-database encryption rather than field-level encryption. The desktop database binding is pinned to `better-sqlite3-multiple-ciphers` and configured for its SQLCipher-compatible cipher. The database pages are encrypted using AES-256-CBC with random per-page initialization vectors and authenticated by the cipher's per-page HMAC. This mature format preserves the existing SQLite schema, foreign keys, indexes, transactions, synchronization identifiers, revisions, timestamps, tombstones, and query behavior. It also ensures sensitive values are encrypted before SQLite writes database, WAL, journal, or temporary pages.

Each account profile receives an independent cryptographically random 32-byte data-encryption key. Electron `safeStorage` wraps that key using the operating system's protected storage (Windows DPAPI). Only the wrapped blob and non-secret format/profile identifiers are persisted. The key is used only in the trusted Electron main process and is never exposed through preload IPC, synchronized to Turso, uploaded to R2, placed in exports, or bundled with the application.

The profile directory name, database format version, migration state, SQLite schema, record identifiers, and file sizes remain observable to someone who copies the profile. Financial field values and database contents do not.

## Threat model

This protects financial records from offline profile/database theft, casual SQLite inspection, leaked profile backups, possession of database sidecars without the Windows protected key, and local cross-account key reuse. Separate account profiles have separate protected keys.

It does not protect against malware running as the logged-in unlocked Windows user, a compromised operating system, or an attacker controlling the Electron main process at runtime. Plaintext explicitly exported by the user is also outside this protection.

## Migration and activation

An existing profile database is never overwritten in place. Migration follows this restart-safe sequence:

1. Detect the plaintext source and persist migration state.
2. Generate and persist the OS-wrapped account key.
3. checkpoint and integrity-check the plaintext database.
4. Copy it to a staging generation and encrypt that copy.
5. Reopen the encrypted copy, authenticate it, run SQLite integrity checks, and compare schema plus every table row count with the source.
6. Atomically activate the staged encrypted generation.
7. Reopen and verify the active generation.
8. Remove the plaintext database and SQLite sidecars only after successful post-activation verification.
9. Persist the completed state.

Every state transition is persisted through a temporary file, file flush, and atomic rename. Startup resumes any incomplete stage. If a crash occurs before activation, the original plaintext source remains valid. If it occurs after activation, startup authenticates the encrypted generation and compares it to the retained source before cleanup. Repeated execution is idempotent.

Logical file deletion removes plaintext migration generations and sidecars after verification. Filesystem deletion cannot promise forensic erasure of previously allocated sectors on SSDs or user-controlled external backups; Windows device encryption and secure disposal of old backups remain relevant.

## Key loss and recovery

MoneyWise never silently generates a replacement key when an encrypted database already exists. If `safeStorage` is unavailable, the protected key is missing or corrupt, DPAPI cannot unwrap it, the profile was copied to another Windows context, or the ciphertext fails authentication, opening the profile fails closed.

Logout and account switching retain each profile and its protected key. A normal application reinstall that preserves the same Electron user-data directory and Windows user context can continue to unwrap it. Copying the profile to another computer, reinstalling Windows, deleting the user-data directory, or losing the Windows profile can make the local database unrecoverable.

For an authenticated account, data already synchronized to Turso can be rebuilt into a fresh local encrypted profile through the normal bootstrap/synchronization path. Unsynchronized local changes and local-only activity/notification state cannot be reconstructed from Turso. The server is not a key escrow and never receives the local database key.

## User exports

JSON, CSV, and XLSX exports are plaintext by explicit user request. Export generation operates directly in memory where the library permits and does not include key documents or encryption metadata. Exported files must be stored and shared as sensitive financial documents.
