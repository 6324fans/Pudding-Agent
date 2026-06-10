const { execFileSync } = require('node:child_process')
const { readdirSync } = require('node:fs')
const path = require('node:path')

function run(command, args, cwd) {
  return execFileSync(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
}

function findApp(appOutDir) {
  const appName = readdirSync(appOutDir).find(name => name.endsWith('.app'))
  return appName ? path.join(appOutDir, appName) : null
}

function hasValidSignature(appPath) {
  try {
    run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath], process.cwd())
    return true
  } catch {
    return false
  }
}

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return

  const appPath = findApp(context.appOutDir)
  if (!appPath || hasValidSignature(appPath)) return

  const entitlements = path.join(context.packager.projectDir, 'assets', 'entitlements.mac.plist')
  run('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', '--entitlements', entitlements, appPath], context.packager.projectDir)
  console.log(`[after-pack] Applied ad-hoc macOS signature to ${appPath}`)
}
