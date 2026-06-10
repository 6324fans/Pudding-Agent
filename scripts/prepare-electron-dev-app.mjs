import { copyFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'

const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const plistBuddy = '/usr/libexec/PlistBuddy'
const electronRequire = createRequire(path.join(rootDir, 'packages', 'electron', 'package.json'))

function run(command, args) {
  return execFileSync(command, args, { cwd: rootDir, stdio: ['ignore', 'pipe', 'pipe'] })
}

function setPlistValue(plistPath, key, type, value) {
  try {
    run(plistBuddy, ['-c', `Set :${key} ${value}`, plistPath])
  } catch {
    run(plistBuddy, ['-c', `Add :${key} ${type} ${value}`, plistPath])
  }
}

function findElectronApp() {
  const electronEntry = electronRequire.resolve('electron')
  return path.join(path.dirname(electronEntry), 'dist', 'Electron.app')
}

function main() {
  if (process.platform !== 'darwin') return

  const electronApp = findElectronApp()
  if (!existsSync(electronApp)) {
    console.warn(`[prepare-electron-dev-app] Electron.app not found at ${electronApp}`)
    return
  }

  const infoPlist = path.join(electronApp, 'Contents', 'Info.plist')
  const iconSource = path.join(rootDir, 'assets', 'icon.icns')
  const iconTarget = path.join(electronApp, 'Contents', 'Resources', 'electron.icns')
  const entitlements = path.join(rootDir, 'assets', 'entitlements.mac.plist')

  setPlistValue(infoPlist, 'CFBundleIdentifier', 'string', 'com.pudding.agent.dev')
  setPlistValue(infoPlist, 'CFBundleDisplayName', 'string', 'Pudding-Agent')
  setPlistValue(infoPlist, 'CFBundleName', 'string', 'Pudding-Agent')
  setPlistValue(
    infoPlist,
    'NSAppleEventsUsageDescription',
    'string',
    'Pudding-Agent needs to control System Events for Computer Use actions.'
  )
  setPlistValue(
    infoPlist,
    'NSAccessibilityUsageDescription',
    'string',
    'Pudding-Agent needs accessibility access to click, type, scroll, and inspect windows.'
  )
  setPlistValue(
    infoPlist,
    'NSScreenCaptureUsageDescription',
    'string',
    'Pudding-Agent needs screen capture access to inspect the current desktop.'
  )

  if (existsSync(iconSource)) {
    copyFileSync(iconSource, iconTarget)
  }

  try {
    run('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', '--entitlements', entitlements, electronApp])
    console.log('[prepare-electron-dev-app] Prepared and signed Electron.app for Pudding-Agent dev automation.')
  } catch (err) {
    console.warn(`[prepare-electron-dev-app] Failed to sign Electron.app: ${err.message}`)
  }
}

main()
