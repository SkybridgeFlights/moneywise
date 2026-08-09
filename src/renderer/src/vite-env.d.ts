/// <reference types="vite/client" />

import type { MoneywiseApi } from '@shared/contracts'

declare global {
  interface SyncApiBridge {
    syncNow(): Promise<import('@shared/contracts').SyncStatusSnapshot>
    refreshSyncState(): Promise<import('@shared/contracts').SyncStatusSnapshot>
    uploadAllData(): Promise<import('@shared/contracts').SyncStatusSnapshot>
    refresh(): Promise<import('@shared/contracts').SyncStatusSnapshot>
    uploadAll(): Promise<import('@shared/contracts').SyncStatusSnapshot>
  }

  interface Window {
    moneywise?: MoneywiseApi
    syncApi?: SyncApiBridge
  }
}

export {}
