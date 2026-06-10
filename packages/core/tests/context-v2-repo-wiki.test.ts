import { createHash } from 'node:crypto'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { IndexStore } from '../src/context-engine/graph/store.js'
import type { ContextScheduler } from '../src/context-engine/scheduler.js'
import type { FileIndex, SymbolNode } from '../src/context-engine/types.js'
import {
  buildRepoWikiEvidencePacket,
  collectRepoWikiFacts,
  createContextFactStore,
  generateRepoWikiEntries,
  projectKeyForCwd,
  retrieveRepoWikiEntries,
} from '../src/context-v2/index.js'
import type { RepoWikiEntry, RepoWikiModelClient } from '../src/context-v2/index.js'

function indexedFile(filePath: string, hash: string, symbols: SymbolNode[] = []): FileIndex {
  return { filePath, language: 'typescript', hash, symbols, references: [], imports: [] }
}

function symbol(overrides: Partial<SymbolNode> = {}): SymbolNode {
  return {
    id: overrides.id ?? 'sym_main',
    name: overrides.name ?? 'main',
    kind: overrides.kind ?? 'function',
    filePath: overrides.filePath ?? 'src/main.ts',
    line: overrides.line ?? 1,
    column: overrides.column ?? 1,
    startLine: overrides.startLine ?? overrides.line ?? 1,
    endLine: overrides.endLine ?? overrides.line ?? 1,
    signature: overrides.signature,
  }
}

describe('context-v2 repo wiki', () => {
  it('builds evidence from repo map, docs, package scripts, and current file hashes', async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'pudding-repo-wiki-evidence-'))
    mkdirSync(path.join(cwd, 'src'), { recursive: true })
    writeFileSync(path.join(cwd, 'README.md'), '# Pudding\nRun pnpm test.\n', 'utf-8')
    writeFileSync(path.join(cwd, 'AGENTS.md'), 'Follow local instructions.', 'utf-8')
    writeFileSync(path.join(cwd, 'PUDDINGAGENT.md'), 'Use Pudding instructions.', 'utf-8')
    writeFileSync(path.join(cwd, 'OLDAGENT.md'), 'Legacy doc that should not be used.', 'utf-8')
    writeFileSync(path.join(cwd, 'package.json'), JSON.stringify({ scripts: { test: 'vitest', build: 'tsc' } }), 'utf-8')
    const mainContent = 'export function main() {}\n'
    writeFileSync(path.join(cwd, 'src/main.ts'), mainContent, 'utf-8')

    const indexStore = new IndexStore()
    indexStore.upsertFile(indexedFile('src/main.ts', hashIndexedContent(mainContent), [symbol({ signature: 'export function main()' })]))

    const evidence = buildRepoWikiEvidencePacket({ cwd, indexStore, now: () => 1 })

    expect(evidence.diagnostics).toEqual([])
    expect(evidence.packets.map((packet) => packet.ref)).toEqual(expect.arrayContaining(['code-index', 'src/main.ts', 'README.md', 'AGENTS.md', 'PUDDINGAGENT.md', 'package.json']))
    expect(evidence.packets.map((packet) => packet.ref)).not.toContain('OLDAGENT.md')
    expect(evidence.packets.find((packet) => packet.ref === 'src/main.ts')?.hash).toBe(hashCurrentContent(mainContent))
    expect(evidence.packets.find((packet) => packet.ref === 'package.json')?.content).toContain('"test":"vitest"')
    expect(evidence.evidenceHash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('emits diagnostics for stale index packets and missing citation files', async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'pudding-repo-wiki-stale-'))
    mkdirSync(path.join(cwd, 'src'), { recursive: true })
    writeFileSync(path.join(cwd, 'src/main.ts'), 'export function main() {}\n', 'utf-8')
    const indexStore = new IndexStore()
    indexStore.upsertFile(indexedFile('src/main.ts', hashIndexedContent('export function stale() {}\n'), [symbol()]))

    const evidence = buildRepoWikiEvidencePacket({ cwd, indexStore, now: () => 1 })

    expect(evidence.packets.map((packet) => packet.ref)).not.toContain('src/main.ts')
    expect(evidence.diagnostics[0]).toContain('stale index packet for src/main.ts')
  })

  it('generates entries only from valid citation-backed model output', async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'pudding-repo-wiki-generate-'))
    mkdirSync(path.join(cwd, 'src'), { recursive: true })
    const mainContent = 'export function main() {}\n'
    writeFileSync(path.join(cwd, 'src/main.ts'), mainContent, 'utf-8')
    const indexStore = new IndexStore()
    indexStore.upsertFile(indexedFile('src/main.ts', hashIndexedContent(mainContent), [symbol({ signature: 'export function main()' })]))
    const evidence = buildRepoWikiEvidencePacket({ cwd, indexStore, now: () => 1 })
    const mainPacket = evidence.packets.find((packet) => packet.ref === 'src/main.ts')!
    const modelClient: RepoWikiModelClient = {
      completeRepoWiki: vi.fn(async () => JSON.stringify({
        schemaVersion: 1,
        action: 'save',
        sections: [{
          kind: 'entrypoint',
          title: 'Runtime entry point',
          content: 'The runtime entry point is the exported main function.',
          summary: 'Runtime starts from main.',
          citationPacketIds: [mainPacket.id],
          relatedFiles: ['src/main.ts'],
          relatedSymbols: ['main'],
          confidence: 0.9,
        }],
      })),
    }

    const generated = await generateRepoWikiEntries({
      cwd,
      projectKey: cwd,
      evidence,
      modelClient,
      model: { providerProtocol: 'test', modelId: 'repo-wiki-test' },
      now: () => 2,
    })

    expect(generated.diagnostics).toEqual([])
    expect(generated.entries).toEqual([
      expect.objectContaining({
        kind: 'entrypoint',
        title: 'Runtime entry point',
        summary: 'Runtime starts from main.',
        citations: [expect.objectContaining({ ref: 'src/main.ts', hash: hashCurrentContent(mainContent) })],
      }),
    ])

    const unknownCitation = await generateRepoWikiEntries({
      cwd,
      projectKey: cwd,
      evidence,
      modelClient: { completeRepoWiki: vi.fn(async () => JSON.stringify({ schemaVersion: 1, action: 'save', sections: [{ kind: 'architecture', title: 'Bad', content: 'No proof.', citationPacketIds: ['missing_packet'], relatedFiles: [], relatedSymbols: [], confidence: 0.8 }] })) },
      model: { providerProtocol: 'test', modelId: 'repo-wiki-test' },
      now: () => 3,
    })
    expect(unknownCitation.entries).toEqual([])
    expect(unknownCitation.diagnostics[0]).toContain('unknown citation packet')

    const hiddenReasoning = await generateRepoWikiEntries({
      cwd,
      projectKey: cwd,
      evidence,
      modelClient: { completeRepoWiki: vi.fn(async () => JSON.stringify({ schemaVersion: 1, action: 'save', sections: [{ kind: 'architecture', title: 'Hidden', content: 'Hidden reasoning: think secretly.', citationPacketIds: [mainPacket.id], relatedFiles: ['src/main.ts'], relatedSymbols: [], confidence: 0.8 }] })) },
      model: { providerProtocol: 'test', modelId: 'repo-wiki-test' },
      now: () => 4,
    })
    expect(hiddenReasoning.entries).toEqual([])
    expect(hiddenReasoning.diagnostics[0]).toContain('hidden reasoning')

    writeFileSync(path.join(cwd, 'src/main.ts'), 'export function main() { return 1 }\n', 'utf-8')
    const staleHash = await generateRepoWikiEntries({
      cwd,
      projectKey: cwd,
      evidence,
      modelClient: { completeRepoWiki: vi.fn(async () => JSON.stringify({ schemaVersion: 1, action: 'save', sections: [{ kind: 'architecture', title: 'Stale', content: 'Main exists.', citationPacketIds: [mainPacket.id], relatedFiles: ['src/main.ts'], relatedSymbols: [], confidence: 0.8 }] })) },
      model: { providerProtocol: 'test', modelId: 'repo-wiki-test' },
      now: () => 5,
    })
    expect(staleHash.entries).toEqual([])
    expect(staleHash.diagnostics[0]).toContain('stale hash')

    rmSync(path.join(cwd, 'src/main.ts'))
    const missingCitationFile = await generateRepoWikiEntries({
      cwd,
      projectKey: cwd,
      evidence,
      modelClient: { completeRepoWiki: vi.fn(async () => JSON.stringify({ schemaVersion: 1, action: 'save', sections: [{ kind: 'architecture', title: 'Missing', content: 'Main exists.', citationPacketIds: [mainPacket.id], relatedFiles: ['src/main.ts'], relatedSymbols: [], confidence: 0.8 }] })) },
      model: { providerProtocol: 'test', modelId: 'repo-wiki-test' },
      now: () => 6,
    })
    expect(missingCitationFile.entries).toEqual([])
    expect(missingCitationFile.diagnostics[0]).toContain('missing citation file')
  })

  it('persists, filters, summarizes, and invalidates repo wiki entries', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'pudding-repo-wiki-store-'))
    const cwd = path.join(root, 'repo')
    const configDir = path.join(root, 'config')
    mkdirSync(cwd)
    let now = 10
    const store = createContextFactStore({ cwd, configDir, now: () => now++ })

    await expect(store.saveRepoWikiEntries([
      repoWikiEntry({ projectKey: projectKeyForCwd(cwd), updatedAt: 10 }),
      repoWikiEntry({ id: 'wiki_rejected', projectKey: projectKeyForCwd(cwd), status: 'rejected', freshness: 'stale', lifecycleReason: 'model output failed validation', updatedAt: 11 }),
    ])).resolves.toMatchObject({ savedEntries: 2, diagnostics: [] })

    expect(await store.listRepoWikiEntries()).toEqual([expect.objectContaining({ id: 'wiki_architecture' })])
    expect(await store.listRepoWikiEntries({ includeRejected: true, includeStale: true })).toHaveLength(2)
    expect(await store.listRepoWikiEntries({ relatedFile: 'src/main.ts' })).toEqual([expect.objectContaining({ id: 'wiki_architecture' })])

    const summary = await store.getRepoWikiSummary()
    expect(summary).toMatchObject({ activeEntries: 1, staleEntries: 1, rejectedEntries: 1, lastModelId: 'repo-wiki-test' })
    expect(summary.summaries[0].summary).toBeTruthy()

    const invalidated = await store.invalidateRepoWikiByFileHash('src/main.ts', 'new_hash')
    expect(invalidated.invalidatedEntries).toBe(1)
    expect(await store.listRepoWikiEntries()).toEqual([])
    expect(await store.listRepoWikiEntries({ includeStale: true })).toEqual([expect.objectContaining({ status: 'stale', freshness: 'stale' })])
  })

  it('retrieves active cached entries and queues background generation on empty cache', async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'pudding-repo-wiki-provider-'))
    const configDir = path.join(cwd, '.config')
    mkdirSync(path.join(cwd, 'src'), { recursive: true })
    const mainContent = 'export function main() {}\n'
    writeFileSync(path.join(cwd, 'src/main.ts'), mainContent, 'utf-8')
    const indexStore = new IndexStore()
    indexStore.upsertFile(indexedFile('src/main.ts', hashIndexedContent(mainContent), [symbol({ signature: 'export function main()' })]))
    const store = createContextFactStore({ cwd, configDir, now: () => 1 })

    let indexed = false
    let queued: Promise<void> | undefined
    const scheduler = immediateScheduler((promise) => { queued = promise })
    const modelClient: RepoWikiModelClient = {
      completeRepoWiki: vi.fn(async (request) => {
        const packet = request.evidence.packets.find((item) => item.ref === 'src/main.ts')!
        return JSON.stringify({
          schemaVersion: 1,
          action: 'save',
          sections: [{
            kind: 'entrypoint',
            title: 'Runtime entry point',
            content: 'The runtime starts from src/main.ts.',
            citationPacketIds: [packet.id],
            relatedFiles: ['src/main.ts'],
            relatedSymbols: ['main'],
            confidence: 0.9,
          }],
        })
      }),
    }

    const initial = await collectRepoWikiFacts({ cwd, projectKey: projectKeyForCwd(cwd), userMessage: 'main entry', now: () => 1 }, {
      store,
      scheduler,
      getContextEngine: () => ({
        isIndexed: () => indexed,
        index: async () => { indexed = true },
        getStore: () => indexStore,
      }),
      modelClient,
      modelConfig: { model: 'repo-wiki-test', maxTokens: 1000 },
      model: { providerProtocol: 'test', modelId: 'repo-wiki-test' },
      refreshMinIntervalMs: 0,
    })

    expect(initial.facts).toEqual([])
    expect(initial.diagnostics).toContain('Repo Wiki cache is empty or stale; background generation was queued without blocking foreground chat.')
    await queued

    const cached = await collectRepoWikiFacts({ cwd, projectKey: projectKeyForCwd(cwd), userMessage: 'main entry', now: () => 2 }, { store })
    expect(cached.facts).toEqual([expect.objectContaining({ kind: 'repo_wiki', title: 'Runtime entry point' })])
    expect(cached.diagnostics).toContain('Repo Wiki summary active=1 stale=0 rejected=0')

    const retrieved = retrieveRepoWikiEntries({ query: 'main entry', entries: await store.listRepoWikiEntries() })
    expect(retrieved[0]).toMatchObject({ entry: expect.objectContaining({ title: 'Runtime entry point' }), reasons: expect.arrayContaining(['query_match']) })
  })
})

function hashIndexedContent(content: string): string {
  return createHash('sha1').update(content).digest('hex')
}

function hashCurrentContent(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

function repoWikiEntry(overrides: Partial<RepoWikiEntry> = {}): RepoWikiEntry {
  return {
    id: 'wiki_architecture',
    projectKey: '/repo',
    kind: 'architecture',
    title: 'Architecture overview',
    content: 'Runtime context is assembled before model calls.',
    summary: 'Runtime context is assembled before model calls.',
    citations: [{ id: 'cit', type: 'file', ref: 'src/main.ts', hash: 'hash_main' }],
    relatedFiles: ['src/main.ts'],
    relatedSymbols: ['main'],
    confidence: 0.9,
    freshness: 'cached',
    generatedBy: { providerProtocol: 'test', modelId: 'repo-wiki-test' },
    evidenceHash: 'hash',
    status: 'active',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

function immediateScheduler(onPromise: (promise: Promise<void>) => void): ContextScheduler {
  return {
    recorder: {
      record: () => {},
      snapshot: () => ({ operations: [] }),
      clear: () => {},
    },
    runForeground: async (_name, _timeout, task, _degraded) => task(new AbortController().signal),
    enqueueBackground: (_projectKey, _name, task) => {
      const promise = task(new AbortController().signal)
      onPromise(promise)
      return { accepted: true, promise }
    },
    cancelProject: () => {},
  }
}
