# Mobile release certification

This document covers the mobile client only. It does not certify or publish an Android or iOS binary.

## Local persistence threat model

| Data | Persistence after the v3 migration | Classification |
| --- | --- | --- |
| Income, expenses, categories, budgets, goals, debts, and monthly summaries | Per-account AES-256-GCM envelope in AsyncStorage | ENCRYPTED |
| Financial settings and balance-correction data | Finance envelope | ENCRYPTED |
| Pending sync request body and request ID | Sync envelope | ENCRYPTED |
| Sync manifest, tombstones, cursor, revisions, and bootstrap state | Sync envelope | ENCRYPTED |
| Device ID, account email, user ID, authentication mode, access-token expiry, and sync status metadata | Sync envelope | ENCRYPTED |
| Access token | Expo SecureStore | OS-PROTECTED |
| Refresh token | Expo SecureStore | OS-PROTECTED |
| Per-profile AES-256 key | Expo SecureStore; never included in a finance/sync envelope | OS-PROTECTED |
| Active account identifier | Expo SecureStore | OS-PROTECTED |
| Storage format version, ownership classification, and opaque encoded profile locator used in AsyncStorage key names | AsyncStorage; contains no financial payload or credential | PLAINTEXT |
| Password | Used for the authentication request only | NOT PERSISTED |

Native persistence uses Expo Crypto AES-256-GCM with a fresh library-generated nonce and a 16-byte authentication tag. Authenticated additional data binds each envelope to version 3, its account scope, and its payload kind. Each account receives an independently generated key. Expo SecureStore protects values with Android Keystore-backed encryption on Android and Keychain services on iOS. The web build deliberately does not persist mobile finance or authentication state because it cannot use the native SecureStore boundary.

No encryption key is logged, sent to the backend, synchronized to Turso, or included in export/backup data. Missing keys, invalid keys, malformed envelope metadata, account-swapped envelopes, and failed authentication tags raise a storage error; they do not create or save an empty replacement profile.

## Plaintext migration and recovery

The v1/v2 plaintext source remains in place while an encrypted staging envelope is written and authenticated. The final encrypted envelope is then written and authenticated before the staging entry and plaintext source are removed. Restarting at any step repeats or completes the operation idempotently. Unknown-owner legacy data is retained only as an encrypted quarantine rather than being exposed to a different account.

Deterministic tests inject interruption after staging write, final encrypted write, encrypted verification, and immediately before plaintext deletion. In every case the plaintext source remains until a verified encrypted copy exists, and a restart completes migration without loss. These tests do not substitute for physical-device filesystem inspection.

If SecureStore key material is lost while encrypted AsyncStorage survives, the client fails closed. It must not silently replace the profile. Synchronized state can be reconstructed after authentication from Turso into a new profile; unsynchronized/local-only state cannot be recovered without its original key. On Android, app deletion removes SecureStore data. On iOS, Keychain entries may survive deletion and reinstall with the same bundle ID, but this behavior is not guaranteed and is not treated as a backup mechanism.

## Native configuration snapshot

- Android application ID: `com.moneywise.mobile`
- Android version name/code: `1.0.0` / `1`
- iOS bundle ID: `com.moneywise.mobile`
- iOS version/build: `1.0.0` / `1`
- Production sync origin: `https://moneywise-f4jh.onrender.com`
- Authentication: password-only; production dev-session is unsupported
- Canonical finance protocol: `moneyVersion: 2`, integer minor units

Android distribution requires a real Play upload/signing key. iOS distribution requires an Apple Developer identity, provisioning profile, and macOS/Xcode build environment. No credentials are generated or embedded by this certification.

## Dependency advisory triage

The official npm audit reports 10 High and 8 Moderate package-level findings, with zero Critical findings. Expo's supported SDK 57 patch updates were applied first. The remaining findings are build/configuration tool paths rather than code shipped as a reachable MoneyWise finance/authentication runtime path.

| Package | Severity | Reachability and platform | Supported fix |
| --- | --- | --- | --- |
| `expo` | High | Direct toolchain root used to build both platforms; advisory is inherited from CLI/config/Metro | No compatible audit fix; npm proposes an incompatible SDK downgrade |
| `react-native` | High | Direct native runtime package, but reported path is its community CLI → Metro build tooling, not a native runtime API | No compatible audit fix; npm proposes an incompatible React Native downgrade |
| `@expo/cli` | High | Build/dev CLI for Android and iOS | No compatible audit-clearing version in the SDK 57 tree |
| `@expo/metro` | High | JavaScript bundler integration for Android and iOS builds | No compatible audit-clearing version in the SDK 57 tree |
| `@expo/metro-config` | High | Bundler configuration for Android and iOS builds | No compatible audit-clearing version in the SDK 57 tree |
| `@react-native/community-cli-plugin` | High | Native build CLI integration for Android and iOS | No compatible audit fix |
| `metro` | High | Build-time bundler; findings include parsers invoked on developer/build inputs | No compatible audit fix |
| `metro-config` | High | Build-time bundler configuration | No compatible audit fix |
| `metro-transform-worker` | High | Build-time transform worker | No compatible audit fix |
| `image-size` | High | Metro build-time image parser; malicious ICNS/JXL/HEIF build input can cause denial of service; no MoneyWise runtime input path | No fixed npm release exists beyond current vulnerable latest `2.0.2` |
| `@expo/config` | Moderate | App configuration tooling for Android and iOS builds | No compatible audit fix |
| `@expo/config-plugins` | Moderate | Native project generation; Android/iOS build-time only | No compatible audit fix |
| `@expo/inline-modules` | Moderate | Metro/build-time transformation | No compatible audit fix |
| `@expo/local-build-cache-provider` | Moderate | Local build cache tooling | No compatible audit fix |
| `@expo/prebuild-config` | Moderate | Android/iOS native project generation | No compatible audit fix |
| `expo-splash-screen` | Moderate | Direct native feature, but reported path is its config plugin → Xcode project tooling | No compatible SDK 57 audit fix |
| `xcode` | Moderate | iOS project-file generation on the build host only | No compatible upstream fix in the Expo tree |
| `uuid` | Moderate | Reached only through the `xcode` build tool; vulnerable buffer-taking APIs are not called by MoneyWise runtime | Patched major exists, but forcing it over the upstream pin is unsupported |

These findings can affect a build host processing hostile project assets, especially through denial of service, but no advisory has a demonstrated path from an untrusted mobile user or synchronized financial payload into the released Android/iOS runtime. They remain items for re-audit when Expo publishes a compatible patched tree.

## Physical-device acceptance plan

Run the following independently on a supported physical Android device and physical iPhone, using disposable accounts and records:

1. Install the release candidate and confirm identity, permissions, version, HTTPS backend, and first-launch behavior.
2. Register and log in; verify access-token expiry and refresh rotation without exposing tokens in logs.
3. Write recognizable income, expense, budget, goal, debt, settings, and pending-sync canaries; restart and verify exact integer cents.
4. Inspect AsyncStorage, application files, caches, temporary storage, device logs, and crash logs. Financial canaries, tokens, and key material must be absent in plaintext.
5. Go offline, write exact-cent changes, restart, reconnect, and verify one idempotent mutation with no drift.
6. Synchronize Desktop → Mobile → Desktop, including edits and tombstones, and confirm IDs, account ownership, revisions, and cents.
7. Explicitly log out while online and offline. SecureStore access/refresh credentials and active-account metadata must be removed locally while retained encrypted finance remains separate.
8. Exercise account A → B → A. Confirm each profile remains intact, neither account can load the other's data, and pending requests retain the correct owner.
9. Corrupt an encrypted test envelope and separately remove/corrupt its protected test key. Confirm fail-closed behavior and no empty-profile replacement.
10. Uninstall and reinstall. On Android, verify expected Keystore/key deletion and synchronized-profile reconstruction. On iOS, test both observed Keychain-survival and missing-key paths without assuming survival.
11. Verify notification preferences and other local-only settings according to platform behavior; do not claim recovery of unsynchronized data after key loss.
12. Capture OS/app versions, build hashes, screenshots, sanitized logs, and results. Native release certification remains blocked until both platforms complete this plan.
