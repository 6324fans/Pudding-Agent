import { existsSync, rmSync } from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const defaultAppPath = '/Applications/Pudding-Agent.app'
const defaultSourcePath = path.join(rootDir, 'out', 'mac-arm64', 'Pudding-Agent.app')

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: rootDir,
    encoding: 'utf8',
    stdio: options.stdio || 'inherit',
  })
}

function runQuiet(command, args) {
  try {
    return execFileSync(command, args, {
      cwd: rootDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (err) {
    return `${err.stdout || ''}${err.stderr || ''}`
  }
}

function parseArgs(argv) {
  const args = {
    app: defaultAppPath,
    source: defaultSourcePath,
    package: true,
    resetTcc: true,
    clearQuarantine: true,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--') {
      continue
    } else if (arg === '--help' || arg === '-h') {
      args.help = true
    } else if (arg === '--app') {
      args.app = argv[++i]
    } else if (arg === '--source') {
      args.source = path.resolve(argv[++i])
    } else if (arg === '--skip-package') {
      args.package = false
    } else if (arg === '--no-reset-tcc') {
      args.resetTcc = false
    } else if (arg === '--no-clear-quarantine') {
      args.clearQuarantine = false
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  return args
}

function printHelp() {
  console.log(`Usage: node scripts/install-mac-local.mjs [options]

Builds the macOS app, installs it into /Applications, and applies the local
Pudding-Agent signing identity used for stable macOS TCC permissions.

Options:
  --app /path/to/Pudding-Agent.app       Install target. Default: ${defaultAppPath}
  --source /path/to/Pudding-Agent.app    Built app source. Default: out/mac-arm64/Pudding-Agent.app
  --skip-package                         Reuse the existing built app instead of running pnpm package.
  --no-reset-tcc                         Keep current AppleEvents/Accessibility/ScreenCapture approvals.
  --no-clear-quarantine                  Do not remove com.apple.quarantine before signing.
`)
}

function requireMacOS() {
  if (process.platform !== 'darwin') {
    throw new Error(`Local macOS install only works on darwin. Current platform: ${process.platform}`)
  }
}

function quitInstalledApp() {
  const running = runQuiet('/usr/bin/pgrep', ['-x', 'Pudding-Agent']).trim()
  if (!running) return

  console.log('Pudding-Agent is running; asking it to quit before replacement...')
  runQuiet('/usr/bin/osascript', ['-e', 'tell application "Pudding-Agent" to quit'])
  runQuiet('/bin/sleep', ['2'])
}

function installApp(sourcePath, appPath) {
  if (!existsSync(sourcePath)) {
    throw new Error(`Built app not found: ${sourcePath}`)
  }

  rmSync(appPath, { recursive: true, force: true })
  run('/usr/bin/ditto', [sourcePath, appPath])
}

function signApp(appPath, args) {
  const signArgs = ['scripts/sign-mac-local.mjs', '--app', appPath]
  if (!args.resetTcc) signArgs.push('--no-reset-tcc')
  if (args.clearQuarantine) signArgs.push('--clear-quarantine')
  run(process.execPath, signArgs)
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    printHelp()
    return
  }

  requireMacOS()

  if (args.package) {
    run('corepack', ['pnpm', 'package'])
  }

  quitInstalledApp()
  installApp(args.source, args.app)
  signApp(args.app, args)

  console.log(`Installed and locally signed: ${args.app}`)
}

main()
