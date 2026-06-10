const { execFileSync } = require('node:child_process')

function run(command, args, cwd) {
  return execFileSync(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
}

function getCodesigningIdentities() {
  try {
    const output = run('/usr/bin/security', ['find-identity', '-v', '-p', 'codesigning'], process.cwd()).toString()
    return output
      .split(/\r?\n/)
      .map(line => line.match(/^\s*\d+\)\s+[A-F0-9]+\s+"(.+)"$/)?.[1])
      .filter(Boolean)
  } catch {
    return []
  }
}

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return
  const strictSigning = process.env.PUDDING_STRICT_MAC_SIGNING === '1'
  if (process.env.PUDDING_ALLOW_UNSIGNED_MAC_PACKAGE === '1') {
    console.warn('[after-pack] Building an unsigned macOS package. Computer Use Automation permissions will not persist reliably.')
    return
  }

  if (process.env.CSC_LINK || process.env.CSC_NAME) return

  const identities = getCodesigningIdentities()
  if (identities.length > 0) return

  const message = [
    'Pudding-Agent macOS packages require a stable code signing identity.',
    'Computer Use controls System Events, and macOS TCC revokes Automation permissions for ad-hoc or unsigned app bundles after rebuilds.',
    'Install an Apple Developer ID Application certificate or provide CSC_LINK/CSC_NAME for stable Computer Use permissions.',
  ].join('\n')
  if (strictSigning) throw new Error(message)
  console.warn(`[after-pack] ${message}`)
}
