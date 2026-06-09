import type { ToolHandler, ToolContext, ToolResult } from '../tool-registry.js'
import { EngineQuery, type SymbolLocation } from '../context-engine/query.js'
import type { ContextEngine } from '../context-engine/engine.js'
import { getContextEngine } from '../context-engine/index.js'
import { buildRepoMap, renderRepoMap } from '../context-engine/repo-map.js'

const queryCache = new WeakMap<ContextEngine, EngineQuery>()
const indexFailures = new WeakMap<ContextEngine, string>()

async function getQuery(context: ToolContext): Promise<EngineQuery | 'not_ready' | { error: string }> {
  const engine = getContextEngine(context.cwd)
  if (!engine.isIndexed()) {
    const failure = indexFailures.get(engine)
    if (failure) return { error: failure }
    void engine.index().then(() => engine.startWatching()).catch((error) => {
      const message = error instanceof Error ? error.message : String(error)
      indexFailures.set(engine, message)
      console.error('[context-engine] index failed:', error)
    })
    return 'not_ready'
  }
  indexFailures.delete(engine)
  let q = queryCache.get(engine)
  if (!q) {
    q = new EngineQuery(engine)
    queryCache.set(engine, q)
  }
  return q
}

function statusFooter(context: ToolContext): string {
  const engine = getContextEngine(context.cwd)
  const s = engine.stats()
  const origin = engine.wasLoadedFromSnapshot() ? 'loaded from snapshot' : 'built in this session'
  return `\n\n-- Index status: ${s.files} files / ${s.symbols} symbols (${origin})`
}

function withStatus(context: ToolContext, content: string): ToolResult {
  return { content: content + statusFooter(context) }
}

function fmtLoc(l: SymbolLocation): string {
  const sig = l.signature ? `  ${l.signature}` : ''
  return `- ${l.kind} ${l.name} - ${l.file}:${l.line}${sig}`
}

function notReady(): ToolResult {
  return { content: 'Context engine index is building in the background. Try this tool again shortly.', isError: false }
}

function indexFailed(error: string): ToolResult {
  return { content: `Context engine index failed: ${error}`, isError: true }
}

const contextSearchTool: ToolHandler = {
  definition: {
    name: 'ContextSearch',
    description: 'Search project symbols by name. Returns matching definitions with file:line from the experimental Pudding Context Engine.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Symbol name or partial name' },
        limit: { type: 'number', description: 'Max results (default 10)' },
      },
      required: ['query'],
    },
  },
  async execute(input, context): Promise<ToolResult> {
    const q = await getQuery(context)
    if (q === 'not_ready') return notReady()
    if ('error' in q) return indexFailed(q.error)
    const results = q.search(String(input.query), Number(input.limit) || 10)
    if (results.length === 0) return withStatus(context, `No symbols matching "${input.query}".`)
    return withStatus(context, results.map(fmtLoc).join('\n'))
  },
}

const contextNodeTool: ToolHandler = {
  definition: {
    name: 'ContextNode',
    description: "Get one symbol's location, signature, static callers, static callees, and optionally its source body.",
    inputSchema: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: 'Symbol name' },
        includeCode: { type: 'boolean', description: 'Include full source body (default false)' },
      },
      required: ['symbol'],
    },
  },
  async execute(input, context): Promise<ToolResult> {
    const q = await getQuery(context)
    if (q === 'not_ready') return notReady()
    if ('error' in q) return indexFailed(q.error)
    const detail = await q.node(String(input.symbol), input.includeCode === true)
    if (!detail) return withStatus(context, `Symbol "${input.symbol}" not found.`)
    const parts = [
      `${detail.kind} ${detail.name} - ${detail.file}:${detail.line}-${detail.endLine}`,
    ]
    if (detail.signature) parts.push(`signature: ${detail.signature}`)
    parts.push('\n### Calls (callees)\n' + (detail.callees.length ? detail.callees.map(fmtLoc).join('\n') : '(none found statically)'))
    parts.push('\n### Called by (callers)\n' + (detail.callers.length ? detail.callers.map(fmtLoc).join('\n') : '(none found statically)'))
    if (detail.code) parts.push(`\n### Source\n\`\`\`\n${detail.code}\n\`\`\``)
    return withStatus(context, parts.join('\n'))
  },
}

const contextImpactTool: ToolHandler = {
  definition: {
    name: 'ContextImpact',
    description: 'Analyze the static impact radius of changing a symbol by traversing transitive callers up to a depth.',
    inputSchema: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: 'Symbol to analyze' },
        depth: { type: 'number', description: 'Levels to traverse (default 2)' },
      },
      required: ['symbol'],
    },
  },
  async execute(input, context): Promise<ToolResult> {
    const q = await getQuery(context)
    if (q === 'not_ready') return notReady()
    if ('error' in q) return indexFailed(q.error)
    const impacted = q.impact(String(input.symbol), Number(input.depth) || 2)
    if (impacted.length === 0) return withStatus(context, `No code appears to be impacted by changing "${input.symbol}".`)
    return withStatus(context, `Changing "${input.symbol}" may affect:\n` + impacted.map(fmtLoc).join('\n'))
  },
}

const contextFilesTool: ToolHandler = {
  definition: {
    name: 'ContextFiles',
    description: 'Get the indexed project file structure with per-file symbol counts from the experimental Context Engine.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Filter to files under this project-relative directory' },
      },
    },
  },
  async execute(input, context): Promise<ToolResult> {
    const q = await getQuery(context)
    if (q === 'not_ready') return notReady()
    if ('error' in q) return indexFailed(q.error)
    void q
    const engine = getContextEngine(context.cwd)
    const repoMap = buildRepoMap(engine.getStore(), { pathPrefix: input.path ? String(input.path) : '' })
    if (repoMap.files.length === 0) return withStatus(context, 'No indexed files.')
    const stats = engine.stats()
    return withStatus(context, `${stats.files} files, ${stats.symbols} symbols indexed.\n\n${renderRepoMap(repoMap)}`)
  },
}

export function createContextEngineTools(): ToolHandler[] {
  return [
    contextSearchTool,
    contextNodeTool,
    contextImpactTool,
    contextFilesTool,
  ]
}
