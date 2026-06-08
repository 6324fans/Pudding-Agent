import type { ToolCardRouterProps } from './ToolCardRouter'
import { ToolCardShell } from './ToolCardShell'
import { truncateText } from './shared'
import { ToolCopyButton } from './ToolCopyButton'
import { deriveToolStatus, getToolVariant, shouldShowToolRail } from './tool-card-meta'

export function BashToolCard({ event, input, result, name }: ToolCardRouterProps) {
  const status = deriveToolStatus(event, result)
  const toolName = event?.toolName || name || 'bash'
  const command = (event?.input?.command || input?.command || '') as string
  const output = event?.result?.content || result?.content || ''
  const isError = event?.result?.isError || result?.is_error

  const displayCommand = truncateText(command, 60)

  return (
    <ToolCardShell
      label="BASH"
      detail={`$ ${displayCommand}`}
      status={status}
      defaultExpanded={status === 'running'}
      rail={shouldShowToolRail(toolName, status)}
      variant={getToolVariant(toolName)}
      actions={status === 'done' ? (
        <div className="flex items-center gap-1">
          {command && <ToolCopyButton text={command} label="命令" title="复制命令" toastLabel="命令" />}
          {output && <ToolCopyButton text={output} label="输出" title="复制输出" toastLabel="输出" />}
        </div>
      ) : undefined}
    >
      {status === 'running' && !output && (
        <div className="text-[10px] text-[var(--muted)] uppercase tracking-[0.1em]">运行中...</div>
      )}
      {output && (
        <pre className={`max-h-[300px] overflow-auto p-2 text-[12px] whitespace-pre-wrap ${isError ? 'text-[var(--bad)]' : 'text-[var(--text)]'}`} style={{ fontFamily: 'var(--font-mono)' }}>
          {output}
        </pre>
      )}
    </ToolCardShell>
  )
}
