import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { getConfigDir } from '../config.js'
import type { ContextFact, ContextFactQuery, ContextFactStoreFile } from './types.js'

export const CONTEXT_V2_STORE_VERSION = 1

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
  }
}

function normalizeFact(raw: unknown, projectKey: string, now: () => number): ContextFact {
  const fact = raw && typeof raw === 'object' ? raw as Partial<ContextFact> : {}
  const createdAt = typeof fact.createdAt === 'number' ? fact.createdAt : now()
  const updatedAt = typeof fact.updatedAt === 'number' ? fact.updatedAt : createdAt
  const kind = fact.kind === 'code' || fact.kind === 'git' || fact.kind === 'conversation' ? fact.kind : 'project'
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
