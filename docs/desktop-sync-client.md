# Desktop Sync Client

The desktop app remains local-first. SQLite is still the primary desktop store. Sync is optional and can be enabled per device.

## Desktop behavior

- renderer always loads from local SQLite first
- sync runs in the main process only
- backend failures never block normal desktop finance usage
- manual sync and sync status are visible in the existing Settings screen

## Desktop sync status now shown in UI

The desktop Settings screen now shows:

- sync enabled / disabled
- backend reachability
- last successful sync time
- pending local change count
- backend URL
- device ID
- account email
- auth mode
- last sync error if present

It also provides:

- `Sync now`
- `Refresh status`
- `Pause sync on this device`

## Environment

Desktop sync is still config-based:

- `MONEYWISE_SYNC_ENABLED=true`
- `MONEYWISE_SYNC_URL=http://127.0.0.1:8787`
- `MONEYWISE_SYNC_EMAIL=desktop-sync@example.com`
- `MONEYWISE_SYNC_PASSWORD=your-password`
- `MONEYWISE_SYNC_DEVICE_ID=desktop-main`

If `MONEYWISE_SYNC_PASSWORD` is omitted, the desktop client falls back to the dev-session auth route when the backend allows it.

## Sync flow

1. optional backend health check
2. create or resume session
3. first bootstrap if needed
4. pull remote changes since cursor
5. push local pending changes

## Local-first fallback

- if sync is disabled, the app behaves exactly like the offline desktop app
- if sync is paused, local saves continue and the pending count grows
- if the backend is offline, local work continues and the last sync error is shown in Settings
- if the session expires, the client clears the stale token and safely re-authenticates on the next sync attempt

## Conflict policy

Current policy remains:

- local dirty records are not overwritten by pulled remote changes
- remote version metadata is still tracked
- the next push uses the latest known remote version as `baseVersion`

This keeps the app deterministic without changing the local-first finance workflow.
