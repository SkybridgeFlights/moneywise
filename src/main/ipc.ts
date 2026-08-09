import { dialog, ipcMain } from 'electron'
import { ZodType } from 'zod'
import { FinanceService } from './finance-service'
import { DesktopSyncManager } from './desktop-sync'
import type {
  DeleteCategoryInput,
  SaveBudgetPlanInput,
  SaveCategoryInput,
  SaveDebtInput,
  SaveGoalContributionInput,
  SaveExpenseInput,
  SaveGoalInput,
  SaveIncomeInput
} from '@shared/contracts'
import type { Settings } from '@shared/types'
import {
  budgetPlanInputSchema,
  categoryInputSchema,
  debtInputSchema,
  deleteCategoryInputSchema,
  exportFormatSchema,
  booleanSchema,
  expenseInputSchema,
  goalContributionInputSchema,
  goalInputSchema,
  idSchema,
  importFormatSchema,
  incomeInputSchema,
  monthSchema,
  settingsInputSchema
} from '@shared/validation'

function ensureTrustedSender(event: Electron.IpcMainInvokeEvent): void {
  const senderUrl = event.senderFrame?.url
  if (!senderUrl) {
    throw new Error('Blocked IPC request without sender frame')
  }
  if (process.env.ELECTRON_RENDERER_URL) {
    if (!senderUrl.startsWith(process.env.ELECTRON_RENDERER_URL)) {
      throw new Error('Blocked IPC request from untrusted origin')
    }
    return
  }

  if (!senderUrl.startsWith('file://')) {
    throw new Error('Blocked IPC request from unexpected origin')
  }
}

function registerValidatedHandler<TInput, TResult>(
  channel: string,
  schema: ZodType<TInput>,
  handler: (input: TInput) => TResult | Promise<TResult>
): void {
  ipcMain.handle(channel, (event, rawInput: unknown) => {
    ensureTrustedSender(event)
    return handler(schema.parse(rawInput))
  })
}

export function registerIpcHandlers(service: FinanceService, syncManager: DesktopSyncManager): void {
  ipcMain.handle('app:getSnapshot', (event) => {
    ensureTrustedSender(event)
    return service.getSnapshot()
  })
  ipcMain.handle('sync:getStatus', (event) => {
    ensureTrustedSender(event)
    console.log('[main] SYNC REFRESH TRIGGERED (sync:getStatus)')
    return syncManager.getStatus()
  })
  ipcMain.handle('sync:runNow', async (event) => {
    ensureTrustedSender(event)
    console.log('[main] SYNC NOW TRIGGERED (sync:runNow)')
    return syncManager.syncNow()
  })
  ipcMain.handle('sync:uploadAllLocal', async (event) => {
    ensureTrustedSender(event)
    console.log('[main] UPLOAD ALL TRIGGERED (sync:uploadAllLocal)')
    return syncManager.uploadAllLocalData()
  })
  ipcMain.handle('sync:now', async (event) => {
    ensureTrustedSender(event)
    console.log('[main] SYNC NOW TRIGGERED (sync:now)')
    return syncManager.syncNow()
  })
  ipcMain.handle('sync:refresh', (event) => {
    ensureTrustedSender(event)
    console.log('[main] SYNC REFRESH TRIGGERED (sync:refresh)')
    return syncManager.getStatus()
  })
  ipcMain.handle('sync:uploadAll', async (event) => {
    ensureTrustedSender(event)
    console.log('[main] UPLOAD ALL TRIGGERED (sync:uploadAll)')
    return syncManager.uploadAllLocalData()
  })
  registerValidatedHandler('sync:setPaused', booleanSchema, (paused: boolean) => syncManager.setPaused(paused))
  registerValidatedHandler('income:save', incomeInputSchema, (input: SaveIncomeInput) => service.saveIncome(input))
  registerValidatedHandler('income:delete', idSchema, (id: string) => service.deleteIncome(id))
  registerValidatedHandler('expense:save', expenseInputSchema, (input: SaveExpenseInput) => service.saveExpense(input))
  registerValidatedHandler('expense:delete', idSchema, (id: string) => service.deleteExpense(id))
  registerValidatedHandler('goal:save', goalInputSchema, (input: SaveGoalInput) => service.saveGoal(input))
  registerValidatedHandler('goal:delete', idSchema, (id: string) => service.deleteGoal(id))
  registerValidatedHandler('goal:contribution:save', goalContributionInputSchema, (input: SaveGoalContributionInput) =>
    service.saveGoalContribution(input)
  )
  registerValidatedHandler('debt:save', debtInputSchema, (input: SaveDebtInput) => service.saveDebt(input))
  registerValidatedHandler('debt:delete', idSchema, (id: string) => service.deleteDebt(id))
  registerValidatedHandler('category:save', categoryInputSchema, (input: SaveCategoryInput) => service.saveCategory(input))
  registerValidatedHandler('category:impact', idSchema, (id: string) => service.getCategoryDeletionImpact(id))
  registerValidatedHandler('category:delete', deleteCategoryInputSchema, (input: DeleteCategoryInput) => service.deleteCategory(input))
  registerValidatedHandler('budget:save', budgetPlanInputSchema, (input: SaveBudgetPlanInput) => service.saveBudgetPlan(input))
  registerValidatedHandler('settings:save', settingsInputSchema, (input: Settings) => service.saveSettings(input))
  ipcMain.handle('seed:demo', (event) => {
    ensureTrustedSender(event)
    return service.seedDemoData()
  })
  ipcMain.handle('app:reset', (event) => {
    ensureTrustedSender(event)
    return service.resetData()
  })
  registerValidatedHandler('monthly:close', monthSchema, (month: string) => service.runMonthlyClose(month))

  ipcMain.handle('export:data', async (event, rawFormat: unknown) => {
    ensureTrustedSender(event)
    const format = exportFormatSchema.parse(rawFormat)
    const extension = format === 'xlsx' ? 'xlsx' : format
    const result = await dialog.showSaveDialog({
      title: 'Export finance data',
      defaultPath: `moneywise-export.${extension}`,
      filters: [
        {
          name: format.toUpperCase(),
          extensions: [extension]
        }
      ]
    })
    if (result.canceled || !result.filePath) {
      return { success: false }
    }
    return service.exportData(format, result.filePath)
  })

  ipcMain.handle('import:data', async (event, rawFormat: unknown) => {
    ensureTrustedSender(event)
    const format = importFormatSchema.parse(rawFormat)
    const extension = format === 'xlsx' ? 'xlsx' : format
    const result = await dialog.showOpenDialog({
      title: 'Import finance data',
      filters: [
        {
          name: format.toUpperCase(),
          extensions: [extension]
        }
      ],
      properties: ['openFile']
    })
    if (result.canceled || result.filePaths.length === 0) {
      return service.getSnapshot()
    }
    return service.importData(format, result.filePaths[0])
  })
}
