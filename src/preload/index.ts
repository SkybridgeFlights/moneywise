import { contextBridge, ipcRenderer } from 'electron'
import type { MoneywiseApi } from '@shared/contracts'

console.info('[preload] Preload bridge starting')

const syncApi = {
  syncNow: () => {
    console.info('[preload] syncApi.syncNow invoked')
    return ipcRenderer.invoke('sync:now')
  },
  refreshSyncState: () => {
    console.info('[preload] syncApi.refreshSyncState invoked')
    return ipcRenderer.invoke('sync:refresh')
  },
  uploadAllData: () => {
    console.info('[preload] syncApi.uploadAllData invoked')
    return ipcRenderer.invoke('sync:uploadAll')
  },
  refresh: () => {
    console.info('[preload] syncApi.refresh invoked')
    return ipcRenderer.invoke('sync:refresh')
  },
  uploadAll: () => {
    console.info('[preload] syncApi.uploadAll invoked')
    return ipcRenderer.invoke('sync:uploadAll')
  }
}

const api: MoneywiseApi = {
  getSnapshot: () => ipcRenderer.invoke('app:getSnapshot'),
  getSyncStatus: () => {
    console.info('[preload] moneywise.getSyncStatus invoked')
    return ipcRenderer.invoke('sync:getStatus')
  },
  syncNow: () => {
    console.info('[preload] moneywise.syncNow invoked')
    return ipcRenderer.invoke('sync:runNow')
  },
  setSyncPaused: (paused) => ipcRenderer.invoke('sync:setPaused', paused),
  uploadAllLocalData: () => {
    console.info('[preload] moneywise.uploadAllLocalData invoked')
    return ipcRenderer.invoke('sync:uploadAllLocal')
  },
  saveIncome: (input) => ipcRenderer.invoke('income:save', input),
  deleteIncome: (id) => ipcRenderer.invoke('income:delete', id),
  saveExpense: (input) => ipcRenderer.invoke('expense:save', input),
  deleteExpense: (id) => ipcRenderer.invoke('expense:delete', id),
  saveGoal: (input) => ipcRenderer.invoke('goal:save', input),
  deleteGoal: (id) => ipcRenderer.invoke('goal:delete', id),
  saveGoalContribution: (input) => ipcRenderer.invoke('goal:contribution:save', input),
  saveDebt: (input) => ipcRenderer.invoke('debt:save', input),
  deleteDebt: (id) => ipcRenderer.invoke('debt:delete', id),
  saveCategory: (input) => ipcRenderer.invoke('category:save', input),
  getCategoryDeletionImpact: (id) => ipcRenderer.invoke('category:impact', id),
  deleteCategory: (input) => ipcRenderer.invoke('category:delete', input),
  saveBudgetPlan: (input) => ipcRenderer.invoke('budget:save', input),
  saveSettings: (input) => ipcRenderer.invoke('settings:save', input),
  seedDemoData: () => ipcRenderer.invoke('seed:demo'),
  resetData: () => ipcRenderer.invoke('app:reset'),
  exportData: (format) => ipcRenderer.invoke('export:data', format),
  importData: (format) => ipcRenderer.invoke('import:data', format),
  runMonthlyClose: (month) => ipcRenderer.invoke('monthly:close', month)
}

try {
  contextBridge.exposeInMainWorld('moneywise', api)
  contextBridge.exposeInMainWorld('syncApi', syncApi)
  console.info('[preload] Bridge exposed successfully')
} catch (error) {
  console.error('[preload] Failed to expose bridge', error)
  throw error
}
