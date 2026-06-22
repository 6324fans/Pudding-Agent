import { existsSync } from 'node:fs'
import path from 'node:path'
import type { McpServerConfig } from '@puddingagent/core'

const NATIVE_BIN_REL = path.join('dist', 'Open Computer Use.app', 'Contents', 'MacOS', 'OpenComputerUse')
export const OCU_MCP_SERVER_NAME = 'open-computer-use'

/**
 * Resolve the bundled open-computer-use native binary and return an MCP stdio
 * server config that spawns it directly with `mcp`.
 *
 * The npm package `open-computer-use` ships the native `Open Computer Use.app`
 * (the git repo's Swift binary) in its `dist/`. We spawn that binary directly
 * (same as the package's own bin launcher) so end users need no separate
 * install or download — everything is bundled inside Pudding-Agent.
 *
 * When packaged under app.asar, electron-builder asarUnpacks the package, so
 * the real binary lives under `app.asar.unpacked`; we rewrite the path
 * accordingly because native binaries cannot be executed from inside an asar.
 */
export function resolveOpenComputerUseServerConfig(): McpServerConfig | null {
  if (process.platform !== 'darwin') return null
  const pkgName = 'open-computer-use'
  let pkgRoot: string
  try {
    // Dynamic so esbuild leaves runtime require.resolve (not build-time).
    pkgRoot = path.dirname(require.resolve(`${pkgName}/package.json`))
  } catch {
    return null
  }
  let exe = path.join(pkgRoot, NATIVE_BIN_REL)
  if (exe.includes(`${path.sep}app.asar${path.sep}`)) {
    exe = exe.replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`)
  }
  if (!existsSync(exe)) return null
  return { transport: 'stdio', command: exe, args: ['mcp'] }
}
