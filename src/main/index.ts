import { app, BrowserWindow } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { appendFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { FinanceDatabase } from './database'
import { DesktopSyncManager } from './desktop-sync'
import { DesktopSyncStateStore } from './desktop-sync-state'
import { FinanceService } from './finance-service'
import { registerIpcHandlers } from './ipc'
import { readDesktopSyncConfigWithDebug } from './sync-config'

let startupLogPath = ''

function writeStartupLog(line: string): void {
  if (!startupLogPath) {
    return
  }
  appendFileSync(startupLogPath, `${new Date().toISOString()} ${line}\n`, 'utf8')
}

function logMain(message: string, detail?: unknown): void {
  if (detail === undefined) {
    console.log(`[main] ${message}`)
    writeStartupLog(`[main] ${message}`)
    return
  }
  console.log(`[main] ${message}`, detail)
  writeStartupLog(`[main] ${message} ${JSON.stringify(detail)}`)
}

function createWindow(): void {
  const preloadJsPath = join(__dirname, '../preload/index.js')
  const preloadMjsPath = join(__dirname, '../preload/index.mjs')
  const preloadPath = existsSync(preloadJsPath) ? preloadJsPath : preloadMjsPath
  const rendererIndexPath = join(__dirname, '../renderer/index.html')
  logMain('Creating BrowserWindow', {
    preloadPath,
    rendererIndexPath,
    rendererUrl: process.env.ELECTRON_RENDERER_URL ?? null,
    isPackaged: app.isPackaged
  })

  const mainWindow = new BrowserWindow({
    width: 1540,
    height: 960,
    minWidth: 1280,
    minHeight: 820,
    show: false,
    autoHideMenuBar: true,
    title: 'MoneyWise',
    backgroundColor: '#0e1628',
    webPreferences: {
      preload: preloadPath,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false,
      devTools: !app.isPackaged,
      spellcheck: false,
      webSecurity: true,
      allowRunningInsecureContent: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    logMain('Window ready-to-show')
    mainWindow.show()
  })

  mainWindow.webContents.on('did-start-loading', () => logMain('Renderer started loading'))
  mainWindow.webContents.on('did-finish-load', () => logMain('Renderer finished loading'))
  mainWindow.webContents.on('did-fail-load', (_, errorCode, errorDescription, validatedURL) => {
    logMain('Renderer failed to load', { errorCode, errorDescription, validatedURL })
  })
  mainWindow.webContents.on('render-process-gone', (_, details) => {
    logMain('Renderer process gone', details)
  })
  mainWindow.webContents.on('console-message', (_, level, message, line, sourceId) => {
    console.log(`[renderer:${level}] ${message} (${sourceId}:${line})`)
  })
  mainWindow.webContents.on('preload-error', (_, preloadPathValue, error) => {
    logMain('Preload error', { preloadPath: preloadPathValue, error: error.message, stack: error.stack })
  })

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.webContents.on('will-navigate', (event) => {
    event.preventDefault()
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    logMain('Loading renderer URL', process.env.ELECTRON_RENDERER_URL)
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    logMain('Loading renderer file', rendererIndexPath)
    void mainWindow.loadFile(rendererIndexPath)
  }
}

app.whenReady().then(() => {
  const logDir = app.getPath('userData')
  if (!existsSync(logDir)) {
    mkdirSync(logDir, { recursive: true })
  }
  startupLogPath = join(logDir, 'startup.log')
  logMain('Application ready')
  electronApp.setAppUserModelId('com.moneywise.desktop')
  const database = new FinanceDatabase()
  const { config: syncConfig, debug: syncConfigDebug } = readDesktopSyncConfigWithDebug()
  logMain('SYNC CONFIG DEBUG', syncConfigDebug)
  const syncStateStore = new DesktopSyncStateStore(join(logDir, 'moneywise', 'sync-state.json'))
  const syncManager = new DesktopSyncManager(database, syncStateStore, syncConfig, logMain, () => {
    logMain('SYNC PULL RELOAD RENDERER')
    BrowserWindow.getAllWindows().forEach((window) => {
      if (!window.isDestroyed()) {
        window.webContents.reloadIgnoringCache()
      }
    })
  })
  const financeService = new FinanceService(database, (reason) => syncManager.scheduleSync(reason))
  registerIpcHandlers(financeService, syncManager)
  logMain('Desktop sync foundation', {
    enabled: syncConfig.enabled,
    backendUrl: syncConfig.backendUrl,
    deviceId: syncConfig.backendUrl ? syncStateStore.getOrCreateDeviceId(syncConfig.deviceId) : null
  })

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  syncManager.start()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

process.on('uncaughtException', (error) => {
  logMain('Uncaught exception', { message: error.message, stack: error.stack })
})

process.on('unhandledRejection', (reason) => {
  logMain('Unhandled rejection', reason)
})

app.on('window-all-closed', () => {
  logMain('All windows closed')
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
