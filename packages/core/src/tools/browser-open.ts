import type { ToolContext, ToolHandler, ToolResult } from '../tool-registry.js'

export type BrowserOpenCallback = (url: string) => Promise<void> | void

export function createBrowserOpenTool(openUrl: BrowserOpenCallback): ToolHandler {
  return {
    definition: {
      name: 'browser_open',
      description: 'Open a URL in the user\'s system browser. Use this when the user asks to open a page or when visual inspection in a browser is useful. Use web_fetch to read page text content.',
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to open. Must start with http:// or https://.' },
        },
        required: ['url'],
      },
    },
    async execute(input: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
      const url = String(input.url || '').trim()
      if (!url) return { content: 'Error: url is required', isError: true }
      let parsed: URL
      try {
        parsed = new URL(url)
      } catch {
        return { content: 'Error: invalid URL', isError: true }
      }
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return { content: 'Error: only http:// and https:// URLs can be opened', isError: true }
      }
      await openUrl(parsed.toString())
      return { content: `Opened ${parsed.toString()}` }
    },
  }
}
