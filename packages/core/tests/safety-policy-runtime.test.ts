import { beforeEach, describe, expect, it } from 'vitest'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { FileReadStateCache } from '../src/file-read-state.js'
import { SafetyPolicyRuntime } from '../src/safety/policy-runtime.js'

describe('SafetyPolicyRuntime', () => {
  const tmpDir = path.join(os.tmpdir(), 'pudding-safety-policy-test')
  const filePath = path.join(tmpDir, 'target.ts')

  beforeEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
    await mkdir(tmpDir, { recursive: true })
    await writeFile(filePath, 'const value = 1\n', 'utf-8')
  })

  it('warns instead of blocking unread edits by default', () => {
    const runtime = new SafetyPolicyRuntime({ now: () => 10 })
    const decision = runtime.preToolUse({
      toolName: 'file_edit',
      toolUseId: 'edit_1',
      input: { file_path: filePath, old_string: 'const value = 1', new_string: 'const value = 2' },
      cwd: tmpDir,
      fileReadState: new FileReadStateCache(),
    })

    expect(decision).toMatchObject({ decision: 'allow', warning: expect.stringContaining('has not been read') })
    expect(runtime.policyEvents.list()).toEqual([
      expect.objectContaining({
        phase: 'pre_tool_use',
        source: 'FileMutationPolicy',
        decision: 'warn',
        toolName: 'file_edit',
      }),
    ])
  })

  it('can be configured to block unread edits', () => {
    const runtime = new SafetyPolicyRuntime({ mode: 'block' })
    const decision = runtime.preToolUse({
      toolName: 'file_edit',
      input: { file_path: filePath, old_string: 'const value = 1', new_string: 'const value = 2' },
      cwd: tmpDir,
      fileReadState: new FileReadStateCache(),
    })

    expect(decision).toMatchObject({ decision: 'block' })
  })

  it('records mutation snapshots and pending verification', async () => {
    const runtime = new SafetyPolicyRuntime({ now: () => 10, cwd: tmpDir })
    const fileReadState = new FileReadStateCache()
    fileReadState.recordRead(filePath, 0, 2, 2, 'const value = 1\n')
    await writeFile(filePath, 'const value = 2\n', 'utf-8')

    runtime.postToolUse({
      toolName: 'file_edit',
      toolUseId: 'edit_1',
      input: { file_path: filePath, old_string: 'const value = 1', new_string: 'const value = 2' },
      cwd: tmpDir,
      fileReadState,
      result: {
        content: 'Successfully edited',
        metadata: { mutations: [{ filePath, kind: 'edit' }] },
      },
    })

    expect(fileReadState.checkFreshRead(filePath, { requiredText: 'const value = 2' }).ok).toBe(true)
    expect(runtime.verificationLedger.getChangedFiles()).toEqual([
      expect.objectContaining({
        filePath: 'target.ts',
        status: 'pending',
        changedByToolUseId: 'edit_1',
      }),
    ])
  })

  it('records failed verification commands even when the tool result is an error', () => {
    const runtime = new SafetyPolicyRuntime({ now: () => 10, cwd: tmpDir })
    const fileReadState = new FileReadStateCache()
    runtime.verificationLedger.recordMutation({ filePath, toolUseId: 'edit_1' })

    runtime.postToolUse({
      toolName: 'bash',
      toolUseId: 'bash_1',
      input: { command: 'pnpm test' },
      cwd: tmpDir,
      fileReadState,
      result: {
        content: 'test failed',
        isError: true,
        metadata: { command: { shell: 'bash', command: 'pnpm test', exitCode: 1 } },
      },
    })

    expect(runtime.verificationLedger.getCommands()[0]).toMatchObject({
      kind: 'test',
      status: 'failed',
    })
    expect(runtime.verificationLedger.getChangedFiles()[0]).toMatchObject({
      status: 'failed',
      verificationFailure: 'test failed',
    })
  })
})
