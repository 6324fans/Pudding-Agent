import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { ToolHandler } from '../src/tool-registry.js'

describe('webSearchTool', () => {
  let homeDir: string
  let fetchMock: ReturnType<typeof vi.fn>
  let webSearchTool: ToolHandler

  beforeEach(async () => {
    homeDir = mkdtempSync(path.join(tmpdir(), 'pudding-web-search-'))
    vi.stubEnv('HOME', homeDir)
    vi.stubEnv('USERPROFILE', homeDir)
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    vi.resetModules()
    webSearchTool = (await import('../src/tools/web-search.js')).webSearchTool
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    rmSync(homeDir, { recursive: true, force: true })
  })

  it('has correct definition', () => {
    expect(webSearchTool.definition.name).toBe('web_search')
    expect(webSearchTool.definition.inputSchema.required).toContain('query')
  })

  it('uses DuckDuckGo fallback when no search provider is configured', async () => {
    fetchMock.mockResolvedValueOnce(new Response(`
      <html>
        <body>
          <div class="result">
            <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fdocs">Example Docs</a>
            <a class="result__snippet">Current documentation snippet.</a>
          </div>
        </body>
      </html>
    `, { status: 200 }))

    const result = await webSearchTool.execute(
      { query: 'test query' },
      { cwd: '/tmp' },
    )

    expect(result.isError).toBeUndefined()
    expect(result.content).toContain('[Example Docs](https://example.com/docs)')
    expect(result.content).toContain('Current documentation snippet.')
    expect(fetchMock).toHaveBeenCalledWith(
      'https://html.duckduckgo.com/html/?q=test%20query',
      expect.objectContaining({
        headers: { 'User-Agent': 'PUDDINGAGENT/1.0 (Desktop AI Assistant)' },
      }),
    )
  })

  it('returns a clear error when a selected API provider has no key', async () => {
    writeConfig({ webSearch: { provider: 'tavily' } })

    const result = await webSearchTool.execute(
      { query: 'test query' },
      { cwd: '/tmp' },
    )

    expect(result.isError).toBe(true)
    expect(result.content).toContain('Tavily Search is selected but its API key is not configured')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('uses Brave Search when configured and preserves markdown result schema', async () => {
    writeConfig({ webSearch: { provider: 'brave', braveApiKey: 'brave-key' } })
    fetchMock.mockResolvedValueOnce(Response.json({
      web: {
        results: [
          { title: 'Brave Result', url: 'https://brave.example/result', description: 'Brave snippet' },
        ],
      },
    }))

    const result = await webSearchTool.execute(
      { query: 'latest api', count: 3 },
      { cwd: '/tmp' },
    )

    expect(result.isError).toBeUndefined()
    expect(result.content).toBe('- [Brave Result](https://brave.example/result)\n  Brave snippet')
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.search.brave.com/res/v1/web/search?q=latest%20api&count=3',
      expect.objectContaining({
        headers: { 'X-Subscription-Token': 'brave-key', 'Accept': 'application/json' },
      }),
    )
  })
})

function writeConfig(config: Record<string, unknown>): void {
  const configDir = path.join(process.env.HOME!, '.puddingagent')
  mkdirSync(configDir, { recursive: true })
  writeFileSync(path.join(configDir, 'config.json'), JSON.stringify(config), 'utf-8')
}
