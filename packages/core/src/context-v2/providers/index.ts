import type { ContextProviderRequest, ContextProviderResult } from '../types.js'
import { collectRepoWikiFacts, type RepoWikiProviderOptions } from '../repo-wiki/provider.js'
import { createContextFactStore } from '../store.js'
import { collectConversationFacts, type ConversationFactsOptions } from './conversation.js'
import { collectGitFacts } from './git.js'
import { collectProjectFacts } from './project.js'

export interface CollectProviderFactsOptions {
  project?: boolean
  git?: boolean
  conversation?: boolean | ConversationFactsOptions
  repoWiki?: boolean | Partial<RepoWikiProviderOptions>
}

export async function collectContextProviderFacts(
  request: ContextProviderRequest,
  options: CollectProviderFactsOptions = {},
): Promise<ContextProviderResult> {
  const includeProject = options.project !== false
  const includeGit = options.git !== false
  const includeConversation = options.conversation !== false
  const includeRepoWiki = options.repoWiki !== false && options.repoWiki !== undefined
  const results: ContextProviderResult[] = []

  if (includeProject) results.push(await collectProjectFacts(request))
  if (includeGit) results.push(await collectGitFacts(request))
  if (includeRepoWiki) {
    const repoWikiOptions = typeof options.repoWiki === 'object' ? options.repoWiki : {}
    results.push(await collectRepoWikiFacts(request, {
      ...repoWikiOptions,
      store: repoWikiOptions.store ?? createContextFactStore({ cwd: request.cwd, now: request.now }),
    }))
  }
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
export { collectRepoWikiFacts, type RepoWikiProviderOptions } from '../repo-wiki/provider.js'
