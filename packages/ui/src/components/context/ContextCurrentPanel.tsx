import type { ReactNode } from 'react'
import type { ContextInspectSnapshot, ContextCitation } from '../../lib/ipc-client'

export function ContextCurrentPanel({ snapshot, loading, error, onReload }: {
  snapshot: ContextInspectSnapshot | null
  loading: boolean
  error: string | null
  onReload: () => void
}) {
  if (loading) return <PanelState title="正在读取上下文" message="Context V2" />
  if (error) return <PanelState title="上下文暂不可用" message={error} />
  if (!snapshot) return <PanelState title="暂无上下文快照" message="Context V2" />
  if (snapshot.status === 'unavailable') return <PanelState title="上下文暂不可用" message={snapshot.diagnostics[0] ?? 'Context V2 unavailable'} />

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
        <PanelState title="暂无注入 section" message={snapshot.query} />
      ) : (
        <article className="min-w-0 rounded-[6px] border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="break-words text-[12px] font-medium text-[var(--text)] [overflow-wrap:anywhere]">{section.title}</div>
              <div className="mt-0.5 break-words text-[10px] uppercase tracking-[0.08em] text-[var(--muted)] [overflow-wrap:anywhere]">
                {section.id}
              </div>
            </div>
            <StatusPill tone="good">{section.tokenEstimate} tok</StatusPill>
          </div>
          <LongText text={section.content} />
          <CitationList citations={citations} />
        </article>
      )}

      <div className="space-y-2">
        <div className="text-[10px] uppercase tracking-[0.08em] text-[var(--muted)]">Facts</div>
        {snapshot.current.facts.length === 0 ? (
          <p className="text-[12px] text-[var(--muted)]">暂无命中事实</p>
        ) : (
          snapshot.current.facts.map((item) => (
            <article key={item.fact.id} className="min-w-0 rounded-[6px] border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="break-words text-[12px] font-medium text-[var(--text)] [overflow-wrap:anywhere]">
                    {item.fact.title || item.fact.kind}
                  </div>
                  <div className="mt-0.5 break-words text-[10px] uppercase tracking-[0.08em] text-[var(--muted)] [overflow-wrap:anywhere]">
                    {item.fact.kind} · {item.fact.scope} · score {item.score}
                  </div>
                </div>
                <StatusPill tone="muted">{item.tokenEstimate} tok</StatusPill>
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
      <div className="text-[10px] uppercase tracking-[0.08em] text-[var(--muted)]">{label}</div>
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
  if (text.length <= 520) {
    return <p className="mt-2 whitespace-pre-wrap break-words text-[11px] leading-relaxed text-[var(--text)] [overflow-wrap:anywhere]">{text}</p>
  }

  return (
    <details className="mt-2">
      <summary className="cursor-pointer text-[11px] text-[var(--muted)] hover:text-[var(--text)]">
        {text.slice(0, 220).replace(/\s+/g, ' ')}...
      </summary>
      <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-[6px] border border-[var(--border)] bg-[var(--surface)] p-2 text-[10px] leading-relaxed text-[var(--text)] [overflow-wrap:anywhere]">
        {text}
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
          {citation.ref}{citation.line ? `:${citation.line}` : ''}
        </span>
      ))}
    </div>
  )
}
