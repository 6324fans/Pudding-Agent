import type { RepoWikiEntry } from '../types.js'

export interface RetrievedRepoWikiEntry {
  entry: RepoWikiEntry
  score: number
  reasons: string[]
}

export interface RetrieveRepoWikiEntriesInput {
  query: string
  entries: RepoWikiEntry[]
  limit?: number
}

export function retrieveRepoWikiEntries(input: RetrieveRepoWikiEntriesInput): RetrievedRepoWikiEntry[] {
  const queryTokens = tokens(input.query)
  const scored = input.entries
    .filter((entry) => entry.status === 'active' && entry.freshness !== 'stale')
    .map((entry) => scoreEntry(entry, queryTokens))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || b.entry.updatedAt - a.entry.updatedAt || a.entry.id.localeCompare(b.entry.id))
  return typeof input.limit === 'number' ? scored.slice(0, input.limit) : scored
}

function scoreEntry(entry: RepoWikiEntry, queryTokens: string[]): RetrievedRepoWikiEntry {
  const reasons: string[] = []
  let relevanceScore = 0
  const haystack = tokens([
    entry.kind,
    entry.title,
    entry.summary ?? '',
    entry.content,
    ...entry.relatedFiles,
    ...entry.relatedSymbols,
    ...entry.citations.map((citation) => citation.ref),
  ].join(' '))
  const haystackSet = new Set(haystack)
  const matched = queryTokens.filter((token) => haystackSet.has(token))
  if (matched.length) {
    relevanceScore += matched.length * 12
    reasons.push('query_match')
  }

  if (relevanceScore === 0 && queryTokens.length > 0) return { entry, score: 0, reasons: [] }

  let score = relevanceScore + entry.confidence * 10
  if (entry.confidence > 0) reasons.push('confidence')
  if (entry.freshness === 'cached') {
    score += 6
    reasons.push('freshness_cached')
  }
  if (entry.kind === 'architecture' || entry.kind === 'module_boundary') {
    score += 6
    reasons.push('high_value_kind')
  }

  return { entry, score, reasons: [...new Set(reasons)] }
}

function tokens(value: string): string[] {
  return value.toLowerCase().split(/[^\p{L}\p{N}_./:-]+/u).map((token) => token.trim()).filter(Boolean)
}
