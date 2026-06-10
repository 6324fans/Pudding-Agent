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
  const origin = engine.wasLoadedFromSnapshot() ? '已从缓存加载' : '本次会话已构建'
  return `\n\n-- 索引状态：${s.files} 个文件 / ${s.symbols} 个符号（${origin}）`
}

function withStatus(context: ToolContext, content: string): ToolResult {
  return { content: content + statusFooter(context) }
}

function fmtLoc(l: SymbolLocation): string {
  const sig = l.signature ? `  ${l.signature}` : ''
  return `- ${l.kind} ${l.name} — ${l.file}:${l.line}${sig}`
}

function notReady(): ToolResult {
  return { content: 'Context Engine 正在后台建立索引，请稍后再次调用该工具。', isError: false }
}

function indexFailed(error: string): ToolResult {
  return { content: `Context Engine 索引失败：${error}`, isError: true }
}

const contextTool: ToolHandler = {
  definition: {
    name: 'PuddingContext',
    description:
      '首选代码上下文工具。根据任务、问题或需求描述聚合入口符号、相关符号、关键源码、当前未提交改动和近期热区文件。适合回答“某功能怎么实现”“从哪里改”“架构/bug 背景是什么”。',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: '任务、问题、bug 或需求描述' },
        maxNodes: { type: 'number', description: '最多返回的相关符号数，默认 20' },
        includeCode: { type: 'boolean', description: '是否包含关键源码片段，默认 true' },
      },
      required: ['task'],
    },
  },
  async execute(input, context): Promise<ToolResult> {
    const q = await getQuery(context)
    if (q === 'not_ready') return notReady()
    if ('error' in q) return indexFailed(q.error)
    const task = String(input.task)
    const res = await q.contextForRequirements({
      objective: task,
      requirements: [{
        id: 'context_tool_relevant_code',
        kind: 'relevant_code',
        reason: 'Context 工具根据当前任务收集相关代码上下文。',
        query: task,
        priority: 'must',
        relatedFiles: [],
        relatedSymbols: [],
        docRefs: [],
        languageHints: [],
      }],
      maxNodes: Number(input.maxNodes) || 20,
      includeCode: input.includeCode !== false,
    })

    const parts: string[] = []
    if (res.entryPoints.length) {
      parts.push('## 入口符号\n' + res.entryPoints.map(fmtLoc).join('\n'))
    }
    if (res.related.length) {
      parts.push('## 相关符号\n' + res.related.map(fmtLoc).join('\n'))
    }
    for (const item of res.keyCode) {
      parts.push(`## ${item.symbol} — ${item.file}\n\`\`\`\n${item.code}\n\`\`\``)
    }
    if (res.gitChanges?.length) {
      parts.push('## 当前未提交改动\n' + res.gitChanges.map((change) => `- [${change.status}] ${change.path}`).join('\n'))
    }
    if (res.gitHotFiles?.length) {
      parts.push('## 近期热区文件\n' + res.gitHotFiles.map((hot) => `- ${hot.path}（${hot.commits} 次提交）`).join('\n'))
    }
    if (parts.length === 0) return withStatus(context, `没有找到与“${input.task}”相关的代码上下文。`)
    return withStatus(context, parts.join('\n\n'))
  },
}

const contextSearchTool: ToolHandler = {
  definition: {
    name: 'PuddingSearch',
    description: '按名称搜索项目符号，返回匹配定义及 file:line。由内置 Pudding Context Engine 提供。',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '符号名或部分名称' },
        limit: { type: 'number', description: '最多返回数量，默认 10' },
      },
      required: ['query'],
    },
  },
  async execute(input, context): Promise<ToolResult> {
    const q = await getQuery(context)
    if (q === 'not_ready') return notReady()
    if ('error' in q) return indexFailed(q.error)
    const results = q.search(String(input.query), Number(input.limit) || 10)
    if (results.length === 0) return withStatus(context, `没有找到匹配“${input.query}”的符号。`)
    return withStatus(context, results.map(fmtLoc).join('\n'))
  },
}

const contextNodeTool: ToolHandler = {
  definition: {
    name: 'PuddingNode',
    description: '查看单个符号的位置、签名、静态调用者、静态被调用者，可选返回源码正文。',
    inputSchema: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: '符号名' },
        includeCode: { type: 'boolean', description: '是否包含完整源码正文，默认 false' },
      },
      required: ['symbol'],
    },
  },
  async execute(input, context): Promise<ToolResult> {
    const q = await getQuery(context)
    if (q === 'not_ready') return notReady()
    if ('error' in q) return indexFailed(q.error)
    const detail = await q.node(String(input.symbol), input.includeCode === true)
    if (!detail) return withStatus(context, `没有找到符号“${input.symbol}”。`)
    const parts = [
      `${detail.kind} ${detail.name} — ${detail.file}:${detail.line}-${detail.endLine}`,
    ]
    if (detail.signature) parts.push(`signature: ${detail.signature}`)
    parts.push('\n### 调用的符号（callees）\n' + (detail.callees.length ? detail.callees.map(fmtLoc).join('\n') : '（静态分析未发现）'))
    parts.push('\n### 调用它的符号（callers）\n' + (detail.callers.length ? detail.callers.map(fmtLoc).join('\n') : '（静态分析未发现）'))
    if (detail.code) parts.push(`\n### 源码\n\`\`\`\n${detail.code}\n\`\`\``)
    return withStatus(context, parts.join('\n'))
  },
}

const contextCallersTool: ToolHandler = {
  definition: {
    name: 'PuddingCallers',
    description: '查找所有静态调用某个符号的函数/方法。适合理解用法和变更影响入口。',
    inputSchema: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: '要查找调用者的符号名' },
      },
      required: ['symbol'],
    },
  },
  async execute(input, context): Promise<ToolResult> {
    const q = await getQuery(context)
    if (q === 'not_ready') return notReady()
    if ('error' in q) return indexFailed(q.error)
    const callers = q.callers(String(input.symbol))
    if (callers.length === 0) return withStatus(context, `没有找到“${input.symbol}”的静态调用者。`)
    return withStatus(context, callers.map(fmtLoc).join('\n'))
  },
}

const contextCalleesTool: ToolHandler = {
  definition: {
    name: 'PuddingCallees',
    description: '查找某个符号静态调用的函数/方法。适合理解依赖和执行流。',
    inputSchema: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: '要查找被调用符号的符号名' },
      },
      required: ['symbol'],
    },
  },
  async execute(input, context): Promise<ToolResult> {
    const q = await getQuery(context)
    if (q === 'not_ready') return notReady()
    if ('error' in q) return indexFailed(q.error)
    const callees = q.callees(String(input.symbol))
    if (callees.length === 0) return withStatus(context, `没有找到“${input.symbol}”静态调用的符号。`)
    return withStatus(context, callees.map(fmtLoc).join('\n'))
  },
}

const contextImpactTool: ToolHandler = {
  definition: {
    name: 'PuddingImpact',
    description: '通过向上遍历静态调用者，分析修改某个符号可能影响的范围。',
    inputSchema: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: '要分析的符号名' },
        depth: { type: 'number', description: '向上遍历层级，默认 2' },
      },
      required: ['symbol'],
    },
  },
  async execute(input, context): Promise<ToolResult> {
    const q = await getQuery(context)
    if (q === 'not_ready') return notReady()
    if ('error' in q) return indexFailed(q.error)
    const impacted = q.impact(String(input.symbol), Number(input.depth) || 2)
    if (impacted.length === 0) return withStatus(context, `静态分析未发现修改“${input.symbol}”会影响的上游代码。`)
    return withStatus(context, `修改“${input.symbol}”可能影响：\n` + impacted.map(fmtLoc).join('\n'))
  },
}

const contextTraceTool: ToolHandler = {
  definition: {
    name: 'PuddingTrace',
    description: '追踪两个符号之间的静态调用路径，用于回答“from 如何到达 to”。',
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: '调用链起点符号' },
        to: { type: 'string', description: '调用链目标符号' },
      },
      required: ['from', 'to'],
    },
  },
  async execute(input, context): Promise<ToolResult> {
    const q = await getQuery(context)
    if (q === 'not_ready') return notReady()
    if ('error' in q) return indexFailed(q.error)
    const path = q.trace(String(input.from), String(input.to))
    if (!path) return withStatus(context, `没有找到从“${input.from}”到“${input.to}”的静态调用路径。动态派发、回调或接口实现可能打断静态链路。`)
    return withStatus(context, path.map((loc, index) => `${index === 0 ? '' : '-> '}${fmtLoc(loc)}`).join('\n'))
  },
}

const contextExploreTool: ToolHandler = {
  definition: {
    name: 'PuddingExplore',
    description: '一次返回多个相关符号的源码片段，并按文件展示。适合批量检查相关实现。',
    inputSchema: {
      type: 'object',
      properties: {
        symbols: { type: 'array', items: { type: 'string' }, description: '要读取源码的符号名列表' },
      },
      required: ['symbols'],
    },
  },
  async execute(input, context): Promise<ToolResult> {
    const q = await getQuery(context)
    if (q === 'not_ready') return notReady()
    if ('error' in q) return indexFailed(q.error)
    const names = Array.isArray(input.symbols) ? (input.symbols as unknown[]).map(String) : []
    const results = await q.explore(names)
    if (results.length === 0) return withStatus(context, '没有找到匹配的符号源码。')
    return withStatus(context, results.map((result) => `## ${result.symbol} — ${result.file}\n\`\`\`\n${result.code}\n\`\`\``).join('\n\n'))
  },
}

const contextFilesTool: ToolHandler = {
  definition: {
    name: 'PuddingFiles',
    description: '查看已索引的项目文件结构和每个文件的符号数量。',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '按项目相对目录过滤文件' },
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
    if (repoMap.files.length === 0) return withStatus(context, '没有已索引文件。')
    const stats = engine.stats()
    return withStatus(context, `已索引 ${stats.files} 个文件、${stats.symbols} 个符号。\n\n${renderRepoMap(repoMap)}`)
  },
}

export function createContextEngineTools(): ToolHandler[] {
  return [
    contextTool,
    contextSearchTool,
    contextNodeTool,
    contextCallersTool,
    contextCalleesTool,
    contextImpactTool,
    contextTraceTool,
    contextExploreTool,
    contextFilesTool,
  ]
}
