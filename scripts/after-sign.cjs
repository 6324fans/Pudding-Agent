const { readdirSync } = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' })
  const output = `${result.stdout || ''}${result.stderr || ''}`.trim()
  if (result.status !== 0) {
    throw new Error(output || `${command} ${args.join(' ')} exited with ${result.status}`)
  }
  return output
}

function findApp(appOutDir) {
  const appName = readdirSync(appOutDir).find(name => name.endsWith('.app'))
  return appName ? path.join(appOutDir, appName) : null
}

exports.default = async function afterSign(context) {
  if (context.electronPlatformName !== 'darwin') return
  if (process.env.PUDDING_ALLOW_UNSIGNED_MAC_PACKAGE === '1') return

  const appPath = findApp(context.appOutDir)
  if (!appPath) throw new Error(`No .app bundle found in ${context.appOutDir}`)

  const details = run('/usr/bin/codesign', ['-dv', '--verbose=4', appPath], context.packager.projectDir)
  if (details.includes('Signature=adhoc') || details.includes('TeamIdentifier=not set')) {
    throw new Error([
      'Pudding-Agent macOS package is not signed with a stable Apple team identity.',
      details,
    ].join('\n'))
  }

  const entitlements = run('/usr/bin/codesign', ['--display', '--entitlements', ':-', appPath], context.packager.projectDir)
  if (!entitlements.includes('com.apple.security.automation.apple-events')) {
    throw new Error('Pudding-Agent macOS signature is missing com.apple.security.automation.apple-events entitlement.')
  }
}
