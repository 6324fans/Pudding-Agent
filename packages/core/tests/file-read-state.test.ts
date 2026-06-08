import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, rm, stat, unlink, utimes, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { FileReadStateCache } from '../src/file-read-state.js'

describe('FileReadStateCache fresh read checks', () => {
  const tmpDir = path.join(os.tmpdir(), 'pudding-file-read-state-test')
  const filePath = path.join(tmpDir, 'sample.ts')

  beforeEach(async () => {
    await mkdir(tmpDir, { recursive: true })
    await writeFile(filePath, 'const alpha = 1\nconst beta = 2\n')
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('reports not_read when a file has not been read', () => {
    const cache = new FileReadStateCache()

    const result = cache.checkFreshRead(filePath, { requiredText: 'const alpha = 1' })

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('not_read')
  })

  it('accepts fresh full-file and required-text reads', () => {
    const cache = new FileReadStateCache()
    cache.recordRead(filePath, 0, 3, 3, 'const alpha = 1\nconst beta = 2\n')

    expect(cache.checkFreshRead(filePath, { requiredText: 'const beta = 2' }).ok).toBe(true)
    expect(cache.checkFreshRead(filePath, { requireFullFile: true }).ok).toBe(true)
  })

  it('rejects stale same-size content with unchanged mtime', async () => {
    const cache = new FileReadStateCache()
    const originalContent = 'const alpha = 1\nconst beta = 2\n'
    cache.recordRead(filePath, 0, 3, 3, originalContent)
    const originalStat = await stat(filePath)

    const changedContent = 'const gamma = 3\nconst beta = 2\n'
    expect(Buffer.byteLength(changedContent)).toBe(Buffer.byteLength(originalContent))
    await writeFile(filePath, changedContent)
    await utimes(filePath, originalStat.atime, originalStat.mtime)

    expect(cache.checkFreshRead(filePath).reason).toBe('stale')
  })

  it('reports missing when a previously read file is deleted', async () => {
    const cache = new FileReadStateCache()
    cache.recordRead(filePath, 0, 3, 3, 'const alpha = 1\nconst beta = 2\n')
    await unlink(filePath)

    expect(cache.checkFreshRead(filePath).reason).toBe('missing')
  })

  it('keeps mutation snapshots limited to previously visible ranges', async () => {
    const cache = new FileReadStateCache()
    cache.recordRead(filePath, 0, 1, 3, 'const alpha = 1')
    await writeFile(filePath, 'const alpha = 10\nconst beta = 2\n', 'utf-8')

    cache.recordMutationSnapshot(filePath, 'const alpha = 10\nconst beta = 2\n', {
      replacements: [{ oldText: 'const alpha = 1', newText: 'const alpha = 10' }],
    })

    expect(cache.checkFreshRead(filePath, { requiredText: 'const alpha = 10' }).ok).toBe(true)
    expect(cache.checkFreshRead(filePath, { requiredText: 'const beta = 2' }).reason).toBe('range_not_read')
  })
})
