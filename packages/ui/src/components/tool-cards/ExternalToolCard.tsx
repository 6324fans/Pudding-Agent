import type { ToolCardRouterProps } from './ToolCardRouter'
import { ToolCardShell } from './ToolCardShell'
import { ToolCopyButton } from './ToolCopyButton'
import { IconExternalLink } from '../icons'
import {
  deriveToolStatus,
  formatToolLabel,
  getToolVariant,
  shouldShowToolRail,
  stringValue,
} from './tool-card-meta'

function externalDetail(toolName: string, input: Record<string, unknown>): string {
  if (toolName === 'web_search') return stringValue(input.query) || 'web search'
  if (toolName === 'web_fetch') return stringValue(input.url) || 'web fetch'
  if (toolName === 'weather') return stringValue(input.location) || 'weather'
  if (toolName === 'browser_open') return stringValue(input.url) || 'browser'
  if (toolName === 'list_mcp_resources') return stringValue(input.server) || 'all MCP servers'
  if (toolName === 'read_mcp_resource') return `${stringValue(input.server)} · ${stringValue(input.uri)}`
  return toolName
}

export function ExternalToolCard({ event, input, result, name }: ToolCardRouterProps) {
  const status = deriveToolStatus(event, result)
  const toolName = event?.toolName || name || 'external'
  const toolInput = (event?.input || input || {}) as Record<string, unknown>
  const content = event?.result?.content || result?.content || ''
  const isError = event?.result?.isError || result?.is_error
  const url = stringValue(toolInput.url)
  const entries = Object.entries(toolInput).filter(([, value]) => value !== undefined && value !== '')

  return (
    <ToolCardShell
      label={formatToolLabel(toolName)}
      detail={externalDetail(toolName, toolInput)}
      status={status}
      defaultExpanded={status === 'running'}
      rail={shouldShowToolRail(toolName, status)}
      variant={getToolVariant(toolName)}
      actions={
        <div className="flex items-center gap-1">
          {url && (
            <ToolCopyButton text={url} label="URL" title="复制 URL" iconOnly>
              <IconExternalLink size={12} />
            </ToolCopyButton>
          )}
          {content && <ToolCopyButton text={content} label="结果" title="复制结果" iconOnly />}
        </div>
      }
    >
      {entries.length > 0 && (
        <div className="tool-kv-grid">
          {entries.slice(0, 6).map(([key, value]) => (
            <div key={key}>
              <span>{key}</span>
              <strong title={typeof value === 'string' ? value : undefined}>
                {typeof value === 'string' ? value : JSON.stringify(value)}
              </strong>
            </div>
          ))}
        </div>
      )}
      {content ? (
        <pre className={`tool-result-pre ${isError ? 'text-[var(--bad)]' : 'text-[var(--text)]'}`} style={{ fontFamily: 'var(--font-mono)' }}>
          {content}
        </pre>
      ) : status === 'running' ? (
        <div className="tool-empty-state">等待远端响应...</div>
      ) : (
        <div className="tool-empty-state">没有结果内容。</div>
      )}
    </ToolCardShell>
  )
}
