import type { ToolCardRouterProps } from './ToolCardRouter'
import { ToolCardShell } from './ToolCardShell'
import { ToolCopyButton } from './ToolCopyButton'
import { parseMcpToolName } from './shared'
import { deriveToolStatus, getToolVariant, shouldShowToolRail } from './tool-card-meta'

export function McpToolCard({ event, input, result, name }: ToolCardRouterProps) {
  const status = deriveToolStatus(event, result)
  const toolName = event?.toolName || name || ''
  const parsed = parseMcpToolName(toolName)
  const displayName = parsed ? `${parsed.server}::${parsed.tool}` : toolName

  const toolInput = event?.input || input || {}
  const content = event?.result?.content || result?.content || ''
  const isError = event?.result?.isError || result?.is_error

  const inputEntries = Object.entries(toolInput).slice(0, 5)

  return (
    <ToolCardShell
      label="MCP"
      detail={displayName}
      status={status}
      defaultExpanded={status === 'running'}
      rail={shouldShowToolRail(toolName, status)}
      variant={getToolVariant(toolName)}
      actions={content ? (
        <ToolCopyButton text={content} label="结果" title="复制结果" iconOnly />
      ) : undefined}
    >
      {inputEntries.length > 0 && (
        <div className="text-[12px] text-[var(--muted)] mb-2" style={{ fontFamily: 'var(--font-mono)' }}>
          {inputEntries.map(([key, val]) => (
            <div key={key}>
              <span className="text-[var(--text)]">{key}</span>: {typeof val === 'string' ? val.slice(0, 80) : JSON.stringify(val).slice(0, 80)}
            </div>
          ))}
        </div>
      )}
      {content && (
        <pre className={`max-h-48 overflow-auto p-2 text-[12px] whitespace-pre-wrap ${isError ? 'text-[var(--bad)]' : 'text-[var(--text)]'}`} style={{ fontFamily: 'var(--font-mono)' }}>
          {content.slice(0, 500)}
          {content.length > 500 && '\n...'}
        </pre>
      )}
    </ToolCardShell>
  )
}
