export type ContextFactKind = 'project' | 'code' | 'git' | 'conversation' | 'repo_wiki'

export type ContextCitationType = 'file' | 'code' | 'git' | 'message' | 'package'

export type ContextFactScope = 'project' | 'session' | 'turn'

export interface ContextCitation {
  id?: string
  type: ContextCitationType
  ref: string
  line?: number
  excerpt?: string
  timestamp?: number
  hash?: string
}

export interface ContextFact {
  id: string
  projectKey: string
  kind: ContextFactKind
  scope: ContextFactScope
  content: string
  citations: ContextCitation[]
  source: string
  title?: string
  tags?: string[]
  confidence?: number
  createdAt: number
  updatedAt: number
  expiresAt?: number
}

export interface ContextSection {
  id: string
  title: string
  content: string
  facts: ContextFact[]
  citations: ContextCitation[]
  tokenEstimate: number
}

export interface ContextProviderRequest {
  cwd: string
  projectKey: string
  sessionId?: string
  userMessage?: string
  recentMessages?: Array<{
    id: string
    role: string
    content: unknown
    timestamp: number
  }>
  now?: () => number
}

export interface ContextProviderResult {
  facts: ContextFact[]
  diagnostics: string[]
}

export interface ContextFactQuery {
  kinds?: ContextFactKind[]
  excludeKinds?: ContextFactKind[]
  tags?: string[]
  source?: string
  includeExpired?: boolean
  limit?: number
}

export interface ContextFactStoreFile {
  version: number
  projectKey: string
  updatedAt: number
  facts: ContextFact[]
  repoWikiEntries: RepoWikiEntry[]
}

export interface RetrievedContextFact {
  fact: ContextFact
  score: number
  reasons: string[]
  tokenEstimate: number
}

export interface ContextRetrievalResult {
  facts: RetrievedContextFact[]
  section: ContextSection | null
  usedTokens: number
  droppedTokens: number
}

export type RepoWikiEntryKind =
  | 'architecture'
  | 'module_boundary'
  | 'entrypoint'
  | 'workflow'
  | 'testing'
  | 'convention'
  | 'release'
  | 'constraint'

export type RepoWikiEntryStatus = 'active' | 'stale' | 'archived' | 'rejected'
export type RepoWikiEntryFreshness = 'cached' | 'stale'

export interface RepoWikiGeneratedBy {
  providerProtocol: string
  modelId: string
  modelProfileId?: string
}

export interface RepoWikiEntry {
  id: string
  projectKey: string
  kind: RepoWikiEntryKind
  title: string
  content: string
  summary?: string
  citations: ContextCitation[]
  relatedFiles: string[]
  relatedSymbols: string[]
  confidence: number
  freshness: RepoWikiEntryFreshness
  generatedBy: RepoWikiGeneratedBy
  evidenceHash: string
  status: RepoWikiEntryStatus
  createdAt: number
  updatedAt: number
  archivedAt?: number
  lifecycleReason?: string
}

export interface RepoWikiEntryQuery {
  kinds?: RepoWikiEntryKind[]
  includeStale?: boolean
  includeArchived?: boolean
  includeRejected?: boolean
  relatedFile?: string
  relatedSymbol?: string
  limit?: number
}

export interface RepoWikiSummaryEntry {
  id: string
  kind: RepoWikiEntryKind
  title: string
  status: RepoWikiEntryStatus
  summary: string
  updatedAt: number
}

export interface RepoWikiSummary {
  activeEntries: number
  staleEntries: number
  rejectedEntries: number
  lastGeneratedAt?: number
  lastModelId?: string
  lastDiagnostic?: string
  summaries: RepoWikiSummaryEntry[]
}

export interface RepoWikiInvalidationResult {
  invalidatedEntries: number
}

export interface RepoWikiEvidencePacket {
  id: string
  ref: string
  title: string
  content: string
  hash: string
  line?: number
  relatedSymbols: string[]
}

export interface RepoWikiModelSection {
  kind: RepoWikiEntryKind
  title: string
  content: string
  citationPacketIds: string[]
  relatedFiles: string[]
  relatedSymbols: string[]
  confidence: number
  summary?: string
}

export interface RepoWikiModelOutput {
  schemaVersion: 1
  action: 'save' | 'skip'
  reason?: string
  sections: RepoWikiModelSection[]
}
