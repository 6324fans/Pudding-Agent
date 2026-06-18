import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const defaultAppPath = '/Applications/Pudding-Agent.app'
const certName = process.env.PUDDING_LOCAL_SIGN_CERT || 'Pudding Dedicated Local Code Signing'
const keychainPassword = process.env.PUDDING_LOCAL_SIGN_KEYCHAIN_PASSWORD || 'pudding-local-codesign'
const keychainPath = process.env.PUDDING_LOCAL_SIGN_KEYCHAIN ||
  path.join(os.homedir(), 'Library', 'Keychains', 'pudding-local-codesign.keychain-db')

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: rootDir,
    encoding: 'utf8',
    stdio: options.stdio || ['ignore', 'pipe', 'pipe'],
  })
}

function runQuiet(command, args) {
  try {
    return run(command, args)
  } catch (err) {
    return `${err.stdout || ''}${err.stderr || ''}`
  }
}

function parseArgs(argv) {
  const args = {
    app: defaultAppPath,
    resetTcc: true,
    clearQuarantine: false,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--') {
      continue
    } else if (arg === '--help' || arg === '-h') {
      args.help = true
    } else if (arg === '--app') {
      args.app = argv[++i]
    } else if (arg === '--no-reset-tcc') {
      args.resetTcc = false
    } else if (arg === '--clear-quarantine') {
      args.clearQuarantine = true
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }
  return args
}

function printHelp() {
  console.log(`Usage: node scripts/sign-mac-local.mjs [--app /path/to/Pudding-Agent.app] [--no-reset-tcc] [--clear-quarantine]

Creates a dedicated local code-signing keychain and re-signs a local macOS
Pudding-Agent.app so macOS TCC permissions for Computer Use are stable.

Environment:
  PUDDING_LOCAL_SIGN_CERT                Certificate common name.
  PUDDING_LOCAL_SIGN_KEYCHAIN            Dedicated keychain path.
  PUDDING_LOCAL_SIGN_KEYCHAIN_PASSWORD   Dedicated keychain password. Default: pudding-local-codesign.
`)
}

function requireMacOS() {
  if (process.platform !== 'darwin') {
    throw new Error(`Local macOS signing only works on darwin. Current platform: ${process.platform}`)
  }
}

function ensureTool(command) {
  run('/usr/bin/which', [command])
}

function ensureKeychainInSearchList() {
  const existing = run('/usr/bin/security', ['list-keychains', '-d', 'user'])
    .split(/\r?\n/)
    .map(line => line.trim().replace(/^"|"$/g, ''))
    .filter(Boolean)
  if (existing.includes(keychainPath)) return
  run('/usr/bin/security', ['list-keychains', '-d', 'user', '-s', keychainPath, ...existing])
}

function ensureDedicatedKeychain() {
  if (!existsSync(keychainPath)) {
    run('/usr/bin/security', ['create-keychain', '-p', keychainPassword, keychainPath])
  }
  run('/usr/bin/security', ['set-keychain-settings', '-lut', '21600', keychainPath])
  run('/usr/bin/security', ['unlock-keychain', '-p', keychainPassword, keychainPath])
  ensureKeychainInSearchList()
}

function findIdentity() {
  const output = runQuiet('/usr/bin/security', ['find-identity', '-v', '-p', 'codesigning', keychainPath])
  const escapedName = certName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = output.match(new RegExp(`\\s*\\d+\\)\\s+([A-F0-9]+)\\s+"${escapedName}"`))
  return match?.[1]
}

function createIdentity() {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'pudding-local-codesign.'))
  try {
    const configPath = path.join(tmpDir, 'codesign.cnf')
    const keyPath = path.join(tmpDir, 'codesign.key')
    const certPath = path.join(tmpDir, 'codesign.crt')
    const p12Path = path.join(tmpDir, 'codesign.p12')
    writeFileSync(configPath, `[ req ]
default_bits = 2048
prompt = no
default_md = sha256
distinguished_name = dn
x509_extensions = v3_codesign

[ dn ]
CN = ${certName}
O = Pudding-Agent Local

[ v3_codesign ]
basicConstraints = critical,CA:true
keyUsage = critical,digitalSignature,keyCertSign
extendedKeyUsage = codeSigning
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid:always,issuer
`)
    run('openssl', [
      'req', '-new', '-newkey', 'rsa:2048', '-nodes', '-x509', '-days', '3650',
      '-keyout', keyPath,
      '-out', certPath,
      '-config', configPath,
    ])
    run('openssl', [
      'pkcs12', '-export',
      '-inkey', keyPath,
      '-in', certPath,
      '-name', certName,
      '-out', p12Path,
      '-passout', `pass:${keychainPassword}`,
    ])
    run('/usr/bin/security', ['import', p12Path, '-k', keychainPath, '-P', keychainPassword, '-A', '-t', 'agg', '-f', 'pkcs12'])
    run('/usr/bin/security', ['add-trusted-cert', '-r', 'trustRoot', '-p', 'codeSign', '-k', keychainPath, certPath])
    run('/usr/bin/security', ['set-key-partition-list', '-S', 'apple-tool:,apple:,codesign:', '-s', '-k', keychainPassword, keychainPath])
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
}

function ensureIdentity() {
  let identity = findIdentity()
  if (identity) return identity
  createIdentity()
  identity = findIdentity()
  if (!identity) throw new Error(`Failed to create local signing identity: ${certName}`)
  return identity
}

function writeLocalEntitlements() {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'pudding-local-entitlements.'))
  const entitlementsPath = path.join(tmpDir, 'entitlements.plist')
  writeFileSync(entitlementsPath, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>com.apple.security.automation.apple-events</key>
    <true/>
    <key>com.apple.security.cs.allow-jit</key>
    <true/>
    <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
    <true/>
    <key>com.apple.security.cs.allow-dyld-environment-variables</key>
    <true/>
    <key>com.apple.security.cs.disable-library-validation</key>
    <true/>
</dict>
</plist>
`)
  return { entitlementsPath, cleanup: () => rmSync(tmpDir, { recursive: true, force: true }) }
}

function sign(identity, entitlementsPath, target, extraArgs = []) {
  if (!existsSync(target)) return
  run('/usr/bin/codesign', [
    '--force',
    '--timestamp=none',
    '--options', 'runtime',
    '--keychain', keychainPath,
    '--sign', identity,
    ...extraArgs,
    target,
  ], { stdio: 'inherit' })
}

function signApp(appPath, identity, entitlementsPath) {
  const frameworks = path.join(appPath, 'Contents', 'Frameworks')
  const electronFramework = path.join(frameworks, 'Electron Framework.framework')
  const electronVersion = path.join(electronFramework, 'Versions', 'A')
  const signPlain = target => sign(identity, entitlementsPath, target)
  const signWithEntitlements = target => sign(identity, entitlementsPath, target, ['--entitlements', entitlementsPath])

  signPlain(path.join(electronVersion, 'Helpers', 'chrome_crashpad_handler'))
  for (const lib of ['libEGL.dylib', 'libvk_swiftshader.dylib', 'libGLESv2.dylib', 'libffmpeg.dylib']) {
    signPlain(path.join(electronVersion, 'Libraries', lib))
  }
  signPlain(path.join(electronVersion, 'Electron Framework'))
  signPlain(electronFramework)

  signPlain(path.join(frameworks, 'Mantle.framework'))
  signPlain(path.join(frameworks, 'ReactiveObjC.framework'))
  signPlain(path.join(frameworks, 'Squirrel.framework', 'Versions', 'A', 'Resources', 'ShipIt'))
  signPlain(path.join(frameworks, 'Squirrel.framework'))

  for (const helper of [
    'Pudding-Agent Helper.app',
    'Pudding-Agent Helper (GPU).app',
    'Pudding-Agent Helper (Plugin).app',
    'Pudding-Agent Helper (Renderer).app',
  ]) {
    signWithEntitlements(path.join(frameworks, helper))
  }
  signWithEntitlements(appPath)
}

function resetTcc(bundleId) {
  for (const service of ['AppleEvents', 'Accessibility', 'ScreenCapture']) {
    const output = runQuiet('/usr/bin/tccutil', ['reset', service, bundleId])
    if (output.trim()) console.log(output.trim())
  }
}

function readBundleId(appPath) {
  return run('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleIdentifier', path.join(appPath, 'Contents', 'Info.plist')]).trim()
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    printHelp()
    return
  }
  requireMacOS()
  ensureTool('openssl')
  if (!existsSync(args.app)) throw new Error(`App not found: ${args.app}`)

  if (!process.env.PUDDING_LOCAL_SIGN_KEYCHAIN_PASSWORD) {
    console.log('If macOS asks to unlock "pudding-local-codesign", use password: pudding-local-codesign')
  } else {
    console.log('If macOS asks to unlock the local signing keychain, use PUDDING_LOCAL_SIGN_KEYCHAIN_PASSWORD.')
  }

  ensureDedicatedKeychain()
  const identity = ensureIdentity()
  const { entitlementsPath, cleanup } = writeLocalEntitlements()
  try {
    if (args.clearQuarantine) {
      runQuiet('/usr/bin/xattr', ['-dr', 'com.apple.quarantine', args.app])
    }
    signApp(args.app, identity, entitlementsPath)
    run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', args.app], { stdio: 'inherit' })
    run('/usr/bin/codesign', ['-dv', '--verbose=4', args.app], { stdio: 'inherit' })
    if (args.resetTcc) resetTcc(readBundleId(args.app))
    console.log(`Local macOS signing complete: ${args.app}`)
  } finally {
    cleanup()
  }
}

try {
  main()
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err))
  process.exitCode = 1
}
