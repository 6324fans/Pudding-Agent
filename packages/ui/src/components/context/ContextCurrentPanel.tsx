import type { ReactNode } from 'react'
import type { ContextInspectSnapshot, ContextCitation } from '../../lib/ipc-client'

export function ContextCurrentPanel({ snapshot, loading, error, onReload }: {
  snapshot: ContextInspectSnapshot | null
  loading: boolean
  error: string | null
  onReload: () => void
}) {
  if (loading) return <PanelState title="正在读取上下文" message="上下文引擎" />
  if (error) return <PanelState title="上下文暂不可用" message={error} />
  if (!snapshot) return <PanelState title="暂无上下文快照" message="上下文引擎" />
  if (snapshot.status === 'unavailable') return <PanelState title="上下文暂不可用" message={snapshot.diagnostics[0] ?? '上下文引擎暂不可用'} />

  const section = snapshot.current.section
  const citations = section?.citations ?? []

  return (
    <section className="space-y-3">
      <PanelHeader title="当前上下文" actionLabel="刷新" onAction={onReload} />
      <div className="grid grid-cols-3 gap-2">
        <Metric label="命中" value={snapshot.current.facts.length} />
        <Metric label="令牌" value={section?.tokenEstimate ?? snapshot.current.usedTokens} />
        <Metric label="引用" value={citations.length} />
      </div>

      {!section ? (
        <PanelState title="暂无注入片段" message={snapshot.query} />
      ) : (
        <article className="min-w-0 rounded-[6px] border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="break-words text-[12px] font-medium text-[var(--text)] [overflow-wrap:anywhere]">{section.title}</div>
              <div className="mt-0.5 break-words text-[10px] uppercase tracking-[0.08em] text-[var(--muted)] [overflow-wrap:anywhere]">
                {section.id}
              </div>
            </div>
            <StatusPill tone="good">{section.tokenEstimate} 令牌</StatusPill>
          </div>
          <LongText text={section.content} />
          <CitationList citations={citations} />
        </article>
      )}

      <div className="space-y-2">
        <div className="text-[10px] tracking-[0.08em] text-[var(--muted)]">事实</div>
        {snapshot.current.facts.length === 0 ? (
          <p className="text-[12px] text-[var(--muted)]">暂无命中事实</p>
        ) : (
          snapshot.current.facts.map((item) => (
            <article key={item.fact.id} className="min-w-0 rounded-[6px] border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="break-words text-[12px] font-medium text-[var(--text)] [overflow-wrap:anywhere]">
                    {displayFactTitle(item.fact.title, item.fact.kind)}
                  </div>
                  <div className="mt-0.5 break-words text-[10px] tracking-[0.08em] text-[var(--muted)] [overflow-wrap:anywhere]">
                    {factKindLabel(item.fact.kind)} · {factScopeLabel(item.fact.scope)} · 分数 {item.score}
                  </div>
                </div>
                <StatusPill tone="muted">{item.tokenEstimate} 令牌</StatusPill>
              </div>
              <LongText text={item.fact.content} />
              <CitationList citations={item.fact.citations} />
            </article>
          ))
        )}
      </div>
    </section>
  )
}

export function PanelHeader({ title, actionLabel, onAction }: {
  title: string
  actionLabel?: string
  onAction?: () => void
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <h3 className="text-[11px] uppercase tracking-[0.1em] text-[var(--muted)] font-medium">{title}</h3>
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="rounded-[6px] border border-[var(--border)] px-2 py-1 text-[10px] text-[var(--muted)] hover:border-[var(--accent)] hover:text-[var(--text)]"
        >
          {actionLabel}
        </button>
      )}
    </div>
  )
}

export function PanelState({ title, message }: { title: string; message: string }) {
  return (
    <div className="min-w-0 rounded-[6px] border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2.5">
      <div className="break-words text-[12px] font-medium text-[var(--text)] [overflow-wrap:anywhere]">{title}</div>
      <div className="mt-1 break-words text-[11px] text-[var(--muted)] [overflow-wrap:anywhere]">{message}</div>
    </div>
  )
}

export function Metric({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div className="min-w-0 rounded-[6px] border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-2">
      <div className="text-[10px] tracking-[0.08em] text-[var(--muted)]">{label}</div>
      <div className="mt-1 truncate text-[12px] font-medium text-[var(--text)]" title={String(value ?? '无')}>
        {value ?? '无'}
      </div>
    </div>
  )
}

export function StatusPill({ tone, children }: { tone: 'good' | 'warn' | 'bad' | 'accent' | 'muted'; children: ReactNode }) {
  const color = tone === 'good'
    ? 'var(--good)'
    : tone === 'warn'
      ? 'var(--warn)'
      : tone === 'bad'
        ? 'var(--bad)'
        : tone === 'accent'
          ? 'var(--accent)'
          : 'var(--muted)'
  return (
    <span
      className="inline-flex max-w-full items-center rounded-[999px] border px-1.5 py-0.5 text-[10px] leading-none"
      style={{ color, borderColor: color }}
    >
      <span className="truncate">{children}</span>
    </span>
  )
}

export function LongText({ text }: { text: string }) {
  const displayText = localizeContextText(text)
  if (displayText.length <= 520) {
    return <p className="mt-2 whitespace-pre-wrap break-words text-[11px] leading-relaxed text-[var(--text)] [overflow-wrap:anywhere]">{displayText}</p>
  }

  return (
    <details className="mt-2">
      <summary className="cursor-pointer text-[11px] text-[var(--muted)] hover:text-[var(--text)]">
        {displayText.slice(0, 220).replace(/\s+/g, ' ')}...
      </summary>
      <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-[6px] border border-[var(--border)] bg-[var(--surface)] p-2 text-[10px] leading-relaxed text-[var(--text)] [overflow-wrap:anywhere]">
        {displayText}
      </pre>
    </details>
  )
}

export function CitationList({ citations }: { citations: ContextCitation[] }) {
  if (citations.length === 0) return <div className="mt-2 text-[10px] text-[var(--muted)]">引用 0</div>
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {citations.map((citation, index) => (
        <span
          key={citation.id || `${citation.ref}-${citation.line ?? index}`}
          className="max-w-full truncate rounded-[4px] border border-[var(--border)] bg-[var(--surface)] px-1.5 py-1 font-mono text-[10px] text-[var(--muted)]"
          title={`${citation.type}:${citation.ref}${citation.line ? `:${citation.line}` : ''}`}
        >
          {citationRefLabel(citation.ref)}{citation.line ? `:${citation.line}` : ''}
        </span>
      ))}
    </div>
  )
}

function localizeContextText(text: string): string {
  return text
    .replace(/(^|\n)user:/g, '$1用户:')
    .replace(/(^|\n)assistant:/g, '$1助手:')
    .replace(/(^|\n)system:/g, '$1系统:')
    .replace(/(^|\n)current user:/g, '$1当前用户:')
    .replace(/\bcurrent-user-message\b/g, '当前用户消息')
    .replace(/\bcurrent-turn\b/g, '当前轮次')
    .replace(/\bconversation\b/g, '会话')
}

function citationRefLabel(ref: string): string {
  switch (ref) {
    case 'current-user-message': return '当前用户消息'
    case 'current-turn': return '当前轮次'
    default: return ref
  }
}

export function factKindLabel(kind: string): string {
  switch (kind) {
    case 'project': return '项目'
    case 'code': return '代码'
    case 'git': return 'Git'
    case 'conversation': return '会话'
    case 'repo_wiki': return '仓库 Wiki'
    default: return kind
  }
}

export function factScopeLabel(scope: string): string {
  switch (scope) {
    case 'project': return '项目级'
    case 'session': return '会话级'
    case 'turn': return '本轮'
    default: return scope
  }
}

export function displayFactTitle(title: string | undefined, kind: string): string {
  if (title === 'Context V2 Project Facts') return '上下文项目事实'
  if (title === 'Current conversation state') return '当前会话状态'
  if (title === 'Rejected Repo Wiki Generation') return '被拒绝的仓库 Wiki 生成结果'
  if (!title) return factKindLabel(kind)
  return title
}
