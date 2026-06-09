import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { collectConversationFacts, collectGitFacts, collectProjectFacts } from '../src/context-v2/providers/index.js'
import { projectKeyForCwd } from '../src/context-v2/store.js'

describe('context-v2 providers', () => {
  it('collects project facts from README, AGENTS, PUDDINGAGENT, and package.json', async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'pudding-context-v2-project-'))
    writeFileSync(path.join(cwd, 'README.md'), '# Demo\nProject overview', 'utf-8')
    writeFileSync(path.join(cwd, 'AGENTS.md'), 'Follow local instructions.', 'utf-8')
    writeFileSync(path.join(cwd, 'PUDDINGAGENT.md'), 'Use Pudding instructions.', 'utf-8')
    writeFileSync(path.join(cwd, 'package.json'), JSON.stringify({
      name: 'demo',
      scripts: { test: 'vitest', build: 'tsc' },
      dependencies: { zod: '^3.0.0' },
    }), 'utf-8')

    const result = await collectProjectFacts({ cwd, projectKey: projectKeyForCwd(cwd), now: () => 1 })

    expect(result.diagnostics).toEqual([])
    expect(result.facts.map((fact) => fact.title)).toEqual(expect.arrayContaining(['README.md', 'AGENTS.md', 'PUDDINGAGENT.md', 'package.json']))
    expect(result.facts.find((fact) => fact.title === 'package.json')?.content).toContain('scripts: build, test')
  })

  it('handles missing project files without throwing', async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'pudding-context-v2-missing-project-'))
    const result = await collectProjectFacts({ cwd, projectKey: projectKeyForCwd(cwd), now: () => 1 })

    expect(result.facts).toEqual([])
    expect(result.diagnostics[0]).toContain('No README')
  })

  it('collects git facts and degrades when git is unavailable', async () => {
    const gitCwd = await mkdtemp(path.join(os.tmpdir(), 'pudding-context-v2-git-'))
    execFileSync('git', ['init'], { cwd: gitCwd, stdio: 'ignore' })
    writeFileSync(path.join(gitCwd, 'note.txt'), 'hello', 'utf-8')

    const gitResult = await collectGitFacts({ cwd: gitCwd, projectKey: projectKeyForCwd(gitCwd), now: () => 1 })
    expect(gitResult.facts).toHaveLength(1)
    expect(gitResult.facts[0].content).toContain('status:')
    expect(gitResult.facts[0].content).toContain('?? note.txt')

    const plainCwd = await mkdtemp(path.join(os.tmpdir(), 'pudding-context-v2-no-git-'))
    const plainResult = await collectGitFacts({ cwd: plainCwd, projectKey: projectKeyForCwd(plainCwd), now: () => 1 })
    expect(plainResult.facts).toEqual([])
    expect(plainResult.diagnostics[0]).toContain('Git metadata is unavailable')
  })

  it('summarizes current conversation state', () => {
    const cwd = '/repo'
    const result = collectConversationFacts({
      cwd,
      projectKey: projectKeyForCwd(cwd),
      userMessage: 'Implement the migration task.',
      recentMessages: [
        { id: 'm1', role: 'user', timestamp: 1, content: [{ type: 'text', text: 'Previous request' }] },
      ],
      now: () => 1,
    })

    expect(result.facts).toHaveLength(1)
    expect(result.facts[0].content).toContain('Previous request')
    expect(result.facts[0].content).toContain('current user: Implement the migration task.')
  })
})
