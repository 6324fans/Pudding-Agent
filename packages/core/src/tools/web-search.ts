import { parseHTML } from 'linkedom'
import { loadAppConfig } from '../config.js'
import type { ToolContext, ToolHandler, ToolResult } from '../tool-registry.js'

interface SearchResult {
  title: string
  url: string
  description: string
}

export const webSearchTool: ToolHandler = {
  definition: {
    name: 'web_search',
    description: `Search the web for current information. Returns titles, URLs, and snippets.

Usage notes:
- Use for information beyond your training data: current events, recent documentation, API references.
- Use this proactively for questions that require current/live information, including weather, prices, releases, and breaking news.
- You MUST always include a "Sources:" section at the end of your response with relevant URLs as markdown links.
- Use specific, descriptive queries rather than single keywords.
- If Brave Search is configured it will be used; otherwise a no-key DuckDuckGo HTML fallback is used.`,
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        count: { type: 'number', description: 'Number of results (default 5, max 20)' },
      },
      required: ['query'],
    },
  },
  async execute(input: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const query = input.query as string | undefined
    if (!query) return { content: 'Error: query is required', isError: true }
    const count = Math.min(Math.max((input.count as number) || 5, 1), 20)

    try {
      const results = await search(query, count, context.signal)
      const formatted = results
        .map(r => `- [${r.title}](${r.url})\n  ${r.description || ''}`)
        .join('\n\n')
      return { content: formatted || 'No results found.' }
    } catch (err: any) {
      return { content: `Error: ${err.message}`, isError: true }
    }
  },
}

async function search(query: string, count: number, signal?: AbortSignal): Promise<SearchResult[]> {
  const config = loadAppConfig()
  const apiKey = (config as any)?.webSearch?.braveApiKey
  if (apiKey) return searchBrave(query, count, apiKey, signal)
  return searchDuckDuckGo(query, count, signal)
}

async function searchBrave(query: string, count: number, apiKey: string, signal?: AbortSignal): Promise<SearchResult[]> {
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}`
  const response = await fetch(url, {
    headers: { 'X-Subscription-Token': apiKey, 'Accept': 'application/json' },
    signal: signal || AbortSignal.timeout(15000),
  })
  if (!response.ok) throw new Error(`Brave Search API returned ${response.status}`)
  const data = await response.json() as any
  return (data.web?.results || [])
    .map((r: any) => ({
      title: String(r.title || '').trim(),
      url: String(r.url || '').trim(),
      description: String(r.description || '').trim(),
    }))
    .filter((r: SearchResult) => r.title && r.url)
}

async function searchDuckDuckGo(query: string, count: number, signal?: AbortSignal): Promise<SearchResult[]> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
  const response = await fetch(url, {
    headers: { 'User-Agent': 'PUDDINGAGENT/1.0 (Desktop AI Assistant)' },
    signal: signal || AbortSignal.timeout(15000),
  })
  if (!response.ok) throw new Error(`DuckDuckGo search returned ${response.status}`)
  const html = await response.text()
  const { document } = parseHTML(html)
  const links = Array.from(document.querySelectorAll('a.result__a'))
  const results: SearchResult[] = []

  for (const link of links) {
    const title = (link.textContent || '').replace(/\s+/g, ' ').trim()
    const href = normalizeDuckDuckGoUrl(link.getAttribute('href') || '')
    const result = link.closest('.result')
    const description = (result?.querySelector('.result__snippet')?.textContent || '')
      .replace(/\s+/g, ' ')
      .trim()
    if (title && href) results.push({ title, url: href, description })
    if (results.length >= count) break
  }

  return results
}

function normalizeDuckDuckGoUrl(href: string): string {
  if (!href) return ''
  const absolute = href.startsWith('//') ? `https:${href}` : href
  try {
    const url = new URL(absolute)
    const redirected = url.searchParams.get('uddg')
    return redirected ? decodeURIComponent(redirected) : absolute
  } catch {
    return href
  }
}
