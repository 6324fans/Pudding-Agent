import type { BrowserWindow } from 'electron'
import { accessSync, chmodSync, constants, existsSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

let pty: any = null
try {
  pty = require('node-pty')
} catch (err) {
  console.error('[TerminalService] Failed to load node-pty:', (err as Error).message)
}

interface PtyInstance {
  id: string
  process: any
  cwd: string
}

function isDirectory(value: string | undefined): value is string {
  if (!value) return false
  try {
    return statSync(value).isDirectory()
  } catch {
    return false
  }
}

function isExecutableFile(value: string | undefined): value is string {
  if (!value) return false
  try {
    if (!statSync(value).isFile()) return false
    accessSync(value, constants.X_OK)
    return true
  } catch {
    return false
  }
}

function resolveCwd(cwd: string): string {
  if (isDirectory(cwd)) return cwd
  const home = os.homedir()
  if (isDirectory(home)) return home
  return process.cwd()
}

function resolveShell(isWindows: boolean): string | null {
  if (isWindows) {
    return process.env.COMSPEC || 'cmd.exe'
  }

  const candidates = [
    process.env.SHELL,
    '/bin/zsh',
    '/bin/bash',
    '/bin/sh',
  ]

  return candidates.find(isExecutableFile) ?? null
}

function ensureNodePtySpawnHelperExecutable(): void {
  if (process.platform === 'win32') return

  try {
    const nodePtyEntry = require.resolve('node-pty')
    const libDir = path.dirname(nodePtyEntry)
    const platformDir = `${process.platform}-${process.arch}`
    const candidates = [
      path.resolve(libDir, '../build/Release/spawn-helper'),
      path.resolve(libDir, '../build/Debug/spawn-helper'),
      path.resolve(libDir, `../prebuilds/${platformDir}/spawn-helper`),
      path.resolve(libDir, `./prebuilds/${platformDir}/spawn-helper`),
    ].map((candidate) =>
      candidate
        .replace('app.asar', 'app.asar.unpacked')
        .replace('node_modules.asar', 'node_modules.asar.unpacked')
    )

    for (const candidate of candidates) {
      if (!existsSync(candidate)) continue
      const stat = statSync(candidate)
      if (!stat.isFile() || (stat.mode & 0o111) !== 0) continue
      chmodSync(candidate, stat.mode | 0o111)
    }
  } catch (err) {
    console.warn('[TerminalService] Failed to fix node-pty spawn-helper permissions:', (err as Error).message)
  }
}

export class TerminalService {
  private instances = new Map<string, PtyInstance>()
  private window: BrowserWindow | null = null
  private nextId = 1

  setWindow(window: BrowserWindow): void {
    this.window = window
  }

  create(cwd: string): { id: string; error?: string } {
    if (!pty) return { id: '', error: 'node-pty not available' }

    const id = `term-${this.nextId++}`
    const isWindows = process.platform === 'win32'
    const shell = resolveShell(isWindows)
    const terminalCwd = resolveCwd(cwd)

    if (!shell) {
      return { id: '', error: 'No executable shell found (/bin/zsh, /bin/bash, /bin/sh)' }
    }

    let ptyProcess: any
    try {
      ensureNodePtySpawnHelperExecutable()
      ptyProcess = pty.spawn(shell, [], {
        name: 'xterm-256color',
        cols: 80,
        rows: 24,
        cwd: terminalCwd,
        env: { ...process.env, PWD: terminalCwd, ...(isWindows ? {} : { TERM: 'xterm-256color', SHELL: shell }) },
        encoding: 'utf8',
        useConpty: isWindows,
      })
    } catch (err) {
      return { id: '', error: `${(err as Error).message} (shell: ${shell}, cwd: ${terminalCwd})` }
    }

    if (isWindows) {
      ptyProcess.write('chcp 65001 > nul\r')
    }

    ptyProcess.onData((data: string) => {
      this.window?.webContents.send('terminal:data', { id, data })
    })

    ptyProcess.onExit(({ exitCode }: { exitCode: number }) => {
      this.window?.webContents.send('terminal:exit', { id, code: exitCode })
      this.instances.delete(id)
    })

    this.instances.set(id, { id, process: ptyProcess, cwd: terminalCwd })
    return { id }
  }

  write(id: string, data: string): void {
    const instance = this.instances.get(id)
    if (instance) instance.process.write(data)
  }

  resize(id: string, cols: number, rows: number): void {
    const instance = this.instances.get(id)
    if (instance) instance.process.resize(cols, rows)
  }

  destroy(id: string): { success: boolean } {
    const instance = this.instances.get(id)
    if (instance) {
      instance.process.kill()
      this.instances.delete(id)
      return { success: true }
    }
    return { success: false }
  }

  destroyAll(): void {
    for (const [id] of this.instances) {
      this.destroy(id)
    }
  }
}
