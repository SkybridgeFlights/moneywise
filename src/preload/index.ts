import { contextBridge, ipcRenderer } from 'electron'
import type { MoneywiseApi } from '@shared/contracts'

console.info('[preload] Preload bridge starting')

const api: MoneywiseApi = {
  getSnapshot: () => ipcRenderer.invoke('app:getSnapshot'),
  getSyncStatus: () => ipcRenderer.invoke('sync:getStatus'),
  syncNow: () => ipcRenderer.invoke('sync:runNow'),
  setSyncPaused: (paused) => ipcRenderer.invoke('sync:setPaused', paused),
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
  console.info('[preload] Bridge exposed successfully')
} catch (error) {
  console.error('[preload] Failed to expose bridge', error)
  throw error
}
