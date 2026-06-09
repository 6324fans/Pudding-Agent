import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { ContextProviderRequest, ContextProviderResult } from '../types.js'
import { gitCitation, makeFact } from './shared.js'

const SOURCE = 'context-v2-git-provider'
const execFileAsync = promisify(execFile)

export async function collectGitFacts(request: ContextProviderRequest): Promise<ContextProviderResult> {
  const diagnostics: string[] = []
  const [branch, status, recentCommits] = await Promise.all([
    runGit(request.cwd, ['branch', '--show-current']),
    runGit(request.cwd, ['status', '--short']),
    runGit(request.cwd, ['log', '--oneline', '-5']),
  ])

  if (!branch.ok && !status.ok && !recentCommits.ok) {
    return {
      facts: [],
      diagnostics: ['Git metadata is unavailable for this project.'],
    }
  }

  for (const result of [branch, status, recentCommits]) {
    if (!result.ok && result.error) diagnostics.push(result.error)
  }

  const branchText = branch.value.trim() || 'unknown'
  const statusText = status.value.trim() || '(clean)'
  const commitText = recentCommits.value.trim() || '(unavailable)'
  const content = [
    `branch: ${branchText}`,
    `status:\n${statusText}`,
    `recent commits:\n${commitText}`,
  ].join('\n\n')

  return {
    facts: [makeFact(request, {
      kind: 'git',
      scope: 'turn',
      source: SOURCE,
      title: 'Git state',
      content,
      citations: [gitCitation('git status/log', branchText)],
      tags: ['git', 'branch', branchText],
      confidence: branchText === 'unknown' ? 0.55 : 0.86,
    })],
    diagnostics,
  }
}

async function runGit(cwd: string, args: string[]): Promise<{ ok: true; value: string; error?: never } | { ok: false; value: string; error: string }> {
  try {
    const { stdout } = await execFileAsync('git', args, { cwd })
    return { ok: true, value: stdout }
  } catch (error) {
    return {
      ok: false,
      value: '',
      error: `git ${args.join(' ')} failed: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}
