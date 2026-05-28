import { chmodSync, existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

if (process.platform !== 'win32') {
  const require = createRequire(import.meta.url)

  try {
    const entry = require.resolve('node-pty')
    const libDir = path.dirname(entry)
    const platformDir = `${process.platform}-${process.arch}`
    const candidates = [
      path.resolve(libDir, '../build/Release/spawn-helper'),
      path.resolve(libDir, '../build/Debug/spawn-helper'),
      path.resolve(libDir, `../prebuilds/${platformDir}/spawn-helper`),
    ]

    for (const candidate of candidates) {
      if (!existsSync(candidate)) continue
      const stat = statSync(candidate)
      if (!stat.isFile() || (stat.mode & 0o111) !== 0) continue
      chmodSync(candidate, stat.mode | 0o111)
      console.log(`[fix-node-pty-permissions] added executable bit: ${candidate}`)
    }
  } catch (err) {
    console.warn(`[fix-node-pty-permissions] skipped: ${err.message}`)
  }
}
