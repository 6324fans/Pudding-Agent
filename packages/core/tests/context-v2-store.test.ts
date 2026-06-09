import { mkdirSync, writeFileSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createContextFactStore, ContextFactStore } from '../src/context-v2/store.js'

describe('context-v2 store', () => {
  it('saves, lists, updates, and isolates project facts by cwd', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'pudding-context-v2-store-'))
    const configDir = path.join(root, 'config')
    const cwdA = path.join(root, 'repo-a')
    const cwdB = path.join(root, 'repo-b')
    mkdirSync(cwdA)
    mkdirSync(cwdB)
    let now = 1000

    const storeA = createContextFactStore({ cwd: cwdA, configDir, now: () => now++ })
    await storeA.saveFact({
      id: 'billing-rule',
      kind: 'project',
      scope: 'project',
      title: 'Billing rule',
      content: 'Billing deploys require release checklist review.',
      citations: [{ id: 'c1', type: 'file', ref: 'docs/billing.md' }],
      source: 'test',
      tags: ['billing'],
      confidence: 0.9,
    })

    expect(await storeA.listFacts()).toHaveLength(1)
    expect(await storeA.listFacts({ tags: ['billing'] })).toHaveLength(1)

    const updated = await storeA.updateFact('billing-rule', { content: 'Billing deploys require QA signoff.' })
    expect(updated?.content).toBe('Billing deploys require QA signoff.')

    const storeB = createContextFactStore({ cwd: cwdB, configDir, now: () => now++ })
    expect(await storeB.listFacts()).toEqual([])
  })

  it('migrates legacy array files into the current store shape when reading', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'pudding-context-v2-migration-'))
    const cwd = path.join(root, 'repo')
    const storePath = path.join(root, 'legacy-facts.json')
    mkdirSync(cwd)
    writeFileSync(storePath, JSON.stringify([
      {
        id: 'legacy',
        kind: 'git',
        scope: 'turn',
        content: 'branch: main',
        citations: [{ type: 'git', ref: 'git status' }],
        source: 'legacy-test',
        createdAt: 1,
        updatedAt: 1,
      },
    ]), 'utf-8')

    const store = new ContextFactStore({ cwd, storePath, now: () => 5000 })
    const facts = await store.listFacts({ kinds: ['git'] })

    expect(facts).toHaveLength(1)
    expect(facts[0].projectKey).toBe(path.resolve(cwd))
    expect(facts[0].source).toBe('legacy-test')
  })
})
