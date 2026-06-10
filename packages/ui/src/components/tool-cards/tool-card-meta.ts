export type ToolStatus = 'running' | 'done' | 'error'

interface ToolEventLike {
  type: 'start' | 'progress' | 'complete' | 'error'
  result?: { isError?: boolean }
}

export type ToolFamily =
  | 'agent'
  | 'command'
  | 'context'
  | 'external'
  | 'mcp'
  | 'mutation'
  | 'pudding'
  | 'read'
  | 'search'
  | 'skill'
  | 'task'
  | 'generic'

export type ToolCardKind =
  | 'agent'
  | 'bash'
  | 'edit'
  | 'external'
  | 'generic'
  | 'mcp'
  | 'multi-edit'
  | 'notebook-edit'
  | 'pudding'
  | 'read'
  | 'search'
  | 'skill'
  | 'task'
  | 'write'

const PUDDING_TOOLS = new Set([
  'PuddingContext',
  'PuddingSearch',
  'PuddingNode',
  'PuddingCallers',
  'PuddingCallees',
  'PuddingImpact',
  'PuddingTrace',
  'PuddingExplore',
  'PuddingFiles',
  'PuddingMemorySearch',
  'PuddingMemoryWrite',
  'PuddingContextInspect',
  'PuddingContextRefresh',
])

const COMMAND_TOOLS = new Set(['bash', 'powershell', 'monitor'])
const MUTATION_TOOLS = new Set(['file_write', 'file_edit', 'multi_edit', 'notebook_edit'])
const SEARCH_TOOLS = new Set(['glob', 'grep', 'ls', 'tree', 'lsp'])
const EXTERNAL_TOOLS = new Set(['web_search', 'web_fetch', 'weather', 'browser_open', 'list_mcp_resources', 'read_mcp_resource'])
const TASK_TOOLS = new Set([
  'Team',
  'ask_user',
  'background_events',
  'background_send',
  'background_status',
  'enter_plan_mode',
  'exit_plan_mode',
  'notify',
  'save_memory',
  'skill_list',
  'task_create',
  'task_get',
  'task_list',
  'task_output',
  'task_stop',
  'task_update',
  'team_add_task',
  'team_artifact',
  'team_list',
  'team_report',
  'todo_write',
])
const CONTEXT_TOOLS = new Set([
  'gitnexus',
])

export function deriveToolStatus(
  event?: ToolEventLike,
  result?: { is_error?: boolean },
): ToolStatus {
  if (event?.result?.isError || result?.is_error) return 'error'
  if (!event) return 'done'
  if (event.type === 'complete') return 'done'
  if (event.type === 'error') return 'error'
  return 'running'
}

export function getToolFamily(toolName: string): ToolFamily {
  if (PUDDING_TOOLS.has(toolName) || toolName.startsWith('Pudding')) return 'pudding'
  if (/^mcp__[^_]+__.+$/.test(toolName)) return 'mcp'
  if (toolName === 'Agent') return 'agent'
  if (toolName === 'Skill') return 'skill'
  if (toolName === 'file_read') return 'read'
  if (MUTATION_TOOLS.has(toolName)) return 'mutation'
  if (COMMAND_TOOLS.has(toolName)) return 'command'
  if (SEARCH_TOOLS.has(toolName)) return 'search'
  if (EXTERNAL_TOOLS.has(toolName)) return 'external'
  if (TASK_TOOLS.has(toolName)) return 'task'
  if (CONTEXT_TOOLS.has(toolName) || toolName.startsWith('gitnexus_')) return 'context'
  return 'generic'
}

export function getToolCardKind(toolName: string): ToolCardKind {
  if (PUDDING_TOOLS.has(toolName) || toolName.startsWith('Pudding')) return 'pudding'
  if (/^mcp__[^_]+__.+$/.test(toolName)) return 'mcp'

  switch (toolName) {
    case 'Agent':
      return 'agent'
    case 'Skill':
      return 'skill'
    case 'bash':
    case 'powershell':
    case 'monitor':
      return 'bash'
    case 'file_edit':
      return 'edit'
    case 'file_write':
      return 'write'
    case 'multi_edit':
      return 'multi-edit'
    case 'notebook_edit':
      return 'notebook-edit'
    case 'file_read':
      return 'read'
    default:
      break
  }

  const family = getToolFamily(toolName)
  if (family === 'search') return 'search'
  if (family === 'external') return 'external'
  if (family === 'task') return 'task'
  return 'generic'
}

export function shouldShowToolRail(toolName: string, status: ToolStatus): boolean {
  if (status === 'running' || status === 'error') return true
  return getToolFamily(toolName) === 'mutation'
}

export function getToolVariant(toolName: string): string {
  const family = getToolFamily(toolName)
  if (family === 'mutation') return 'mutation'
  return family
}

export function formatToolLabel(toolName: string): string {
  if (!toolName) return 'TOOL'
  if (toolName === 'Agent') return 'AGENT'
  if (toolName === 'Skill') return 'SKILL'
  if (toolName === 'powershell') return 'POWERSHELL'
  if (toolName.startsWith('team_')) return toolName.replace(/^team_/, 'TEAM ').replace(/_/g, ' ').toUpperCase()
  return toolName.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').toUpperCase()
}

export function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value)
}

const MISSING_REQUIRED_ARGUMENT_MESSAGES: Record<string, string> = {
  file_path: '缺少文件路径',
  pattern: '缺少搜索条件',
  command: '缺少命令',
  query: '缺少查询内容',
}

export function missingRequiredArgumentMessage(content: string): string | null {
  const match = /^Error:\s+([A-Za-z0-9_]+)\s+is required\b/.exec(content.trim())
  if (!match) return null
  return MISSING_REQUIRED_ARGUMENT_MESSAGES[match[1]] || `缺少必填参数 ${match[1]}`
}

export function hasMissingRequiredArgumentInput(toolName: string, input: Record<string, unknown> | undefined): boolean {
  const required = REQUIRED_ARGUMENTS_BY_TOOL[toolName]
  if (!required) return false
  return required.some((name) => isMissingRequiredValue(input?.[name]))
}

const REQUIRED_ARGUMENTS_BY_TOOL: Record<string, string[]> = {
  file_read: ['file_path'],
  grep: ['pattern'],
  glob: ['pattern'],
}

function isMissingRequiredValue(value: unknown): boolean {
  if (value == null) return true
  if (typeof value === 'string') return value.trim().length === 0
  if (Array.isArray(value)) return value.length === 0
  return false
}
