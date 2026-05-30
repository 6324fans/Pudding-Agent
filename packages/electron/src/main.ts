import { app, BrowserWindow, nativeImage, ipcMain } from 'electron'
import { autoUpdater } from 'electron-updater'
import path from 'node:path'
import { existsSync, mkdirSync, createWriteStream } from 'node:fs'
import { createMainWindow } from './window.js'
import { SessionManager } from './session-manager.js'
import { registerIpcHandlers } from './ipc-handlers.js'
import { registerMcpIpcHandlers } from './mcp-ipc.js'
import { GitService } from './git-service.js'
import { AppLauncher } from './app-launcher.js'
import { TerminalService } from './terminal-service.js'
import { PluginMarketplaceService } from './plugin-marketplace-service.js'
import { ChatBridgeService } from './chat-bridge-service.js'

// Mirror console output to a file so production users can ship logs back.
// Path: %APPDATA%\Pudding-Agent\logs\main.log on Windows, ~/Library/Logs/Pudding-Agent/main.log on macOS.
function setupFileLogger(): void {
  try {
    const logDir = app.getPath('logs')
    mkdirSync(logDir, { recursive: true })
    const logPath = path.join(logDir, 'main.log')
    const stream = createWriteStream(logPath, { flags: 'a' })
    const ts = () => new Date().toISOString()
    const wrap = (orig: (...args: any[]) => void, level: string) => (...args: any[]) => {
      orig(...args)
      try {
        const line = `[${ts()}] [${level}] ${args.map(a => typeof a === 'string' ? a : (a instanceof Error ? `${a.message}\n${a.stack}` : JSON.stringify(a))).join(' ')}\n`
        stream.write(line)
      } catch {}
    }
    console.log   = wrap(console.log.bind(console),   'log')
    console.info  = wrap(console.info.bind(console),  'info')
    console.warn  = wrap(console.warn.bind(console),  'warn')
    console.error = wrap(console.error.bind(console), 'error')
    console.log(`[Pudding-Agent] log file: ${logPath}`)
  } catch (err) {
    // Logger setup must never crash the app.
    process.stderr.write(`[Pudding-Agent] failed to set up file logger: ${err}\n`)
  }
}
setupFileLogger()

process.on('uncaughtException', (err) => {
  console.error('[Pudding-Agent] Uncaught exception:', err.message)
})

const sessionManager = new SessionManager()
const gitService = new GitService()
const appLauncher = new AppLauncher()
const terminalService = new TerminalService()
const pluginMarketplaceService = new PluginMarketplaceService()
const chatBridgeService = new ChatBridgeService(sessionManager)

// Auto-updater setup
autoUpdater.autoDownload = false
autoUpdater.autoInstallOnAppQuit = true

function getUpdaterRawError(err: unknown): string {
  if (err instanceof Error) return `${err.message}\n${err.stack || ''}`.trim()
  return String(err ?? '')
}

function getUpdaterErrorMessage(err: unknown): string {
  const raw = getUpdaterRawError(err)

  if (/404|not found|releases\.atom|cannot find latest|no published versions/i.test(raw)) {
    return '未找到更新发布源，请确认 GitHub Releases 已发布后再试。'
  }
  if (/401|403|authentication token|authorization|forbidden|unauthorized/i.test(raw)) {
    return '无法访问更新发布源，请检查 GitHub 发布配置或访问权限。'
  }
  if (/ENOTFOUND|ECONN|ETIMEDOUT|EAI_AGAIN|network|timeout|socket|certificate/i.test(raw)) {
    return '网络连接异常，请检查网络后重试。'
  }

  return '检查更新失败，请稍后重试。'
}

function setupAutoUpdater(win: BrowserWindow) {
  autoUpdater.on('update-available', (info) => {
    win.webContents.send('updater:available', { version: info.version })
  })
  autoUpdater.on('update-not-available', () => {
    win.webContents.send('updater:not-available')
  })
  autoUpdater.on('download-progress', (progress) => {
    win.webContents.send('updater:progress', { percent: Math.round(progress.percent) })
  })
  autoUpdater.on('update-downloaded', () => {
    win.webContents.send('updater:downloaded')
  })
  autoUpdater.on('error', (err) => {
    const message = getUpdaterErrorMessage(err)
    console.error('[Pudding-Agent] updater error:', message, getUpdaterRawError(err))
    win.webContents.send('updater:error', { message })
  })

  // Auto-check on launch (delay 5s) + every 30 minutes
  setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 5000)
  setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 30 * 60 * 1000)

  ipcMain.handle('updater:check', async () => {
    try {
      const result = await autoUpdater.checkForUpdates()
      return { version: result?.updateInfo.version || null }
    } catch (err: unknown) {
      return { version: null, error: getUpdaterErrorMessage(err) }
    }
  })
  ipcMain.handle('updater:download', async () => {
    autoUpdater.downloadUpdate()
    return { success: true }
  })
  ipcMain.handle('updater:install', () => {
    autoUpdater.quitAndInstall()
  })
}

ipcMain.handle('app:version', () => app.getVersion())

app.whenReady().then(async () => {
  if (process.platform === 'darwin') {
    const iconPath = path.join(__dirname, '../../assets/icon.png')
    if (existsSync(iconPath)) {
      app.dock.setIcon(nativeImage.createFromPath(iconPath))
    }
  }

  await sessionManager.ensureReady()
  registerIpcHandlers(sessionManager, { gitService, appLauncher, terminalService, pluginMarketplaceService, chatBridgeService })
  registerMcpIpcHandlers(sessionManager)

  const win = createMainWindow()
  sessionManager.setWindow(win)
  terminalService.setWindow(win)
  chatBridgeService.setWindow(win)
  setupAutoUpdater(win)

  win.webContents.on('did-finish-load', () => {
    sessionManager.initMcp(process.env.HOME || '/').catch((err) => {
      console.error('[Pudding-Agent] MCP init error:', err.message)
    })
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const newWin = createMainWindow()
      sessionManager.setWindow(newWin)
      terminalService.setWindow(newWin)
      chatBridgeService.setWindow(newWin)
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  terminalService.destroyAll()
  chatBridgeService.close()
  sessionManager.close()
})
