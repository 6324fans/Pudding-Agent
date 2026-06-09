import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { getConfigDir } from '../config.js'
import type {
  ContextFact,
  ContextFactQuery,
  ContextFactStoreFile,
  RepoWikiEntry,
  RepoWikiEntryKind,
  RepoWikiEntryQuery,
  RepoWikiEntryStatus,
  RepoWikiInvalidationResult,
  RepoWikiSummary,
} from './types.js'

export const CONTEXT_V2_STORE_VERSION = 2

export interface ContextFactStoreOptions {
  cwd: string
  configDir?: string
  storePath?: string
  now?: () => number
}

export class ContextFactStore {
  readonly cwd: string
  readonly projectKey: string
  readonly storePath: string
  private readonly now: () => number

  constructor(options: ContextFactStoreOptions) {
    this.cwd = path.resolve(options.cwd)
    this.projectKey = projectKeyForCwd(this.cwd)
    this.storePath = options.storePath ?? contextFactStorePath(this.cwd, options.configDir)
    this.now = options.now ?? Date.now
  }

  async saveFact(fact: Omit<ContextFact, 'projectKey' | 'createdAt' | 'updatedAt'> & Partial<Pick<ContextFact, 'projectKey' | 'createdAt' | 'updatedAt'>>): Promise<ContextFact> {
    const file = await this.readStoreFile()
    const existingIndex = file.facts.findIndex((item) => item.id === fact.id)
    const current = existingIndex >= 0 ? file.facts[existingIndex] : null
    const saved = normalizeFact({
      ...(current ?? {}),
      ...fact,
      projectKey: this.projectKey,
      createdAt: current?.createdAt ?? fact.createdAt ?? this.now(),
      updatedAt: fact.updatedAt ?? this.now(),
    }, this.projectKey, this.now)

    if (existingIndex >= 0) {
      file.facts[existingIndex] = saved
    } else {
      file.facts.push(saved)
    }
    await this.writeStoreFile(file)
    return saved
  }

  async listFacts(query: ContextFactQuery = {}): Promise<ContextFact[]> {
    const file = await this.readStoreFile()
    const now = this.now()
    const kindSet = query.kinds ? new Set(query.kinds) : null
    const excludedKinds = query.excludeKinds ? new Set(query.excludeKinds) : null
    const tagSet = query.tags ? new Set(query.tags.map((tag) => tag.toLowerCase())) : null

    let facts = file.facts.filter((fact) => {
      if (fact.projectKey !== this.projectKey) return false
      if (!query.includeExpired && fact.expiresAt !== undefined && fact.expiresAt <= now) return false
      if (kindSet && !kindSet.has(fact.kind)) return false
      if (excludedKinds?.has(fact.kind)) return false
      if (query.source && fact.source !== query.source) return false
      if (tagSet) {
        const factTags = new Set((fact.tags ?? []).map((tag) => tag.toLowerCase()))
        for (const tag of tagSet) {
          if (!factTags.has(tag)) return false
        }
      }
      return true
    })

    facts = facts.sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id))
    return query.limit === undefined ? facts : facts.slice(0, query.limit)
  }

  async updateFact(
    id: string,
    update: Partial<Omit<ContextFact, 'id' | 'projectKey' | 'createdAt'>> | ((fact: ContextFact) => Partial<Omit<ContextFact, 'id' | 'projectKey' | 'createdAt'>>),
  ): Promise<ContextFact | null> {
    const file = await this.readStoreFile()
    const index = file.facts.findIndex((fact) => fact.id === id && fact.projectKey === this.projectKey)
    if (index === -1) return null

    const current = file.facts[index]
    const patch = typeof update === 'function' ? update(current) : update
    const next = normalizeFact({
      ...current,
      ...patch,
      id: current.id,
      projectKey: this.projectKey,
      createdAt: current.createdAt,
      updatedAt: patch.updatedAt ?? this.now(),
    }, this.projectKey, this.now)

    file.facts[index] = next
    await this.writeStoreFile(file)
    return next
  }

  async saveRepoWikiEntries(entries: RepoWikiEntry[]): Promise<{ savedEntries: number; diagnostics: string[] }> {
    const file = await this.readStoreFile()
    const diagnostics: string[] = []
    let savedEntries = 0

    for (const entry of entries) {
      const normalized = normalizeRepoWikiEntry(entry, this.projectKey, this.now)
      const validation = validateRepoWikiEntry(normalized)
      if (validation) {
        diagnostics.push(validation)
        continue
      }

      const existingIndex = file.repoWikiEntries.findIndex((item) => item.id === normalized.id)
      if (existingIndex >= 0) {
        file.repoWikiEntries[existingIndex] = normalized
      } else {
        file.repoWikiEntries.push(normalized)
      }
      savedEntries += 1
    }

    await this.writeStoreFile(file)
    return { savedEntries, diagnostics }
  }

  async listRepoWikiEntries(query: RepoWikiEntryQuery = {}): Promise<RepoWikiEntry[]> {
    const file = await this.readStoreFile()
    const kindSet = query.kinds ? new Set(query.kinds) : null
    const relatedFile = query.relatedFile ? normalizeRef(query.relatedFile) : null
    const relatedSymbol = query.relatedSymbol?.toLowerCase()

    let entries = file.repoWikiEntries.filter((entry) => {
      if (entry.projectKey !== this.projectKey) return false
      if (!query.includeArchived && entry.status === 'archived') return false
      if (!query.includeRejected && entry.status === 'rejected') return false
      if (!query.includeStale && (entry.status === 'stale' || entry.freshness === 'stale')) return false
      if (kindSet && !kindSet.has(entry.kind)) return false
      if (relatedFile) {
        const refs = new Set([
          ...entry.relatedFiles.map(normalizeRef),
          ...entry.citations.map((citation) => normalizeRef(citation.ref)),
        ])
        if (!refs.has(relatedFile)) return false
      }
      if (relatedSymbol && !entry.relatedSymbols.some((symbol) => symbol.toLowerCase() === relatedSymbol)) return false
      return true
    })

    entries = entries.sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id))
    return query.limit === undefined ? entries : entries.slice(0, query.limit)
  }

  async getRepoWikiSummary(): Promise<RepoWikiSummary> {
    const file = await this.readStoreFile()
    const entries = file.repoWikiEntries.filter((entry) => entry.projectKey === this.projectKey)
    const activeEntries = entries.filter((entry) => entry.status === 'active' && entry.freshness !== 'stale').length
    const staleEntries = entries.filter((entry) => entry.status === 'stale' || entry.freshness === 'stale').length
    const rejectedEntries = entries.filter((entry) => entry.status === 'rejected').length
    const latest = entries.slice().sort((a, b) => b.updatedAt - a.updatedAt)[0]

    return {
      activeEntries,
      staleEntries,
      rejectedEntries,
      ...(latest ? { lastGeneratedAt: latest.updatedAt, lastModelId: latest.generatedBy.modelId } : {}),
      ...(latest?.lifecycleReason ? { lastDiagnostic: latest.lifecycleReason } : {}),
      summaries: entries
        .slice()
        .sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id))
        .slice(0, 12)
        .map((entry) => ({
          id: entry.id,
          kind: entry.kind,
          title: entry.title,
          status: entry.status,
          summary: entry.summary ?? summarizeRepoWikiEntry(entry),
          updatedAt: entry.updatedAt,
        })),
    }
  }

  async invalidateRepoWikiByFileHash(filePath: string, hash: string): Promise<RepoWikiInvalidationResult> {
    const file = await this.readStoreFile()
    const normalizedFile = normalizeRef(filePath)
    let invalidatedEntries = 0

    file.repoWikiEntries = file.repoWikiEntries.map((entry) => {
      if (entry.projectKey !== this.projectKey) return entry
      if (entry.status !== 'active' && entry.status !== 'stale') return entry
      const hasCitation = entry.citations.some((citation) => normalizeRef(citation.ref) === normalizedFile && citation.hash && citation.hash !== hash)
      if (!hasCitation) return entry
      invalidatedEntries += 1
      return {
        ...entry,
        status: 'stale',
        freshness: 'stale',
        updatedAt: this.now(),
        lifecycleReason: `Citation hash changed for ${filePath}`,
      }
    })

    if (invalidatedEntries > 0) await this.writeStoreFile(file)
    return { invalidatedEntries }
  }

  private async readStoreFile(): Promise<ContextFactStoreFile> {
    try {
      const parsed = JSON.parse(await readFile(this.storePath, 'utf-8')) as unknown
      return migrateStoreFile(parsed, this.projectKey, this.now)
    } catch (error) {
      const code = typeof error === 'object' && error !== null && 'code' in error ? (error as { code?: string }).code : undefined
      if (code === 'ENOENT') return emptyStoreFile(this.projectKey, this.now())
      throw error
    }
  }

  private async writeStoreFile(file: ContextFactStoreFile): Promise<void> {
    const next: ContextFactStoreFile = {
      version: CONTEXT_V2_STORE_VERSION,
      projectKey: this.projectKey,
      updatedAt: this.now(),
      facts: file.facts.filter((fact) => fact.projectKey === this.projectKey),
      repoWikiEntries: file.repoWikiEntries.filter((entry) => entry.projectKey === this.projectKey),
    }
    await mkdir(path.dirname(this.storePath), { recursive: true })
    const tmpPath = `${this.storePath}.${process.pid}.${Date.now()}.tmp`
    await writeFile(tmpPath, JSON.stringify(next, null, 2), 'utf-8')
    await rename(tmpPath, this.storePath)
  }
}

export function createContextFactStore(options: ContextFactStoreOptions): ContextFactStore {
  return new ContextFactStore(options)
}

export function contextFactStorePath(cwd: string, configDir = contextV2ConfigDir()): string {
  return path.join(configDir, 'projects', projectPathSegment(cwd), 'context-v2', 'facts.json')
}

export function projectKeyForCwd(cwd: string): string {
  return path.resolve(cwd)
}

export function projectPathSegment(cwd: string): string {
  return path.resolve(cwd).replace(/\\/g, '/').replace(/\//g, '-').replace(/^-/, '')
}

function contextV2ConfigDir(): string {
  return process.env.PUDDINGAGENT_CONFIG_DIR || getConfigDir()
}

function emptyStoreFile(projectKey: string, updatedAt: number): ContextFactStoreFile {
  return {
    version: CONTEXT_V2_STORE_VERSION,
    projectKey,
    updatedAt,
    facts: [],
    repoWikiEntries: [],
  }
}

function migrateStoreFile(raw: unknown, projectKey: string, now: () => number): ContextFactStoreFile {
  const updatedAt = now()
  if (Array.isArray(raw)) {
    return {
      version: CONTEXT_V2_STORE_VERSION,
      projectKey,
      updatedAt,
      facts: raw.map((fact) => normalizeFact(fact, projectKey, now)),
      repoWikiEntries: [],
    }
  }

  if (!raw || typeof raw !== 'object') {
    return emptyStoreFile(projectKey, updatedAt)
  }

  const candidate = raw as Partial<ContextFactStoreFile>
  if (!Array.isArray(candidate.facts)) {
    return emptyStoreFile(projectKey, updatedAt)
  }

  return {
    version: CONTEXT_V2_STORE_VERSION,
    projectKey,
    updatedAt: typeof candidate.updatedAt === 'number' ? candidate.updatedAt : updatedAt,
    facts: candidate.facts.map((fact) => normalizeFact(fact, projectKey, now)),
    repoWikiEntries: Array.isArray(candidate.repoWikiEntries)
      ? candidate.repoWikiEntries.map((entry) => normalizeRepoWikiEntry(entry, projectKey, now))
      : [],
  }
}

function normalizeFact(raw: unknown, projectKey: string, now: () => number): ContextFact {
  const fact = raw && typeof raw === 'object' ? raw as Partial<ContextFact> : {}
  const createdAt = typeof fact.createdAt === 'number' ? fact.createdAt : now()
  const updatedAt = typeof fact.updatedAt === 'number' ? fact.updatedAt : createdAt
  const kind = fact.kind === 'code' || fact.kind === 'git' || fact.kind === 'conversation' || fact.kind === 'repo_wiki' ? fact.kind : 'project'
  const scope = fact.scope === 'session' || fact.scope === 'turn' ? fact.scope : 'project'

  return {
    id: typeof fact.id === 'string' && fact.id ? fact.id : `fact-${createdAt}`,
    projectKey,
    kind,
    scope,
    content: typeof fact.content === 'string' ? fact.content : '',
    citations: Array.isArray(fact.citations) ? fact.citations : [],
    source: typeof fact.source === 'string' && fact.source ? fact.source : 'context-v2-store',
    ...(typeof fact.title === 'string' && fact.title ? { title: fact.title } : {}),
    ...(Array.isArray(fact.tags) ? { tags: fact.tags.filter((tag): tag is string => typeof tag === 'string') } : {}),
    ...(typeof fact.confidence === 'number' ? { confidence: Math.max(0, Math.min(1, fact.confidence)) } : {}),
    createdAt,
    updatedAt,
    ...(typeof fact.expiresAt === 'number' ? { expiresAt: fact.expiresAt } : {}),
  }
}

const REPO_WIKI_KINDS: RepoWikiEntryKind[] = ['architecture', 'module_boundary', 'entrypoint', 'workflow', 'testing', 'convention', 'release', 'constraint']
const REPO_WIKI_STATUSES: RepoWikiEntryStatus[] = ['active', 'stale', 'archived', 'rejected']

function normalizeRepoWikiEntry(raw: unknown, projectKey: string, now: () => number): RepoWikiEntry {
  const entry = raw && typeof raw === 'object' ? raw as Partial<RepoWikiEntry> : {}
  const createdAt = typeof entry.createdAt === 'number' ? entry.createdAt : now()
  const updatedAt = typeof entry.updatedAt === 'number' ? entry.updatedAt : createdAt
  const kind = typeof entry.kind === 'string' && (REPO_WIKI_KINDS as string[]).includes(entry.kind) ? entry.kind as RepoWikiEntryKind : 'architecture'
  const status = typeof entry.status === 'string' && (REPO_WIKI_STATUSES as string[]).includes(entry.status) ? entry.status as RepoWikiEntryStatus : 'active'
  const freshness = entry.freshness === 'stale' || status === 'stale' ? 'stale' : 'cached'
  const generatedBy = entry.generatedBy && typeof entry.generatedBy === 'object' ? entry.generatedBy : {}
  const typedGeneratedBy = generatedBy as Partial<RepoWikiEntry['generatedBy']>

  return {
    id: typeof entry.id === 'string' && entry.id ? entry.id : `repo-wiki-${createdAt}`,
    projectKey,
    kind,
    title: typeof entry.title === 'string' && entry.title ? entry.title : 'Repo Wiki Entry',
    content: typeof entry.content === 'string' ? entry.content : '',
    ...(typeof entry.summary === 'string' && entry.summary ? { summary: entry.summary } : {}),
    citations: Array.isArray(entry.citations) ? entry.citations : [],
    relatedFiles: Array.isArray(entry.relatedFiles) ? entry.relatedFiles.filter((value): value is string => typeof value === 'string' && value.length > 0) : [],
    relatedSymbols: Array.isArray(entry.relatedSymbols) ? entry.relatedSymbols.filter((value): value is string => typeof value === 'string' && value.length > 0) : [],
    confidence: typeof entry.confidence === 'number' ? Math.max(0, Math.min(1, entry.confidence)) : 0.7,
    freshness,
    generatedBy: {
      providerProtocol: typeof typedGeneratedBy.providerProtocol === 'string' && typedGeneratedBy.providerProtocol ? typedGeneratedBy.providerProtocol : 'unknown',
      modelId: typeof typedGeneratedBy.modelId === 'string' && typedGeneratedBy.modelId ? typedGeneratedBy.modelId : 'unknown',
      ...(typeof typedGeneratedBy.modelProfileId === 'string' && typedGeneratedBy.modelProfileId ? { modelProfileId: typedGeneratedBy.modelProfileId } : {}),
    },
    evidenceHash: typeof entry.evidenceHash === 'string' ? entry.evidenceHash : '',
    status,
    createdAt,
    updatedAt,
    ...(typeof entry.archivedAt === 'number' ? { archivedAt: entry.archivedAt } : {}),
    ...(typeof entry.lifecycleReason === 'string' && entry.lifecycleReason ? { lifecycleReason: entry.lifecycleReason } : {}),
  }
}

function validateRepoWikiEntry(entry: RepoWikiEntry): string | null {
  if (!entry.title.trim()) return `Rejected Repo Wiki entry ${entry.id}: title is required.`
  if (!entry.content.trim()) return `Rejected Repo Wiki entry ${entry.id}: content is required.`
  if (entry.status === 'active' && entry.citations.length === 0) return `Rejected Repo Wiki entry ${entry.id}: active entries require citations.`
  if (entry.confidence <= 0 || entry.confidence > 1) return `Rejected Repo Wiki entry ${entry.id}: confidence must be > 0 and <= 1.`
  return null
}

function summarizeRepoWikiEntry(entry: RepoWikiEntry): string {
  const compact = entry.content.replace(/\s+/g, ' ').trim()
  return compact.length > 220 ? `${compact.slice(0, 217)}...` : compact
}

function normalizeRef(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase()
}
