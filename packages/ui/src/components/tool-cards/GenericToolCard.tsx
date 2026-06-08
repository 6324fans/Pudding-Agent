import type { ToolExecutionEvent } from '@puddingagent/core'
import { ToolCardShell } from './ToolCardShell'
import { ToolCopyButton } from './ToolCopyButton'
import { deriveToolStatus, formatToolLabel, getToolVariant, shouldShowToolRail } from './tool-card-meta'

interface Props {
  event?: ToolExecutionEvent
  name?: string
  input?: Record<string, unknown>
  result?: { content: string; is_error?: boolean }
}

export function GenericToolCard({ event, name, input, result }: Props) {
  const toolName = event?.toolName || name || 'unknown'
  const status = deriveToolStatus(event, result)
  const content = event?.result?.content || event?.message || result?.content
  const isError = event?.result?.isError || result?.is_error
  const toolInput = event?.input || input

  return (
    <ToolCardShell
      label={formatToolLabel(toolName)}
      detail={toolName}
      status={status}
      defaultExpanded={status === 'running'}
      rail={shouldShowToolRail(toolName, status)}
      variant={getToolVariant(toolName)}
      actions={content ? (
        <ToolCopyButton text={content} label="结果" title="复制结果" iconOnly />
      ) : undefined}
    >
      {toolInput && Object.keys(toolInput).length > 0 && (
        <pre className="max-h-48 overflow-auto p-2 text-[12px] whitespace-pre-wrap text-[var(--text)] mb-2" style={{ fontFamily: 'var(--font-mono)' }}>
          {JSON.stringify(toolInput, null, 2)}
        </pre>
      )}
      {content && (
        <pre className={`max-h-48 overflow-auto p-2 text-[12px] whitespace-pre-wrap ${isError ? 'text-[var(--bad)]' : 'text-[var(--text)]'}`} style={{ fontFamily: 'var(--font-mono)' }}>
          {content}
        </pre>
      )}
    </ToolCardShell>
  )
}
