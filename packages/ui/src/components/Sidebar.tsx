import { useEffect, useState, useRef, type ReactNode } from 'react'
import { useSessionStore } from '../stores/session-store'
import { useSettingsStore } from '../stores/settings-store'
import { IconFiles, IconPlus, IconSearch, IconSettings, IconTasks, IconUsage } from './icons'

function NavButton({ icon, label, active, onClick }: { icon: ReactNode; label: string; active?: boolean; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-[8px] px-2 py-2 text-left text-[13px] font-medium text-[var(--text)] transition-colors hover:bg-[var(--surface-3)] ${
        active ? 'bg-[var(--surface)] shadow-[var(--shadow)]' : ''
      }`}
    >
      <span className="text-[var(--muted)]">{icon}</span>
      <span className="truncate">{label}</span>
    </button>
  )
}

function formatSessionTime(timestamp?: number | null): string {
  if (!timestamp) return ''
  const diff = Date.now() - timestamp
  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour
  if (diff < minute) return '刚刚'
  if (diff < hour) return `${Math.floor(diff / minute)}分钟前`
  if (diff < day) return `${Math.floor(diff / hour)}小时前`
  if (diff < 7 * day) return `${Math.floor(diff / day)}天前`
  return new Date(timestamp).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
}

function formatLastMessage(role?: string | null, preview?: string | null): string {
  if (!preview) return ''
  const prefix = role === 'user' ? '你: ' : role === 'assistant' ? 'AI: ' : ''
  return `${prefix}${preview}`
}

export function Sidebar() {
  const projects = useSessionStore((s) => s.projects)
  const activeSessionId = useSessionStore((s) => s.activeSessionId)
  const showHome = useSessionStore((s) => s.showHome)
  const showSearch = useSessionStore((s) => s.showSearch)
  const sessionStates = useSessionStore((s) => s.sessionStates)
  const loadProjects = useSessionStore((s) => s.loadProjects)
  const createSession = useSessionStore((s) => s.createSession)
  const switchSession = useSessionStore((s) => s.switchSession)
  const renameSession = useSessionStore((s) => s.renameSession)
  const deleteSession = useSessionStore((s) => s.deleteSession)
  const deleteProject = useSessionStore((s) => s.deleteProject)
  const addProject = useSessionStore((s) => s.addProject)
  const openHome = useSessionStore((s) => s.openHome)
  const openSearch = useSessionStore((s) => s.openSearch)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [confirmDeleteProjectCwd, setConfirmDeleteProjectCwd] = useState<string | null>(null)
  const [version, setVersion] = useState('')
  const [updateAvailable, setUpdateAvailable] = useState<string | null>(null)
  const [projectsCollapsed, setProjectsCollapsed] = useState(false)
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(() => new Set())
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    loadProjects()
    window.electronAPI?.getVersion?.().then((v: string) => setVersion(v))
    const unsub = window.electronAPI?.on('updater:available', (_e: unknown, data: unknown) => {
      setUpdateAvailable((data as { version: string }).version)
    })
    return unsub
  }, [loadProjects])

  useEffect(() => {
    if (editingId && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editingId])

  const handleDoubleClick = (sessionId: string, currentTitle: string) => {
    setEditingId(sessionId)
    setEditValue(currentTitle)
  }

  const handleRenameSubmit = (sessionId: string) => {
    const trimmed = editValue.trim()
    if (trimmed) {
      renameSession(sessionId, trimmed)
    }
    setEditingId(null)
  }

  const handleDelete = (sessionId: string) => {
    deleteSession(sessionId)
    setConfirmDeleteId(null)
  }

  const handleProjectDelete = (cwd: string) => {
    deleteProject(cwd)
    setConfirmDeleteProjectCwd(null)
  }

  const toggleProject = (cwd: string) => {
    setCollapsedProjects((prev) => {
      const next = new Set(prev)
      if (next.has(cwd)) next.delete(cwd)
      else next.add(cwd)
      return next
    })
  }

  return (
    <aside className="w-[260px] border-r border-[var(--border)] bg-[var(--sidebar)] flex flex-col overflow-hidden" style={{ fontFamily: 'var(--font-sans)' }}>
      <div className="h-3 flex-shrink-0" />

      <div className="px-3 pb-4 space-y-1">
        <NavButton icon={<IconPlus size={16} />} label="新对话" active={showHome && !activeSessionId} onClick={openHome} />
        <NavButton icon={<IconSearch size={16} />} label="搜索" active={showSearch} onClick={openSearch} />
        <NavButton icon={<IconTasks size={16} />} label="插件" onClick={() => useSettingsStore.getState().open('plugins')} />
        <NavButton icon={<IconUsage size={16} />} label="技能" onClick={() => useSettingsStore.getState().open('skills')} />
      </div>

      <div className="flex-1 px-3 pb-3 space-y-5 overflow-y-auto">
        <div>
          <button
            type="button"
            onClick={() => setProjectsCollapsed((v) => !v)}
            className="flex w-full items-center gap-1.5 rounded-[6px] px-2 py-1 text-left text-[12px] font-medium text-[var(--muted)] transition-colors hover:bg-[var(--surface-3)] hover:text-[var(--text)]"
            aria-expanded={!projectsCollapsed}
          >
            <span className="w-3 text-[10px]">{projectsCollapsed ? '▶' : '▼'}</span>
            <span>项目</span>
          </button>
        </div>
        {!projectsCollapsed && projects.map((project) => {
          const collapsed = collapsedProjects.has(project.cwd)
          return (
            <div key={project.cwd}>
              {confirmDeleteProjectCwd === project.cwd ? (
                <div className="mb-1.5 flex items-center gap-1 rounded-[6px] border border-[var(--bad)] bg-[var(--surface-2)] px-2 py-1.5">
                  <span className="min-w-0 flex-1 truncate text-[12px] text-[var(--bad)]">删除项目?</span>
                  <button onClick={() => handleProjectDelete(project.cwd)} className="rounded bg-[var(--bad)] px-1.5 py-0.5 text-[11px] text-white hover:opacity-80">确认</button>
                  <button onClick={() => setConfirmDeleteProjectCwd(null)} className="rounded px-1.5 py-0.5 text-[11px] text-[var(--muted)] hover:text-[var(--text)]">取消</button>
                </div>
              ) : (
                <div className="group/project relative mb-1.5 flex items-center">
                  <button
                    type="button"
                    onClick={() => toggleProject(project.cwd)}
                    className="flex w-full items-center gap-2 rounded-[6px] px-2 py-1 pr-7 text-left text-[13px] font-medium text-[var(--muted)] transition-colors hover:bg-[var(--surface-3)] hover:text-[var(--text)]"
                    aria-expanded={!collapsed}
                  >
                    <span className="w-3 text-[10px]">{collapsed ? '▶' : '▼'}</span>
                    <IconFiles size={15} />
                    <span className="truncate">{project.name}</span>
                    <span className="ml-auto text-[10px] text-[var(--muted)]">{project.sessions.length}</span>
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); setConfirmDeleteProjectCwd(project.cwd) }}
                    className="absolute right-1 rounded p-1 text-[var(--muted)] opacity-0 transition-all hover:bg-[var(--surface-3)] hover:text-[var(--bad)] group-hover/project:opacity-100"
                    aria-label="删除项目"
                    title="删除项目"
                  >
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M2 3h8M4.5 3V2h3v1M3 3v7h6V3M5 5v3M7 5v3"/></svg>
                  </button>
                </div>
              )}
              {!collapsed && (
                <div className="space-y-0.5">
                  {project.sessions.map((session) => {
                const state = sessionStates[session.id]
                const isBusy = state?.isStreaming
                const hasError = state?.error && !state.error.retrying
                const isFinished = state?.finished
                const isActive = activeSessionId === session.id
                const showLight = !isActive && (isBusy || hasError || isFinished)
                const lastMessage = formatLastMessage(session.lastMessageRole, session.lastMessagePreview)
                const lastTime = formatSessionTime(session.lastMessageAt || session.updatedAt)
                const displayName = session.title || session.lastMessagePreview || session.id.slice(0, 8)
                const subtitle = session.title ? lastMessage : ''

                if (editingId === session.id) {
                  return (
                    <input
                      key={session.id}
                      ref={inputRef}
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onBlur={() => handleRenameSubmit(session.id)}
                      onKeyDown={(e) => {
                        if (e.nativeEvent.isComposing) return
                        if (e.key === 'Enter') handleRenameSubmit(session.id)
                        if (e.key === 'Escape') setEditingId(null)
                      }}
                      className="w-full px-2.5 py-1.5 text-[13px] rounded-[6px] bg-[var(--surface-2)] border border-[var(--accent)] text-[var(--text)] outline-none"
                    />
                  )
                }

                if (confirmDeleteId === session.id) {
                  return (
                    <div key={session.id} className="flex items-center gap-1 px-2.5 py-1.5 rounded-[6px] bg-[var(--surface-2)] border border-[var(--bad)]">
                      <span className="text-[12px] text-[var(--bad)] flex-1 truncate">删除?</span>
                      <button onClick={() => handleDelete(session.id)} className="text-[11px] px-1.5 py-0.5 rounded bg-[var(--bad)] text-white hover:opacity-80">确认</button>
                      <button onClick={() => setConfirmDeleteId(null)} className="text-[11px] px-1.5 py-0.5 rounded text-[var(--muted)] hover:text-[var(--text)]">取消</button>
                    </div>
                  )
                }

                return (
                  <div key={session.id} className="group relative flex items-center">
                    <button
                      onClick={() => {
                        switchSession(session.id)
                        if (isFinished) useSessionStore.getState().dismissFinished(session.id)
                      }}
                      onDoubleClick={() => handleDoubleClick(session.id, displayName)}
                      className={`w-full text-left px-2.5 py-2 text-[13px] transition-colors flex items-start gap-1.5 rounded-[8px] ${
                        isActive
                          ? 'bg-[var(--surface)] text-[var(--text)] font-semibold shadow-[var(--shadow)]'
                          : 'text-[var(--text)] hover:bg-[var(--surface-3)]'
                      }`}
                    >
                      <span className="mt-[7px] inline-block h-[6px] w-[6px] rounded-full flex-shrink-0">
                        {showLight && isBusy && (
                          <span className="block h-[6px] w-[6px] rounded-full bg-[var(--warn)] animate-pulse" />
                        )}
                        {showLight && !isBusy && hasError && (
                          <span className="block h-[6px] w-[6px] rounded-full bg-[var(--bad)]" />
                        )}
                        {showLight && !isBusy && !hasError && isFinished && (
                          <span className="block h-[6px] w-[6px] rounded-full bg-[var(--good)]" />
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="block truncate">{displayName}</span>
                          {lastTime && (
                            <span className="ml-auto shrink-0 text-[10px] font-normal text-[var(--muted)]">
                              {lastTime}
                            </span>
                          )}
                        </span>
                        {subtitle && (
                          <span className="mt-0.5 block truncate text-[11px] font-normal text-[var(--muted)]">
                            {subtitle}
                          </span>
                        )}
                      </span>
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(session.id) }}
                      className="absolute right-1 opacity-0 group-hover:opacity-100 p-1 rounded text-[var(--muted)] hover:text-[var(--bad)] hover:bg-[var(--surface-3)] transition-all"
                      aria-label="删除会话"
                    >
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M2 3h8M4.5 3V2h3v1M3 3v7h6V3M5 5v3M7 5v3"/></svg>
                    </button>
                  </div>
                )
              })}
              <button
                onClick={() => createSession(project.cwd)}
                className="w-full text-left px-2.5 py-1.5 text-[12px] text-[var(--muted)] hover:text-[var(--text)] transition-colors rounded-[6px]"
              >
                + 新建会话
              </button>
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="px-3 py-3 space-y-2 border-t border-[var(--border)] flex-shrink-0">
        <button
          onClick={addProject}
          className="w-full border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] text-[12px] py-2.5 rounded-[8px] hover:bg-[var(--surface-2)] transition-colors"
        >
          新建项目
        </button>
        <div className="flex items-center justify-center gap-1 text-center text-[10px] text-[var(--muted)]">
          <IconSettings size={12} />
          Pudding-Agent {version ? `v${version}` : ''}
          {updateAvailable && (
            <button
              onClick={() => useSettingsStore.getState().open('advanced')}
              className="ml-1.5 text-[var(--accent)] hover:underline"
            >
              v{updateAvailable} 可用
            </button>
          )}
        </div>
      </div>
    </aside>
  )
}
