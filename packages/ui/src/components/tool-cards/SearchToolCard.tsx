import type { ToolCardRouterProps } from './ToolCardRouter'
import { ToolCardShell } from './ToolCardShell'
import { ToolCopyButton } from './ToolCopyButton'
import {
  deriveToolStatus,
  formatToolLabel,
  getToolVariant,
  missingRequiredArgumentMessage,
  shouldShowToolRail,
  stringValue,
} from './tool-card-meta'

function resultCount(content: string): string {
  if (!content || /^No (matches|files|results)/i.test(content.trim())) return '0 个结果'
  const lines = content.split('\n').filter((line) => line.trim() && !line.startsWith('(truncated'))
  return `${lines.length} 行`
}

function searchDetail(toolName: string, input: Record<string, unknown>, content: string): string {
  if (toolName === 'grep') {
    const path = stringValue(input.path) || '.'
    const glob = stringValue(input.glob)
    const suffix = glob ? ` · ${glob}` : ''
    return `${stringValue(input.pattern) || '(搜索条件)'} 于 ${path}${suffix} · ${resultCount(content)}`
  }
  if (toolName === 'glob') return `${stringValue(input.pattern) || '(搜索条件)'} · ${resultCount(content)}`
  if (toolName === 'ls') return `${stringValue(input.path) || '.'} · ${resultCount(content)}`
  if (toolName === 'tree') {
    const depth = input.depth ? ` · 深度 ${String(input.depth)}` : ''
    return `${stringValue(input.path) || '.'}${depth}`
  }
  if (toolName === 'lsp') {
    const operation = stringValue(input.operation) || '操作'
    const file = stringValue(input.filePath || input.file_path)
    const line = input.line ? `:${String(input.line)}` : ''
    const query = stringValue(input.query)
    return query ? `${operation} · ${query}` : `${operation} · ${file}${line}`
  }
  return toolName
}

export function SearchToolCard({ event, input, result, name }: ToolCardRouterProps) {
  const status = deriveToolStatus(event, result)
  const toolName = event?.toolName || name || 'search'
  const toolInput = (event?.input || input || {}) as Record<string, unknown>
  const content = event?.result?.content || result?.content || ''
  const isError = event?.result?.isError || result?.is_error
  const missingArgumentMessage = isError ? missingRequiredArgumentMessage(content) : null
  const displayStatus = missingArgumentMessage ? 'done' : status
  const detail = missingArgumentMessage
    ? `${missingArgumentMessage}，已跳过`
    : searchDetail(toolName, toolInput, content)
  const entries = Object.entries(toolInput).filter(([, value]) => value !== undefined && value !== '')

  return (
    <ToolCardShell
      label={formatToolLabel(toolName)}
      detail={detail}
      status={displayStatus}
      statusLabel={missingArgumentMessage ? '已跳过' : undefined}
      defaultExpanded={status === 'running'}
      rail={missingArgumentMessage ? false : shouldShowToolRail(toolName, status)}
      variant={missingArgumentMessage ? 'generic' : getToolVariant(toolName)}
      actions={content ? (
        <ToolCopyButton text={content} label="结果" title="复制结果" iconOnly />
      ) : undefined}
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
      {missingArgumentMessage ? (
        <div className="tool-empty-state">
          这次工具调用缺少必填参数，已自动跳过。原始错误：{content}
        </div>
      ) : content ? (
        <pre className={`tool-result-pre ${isError ? 'text-[var(--bad)]' : 'text-[var(--text)]'}`} style={{ fontFamily: 'var(--font-mono)' }}>
          {content}
        </pre>
      ) : status === 'running' ? (
        <div className="tool-empty-state">正在搜索...</div>
      ) : (
        <div className="tool-empty-state">没有结果内容。</div>
      )}
    </ToolCardShell>
  )
}
