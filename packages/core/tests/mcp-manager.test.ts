import { describe, it, expect } from 'vitest'
import { McpManager } from '../src/mcp/manager.js'

const ONE_PIXEL_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII='

describe('McpManager', () => {
  it('initializes with empty state', () => {
    const manager = new McpManager()
    expect(manager.getServerStates()).toEqual([])
  })

  it('reports disabled servers', async () => {
    const manager = new McpManager()
    await manager.loadConfig({
      disabled: { transport: 'stdio', command: 'echo', args: [], disabled: true }
    })
    const states = manager.getServerStates()
    expect(states).toHaveLength(1)
    expect(states[0].status).toBe('disabled')
  })

  it('getTools returns empty when no servers connected', () => {
    const manager = new McpManager()
    expect(manager.getTools()).toEqual([])
  })

  it('close is safe to call multiple times', async () => {
    const manager = new McpManager()
    await manager.close()
    await manager.close()
  })

  it('callTool returns error for invalid tool name', async () => {
    const manager = new McpManager()
    const result = await manager.callTool('invalid_name', {})
    expect(result.isError).toBe(true)
    expect(result.content).toContain('Invalid MCP tool name')
  })

  it('callTool returns error for disconnected server', async () => {
    const manager = new McpManager()
    const result = await manager.callTool('mcp__nonexistent__tool', {})
    expect(result.isError).toBe(true)
    expect(result.content).toContain('not connected')
  })

  it('reports failed status when connection fails', async () => {
    const manager = new McpManager()
    await manager.connectServer('bad', { transport: 'stdio', command: 'nonexistent-command-xyz', args: [] })
    const states = manager.getServerStates()
    expect(states[0].status).toBe('failed')
    expect(states[0].error).toBeDefined()
  })

  it('converts MCP image content into image blocks instead of text', async () => {
    const manager = new McpManager()
    setMockServer(manager, [
      { type: 'text', text: 'state' },
      { type: 'image', data: ONE_PIXEL_PNG, mimeType: 'image/png' },
    ])

    const result = await manager.callTool('mcp__mock__get_app_state', {})

    expect(result.content).toBe('state\n[image 1: image/png]')
    expect(result.images).toHaveLength(1)
    expect(result.images?.[0]?.source.media_type).toBe('image/png')
    expect(result.images?.[0]?.source.data).toBeTruthy()
  })

  it('truncates oversized MCP text results before returning them to the model', async () => {
    const manager = new McpManager()
    const text = `${'a'.repeat(70000)}middle${'z'.repeat(70000)}`
    setMockServer(manager, [{ type: 'text', text }])

    const result = await manager.callTool('mcp__mock__dump', {})

    expect(result.content.length).toBeLessThan(text.length)
    expect(result.content).toContain('MCP tool result truncated')
    expect(result.content.startsWith('aaaa')).toBe(true)
    expect(result.content.endsWith('zzzz')).toBe(true)
  })

  it('does not stringify failed MCP image blocks back into text', async () => {
    const manager = new McpManager()
    setMockServer(manager, [{ type: 'image', data: 'not-valid-image-data', mimeType: 'image/png' }])

    const result = await manager.callTool('mcp__mock__get_app_state', {})

    expect(result.images).toEqual([])
    expect(result.content).toBe('[image omitted: unsupported MCP image content]')
    expect(result.content).not.toContain('not-valid-image-data')
  })
})

function setMockServer(manager: McpManager, content: unknown[]) {
  ;(manager as unknown as { servers: Map<string, unknown> }).servers.set('mock', {
    name: 'mock',
    config: { transport: 'stdio', command: 'mock', args: [] },
    client: {
      callTool: async () => ({ content, isError: false }),
      close: async () => {},
    },
    transport: null,
    tools: [],
    status: 'connected',
  })
}
