import type { ToolCardRouterProps } from './ToolCardRouter'
import { ToolCardShell } from './ToolCardShell'
import { ToolCopyButton } from './ToolCopyButton'
import {
  deriveToolStatus,
  getToolVariant,
  missingRequiredArgumentMessage,
  shouldShowToolRail,
} from './tool-card-meta'

export function ReadToolCard({ event, input, result, name }: ToolCardRouterProps) {
  const status = deriveToolStatus(event, result)
  const toolName = event?.toolName || name || 'file_read'
  const toolInput = event?.input || input || {}
  const filePath = (toolInput.file_path || toolInput.path || '') as string
  const content = event?.result?.content || result?.content || ''
  const lineCount = content ? content.split('\n').length : 0
  const isError = event?.result?.isError || result?.is_error
  const missingArgumentMessage = isError ? missingRequiredArgumentMessage(content) : null
  const displayStatus = missingArgumentMessage ? 'done' : status
  const variant = missingArgumentMessage ? 'generic' : getToolVariant(toolName)

  const detail = missingArgumentMessage
    ? `${missingArgumentMessage}，已跳过`
    : isError
      ? filePath
      : filePath + (lineCount > 0 ? ` (${lineCount} 行)` : '')

  return (
    <ToolCardShell
      label="READ"
      detail={detail}
      status={displayStatus}
      statusLabel={missingArgumentMessage ? '已跳过' : undefined}
      defaultExpanded={false}
      rail={missingArgumentMessage ? false : shouldShowToolRail(toolName, status)}
      variant={variant}
      actions={status === 'done' && filePath ? (
        <ToolCopyButton text={filePath} label="路径" title="复制路径" toastLabel="路径" iconOnly />
      ) : undefined}
    >
      {missingArgumentMessage && (
        <div className="tool-empty-state">
          这次工具调用缺少必填参数，已自动跳过。原始错误：{content}
        </div>
      )}
      {isError && !missingArgumentMessage && (
        <pre className="max-h-48 overflow-auto p-2 text-[12px] whitespace-pre-wrap text-[var(--bad)]" style={{ fontFamily: 'var(--font-mono)' }}>
          {content}
        </pre>
      )}
      {!isError && content && (
        <pre className="max-h-48 overflow-auto p-2 text-[12px] whitespace-pre-wrap text-[var(--text)]" style={{ fontFamily: 'var(--font-mono)' }}>
          {content.split('\n').slice(0, 5).join('\n')}
          {lineCount > 5 && `\n... 还有 ${lineCount - 5} 行`}
        </pre>
      )}
    </ToolCardShell>
  )
}
