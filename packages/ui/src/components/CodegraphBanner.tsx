import { useCodegraph } from '../hooks/useCodegraph'

interface Props {
  cwd: string
}

export function CodegraphBanner({ cwd }: Props) {
  const codegraph = useCodegraph(cwd)

  if (codegraph.status === 'hidden' || !cwd) return null

  const base = 'flex items-center gap-2 px-3 py-2 rounded-[8px] text-[12px] transition-all'

  return (
    <div className="px-4 pb-2 flex justify-start">
      {codegraph.status === 'idle' && (
        <div className={`${base} border border-[var(--border)] bg-[var(--surface)]`}>
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--muted)]" />
          <span className="text-[var(--muted)]">代码图谱未建立</span>
          <button
            type="button"
            onClick={codegraph.run}
            className="ml-1 px-2 py-0.5 rounded-[4px] bg-[var(--accent)] text-[var(--accent-ink)] hover:opacity-90 transition-opacity"
          >
            建立索引
          </button>
        </div>
      )}

      {codegraph.status === 'indexing' && (
        <div className={`${base} border border-[var(--border)] bg-[var(--surface)]`}>
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)] animate-pulse" />
          <span className="text-[var(--text)]" style={{ fontFamily: 'var(--font-mono)' }}>
            {codegraph.progress || '正在索引...'}
          </span>
        </div>
      )}

      {codegraph.status === 'ready' && (
        <div className={`${base} border border-[var(--good)]/20 bg-[var(--surface)]`}>
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--good)]" />
          <span className="text-[var(--good)]">代码图谱已就绪</span>
          <button
            type="button"
            onClick={codegraph.run}
            className="ml-1 text-[var(--muted)] hover:text-[var(--text)] transition-colors"
          >
            重建
          </button>
        </div>
      )}

      {codegraph.status === 'error' && (
        <div className={`${base} border border-[var(--bad)]/20 bg-[var(--surface)]`}>
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--bad)]" />
          <span className="text-[var(--bad)] truncate max-w-[200px]">{codegraph.error || '索引失败'}</span>
          <button
            type="button"
            onClick={codegraph.run}
            className="ml-1 px-2 py-0.5 rounded-[4px] border border-[var(--bad)]/30 text-[var(--bad)] hover:bg-[var(--bad)]/5 transition-colors"
          >
            重试
          </button>
        </div>
      )}
    </div>
  )
}
