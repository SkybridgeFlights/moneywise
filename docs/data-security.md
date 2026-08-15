# Local data and credential security

MoneyWise is local-first. Desktop financial records are held in a fully encrypted SQLite database in the user's Electron application-data directory. Each desktop account profile has an independent random 256-bit database key. The key is wrapped with Electron `safeStorage` (Windows DPAPI) and is never exposed to the renderer, synchronized, exported, or stored alongside the database in plaintext. SQLite pages are encrypted with the maintained SQLCipher-compatible cipher in `better-sqlite3-multiple-ciphers`; page authentication detects modification before plaintext is returned.

Mobile financial records remain in the application's AsyncStorage container and are outside the desktop-at-rest remediation. User-requested JSON, CSV, and spreadsheet exports are intentionally unencrypted because the user selected a plaintext export; they must be handled as sensitive data.

Authentication credentials are handled separately from finance records:

- Desktop access and refresh tokens are encrypted with Electron `safeStorage`, backed by the operating-system credential protection service. Sync authentication fails safely when that protection is unavailable.
- iOS and Android access and refresh tokens are stored with Expo SecureStore in Keychain/Keystore and are never written to AsyncStorage.
- Web builds keep tokens in memory only and require authentication again after restart because browsers do not provide an equivalent application-owned secure credential store.
- Passwords are used only for an interactive login or registration request. They are not persisted and are not accepted through build-time or public environment variables.

Access tokens expire after 15 minutes by default. Refresh tokens are opaque, stored only as HMAC hashes on the server, rotated on every refresh, and invalidated on logout or replay.

See [local-database-encryption.md](./local-database-encryption.md) for the desktop key hierarchy, migration/recovery behavior, threat model, and limitations.
