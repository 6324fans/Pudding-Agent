import type { ToolCardRouterProps } from './ToolCardRouter'
import {
  IconPuddingGraph, IconPuddingSearch, IconPuddingCallers, IconPuddingCallees,
  IconPuddingImpact, IconPuddingTrace, IconFiles,
} from '../icons'
import { useEffect, useMemo, useState, type ComponentType, type CSSProperties } from 'react'
import { deriveToolStatus, type ToolStatus } from './tool-card-meta'

interface IconProps { size?: number; className?: string }

// Per-tool presentation: friendly label, icon, and how to summarize the input.
const TOOL_META: Record<string, {
  label: string
  Icon: ComponentType<IconProps>
  summary: (input: Record<string, unknown>) => string
}> = {
  PuddingContext: {
    label: '上下文检索', Icon: IconPuddingGraph,
    summary: (i) => str(i.task),
  },
  PuddingSearch: {
    label: '符号搜索', Icon: IconPuddingSearch,
    summary: (i) => str(i.query),
  },
  PuddingNode: {
    label: '符号详情', Icon: IconPuddingGraph,
    summary: (i) => str(i.symbol),
  },
  PuddingCallers: {
    label: '谁调用了它', Icon: IconPuddingCallers,
    summary: (i) => str(i.symbol),
  },
  PuddingCallees: {
    label: '它调用了谁', Icon: IconPuddingCallees,
    summary: (i) => str(i.symbol),
  },
  PuddingImpact: {
    label: '影响半径', Icon: IconPuddingImpact,
    summary: (i) => str(i.symbol),
  },
  PuddingTrace: {
    label: '调用路径', Icon: IconPuddingTrace,
    summary: (i) => `${str(i.from)} → ${str(i.to)}`,
  },
  PuddingExplore: {
    label: '批量源码', Icon: IconFiles,
    summary: (i) => Array.isArray(i.symbols) ? (i.symbols as unknown[]).map(String).join(', ') : '',
  },
  PuddingFiles: {
    label: '项目文件', Icon: IconFiles,
    summary: (i) => str(i.path) || '全部',
  },
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v)
}

// Count how many symbol rows ("- kind name — file:line") are in the result,
// to show a quick "N results" hint in the header.
function countResultRows(content: string): number {
  let n = 0
  for (const line of content.split('\n')) {
    if (/^\s*[-→]\s+\S/.test(line)) n++
  }
  return n
}

function repoWikiSummary(content: string): string {
  if (!content.trim()) return ''
  try {
    const parsed = JSON.parse(content) as { repoWiki?: { activeEntries?: unknown; staleEntries?: unknown; lastModelId?: unknown }; bundle?: { sections?: Array<{ kind?: unknown }> } }
    const repoWiki = parsed.repoWiki
    const hasRepoWikiSection = Array.isArray(parsed.bundle?.sections) && parsed.bundle.sections.some((section) => section.kind === 'repo_wiki')
    if (!repoWiki && !hasRepoWikiSection) return ''
    const parts = ['仓库 Wiki']
    if (typeof repoWiki?.activeEntries === 'number') parts.push(`${repoWiki.activeEntries} 可用`)
    if (typeof repoWiki?.staleEntries === 'number') parts.push(`${repoWiki.staleEntries} 过期`)
    if (typeof repoWiki?.lastModelId === 'string' && repoWiki.lastModelId) parts.push(repoWiki.lastModelId)
    return parts.join(' · ')
  } catch {
    return /repo_wiki/.test(content) ? '仓库 Wiki' : ''
  }
}

function truncate(value: string, max = 52): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized
}

function phaseLabel(status: ToolStatus): string {
  if (status === 'running') return '正在理解项目'
  if (status === 'error') return '理解失败'
  return '已理解项目'
}

function statusLabel(status: ToolStatus): string {
  if (status === 'running') return '运行中'
  if (status === 'error') return '异常'
  return '完成'
}

export function PuddingToolCard({ event, input, result, name }: ToolCardRouterProps) {
  const status = deriveToolStatus(event, result)

  const toolName = event?.toolName || name || ''
  const meta = TOOL_META[toolName] ?? {
    label: toolName.replace(/^Pudding/, ''), Icon: IconPuddingGraph, summary: () => '',
  }

  const toolInput = (event?.input || input || {}) as Record<string, unknown>
  const content = event?.result?.content || result?.content || ''
  const summary = meta.summary(toolInput)
  const rowCount = status === 'done' && content ? countResultRows(content) : 0
  const wikiSummary = status === 'done' ? repoWikiSummary(content) : ''
  const detailParts = [
    phaseLabel(status),
    meta.label,
    wikiSummary || (summary ? truncate(summary) : ''),
    rowCount > 0 ? `${rowCount} 项` : '',
  ].filter(Boolean)
  const showRail = status !== 'done'
  const livenessClass = 'is-live'
  const robotGazeStyle = useRobotGaze(String((event as any)?.toolUseId || toolName || summary || 'pudding-context-engine'))

  return (
    <div
      className="pudding-event-card mb-2 pudding-engine-card pudding-engine-card-blackbox pudding-engine-card-premium"
      data-status={status}
      data-expanded="false"
      data-rail={showRail ? 'true' : 'false'}
      data-variant="pudding"
    >
      {showRail && <div className="pudding-event-rail" aria-hidden="true" />}
      <div className="pudding-engine-shell">
        <span className={`pudding-engine-robot ${livenessClass}`} aria-hidden="true">
          <span className="pudding-engine-robot-antenna" />
          <span className="pudding-engine-robot-face">
            <span className="pudding-engine-robot-eyes" style={robotGazeStyle}>
              <span className="pudding-engine-robot-eye" />
              <span className="pudding-engine-robot-eye" />
            </span>
          </span>
          <span className="pudding-engine-robot-base" />
        </span>
        <span className="pudding-engine-copy">
          <span className="pudding-engine-title">Pudding Context Engine</span>
          <span className="pudding-engine-subtitle" title={detailParts.join(' · ')}>
            {detailParts.join(' · ')}
          </span>
        </span>
        {status === 'running' && (
          <span className={`pudding-engine-signal ${livenessClass}`} aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
        )}
        <span className="pudding-event-chip">{statusLabel(status)}</span>
      </div>
    </div>
  )
}

function useRobotGaze(seed: string): CSSProperties {
  const [gaze, setGaze] = useState(() => seededGaze(seed))

  useEffect(() => {
    let cancelled = false
    let timer: number | undefined
    const tick = () => {
      timer = window.setTimeout(() => {
        if (cancelled) return
        setGaze(randomGaze())
        tick()
      }, 1_700 + Math.random() * 2_400)
    }
    tick()
    return () => {
      cancelled = true
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [seed])

  return useMemo(() => ({
    '--pudding-robot-eye-x': `${gaze.x}px`,
    '--pudding-robot-eye-y': `${gaze.y}px`,
  }) as CSSProperties, [gaze.x, gaze.y])
}

function randomGaze(): { x: number; y: number } {
  return {
    x: rounded((Math.random() * 4) - 2),
    y: rounded((Math.random() * 4) - 2),
  }
}

function seededGaze(seed: string): { x: number; y: number } {
  let hash = 0
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0
  }
  return {
    x: rounded(((hash % 41) / 10) - 2),
    y: rounded((((hash >>> 6) % 41) / 10) - 2),
  }
}

function rounded(value: number): number {
  return Math.round(value * 10) / 10
}
