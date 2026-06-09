import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { ContextFact, ContextProviderRequest, ContextProviderResult } from '../types.js'
import { fileCitation, makeFact, relativeRef, truncateText } from './shared.js'

const SOURCE = 'context-v2-project-provider'
const PROJECT_FILES = [
  'README.md',
  'AGENTS.md',
  'PUDDINGAGENT.md',
  path.join('.puddingagent', 'PUDDINGAGENT.md'),
  'package.json',
]

export async function collectProjectFacts(request: ContextProviderRequest): Promise<ContextProviderResult> {
  const facts: ContextFact[] = []
  const diagnostics: string[] = []

  for (const candidate of PROJECT_FILES) {
    const filePath = path.join(request.cwd, candidate)
    const content = await readOptional(filePath)
    if (content === null) continue

    const ref = relativeRef(request.cwd, filePath)
    const fact = ref.endsWith('package.json')
      ? packageJsonFact(request, ref, content, diagnostics)
      : projectFileFact(request, ref, content)
    if (fact) facts.push(fact)
  }

  if (facts.length === 0) {
    diagnostics.push('No README, AGENTS, PUDDINGAGENT, or package.json files were found.')
  }

  return { facts, diagnostics }
}

async function readOptional(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, 'utf-8')
  } catch {
    return null
  }
}

function projectFileFact(request: ContextProviderRequest, ref: string, content: string): ContextFact {
  const excerpt = truncateText(content, ref === 'README.md' ? 1600 : 2200)
  return makeFact(request, {
    kind: 'project',
    source: SOURCE,
    title: ref,
    content: `${ref}:\n${excerpt}`,
    citations: [fileCitation(ref, firstLine(excerpt))],
    tags: ['project', ref.toLowerCase()],
    confidence: 0.82,
  })
}

function packageJsonFact(request: ContextProviderRequest, ref: string, content: string, diagnostics: string[]): ContextFact | null {
  try {
    const parsed = JSON.parse(content) as {
      name?: unknown
      version?: unknown
      scripts?: unknown
      dependencies?: unknown
      devDependencies?: unknown
    }
    const scripts = parsed.scripts && typeof parsed.scripts === 'object'
      ? Object.keys(parsed.scripts).sort()
      : []
    const deps = parsed.dependencies && typeof parsed.dependencies === 'object'
      ? Object.keys(parsed.dependencies).sort()
      : []
    const devDeps = parsed.devDependencies && typeof parsed.devDependencies === 'object'
      ? Object.keys(parsed.devDependencies).sort()
      : []

    const lines = [
      `package: ${typeof parsed.name === 'string' ? parsed.name : 'unknown'}`,
      ...(typeof parsed.version === 'string' ? [`version: ${parsed.version}`] : []),
      scripts.length > 0 ? `scripts: ${scripts.join(', ')}` : 'scripts: none',
      deps.length > 0 ? `dependencies: ${deps.slice(0, 40).join(', ')}` : 'dependencies: none',
      devDeps.length > 0 ? `devDependencies: ${devDeps.slice(0, 40).join(', ')}` : 'devDependencies: none',
    ]

    return makeFact(request, {
      kind: 'project',
      source: SOURCE,
      title: ref,
      content: lines.join('\n'),
      citations: [fileCitation(ref, lines[0])],
      tags: ['project', 'package', 'scripts', ...scripts],
      confidence: 0.9,
    })
  } catch (error) {
    diagnostics.push(`Could not parse ${ref}: ${error instanceof Error ? error.message : String(error)}`)
    return makeFact(request, {
      kind: 'project',
      source: SOURCE,
      title: ref,
      content: `${ref} exists but could not be parsed as JSON.`,
      citations: [fileCitation(ref)],
      tags: ['project', 'package'],
      confidence: 0.4,
    })
  }
}

function firstLine(value: string): string | undefined {
  return value.split('\n').map((line) => line.trim()).find(Boolean)
}
