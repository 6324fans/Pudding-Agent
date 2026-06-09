import type { ContextProviderRequest, ContextProviderResult } from '../types.js'
import { collectConversationFacts, type ConversationFactsOptions } from './conversation.js'
import { collectGitFacts } from './git.js'
import { collectProjectFacts } from './project.js'

export interface CollectProviderFactsOptions {
  project?: boolean
  git?: boolean
  conversation?: boolean | ConversationFactsOptions
}

export async function collectContextProviderFacts(
  request: ContextProviderRequest,
  options: CollectProviderFactsOptions = {},
): Promise<ContextProviderResult> {
  const includeProject = options.project !== false
  const includeGit = options.git !== false
  const includeConversation = options.conversation !== false
  const results: ContextProviderResult[] = []

  if (includeProject) results.push(await collectProjectFacts(request))
  if (includeGit) results.push(await collectGitFacts(request))
  if (includeConversation) {
    const conversationOptions = typeof options.conversation === 'object' ? options.conversation : {}
    results.push(collectConversationFacts(request, conversationOptions))
  }

  return {
    facts: results.flatMap((result) => result.facts),
    diagnostics: results.flatMap((result) => result.diagnostics),
  }
}

export { collectConversationFacts, type ConversationFactsOptions } from './conversation.js'
export { collectGitFacts } from './git.js'
export { collectProjectFacts } from './project.js'
