export type ContextFactKind = 'project' | 'code' | 'git' | 'conversation'

export type ContextCitationType = 'file' | 'code' | 'git' | 'message' | 'package'

export type ContextFactScope = 'project' | 'session' | 'turn'

export interface ContextCitation {
  id?: string
  type: ContextCitationType
  ref: string
  line?: number
  excerpt?: string
  timestamp?: number
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
