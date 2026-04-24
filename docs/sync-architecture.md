# Sync-Ready Architecture Notes

## Current state

The desktop app remains the only runtime client today. Local persistence is still SQLite, and all existing features continue to use the same IPC contract and snapshot shape.

## What changed

- `FinanceDomainState` in `src/shared/domain.ts` is now the shared persisted domain model boundary.
- `AppSnapshot` extends that domain state and adds computed analytics for the renderer.
- `FinanceRepository` in `src/main/finance-repository.ts` defines the storage contract used by the application layer.
- `FinanceService` in `src/main/finance-service.ts` is the main-process application layer between IPC and persistence.
- `FinanceDatabase` remains the SQLite implementation, now behind the repository contract.

## Why this helps future sync

The app no longer needs future sync code to talk directly to SQLite. A later sync phase can add:

1. A remote API client that reads and writes the same `FinanceDomainState` records.
2. A sync coordinator that compares local and remote records by stable `id`.
3. A repository composition strategy such as:
   - local SQLite repository
   - remote API repository
   - sync-aware repository/service that merges both
4. A mobile iPhone client that uses the same domain model and server-side record structure.

## Stable IDs

Current records already use stable string IDs and should continue to do so. For sync, edits must keep the same `id`; only new records should receive new IDs.

## Recommended next sync phase

Add sync metadata to domain records without changing feature behavior:

- `updatedAt`
- `createdAt`
- `deletedAt` for tombstones when needed
- `version` or revision token
- optional `lastModifiedByDeviceId`

That will enable conflict detection and deterministic merges across desktop and mobile.

## Conflict-safe pattern

Recommended future write flow:

1. Read the latest local and remote versions for a record ID.
2. Compare `version` or `updatedAt`.
3. Reject or merge stale writes explicitly.
4. Apply changes through the service layer, not directly in UI code.
5. Recompute analytics from merged domain state after sync completes.

## iPhone app path later

When the iPhone app is added later:

- reuse the same domain record names and IDs
- expose the same entities through an API
- keep analytics either:
  - server-generated for consistency, or
  - client-generated from synced domain state using shared logic ported as needed

## Intentionally unchanged now

- renderer screens
- business calculations in `src/shared/finance.ts`
- current IPC method names
- SQLite schema and current desktop workflows
- dashboard, goals, debts, budgets, reports, filters, and language behavior
