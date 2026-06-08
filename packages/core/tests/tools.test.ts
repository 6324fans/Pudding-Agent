import { describe, it, expect } from 'vitest'
import { ToolRegistry } from '../src/tool-registry.js'
import { ToolRunner } from '../src/tool-runner.js'
import { PermissionChecker } from '../src/permissions.js'
import { registerBuiltinTools } from '../src/tools/index.js'
import { writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

describe('Built-in Tools', () => {
  const tmpDir = path.join(os.tmpdir(), 'puddingagent-test-' + Date.now())

  const setup = async () => {
    await mkdir(tmpDir, { recursive: true })
    const registry = new ToolRegistry()
    registerBuiltinTools(registry)
    return new ToolRunner(registry, tmpDir, new PermissionChecker('relaxed'))
  }

  it('bash: should execute a command', async () => {
    const runner = await setup()
    const result = await runner.execute('bash', 'id-1', { command: 'echo hello' }, () => {})
    expect(result.content.trim()).toContain('hello')
  })

  it('bash: should include command metadata', async () => {
    const runner = await setup()
    const result = await runner.execute('bash', 'id-bash-meta', { command: 'echo metadata' }, () => {})
    expect(result.metadata?.command).toEqual({
      shell: 'bash',
      command: 'echo metadata',
      exitCode: 0,
    })
  })

  it('file_write + file_read: round trip', async () => {
    const runner = await setup()
    const testFile = path.join(tmpDir, 'test.txt')
    await runner.execute('file_write', 'id-2', { file_path: testFile, content: 'line1\nline2\nline3' }, () => {})
    const result = await runner.execute('file_read', 'id-3', { file_path: testFile }, () => {})
    expect(result.content).toContain('line1')
    expect(result.content).toContain('1\t')
  })

  it('file_read: should include read metadata', async () => {
    const runner = await setup()
    const testFile = path.join(tmpDir, 'read-meta.txt')
    await writeFile(testFile, 'alpha\nbeta\ngamma', 'utf-8')
    const result = await runner.execute('file_read', 'id-read-meta', { file_path: testFile, offset: 1, limit: 1 }, () => {})

    expect(result.metadata?.fileRead).toEqual({
      filePath: testFile,
      offset: 1,
      limit: 1,
      totalLines: 3,
      content: 'beta',
    })
  })

  it('file_write: should include mutation metadata', async () => {
    const runner = await setup()
    const testFile = path.join(tmpDir, 'write-meta.txt')
    const result = await runner.execute('file_write', 'id-write-meta', { file_path: testFile, content: 'created' }, () => {})

    expect(result.metadata?.mutations).toEqual([{ filePath: testFile, kind: 'write' }])
  })

  it('file_edit: should replace string', async () => {
    const runner = await setup()
    const testFile = path.join(tmpDir, 'edit.txt')
    await writeFile(testFile, 'hello world', 'utf-8')
    const result = await runner.execute('file_edit', 'id-4', { file_path: testFile, old_string: 'hello', new_string: 'goodbye' }, () => {})
    expect(result.content).toContain('Successfully')
  })

  it('file_edit: should include mutation metadata', async () => {
    const runner = await setup()
    const testFile = path.join(tmpDir, 'edit-meta.txt')
    await writeFile(testFile, 'hello world', 'utf-8')
    const result = await runner.execute('file_edit', 'id-edit-meta', { file_path: testFile, old_string: 'hello', new_string: 'goodbye' }, () => {})

    expect(result.metadata?.mutations).toEqual([{ filePath: testFile, kind: 'edit' }])
  })

  it('multi_edit: should include mutation metadata', async () => {
    const runner = await setup()
    const testFile = path.join(tmpDir, 'multi-edit-meta.txt')
    await writeFile(testFile, 'one two three', 'utf-8')
    const result = await runner.execute('multi_edit', 'id-multi-edit-meta', {
      file_path: testFile,
      edits: [
        { old_string: 'one', new_string: '1' },
        { old_string: 'three', new_string: '3' },
      ],
    }, () => {})

    expect(result.metadata?.mutations).toEqual([{ filePath: testFile, kind: 'multi_edit' }])
  })

  it('file_edit: should error on non-unique string', async () => {
    const runner = await setup()
    const testFile = path.join(tmpDir, 'dup.txt')
    await writeFile(testFile, 'aaa bbb aaa', 'utf-8')
    const result = await runner.execute('file_edit', 'id-5', { file_path: testFile, old_string: 'aaa', new_string: 'ccc' }, () => {})
    expect(result.isError).toBe(true)
    expect(result.content).toContain('2 times')
  })
})
