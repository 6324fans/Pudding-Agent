import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PuddingToolCard } from './PuddingToolCard'

describe('PuddingToolCard', () => {
  it('renders Pudding code tools as a non-expandable black-box status card', () => {
    const html = renderToStaticMarkup(
      <PuddingToolCard
        event={{
          type: 'complete',
          toolName: 'PuddingContext',
          toolUseId: 'tool-pudding-1',
          input: { task: 'Pudding Context Engine 的 engine.ts 是如何工作的' },
          result: {
            content: 'LARGE RAW RESULT\npackages/core/src/context-engine/engine.ts\nhandleMessage\n'.repeat(30),
            isError: false,
          },
        } as any}
      />,
    )

    expect(html).toContain('Pudding Context Engine')
    expect(html).toContain('已理解项目')
    expect(html).toContain('上下文检索')
    expect(html).toContain('pudding-engine-robot')
    expect(html).toContain('pudding-engine-robot-eyes')
    expect(html).toContain('--pudding-robot-eye-x')
    expect(html).not.toContain('pudding-engine-signal')
    expect(html).not.toContain('aria-expanded')
    expect(html).not.toContain('复制结果')
    expect(html).not.toContain('pudding-engine-result')
    expect(html).not.toContain('LARGE RAW RESULT')
    expect(html).not.toContain('packages/core/src/context-engine/engine.ts')
  })

  it('keeps the robot active on completed cards while reserving the signal dots for running cards', () => {
    const doneHtml = renderToStaticMarkup(
      <PuddingToolCard
        event={{
          type: 'complete',
          toolName: 'PuddingSearch',
          toolUseId: 'tool-pudding-done',
          input: { query: 'memorySearch' },
          result: { content: '- function memorySearch — src/a.ts:1', isError: false },
        } as any}
      />,
    )
    const runningHtml = renderToStaticMarkup(
      <PuddingToolCard
        event={{
          type: 'progress',
          toolName: 'PuddingSearch',
          toolUseId: 'tool-pudding-running',
          input: { query: 'memorySearch' },
          result: { content: '', isError: false },
        } as any}
      />,
    )

    expect(doneHtml).not.toContain('pudding-engine-signal')
    expect(doneHtml).toContain('pudding-engine-robot is-live')
    expect(runningHtml).toContain('pudding-engine-signal is-live')
    expect(runningHtml).toContain('pudding-engine-robot is-live')
  })

  it('keeps running Pudding cards compact without exposing partial raw output', () => {
    const html = renderToStaticMarkup(
      <PuddingToolCard
        event={{
          type: 'progress',
          toolName: 'PuddingSearch',
          toolUseId: 'tool-pudding-2',
          input: { query: 'handleMessage' },
          result: {
            content: 'PARTIAL RAW RESULT handleMessage',
            isError: false,
          },
        } as any}
      />,
    )

    expect(html).toContain('正在理解项目')
    expect(html).toContain('符号搜索')
    expect(html).toContain('data-status="running"')
    expect(html).toContain('pudding-engine-signal')
    expect(html).not.toContain('PARTIAL RAW RESULT')
    expect(html).not.toContain('aria-expanded')
  })

  it('summarizes repo wiki sections without dumping raw inspect blobs', () => {
    const html = renderToStaticMarkup(
      <PuddingToolCard
        event={{
          type: 'complete',
          toolName: 'PuddingContextInspect',
          toolUseId: 'tool-pudding-inspect',
          input: { includeRepoWikiSamples: true },
          result: {
            content: JSON.stringify({
              repoWiki: { activeEntries: 2, staleEntries: 1, lastModelId: 'claude-sonnet-4', lastDiagnostic: 'citation stale' },
              bundle: { sections: [{ kind: 'repo_wiki', title: 'Repo Wiki', content: 'RAW HIDDEN REASONING SHOULD NOT RENDER', sourceProvider: 'RepoWikiProvider' }] },
            }),
            isError: false,
          },
        } as any}
      />,
    )

    expect(html).toContain('仓库 Wiki')
    expect(html).toContain('2 可用')
    expect(html).toContain('1 过期')
    expect(html).toContain('claude-sonnet-4')
    expect(html).not.toContain('RAW HIDDEN REASONING SHOULD NOT RENDER')
    expect(html).not.toContain('citation stale')
  })
})
