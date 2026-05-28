import { useAgentStore } from '../stores/agent-store'
import { useSessionStore } from '../stores/session-store'
import { ipc } from '../lib/ipc-client'
import { ToolCardRouter } from './tool-cards'

const AGENT_STATUS_LABELS: Record<string, string> = {
  running: '运行中',
  done: '完成',
  completed: '完成',
  error: '错误',
  failed: '失败',
  stopped: '已停止',
}

export function AgentDetailPanel() {
  const activeAgentId = useAgentStore((s) => s.activeAgentId)
  const agent = useAgentStore((s) => activeAgentId ? s.agents[activeAgentId] : null)
  const setActiveAgent = useAgentStore((s) => s.setActiveAgent)
  const activeSessionId = useSessionStore((s) => s.activeSessionId)

  if (!agent) return null

  const elapsed = Math.round((Date.now() - agent.startTime) / 1000)

  const handleAbort = () => {
    if (activeSessionId && activeAgentId) {
      ipc.agent.abort(activeSessionId, activeAgentId)
    }
  }

  const handleBackground = () => {
    if (activeSessionId && activeAgentId) {
      ipc.agent.background(activeSessionId, activeAgentId)
    }
  }

  const handleClose = () => {
    setActiveAgent(null)
  }

  return (
    <div className="flex flex-col h-full border-l border-[var(--border)] bg-[var(--surface)]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
        <div className="flex items-center gap-2">
          <span className="text-[var(--accent)]">&#9670;</span>
          <span className="text-[10px] uppercase tracking-[0.1em] text-[var(--accent)]">代理</span>
          <span className="text-[11px] text-[var(--text)] truncate max-w-[200px]">
            {agent.prompt.slice(0, 40)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {agent.status === 'running' && (
            <>
              <button
                onClick={handleBackground}
                className="text-[10px] uppercase tracking-[0.05em] text-[var(--accent)] hover:opacity-80 transition-opacity"
              >
                [后台]
              </button>
              <button
                onClick={handleAbort}
                className="text-[10px] uppercase tracking-[0.05em] text-[var(--bad)] hover:opacity-80 transition-opacity"
              >
                [终止]
              </button>
            </>
          )}
          <button
            onClick={handleClose}
            className="text-[var(--muted)] hover:text-[var(--text)] text-xs transition-colors"
          >
            [X]
          </button>
        </div>
      </div>

      {/* Status bar */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-[var(--border)] text-[10px] text-[var(--muted)]">
        {agent.status === 'running' && (
          <span className="inline-block h-2 w-2 rounded-full bg-[var(--accent)] animate-pulse" />
        )}
        <span>{agent.status === 'running' ? `运行中 ${elapsed}s` : AGENT_STATUS_LABELS[agent.status] || agent.status}</span>
        <span>|</span>
        <span>{agent.toolCount} 个工具</span>
        {agent.modelId && (
          <>
            <span>|</span>
            <span>{agent.modelId}</span>
          </>
        )}
      </div>

      {/* Tool events list */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {agent.toolEvents.map((te, i) => (
          <ToolCardRouter
            key={i}
            name={te.toolName}
            input={te.input}
            result={te.result ? { content: te.result.content, is_error: te.result.isError } : undefined}
          />
        ))}
        {agent.status === 'running' && agent.toolEvents.length === 0 && (
          <div className="text-[10px] text-[var(--muted)] uppercase tracking-[0.1em]">
            初始化中...
          </div>
        )}
      </div>

      {/* Text output */}
      {agent.textOutput && (
        <div className="border-t border-[var(--border)] px-4 py-3 max-h-[200px] overflow-y-auto">
          <div className="text-[10px] uppercase tracking-[0.1em] text-[var(--muted)] mb-1">输出</div>
          <pre className="text-xs text-[var(--text)] whitespace-pre-wrap">{agent.textOutput}</pre>
        </div>
      )}
    </div>
  )
}
