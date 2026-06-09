import type { ContextProviderRequest, ContextProviderResult } from '../types.js'
import { makeFact, messageCitation, textFromContentBlocks, truncateText } from './shared.js'

const SOURCE = 'context-v2-conversation-provider'

export interface ConversationFactsOptions {
  maxMessages?: number
}

export function collectConversationFacts(
  request: ContextProviderRequest,
  options: ConversationFactsOptions = {},
): ContextProviderResult {
  const maxMessages = options.maxMessages ?? 6
  const recent = (request.recentMessages ?? []).slice(-maxMessages)
  const lines: string[] = []
  const citations = []

  for (const message of recent) {
    const text = truncateText(textFromContentBlocks(message.content), 500)
    if (!text) continue
    lines.push(`${message.role}: ${text}`)
    citations.push(messageCitation(message.id, text.slice(0, 160)))
  }

  if (request.userMessage?.trim()) {
    lines.push(`current user: ${truncateText(request.userMessage, 700)}`)
    citations.push(messageCitation('current-user-message', request.userMessage.slice(0, 160)))
  }

  if (lines.length === 0) {
    return { facts: [], diagnostics: ['No conversation text was available.'] }
  }

  return {
    facts: [makeFact(request, {
      kind: 'conversation',
      scope: 'turn',
      source: SOURCE,
      title: 'Current conversation state',
      content: lines.join('\n'),
      citations,
      tags: ['conversation', 'current-turn'],
      confidence: 0.76,
    })],
    diagnostics: [],
  }
}
