import type { ToolExecutionEvent } from '@puddingagent/core'
import { GenericToolCard } from './GenericToolCard'
import { BashToolCard } from './BashToolCard'
import { EditToolCard } from './EditToolCard'
import { WriteToolCard } from './WriteToolCard'
import { ReadToolCard } from './ReadToolCard'
import { AgentToolCard } from './AgentToolCard'
import { SkillToolCard } from './SkillToolCard'
import { McpToolCard } from './McpToolCard'
import { PuddingToolCard } from './PuddingToolCard'
import { SearchToolCard } from './SearchToolCard'
import { ExternalToolCard } from './ExternalToolCard'
import { TaskToolCard } from './TaskToolCard'
import { MultiEditToolCard } from './MultiEditToolCard'
import { NotebookEditToolCard } from './NotebookEditToolCard'
import {
  getToolCardKind,
  hasMissingRequiredArgumentInput,
  missingRequiredArgumentMessage,
  type ToolCardKind,
} from './tool-card-meta'

export interface ToolCardRouterProps {
  event?: ToolExecutionEvent
  name?: string
  input?: Record<string, unknown>
  result?: { content: string; is_error?: boolean; metadata?: import('@puddingagent/core').ToolResultMetadata }
}

const TOOL_CARD_REGISTRY: Record<ToolCardKind, React.ComponentType<ToolCardRouterProps>> = {
  agent: AgentToolCard,
  bash: BashToolCard,
  edit: EditToolCard,
  external: ExternalToolCard,
  generic: GenericToolCard,
  mcp: McpToolCard,
  'multi-edit': MultiEditToolCard,
  'notebook-edit': NotebookEditToolCard,
  pudding: PuddingToolCard,
  read: ReadToolCard,
  search: SearchToolCard,
  skill: SkillToolCard,
  task: TaskToolCard,
  write: WriteToolCard,
}

export function ToolCardRouter(props: ToolCardRouterProps) {
  const toolName = props.event?.toolName || props.name || ''
  const input = props.event?.input || props.input
  const content = props.event?.result?.content || props.result?.content || ''
  const isSuppressed = props.result?.metadata?.suppressedToolCall?.reason === 'missing_required_arguments'
    || !!missingRequiredArgumentMessage(content)
    || hasMissingRequiredArgumentInput(toolName, input)
  if (isSuppressed) return null
  const Card = TOOL_CARD_REGISTRY[getToolCardKind(toolName)]
  return <Card {...props} />
}
