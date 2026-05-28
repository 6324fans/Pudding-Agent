import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { ipc, type SessionSearchResult } from '../lib/ipc-client'
import { useSessionStore } from '../stores/session-store'
import { IconSearch, IconX } from './icons'

function formatTime(timestamp?: number | null): string {
  if (!timestamp) return ''
  return new Date(timestamp).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function roleLabel(role: string): string {
  if (role === 'user') return '你'
  if (role === 'assistant') return 'AI'
  if (role === 'system') return '系统'
  return role
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function Highlight({ text, query }: { text: string; query: string }) {
  const trimmed = query.trim()
  if (!trimmed) return <>{text}</>
  const parts = text.split(new RegExp(`(${escapeRegex(trimmed)})`, 'gi'))
  return (
    <>
      {parts.map((part, index) => (
        part.toLowerCase() === trimmed.toLowerCase()
          ? <mark key={index} className="rounded-[3px] bg-[var(--accent-soft)] px-0.5 text-[var(--text)]">{part}</mark>
          : <span key={index}>{part}</span>
      ))}
    </>
  )
}

function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-[220px] items-center justify-center px-6 text-center text-[13px] text-[var(--muted)]">
      {children}
    </div>
  )
}

export function SearchPage() {
  const projects = useSessionStore((s) => s.projects)
  const loadProjects = useSessionStore((s) => s.loadProjects)
  const switchSession = useSessionStore((s) => s.switchSession)
  const closeSearch = useSessionStore((s) => s.closeSearch)

  const [query, setQuery] = useState('')
  const [selectedCwd, setSelectedCwd] = useState('')
  const [results, setResults] = useState<SessionSearchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const trimmedQuery = query.trim()
  const resultCount = useMemo(() => results.reduce((sum, result) => sum + result.matchCount, 0), [results])

  useEffect(() => {
    if (projects.length === 0) loadProjects({ preserveActive: true })
  }, [loadProjects, projects.length])

  const runSearch = async (value = query, cwd = selectedCwd) => {
    const text = value.trim()
    if (!text) {
      setResults([])
      setError(null)
      setIsSearching(false)
      return
    }

    setIsSearching(true)
    setError(null)
    try {
      const nextResults = await ipc.session.search(text, cwd || undefined)
      setResults(nextResults || [])
    } catch (err) {
      setResults([])
      setError(err instanceof Error ? err.message : '搜索失败')
    } finally {
      setIsSearching(false)
    }
  }

  useEffect(() => {
    const handle = window.setTimeout(() => {
      runSearch(query, selectedCwd)
    }, 240)
    return () => window.clearTimeout(handle)
  }, [query, selectedCwd])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeSearch()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [closeSearch])

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    runSearch()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) closeSearch()
      }}
    >
      <div
        className="flex w-[680px] max-h-[80vh] flex-col overflow-hidden rounded-[14px] border border-[var(--border)] bg-[var(--surface)]"
        style={{ boxShadow: 'var(--shadow-soft)' }}
      >
        <div className="relative border-b border-[var(--border)] p-6 pb-4">
          <div className="pr-8">
            <div>
              <h2 className="text-[18px] font-semibold tracking-[0] text-[var(--text)]">搜索</h2>
              <p className="mt-1 text-[12px] text-[var(--muted)]">按对话内容查找历史会话</p>
            </div>
            <button
              onClick={closeSearch}
              className="absolute top-4 right-4 text-[var(--muted)] transition-colors hover:text-[var(--text)]"
              aria-label="关闭搜索"
              title="关闭搜索"
            >
              <IconX size={16} />
            </button>
          </div>

          <div className="mt-5 flex w-full flex-col gap-3">
            <form onSubmit={handleSubmit} className="flex flex-col gap-3 md:flex-row">
              <label className="relative min-w-0 flex-1">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]">
                  <IconSearch size={16} />
                </span>
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="输入关键词"
                  autoFocus
                  className="h-9 w-full rounded-[6px] border border-[var(--border)] bg-[var(--surface-2)] pl-9 pr-3 text-[13px] text-[var(--text)] outline-none transition-colors placeholder:text-[var(--muted)] focus:border-[var(--border-strong)]"
                />
              </label>
              <select
                value={selectedCwd}
                onChange={(event) => setSelectedCwd(event.target.value)}
                className="h-9 min-w-[180px] rounded-[6px] border border-[var(--border)] bg-[var(--surface-2)] px-3 text-[13px] text-[var(--text)] outline-none transition-colors focus:border-[var(--border-strong)]"
                aria-label="选择项目"
              >
                <option value="">全部项目</option>
                {projects.map((project) => (
                  <option key={project.cwd} value={project.cwd}>{project.name}</option>
                ))}
              </select>
            </form>
            <div className="h-4 text-[12px] text-[var(--muted)]">
              {trimmedQuery && !isSearching && !error && (
                <span>{results.length} 个会话，{resultCount} 处匹配</span>
              )}
              {isSearching && <span>搜索中...</span>}
              {error && <span className="text-[var(--bad)]">{error}</span>}
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-6 pt-4">
          <div className="flex w-full flex-col gap-3">
          {!trimmedQuery && <EmptyState>输入关键词开始搜索</EmptyState>}
          {trimmedQuery && !isSearching && !error && results.length === 0 && (
            <EmptyState>没有找到匹配的会话</EmptyState>
          )}
          {results.map((result) => {
            const title = result.title || result.lastMessagePreview || result.sessionId.slice(0, 8)
            return (
              <button
                key={result.sessionId}
                onClick={async () => {
                  await switchSession(result.sessionId)
                  closeSearch()
                }}
                className="rounded-[8px] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-left shadow-[var(--shadow)] transition-colors hover:bg-[var(--surface-2)]"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[14px] font-semibold text-[var(--text)]">{title}</span>
                      <span className="shrink-0 rounded-[5px] bg-[var(--surface-2)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--muted)]">
                        {result.sessionId.slice(0, 8)}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-[11px] text-[var(--muted)]">
                      <span className="truncate">{result.projectName}</span>
                      <span>/</span>
                      <span>{formatTime(result.lastMessageAt || result.updatedAt)}</span>
                    </div>
                  </div>
                  <span className="shrink-0 rounded-[999px] bg-[var(--accent-soft)] px-2 py-1 text-[11px] font-medium text-[var(--text)]">
                    {result.matchCount} 处
                  </span>
                </div>
                <div className="mt-3 space-y-2">
                  {result.matches.map((match) => (
                    <div key={`${result.sessionId}-${match.messageId}`} className="flex gap-2 text-[12px] leading-5 text-[var(--muted)]">
                      <span className="mt-0.5 h-5 min-w-8 rounded-[5px] bg-[var(--surface-2)] px-1.5 text-center text-[10px] font-medium text-[var(--text)]">
                        {roleLabel(match.role)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <Highlight text={match.snippet} query={trimmedQuery} />
                      </span>
                    </div>
                  ))}
                </div>
              </button>
            )
          })}
          </div>
        </div>
      </div>
    </div>
  )
}
