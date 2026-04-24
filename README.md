# MoneyWise

MoneyWise is now a multi-platform personal finance system with:

- a local-first desktop app
- a standalone sync backend
- a local-first Expo mobile app

The current architecture keeps finance behavior local-first on both clients while exposing a compatible backend sync foundation for cross-device use.

## What is included

- Secure Electron window configuration with `contextIsolation`, sandboxed renderer, and no direct Node access in the UI
- Validated IPC write paths using Zod schemas
- SQLite persistence with indexed queries and transactional writes
- Dashboard, income, expenses, budget planning, reports, goals, and settings modules
- Smart budgeting and analytics engine with alerts, forecasting, overspending detection, and actionable recommendations
- JSON, CSV, and Excel export/import support
- Monthly close and archived monthly summaries
- Lazy-loaded renderer screens for lower initial bundle cost
- Unit and integration-style financial tests
- Electron Builder packaging configuration for Windows and macOS
- Standalone backend sync service with SQLite persistence
- Optional desktop sync client with visible sync status and manual sync
- Expo mobile app with local storage, sync status, and manual sync controls

## Stack

- Electron + `electron-vite`
- React 19 + TypeScript
- SQLite via `better-sqlite3`
- Zod for validation
- Recharts for analytics views
- SheetJS and Papa Parse for import/export
- Vitest for automated tests
- Electron Builder for packaging

## Architecture

- `src/main`
  - Electron bootstrap
  - secure IPC handlers
  - SQLite storage and import/export workflows
- `src/preload`
  - typed bridge exposed to the renderer
- `src/shared`
  - domain models
  - defaults and demo data
  - validation schemas
  - financial engine
- `src/renderer`
  - React UI shell
  - shared UI components
  - lazy-loaded screens

This separation keeps storage, business logic, and UI concerns isolated and easier to extend.

## Main features

- Dashboard with income, expenses, remaining balance, savings rate, debt ratio, budget health score, charts, and alerts
- Income tracking with multiple sources, recurring support, grouping, and notes
- Expense tracking with categories, tags, payment method, recurring support, and search
- Budget planning with multiple modes:
  - `50 / 30 / 20`
  - zero-based
  - custom percentage
  - priority-based
  - goal-first
  - debt-focused
- Goals with progress, recommended monthly contribution, and expected completion date
- Reports with top categories, trends, unusual spending detection, and monthly close
- Backup and restore using JSON export/import

## Development

Install dependencies:

```powershell
npm.cmd install
```

Run development mode:

```powershell
npm.cmd run dev
```

Start the sync-backend foundation:

```powershell
npm.cmd run backend:start
```

Run the Expo mobile app:

```powershell
cd mobile
npm.cmd run start
```

Type-check:

```powershell
npm.cmd run typecheck
```

Run tests:

```powershell
npm.cmd test
```

Build production bundles:

```powershell
npm.cmd run build
```

## Packaging

Build Windows packages:

```powershell
npm.cmd run package:win
```

Build macOS DMG configuration target:

```powershell
npm.cmd run package:mac
```

Notes:

- Windows packaging is the primary target from this environment.
- macOS DMG packaging is configured, but final validation usually requires a macOS machine.

## Backup and restore

- JSON export is the recommended full backup format
- JSON import restores a full saved application state
- CSV is best for expense-oriented exchange
- Excel export is useful for spreadsheet review and external reporting

## Troubleshooting

- If PowerShell blocks `npm`, use `npm.cmd`
- If dependency installation fails with cache permission issues, rerun with elevated approval
- If a manual import produces unexpected results, restore from a JSON backup and verify the import file schema
- If packaging fails on macOS targets from Windows, run the mac packaging step on a macOS environment

## Verification completed in this workspace

- `npm.cmd run typecheck`
- `npm.cmd run build`

Recommended next verification:

- `npm.cmd test`
- `npm.cmd run package:win`

## Backend foundation

- The repository now includes a standalone sync-backend foundation under `backend/`
- It is disabled from the desktop app by default and does not replace local SQLite
- Use `.env.backend.example` as the starting point for backend and future desktop sync configuration
- See [docs/backend-sync-foundation.md](docs/backend-sync-foundation.md) for the API and sync model
- See [docs/desktop-sync-client.md](docs/desktop-sync-client.md) for the optional desktop sync client flow and enablement
- See [docs/mobile-expo-app.md](docs/mobile-expo-app.md) for the Expo iPhone app structure and setup
- See [docs/deployment.md](docs/deployment.md) for production deployment, packaging, and real-device sync validation
