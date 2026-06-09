import type {
  ContextCitation,
  ContextFact,
  ContextFactKind,
  ContextRetrievalResult,
  ContextSection,
  RetrievedContextFact,
} from './types.js'

export interface RetrieveContextFactsOptions {
  userMessage: string
  facts: ContextFact[]
  maxFacts?: number
  tokenBudget?: number
  excludeKinds?: ContextFactKind[]
  now?: () => number
}

const KIND_PRIORITIES: Record<ContextFactKind, number> = {
  project: 18,
  code: 16,
  git: 12,
  conversation: 10,
}

export function retrieveContextFacts(options: RetrieveContextFactsOptions): ContextRetrievalResult {
  const now = options.now ?? Date.now
  const query = normalizeSearchText(options.userMessage)
  const queryTokens = tokenize(query)
  const excludedKinds = new Set(options.excludeKinds ?? [])
  const maxFacts = options.maxFacts ?? 8
  const tokenBudget = options.tokenBudget ?? 900

  const scored = options.facts
    .filter((fact) => !excludedKinds.has(fact.kind))
    .filter((fact) => fact.content.trim().length > 0)
    .map((fact) => scoreFact(fact, query, queryTokens, now()))
    .filter((item) => queryTokens.length === 0 || item.reasons.length > 0)
    .sort(compareRetrievedFacts)

  const selected: RetrievedContextFact[] = []
  let usedTokens = 0
  let droppedTokens = 0
  for (const item of scored) {
    if (selected.length >= maxFacts) {
      droppedTokens += item.tokenEstimate
      continue
    }
    if (usedTokens + item.tokenEstimate > tokenBudget) {
      droppedTokens += item.tokenEstimate
      continue
    }
    selected.push(item)
    usedTokens += item.tokenEstimate
  }

  return {
    facts: selected,
    section: selected.length > 0 ? buildContextSection(selected, usedTokens) : null,
    usedTokens,
    droppedTokens,
  }
}

export function formatContextSection(section: ContextSection): string {
  const lines = [`# Context V2 Project Facts`]
  for (const item of section.facts) {
    const label = item.title ? `${item.title}: ` : ''
    const citations = item.citations.length > 0
      ? ` ${item.citations.map((citation) => citationLabel(citation)).join(' ')}`
      : ''
    lines.push(`- (${item.kind}) ${label}${item.content}${citations}`)
  }
  if (section.citations.length > 0) {
    lines.push('')
    lines.push('Citations:')
    for (const citation of section.citations) {
      lines.push(`${citationLabel(citation)} ${citation.type}:${citation.ref}${citation.line ? `:${citation.line}` : ''}`)
    }
  }
  return lines.join('\n')
}

function buildContextSection(items: RetrievedContextFact[], tokenEstimate: number): ContextSection {
  const citations = dedupeCitations(items.flatMap((item) => item.fact.citations))
  const facts = items.map((item) => item.fact)
  return {
    id: `context-v2-${facts.map((fact) => fact.id).join('-')}`,
    title: 'Context V2 Project Facts',
    content: facts.map((fact) => fact.content).join('\n'),
    facts,
    citations,
    tokenEstimate,
  }
}

function scoreFact(fact: ContextFact, query: string, queryTokens: string[], now: number): RetrievedContextFact {
  const text = normalizeSearchText([
    fact.title ?? '',
    fact.content,
    fact.source,
    ...(fact.tags ?? []),
    ...fact.citations.flatMap((citation) => [citation.ref, citation.excerpt ?? '']),
  ].join(' '))
  const textTokens = new Set(tokenize(text))
  const reasons: string[] = []
  let score = KIND_PRIORITIES[fact.kind]

  score += Math.round((fact.confidence ?? 0.7) * 10)

  if (query) {
    if (text.includes(query)) {
      score += 80
      reasons.push('phrase')
    }
    const matched = queryTokens.filter((token) => textTokens.has(token))
    if (matched.length > 0) {
      score += matched.length * 18
      score += Math.round((matched.length / Math.max(queryTokens.length, 1)) * 25)
      reasons.push('tokens')
    } else {
      score -= 18
    }
  }

  if (fact.citations.some((citation) => citationMatches(citation, queryTokens))) {
    score += 20
    reasons.push('citation')
  }

  const ageMs = Math.max(0, now - fact.updatedAt)
  score += Math.max(0, 8 - Math.floor(ageMs / (7 * 24 * 60 * 60 * 1000)))

  return {
    fact,
    score,
    reasons: [...new Set(reasons)],
    tokenEstimate: estimateTokens(renderFactLine(fact)),
  }
}

function compareRetrievedFacts(a: RetrievedContextFact, b: RetrievedContextFact): number {
  return b.score - a.score || b.fact.updatedAt - a.fact.updatedAt || a.fact.id.localeCompare(b.fact.id)
}

function renderFactLine(fact: ContextFact): string {
  return `${fact.kind} ${fact.title ?? ''} ${fact.content} ${fact.citations.map((citation) => citation.ref).join(' ')}`
}

function citationMatches(citation: ContextCitation, queryTokens: string[]): boolean {
  if (queryTokens.length === 0) return false
  const text = normalizeSearchText(`${citation.ref} ${citation.excerpt ?? ''}`)
  return queryTokens.some((token) => text.includes(token))
}

function dedupeCitations(citations: ContextCitation[]): ContextCitation[] {
  const seen = new Set<string>()
  const result: ContextCitation[] = []
  for (const citation of citations) {
    const key = `${citation.type}:${citation.ref}:${citation.line ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push(citation)
  }
  return result
}

function citationLabel(citation: ContextCitation): string {
  if (citation.id) return `[${citation.id}]`
  const normalized = `${citation.type}:${citation.ref}:${citation.line ?? ''}`
  return `[${hashLabel(normalized)}]`
}

function hashLabel(value: string): string {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash) + value.charCodeAt(index)
    hash |= 0
  }
  return `c${Math.abs(hash).toString(36).slice(0, 6)}`
}

function estimateTokens(value: string): number {
  return Math.max(1, Math.ceil(value.length / 4))
}

function normalizeSearchText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_\-/.\u4e00-\u9fff]+/g, ' ').replace(/\s+/g, ' ').trim()
}

function tokenize(value: string): string[] {
  return normalizeSearchText(value)
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
}
