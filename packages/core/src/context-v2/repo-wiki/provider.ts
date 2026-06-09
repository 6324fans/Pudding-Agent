import { createHash } from 'node:crypto'
import path from 'node:path'
import { getContextEngine } from '../../context-engine/index.js'
import type { ContextEngine } from '../../context-engine/engine.js'
import { createContextScheduler, type ContextScheduler } from '../../context-engine/scheduler.js'
import type { ModelConfig } from '../../types.js'
import type { ContextFact, ContextProviderRequest, ContextProviderResult, RepoWikiEntry, RepoWikiEntryQuery, RepoWikiGeneratedBy, RepoWikiSummary } from '../types.js'
import { buildRepoWikiEvidencePacket } from './evidence.js'
import { generateRepoWikiEntries } from './generator.js'
import type { RepoWikiModelClient } from './model-client.js'
import { retrieveRepoWikiEntries, type RetrievedRepoWikiEntry } from './retrieval.js'

export const REPO_WIKI_SOURCE = 'context-v2-repo-wiki-provider'
const DEFAULT_REFRESH_MIN_INTERVAL_MS = 5 * 60 * 1000
const repoWikiScheduler = createContextScheduler()
const activeGenerationProjects = new Set<string>()

type RepoWikiContextEngine = Pick<ContextEngine, 'isIndexed' | 'index' | 'getStore'>

export interface RepoWikiProviderStore {
  listRepoWikiEntries(query?: RepoWikiEntryQuery): Promise<RepoWikiEntry[]>
  getRepoWikiSummary(): Promise<RepoWikiSummary>
  saveRepoWikiEntries(entries: RepoWikiEntry[]): Promise<{ savedEntries: number; diagnostics: string[] }>
}

export interface RepoWikiProviderOptions {
  enabled?: boolean
  store: RepoWikiProviderStore
  scheduler?: ContextScheduler
  getContextEngine?: (cwd: string) => RepoWikiContextEngine
  modelClient?: RepoWikiModelClient
  model?: RepoWikiGeneratedBy
  modelConfig?: ModelConfig
  refreshMinIntervalMs?: number
  limit?: number
}

export async function collectRepoWikiFacts(request: ContextProviderRequest, options: RepoWikiProviderOptions): Promise<ContextProviderResult> {
  if (options.enabled === false) return { facts: [], diagnostics: ['Repo Wiki provider is disabled.'] }

  const diagnostics: string[] = []
  const summary = await options.store.getRepoWikiSummary()
  diagnostics.push(repoWikiSummaryDiagnostic(summary.activeEntries, summary.staleEntries, summary.rejectedEntries))

  const entries = await options.store.listRepoWikiEntries()
  const selected = retrieveRepoWikiEntries({
    query: request.userMessage ?? '',
    entries,
    limit: options.limit ?? 4,
  })
  const facts = selected.map((item) => repoWikiFact(request, item))

  diagnostics.push(...maybeQueueRepoWikiGeneration(request, options, summary.activeEntries, summary.staleEntries))
  return { facts, diagnostics }
}

function maybeQueueRepoWikiGeneration(
  request: ContextProviderRequest,
  options: RepoWikiProviderOptions,
  activeEntryCount: number,
  staleEntryCount: number,
): string[] {
  if (activeEntryCount > 0 && staleEntryCount === 0) return []
  if (!options.modelClient || !options.model || !options.modelConfig) {
    return activeEntryCount === 0 ? ['Repo Wiki cache is empty; background generation is unavailable because no model client was provided.'] : []
  }

  const projectKey = path.resolve(request.cwd)
  if (activeGenerationProjects.has(projectKey)) return ['Repo Wiki generation is already queued for this project.']

  const scheduler = options.scheduler ?? repoWikiScheduler
  activeGenerationProjects.add(projectKey)
  const scheduled = scheduler.enqueueBackground(projectKey, 'repo_wiki_generate', async (signal) => {
    try {
      await deferBackgroundTurn()
      const engine = (options.getContextEngine ?? getContextEngine)(projectKey)
      if (!engine.isIndexed()) await engine.index()
      if (signal.aborted) return

      const startedAt = request.now?.() ?? Date.now()
      const evidence = buildRepoWikiEvidencePacket({ cwd: projectKey, indexStore: engine.getStore(), now: () => startedAt })
      const generated = await generateRepoWikiEntries({
        cwd: projectKey,
        projectKey,
        evidence,
        modelClient: options.modelClient!,
        model: options.model!,
        modelRequest: {
          modelConfig: options.modelConfig!,
          cacheUser: cacheUserForProject(projectKey),
          signal,
        },
        store: options.store,
        now: Date.now,
      })
      if (generated.entries.length === 0 && generated.diagnostics.length > 0) {
        await options.store.saveRepoWikiEntries([rejectedEntry(projectKey, options.model!, evidence.evidenceHash, generated.diagnostics[0], Date.now())])
      }
    } finally {
      activeGenerationProjects.delete(projectKey)
    }
  }, { minIntervalMs: options.refreshMinIntervalMs ?? DEFAULT_REFRESH_MIN_INTERVAL_MS })

  if (!scheduled.accepted) {
    activeGenerationProjects.delete(projectKey)
    return [`Repo Wiki generation was not queued: ${scheduled.reason}.`]
  }
  return ['Repo Wiki cache is empty or stale; background generation was queued without blocking foreground chat.']
}

function repoWikiFact(request: ContextProviderRequest, item: RetrievedRepoWikiEntry): ContextFact {
  const timestamp = request.now?.() ?? Date.now()
  const entry = item.entry
  return {
    id: `repo-wiki-fact-${entry.id}`,
    projectKey: request.projectKey,
    kind: 'repo_wiki',
    scope: 'project',
    title: entry.title,
    content: renderRepoWikiFactContent(item),
    citations: entry.citations,
    source: REPO_WIKI_SOURCE,
    tags: ['repo-wiki', entry.kind, ...entry.relatedFiles, ...entry.relatedSymbols],
    confidence: entry.confidence,
    createdAt: entry.createdAt || timestamp,
    updatedAt: entry.updatedAt || timestamp,
  }
}

function renderRepoWikiFactContent({ entry, reasons }: RetrievedRepoWikiEntry): string {
  return [
    `Repo Wiki: ${entry.title}`,
    `Kind: ${entry.kind}`,
    entry.summary ? `Summary: ${entry.summary}` : '',
    entry.content,
    reasons.length ? `Matched by: ${reasons.join(', ')}` : '',
  ].filter(Boolean).join('\n')
}

function repoWikiSummaryDiagnostic(activeEntries: number, staleEntries: number, rejectedEntries: number): string {
  return `Repo Wiki summary active=${activeEntries} stale=${staleEntries} rejected=${rejectedEntries}`
}

function rejectedEntry(projectKey: string, model: RepoWikiGeneratedBy, evidenceHash: string, reason: string, now: number): RepoWikiEntry {
  return {
    id: `repo_wiki_rejected_${createHash('sha1').update(`${projectKey}:${evidenceHash}:${reason}:${now}`).digest('hex').slice(0, 16)}`,
    projectKey,
    kind: 'constraint',
    title: 'Rejected Repo Wiki Generation',
    content: 'Repo Wiki generation output was rejected and was not used as durable context.',
    summary: 'Rejected model output.',
    citations: [{ id: `repo_wiki_rejected_${now}`, type: 'file', ref: 'code-index', hash: evidenceHash }],
    relatedFiles: [],
    relatedSymbols: [],
    confidence: 0.01,
    freshness: 'stale',
    generatedBy: model,
    evidenceHash,
    status: 'rejected',
    createdAt: now,
    updatedAt: now,
    lifecycleReason: reason,
  }
}

function deferBackgroundTurn(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function cacheUserForProject(projectKey: string): string {
  return `repo_wiki_${createHash('sha256').update(projectKey).digest('hex')}`
}
