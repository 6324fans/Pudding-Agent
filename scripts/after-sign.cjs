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

function handleSigningIssue(message) {
  if (process.env.PUDDING_STRICT_MAC_SIGNING === '1') throw new Error(message)
  console.warn(`[after-sign] ${message}`)
}

exports.default = async function afterSign(context) {
  if (context.electronPlatformName !== 'darwin') return
  if (process.env.PUDDING_ALLOW_UNSIGNED_MAC_PACKAGE === '1') return

  const appPath = findApp(context.appOutDir)
  if (!appPath) return handleSigningIssue(`No .app bundle found in ${context.appOutDir}`)

  let details = ''
  try {
    details = run('/usr/bin/codesign', ['-dv', '--verbose=4', appPath], context.packager.projectDir)
  } catch (err) {
    return handleSigningIssue(`Pudding-Agent macOS package is unsigned or cannot be inspected by codesign.\n${err.message}`)
  }
  if (details.includes('Signature=adhoc') || details.includes('TeamIdentifier=not set')) {
    return handleSigningIssue([
      'Pudding-Agent macOS package is not signed with a stable Apple team identity.',
      details,
    ].join('\n'))
  }

  let entitlements = ''
  try {
    entitlements = run('/usr/bin/codesign', ['--display', '--entitlements', ':-', appPath], context.packager.projectDir)
  } catch (err) {
    return handleSigningIssue(`Unable to inspect Pudding-Agent macOS entitlements.\n${err.message}`)
  }
  if (!entitlements.includes('com.apple.security.automation.apple-events')) {
    handleSigningIssue('Pudding-Agent macOS signature is missing com.apple.security.automation.apple-events entitlement.')
  }
}
