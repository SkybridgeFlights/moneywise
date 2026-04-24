/// <reference types="vite/client" />

import type { MoneywiseApi } from '@shared/contracts'

declare global {
  interface Window {
    moneywise?: MoneywiseApi
  }
}

export {}
