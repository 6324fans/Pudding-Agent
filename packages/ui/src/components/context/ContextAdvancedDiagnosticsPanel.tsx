import type { ContextInspectSnapshot, ContextProviderHealthItem, ContextRefreshSnapshot } from '../../lib/ipc-client'
import type { ContextRequestState } from '../../stores/context-store'
import { LongText, Metric, PanelHeader, PanelState, StatusPill } from './ContextCurrentPanel'

export function ContextAdvancedDiagnosticsPanel({ inspect, refresh, onReloadDiagnostics, onRefreshProviders }: {
  inspect: ContextRequestState<ContextInspectSnapshot>
  refresh: ContextRequestState<ContextRefreshSnapshot>
  onReloadDiagnostics: () => void
  onRefreshProviders: () => void
}) {
  const snapshot = inspect.data

  return (
    <details className="rounded-[6px] border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2.5">
      <summary className="cursor-pointer text-[11px] uppercase tracking-[0.1em] text-[var(--muted)] hover:text-[var(--text)]">
        高级诊断
      </summary>
      <div className="mt-3 space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onReloadDiagnostics}
            disabled={inspect.loading}
            className="rounded-[6px] border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-left text-[11px] text-[var(--text)] hover:border-[var(--accent)] disabled:opacity-60"
          >
            {inspect.loading ? '读取中' : '重新读取'}
          </button>
          <button
            type="button"
            onClick={onRefreshProviders}
            disabled={refresh.loading}
            className="rounded-[6px] border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-left text-[11px] text-[var(--text)] hover:border-[var(--accent)] disabled:opacity-60"
          >
            {refresh.loading ? '刷新中' : '刷新 provider'}
          </button>
        </div>

        {refresh.error && <PanelState title="刷新失败" message={refresh.error} />}
        {refresh.data && (
          <div className="grid grid-cols-2 gap-2">
            <Metric label="保存 facts" value={refresh.data.savedFactCount} />
            <Metric label="刷新时间" value={formatTime(refresh.data.refreshedAt)} />
          </div>
        )}

        <ProviderHealthList providers={snapshot?.providerHealth ?? null} loading={inspect.loading} error={inspect.error} />
        <MemoryReview snapshot={snapshot} />
        <DiagnosticsList diagnostics={[...(snapshot?.diagnostics ?? []), ...(refresh.data?.diagnostics ?? [])]} />
      </div>
    </details>
  )
}

function ProviderHealthList({ providers, loading, error }: {
  providers: ContextProviderHealthItem[] | null
  loading: boolean
  error: string | null
}) {
  if (loading) return <PanelState title="正在读取 provider" message="Context diagnostics" />
  if (error) return <PanelState title="Provider 暂不可用" message={error} />
  if (!providers) return <PanelState title="暂无 provider 状态" message="Context diagnostics" />

  return (
    <section className="space-y-2">
      <PanelHeader title="Provider health" />
      {providers.map((provider) => (
        <article key={provider.id} className="min-w-0 rounded-[6px] border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="break-words text-[12px] font-medium text-[var(--text)] [overflow-wrap:anywhere]">{provider.label}</div>
              <div className="mt-0.5 break-words text-[10px] uppercase tracking-[0.08em] text-[var(--muted)] [overflow-wrap:anywhere]">
                {provider.id} · {provider.factCount} facts · {formatTime(provider.updatedAt)}
              </div>
            </div>
            <StatusPill tone={toneForStatus(provider.status)}>{provider.status}</StatusPill>
          </div>

          {provider.details && (
            <div className="mt-2 grid gap-1.5 [grid-template-columns:repeat(auto-fit,minmax(90px,1fr))]">
              {Object.entries(provider.details).map(([key, value]) => (
                <Metric key={key} label={key} value={value == null ? '无' : String(value)} />
              ))}
            </div>
          )}

          {provider.diagnostics.length > 0 && (
            <ul className="mt-2 space-y-1">
              {provider.diagnostics.map((diagnostic) => (
                <li key={diagnostic} className="break-words text-[11px] text-[var(--warn)] [overflow-wrap:anywhere]">
                  {diagnostic}
                </li>
              ))}
            </ul>
          )}
        </article>
      ))}
    </section>
  )
}

function MemoryReview({ snapshot }: { snapshot: ContextInspectSnapshot | null }) {
  if (!snapshot) return null

  return (
    <section className="space-y-2">
      <PanelHeader title="Memory review" />
      <div className="grid grid-cols-2 gap-2">
        <Metric label="Memory" value={snapshot.memoryReview.available ? 'ready' : 'empty'} />
        <Metric label="Project facts" value={snapshot.memoryReview.storedProjectFacts.length} />
      </div>
      <div className="break-all rounded-[6px] border border-[var(--border)] bg-[var(--bg)] px-2.5 py-2 font-mono text-[10px] text-[var(--muted)]">
        {snapshot.memoryReview.memoryDir}
      </div>
      {snapshot.memoryReview.preview && <LongText text={snapshot.memoryReview.preview} />}
    </section>
  )
}

function DiagnosticsList({ diagnostics }: { diagnostics: string[] }) {
  const unique = [...new Set(diagnostics.filter(Boolean))]
  if (unique.length === 0) return null
  return (
    <section className="space-y-2">
      <PanelHeader title="Diagnostics" />
      <ul className="space-y-1">
        {unique.map((diagnostic) => (
          <li key={diagnostic} className="break-words text-[11px] text-[var(--warn)] [overflow-wrap:anywhere]">
            {diagnostic}
          </li>
        ))}
      </ul>
    </section>
  )
}

function toneForStatus(status: ContextProviderHealthItem['status']): 'good' | 'warn' | 'bad' | 'muted' {
  if (status === 'ok') return 'good'
  if (status === 'warning') return 'warn'
  if (status === 'error') return 'bad'
  return 'muted'
}

function formatTime(timestamp: number): string {
  if (!Number.isFinite(timestamp)) return '无'
  return new Date(timestamp).toLocaleTimeString()
}
