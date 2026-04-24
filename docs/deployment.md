# Deployment and Real-World Usage

This phase prepares MoneyWise for real deployment without changing finance behavior or sync rules.

## Recommended backend deployment

Recommended first target: **Render**.

Why:

- easiest persistent disk setup for SQLite
- simple Docker deployment from this repository
- health check support
- low operational overhead for a first production environment

Alternative supported options in this repo:

- Railway using `railway.json`
- VPS using `backend/Dockerfile`

## Backend production environment

Required backend environment variables:

- `NODE_ENV=production`
- `PORT=8787` or platform-provided port
- `HOST=0.0.0.0`
- `DATABASE_PATH=/data/moneywise-sync.sqlite`
- `AUTH_SECRET=<strong-random-secret>`
- `MONEYWISE_BACKEND_AUTH_MODE=hybrid`
- `MONEYWISE_BACKEND_SESSION_TTL_DAYS=30`

Notes:

- `AUTH_SECRET` is now used to HMAC session tokens before storage.
- SQLite must live on a persistent mounted disk.

## Desktop production sync configuration

Required desktop sync environment:

- `MONEYWISE_SYNC_ENABLED=true`
- `MONEYWISE_SYNC_URL=https://your-moneywise-backend.example.com`
- `MONEYWISE_SYNC_EMAIL=desktop-sync@example.com`
- `MONEYWISE_SYNC_PASSWORD=<account-password>`
- `MONEYWISE_SYNC_DEVICE_ID=desktop-main`

## Mobile production sync configuration

Set these Expo public variables:

- `EXPO_PUBLIC_MONEYWISE_SYNC_ENABLED=true`
- `EXPO_PUBLIC_MONEYWISE_SYNC_URL=https://your-moneywise-backend.example.com`
- `EXPO_PUBLIC_MONEYWISE_SYNC_EMAIL=mobile-sync@example.com`
- `EXPO_PUBLIC_MONEYWISE_SYNC_PASSWORD=<account-password>`
- `EXPO_PUBLIC_MONEYWISE_SYNC_DEVICE_ID=iphone-main`

## Desktop production build

Build Windows artifacts from the repo root:

```powershell
npm.cmd run package:win
```

Expected outputs under `release/`:

- NSIS installer `.exe`
- portable `.exe`

## Mobile production build

The repo now includes `mobile/eas.json` for iOS production builds.

Typical commands:

```powershell
cd mobile
npm.cmd run typecheck
npx eas build --platform ios --profile production
```

Local validation without Apple credentials:

```powershell
cd mobile
npx.cmd expo export --platform ios
```

## Real sync validation checklist

After backend deployment:

1. sign in on desktop and mobile with the same account
2. add an income on desktop and confirm it appears on mobile after sync
3. add an expense on mobile and confirm it appears on desktop after sync
4. test offline create/update on one device
5. reconnect and confirm pending changes sync once only
6. restart both apps and confirm state and session persist

## Current limitation

Actual cloud deployment and App Store/iOS signed build still require your platform credentials:

- Render/Railway/VPS access
- Apple / EAS credentials

This repo is now prepared for those steps, but this workspace cannot complete them without those external accounts.
