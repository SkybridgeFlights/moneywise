# Local data and credential security

MoneyWise is local-first. Desktop financial records remain in the user's Electron application-data directory in SQLite. Mobile financial records remain in the application's AsyncStorage container. These records are protected by the operating system's user/app sandbox and device encryption when enabled, but MoneyWise does not currently add field-level encryption to the finance database. Exported JSON, CSV, and spreadsheet files are unencrypted and must be handled as sensitive data.

Authentication credentials are handled separately from finance records:

- Desktop access and refresh tokens are encrypted with Electron `safeStorage`, backed by the operating-system credential protection service. Sync authentication fails safely when that protection is unavailable.
- iOS and Android access and refresh tokens are stored with Expo SecureStore in Keychain/Keystore and are never written to AsyncStorage.
- Web builds keep tokens in memory only and require authentication again after restart because browsers do not provide an equivalent application-owned secure credential store.
- Passwords are used only for an interactive login or registration request. They are not persisted and are not accepted through build-time or public environment variables.

Access tokens expire after 15 minutes by default. Refresh tokens are opaque, stored only as HMAC hashes on the server, rotated on every refresh, and invalidated on logout or replay.
