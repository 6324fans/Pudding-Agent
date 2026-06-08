import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { classifyVerificationCommand } from '../src/verification/tool-output-classifier.js'
import { VerificationLedger } from '../src/verification/verification-ledger.js'
import { deriveVerificationRequirements } from '../src/verification/verification-requirements.js'

function tempProject(): string {
  return mkdtempSync(path.join(tmpdir(), 'pudding-verify-'))
}

describe('classifyVerificationCommand', () => {
  it.each([
    ['pnpm --filter @puddingagent/core build', 'build'],
    ['corepack pnpm --filter @puddingagent/core build', 'build'],
    ['npm run typecheck', 'typecheck'],
    ['pnpm exec vitest run src/foo.test.ts', 'test'],
    ['pytest tests/test_api.py -q', 'test'],
    ['cargo test', 'test'],
    ['go test ./...', 'test'],
    ['cd packages/core && pnpm build', 'build'],
    ['pnpm lint', 'lint'],
    ['git diff --check', 'diff_check'],
  ])('classifies %s as %s', (command, kind) => {
    expect(classifyVerificationCommand(command)).toEqual({ kind })
  })

  it('ignores non-verification commands', () => {
    expect(classifyVerificationCommand('git status --short')).toBeUndefined()
    expect(classifyVerificationCommand('echo "pnpm test"')).toBeUndefined()
  })
})

describe('VerificationLedger', () => {
  it('marks changed files pending, passed, and failed', () => {
    const ledger = new VerificationLedger({ now: () => 100 })
    ledger.recordMutation({ filePath: 'src/a.ts', toolUseId: 'edit_1' })

    expect(ledger.getChangedFiles()[0]).toMatchObject({ status: 'pending' })

    ledger.recordCommand({
      toolUseId: 'bash_1',
      command: 'pnpm build',
      kind: 'build',
      status: 'passed',
      output: 'ok',
    })
    expect(ledger.getChangedFiles()[0]).toMatchObject({ status: 'verified', verifiedByToolUseId: 'bash_1' })

    ledger.recordCommand({
      toolUseId: 'bash_2',
      command: 'pnpm test',
      kind: 'test',
      status: 'failed',
      output: '1 failed',
    })
    expect(ledger.getChangedFiles()[0]).toMatchObject({ status: 'failed', verificationFailure: '1 failed' })
  })

  it('matches focused package commands using actual workspace package names', () => {
    const ledger = new VerificationLedger({
      now: () => 100,
      workspacePackages: [
        { path: 'packages/core', name: '@puddingagent/core' },
        { path: 'packages/ui', name: '@puddingagent/ui' },
      ],
    })
    ledger.recordMutation({ filePath: 'packages/core/src/session.ts', toolUseId: 'edit_1' })
    ledger.setRequirements([{
      id: 'verify_build',
      kind: 'build',
      command: 'pnpm build',
      status: 'pending',
      files: ['packages/core/src/session.ts'],
      reason: 'build script covers changed files.',
    }])

    ledger.recordCommand({
      toolUseId: 'bash_1',
      command: 'pnpm --filter @puddingagent/ui build',
      kind: 'build',
      status: 'passed',
      output: 'ok',
    })
    expect(ledger.getRequirements()[0]).toMatchObject({ status: 'pending' })

    ledger.recordCommand({
      toolUseId: 'bash_2',
      command: 'corepack pnpm --filter @puddingagent/core build',
      kind: 'build',
      status: 'passed',
      output: 'ok',
    })
    expect(ledger.getRequirements()[0]).toMatchObject({ status: 'passed', satisfiedByToolUseId: 'bash_2' })
  })
})

describe('deriveVerificationRequirements', () => {
  it('requires git diff check for docs-only changes', async () => {
    const cwd = tempProject()
    writeFileSync(path.join(cwd, 'package.json'), JSON.stringify({ scripts: { build: 'tsc' } }))

    const plan = await deriveVerificationRequirements({
      cwd,
      changedFiles: ['docs/plan.md'],
    })

    expect(plan.requirements).toEqual([
      expect.objectContaining({
        id: 'verify_diff_check',
        kind: 'diff_check',
        command: 'git diff --check',
        status: 'pending',
      }),
    ])
  })

  it('derives code requirements and reads Pudding-style workspace package names', async () => {
    const cwd = tempProject()
    writeFileSync(path.join(cwd, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
    writeFileSync(path.join(cwd, 'package.json'), JSON.stringify({
      scripts: {
        build: 'tsc',
        test: 'vitest run',
        typecheck: 'tsc --noEmit',
      },
    }))
    mkdirSync(path.join(cwd, 'packages/core'), { recursive: true })
    writeFileSync(path.join(cwd, 'packages/core/package.json'), JSON.stringify({ name: '@puddingagent/core' }))

    const plan = await deriveVerificationRequirements({
      cwd,
      changedFiles: ['packages/core/src/session.ts'],
    })

    expect(plan.workspacePackages).toEqual([{ path: 'packages/core', name: '@puddingagent/core' }])
    expect(plan.requirements).toEqual([
      expect.objectContaining({ id: 'verify_test', command: 'pnpm test', status: 'pending' }),
      expect.objectContaining({ id: 'verify_build', command: 'pnpm build', status: 'pending' }),
      expect.objectContaining({ id: 'verify_typecheck', command: 'pnpm typecheck', status: 'pending' }),
    ])
  })
})
