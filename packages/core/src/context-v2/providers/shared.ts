import { createHash } from 'node:crypto'
import path from 'node:path'
import type { ContextCitation, ContextFact, ContextFactKind, ContextProviderRequest } from '../types.js'

export function stableId(prefix: string, ...parts: string[]): string {
  return `${prefix}-${createHash('sha1').update(parts.join('\u0000')).digest('hex').slice(0, 16)}`
}

export function makeFact(
  request: ContextProviderRequest,
  input: {
    kind: ContextFactKind
    source: string
    title: string
    content: string
    citations: ContextCitation[]
    tags?: string[]
    scope?: ContextFact['scope']
    confidence?: number
    expiresAt?: number
  },
): ContextFact {
  const timestamp = request.now?.() ?? Date.now()
  return {
    id: stableId('fact', request.projectKey, input.source, input.title, input.content),
    projectKey: request.projectKey,
    kind: input.kind,
    scope: input.scope ?? 'project',
    title: input.title,
    content: input.content,
    citations: input.citations,
    source: input.source,
    ...(input.tags ? { tags: input.tags } : {}),
    ...(input.confidence !== undefined ? { confidence: input.confidence } : {}),
    createdAt: timestamp,
    updatedAt: timestamp,
    ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : {}),
  }
}

export function fileCitation(ref: string, excerpt?: string): ContextCitation {
  return {
    id: stableId('cit', 'file', ref),
    type: ref.endsWith('package.json') ? 'package' : 'file',
    ref,
    ...(excerpt ? { excerpt } : {}),
  }
}

export function gitCitation(ref: string, excerpt?: string): ContextCitation {
  return {
    id: stableId('cit', 'git', ref, excerpt ?? ''),
    type: 'git',
    ref,
    ...(excerpt ? { excerpt } : {}),
    timestamp: Date.now(),
  }
}

export function messageCitation(messageId: string, excerpt?: string): ContextCitation {
  return {
    id: stableId('cit', 'message', messageId),
    type: 'message',
    ref: messageId,
    ...(excerpt ? { excerpt } : {}),
  }
}

export function relativeRef(cwd: string, filePath: string): string {
  return path.relative(cwd, filePath).replace(/\\/g, '/') || path.basename(filePath)
}

export function truncateText(value: string, maxChars: number): string {
  const normalized = value.trim().replace(/\r\n/g, '\n')
  if (normalized.length <= maxChars) return normalized
  return `${normalized.slice(0, maxChars).trimEnd()}\n[truncated]`
}

export function textFromContentBlocks(content: unknown): string {
  if (!Array.isArray(content)) return ''
  return content.flatMap((block) => {
    if (!block || typeof block !== 'object') return []
    const typed = block as { type?: unknown; text?: unknown; content?: unknown }
    if (typed.type === 'text' && typeof typed.text === 'string') return [typed.text]
    if (typed.type === 'tool_result' && typeof typed.content === 'string') return [typed.content]
    return []
  }).join('\n')
}
