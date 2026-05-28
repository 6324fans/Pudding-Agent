import { useSessionStore } from '../stores/session-store'
import { useTerminalStore } from '../stores/terminal-store'
import { AppLauncher } from './AppLauncher'
import { IconTerminal } from './icons'

interface Props {
  permissionMode: string
  effort: 'off' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  planMode: boolean
}

export function SessionHeader(_props: Props) {
  const activeSessionId = useSessionStore((s) => s.activeSessionId)
  const projects = useSessionStore((s) => s.projects)

  const toggleTerminal = useTerminalStore((s) => s.toggle)

  const activeProject = projects.find((p) =>
    p.sessions.some((s) => s.id === activeSessionId)
  )

  return (
    <div className="h-10 flex items-center justify-between px-5 border-b border-[var(--border)] bg-[var(--surface)] flex-shrink-0">
      {/* Left: project / session ID */}
      <div className="flex items-center gap-1 text-[12px] font-[var(--font-mono)] min-w-0">
        <span className="truncate text-[var(--text)]">{activeProject?.name || '—'}</span>
        <span className="text-[var(--muted)]">/</span>
        <span className="text-[var(--muted)] font-mono">{activeSessionId?.slice(0, 8) || '—'}</span>
      </div>

      {/* Center: devtools toolbar */}
      {activeProject?.cwd && (
        <div className="flex items-center gap-2">
          {/* Open in + dropdown group */}
          <div className="flex items-center rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)]">
            <AppLauncher cwd={activeProject.cwd} />
          </div>
          {/* Terminal button */}
          <div className="flex items-center rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)]">
            <button
              onClick={toggleTerminal}
              className="flex items-center gap-1 px-2.5 py-1.5 text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface-3)] transition-colors"
              aria-label="显示/隐藏终端"
            >
              <IconTerminal size={15} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
