# MoneyWise Mobile (Expo)

The mobile app lives under `mobile/` and stays local-first with AsyncStorage.

## Current mobile scope

- dashboard
- expenses
- income
- goals
- debts
- settings
- optional backend sync

## Mobile sync UI

The mobile app now exposes:

- sync enabled / disabled messaging
- last sync time
- pending local change count
- account email and auth mode
- last sync error
- `Sync now`
- `Pause sync`
- local reset confirmation

## Environment

Set these Expo public variables before starting the app:

- `EXPO_PUBLIC_MONEYWISE_SYNC_ENABLED=true`
- `EXPO_PUBLIC_MONEYWISE_SYNC_URL=http://127.0.0.1:8787`
- `EXPO_PUBLIC_MONEYWISE_SYNC_EMAIL=mobile-sync@example.com`
- `EXPO_PUBLIC_MONEYWISE_SYNC_PASSWORD=your-password`
- `EXPO_PUBLIC_MONEYWISE_SYNC_DEVICE_ID=iphone-main`

If the password is omitted, the mobile app falls back to the backend dev-session flow when allowed.

## Mobile sync behavior

- local data loads first from AsyncStorage
- sync is optional
- manual sync is available from the app shell and Settings
- paused sync keeps local usage fully available
- offline errors are shown as status, not blank screens

## Run

```powershell
cd mobile
npm.cmd run typecheck
npm.cmd run start
```

For iOS bundle export:

```powershell
cd mobile
npx.cmd expo export --platform ios
```

## Known limitation

The mobile app already stores the selected language and currency, but full mobile UI localization is still a follow-up item.
