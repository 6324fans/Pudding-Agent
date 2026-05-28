import { useSessionStore } from '../stores/session-store'
import { useSettingsStore } from '../stores/settings-store'
import { IconSettings } from './icons'

export function Topbar() {
  const projects = useSessionStore((s) => s.projects)
  const activeSessionId = useSessionStore((s) => s.activeSessionId)
  const openSettings = useSettingsStore((s) => s.open)

  const activeProject = projects.find((p) =>
    p.sessions.some((s) => s.id === activeSessionId)
  )
  const projectName = activeProject?.name || projects[0]?.name || 'Pudding-Agent'

  return (
    <header
      className="h-12 flex items-center justify-between pl-[78px] pr-5 border-b border-[var(--border)] bg-[var(--surface)]"
      style={{ WebkitAppRegion: 'drag' } as any}
    >
      <div className="flex items-center gap-3" style={{ WebkitAppRegion: 'no-drag' } as any}>
        <h1 className="text-[15px] font-semibold tracking-[0]" style={{ fontFamily: 'var(--font-sans)' }}>
          {projectName}
        </h1>
      </div>

      <div className="flex items-center gap-3" style={{ WebkitAppRegion: 'no-drag' } as any}>
        <button
          onClick={() => openSettings()}
          className="p-2 rounded-[8px] text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)] transition-colors"
          aria-label="设置"
        >
          <IconSettings size={18} />
        </button>
      </div>
    </header>
  )
}
