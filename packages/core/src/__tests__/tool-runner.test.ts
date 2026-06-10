import { describe, it, expect, vi } from 'vitest'
import { ToolRunner } from '../tool-runner.js'
import { ToolRegistry } from '../tool-registry.js'
import { PermissionChecker } from '../permissions.js'

function makeRunner(cwd: string) {
  const registry = new ToolRegistry()
  const captured: Record<string, unknown>[] = []
  registry.register({
    definition: {
      name: 'mcp__other__thing',
      description: '',
      inputSchema: { type: 'object', properties: {} },
    },
    async execute(input) {
      captured.push(input)
      return { content: 'ok' }
    },
  })
  const runner = new ToolRunner(registry, cwd, new PermissionChecker('relaxed'))
  return { runner, captured }
}

describe('ToolRunner — MCP input forwarding', () => {
  it('forwards MCP tool input unchanged', async () => {
    const cwd = '/tmp/proj-A'
    const { runner, captured } = makeRunner(cwd)
    await runner.execute('mcp__other__thing', 'tu1', { x: 1 }, () => {})
    expect(captured[0]).toEqual({ x: 1 })
  })
})

describe('ToolRunner required argument guard', () => {
  it('reports an error when required arguments are missing', async () => {
    const registry = new ToolRegistry()
    const execute = vi.fn(async () => ({ content: 'should not run' }))
    registry.register({
      definition: {
        name: 'file_read',
        description: '',
        inputSchema: {
          type: 'object',
          properties: { file_path: { type: 'string' } },
          required: ['file_path'],
        },
      },
      execute,
    })
    const runner = new ToolRunner(registry, '/tmp/proj-A', new PermissionChecker('relaxed'))
    const onEvent = vi.fn()

    const result = await runner.execute('file_read', 'tu1', {}, onEvent)

    expect(execute).not.toHaveBeenCalled()
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'error', toolName: 'file_read', toolUseId: 'tu1' }))
    expect(result.isError).toBe(true)
    expect(result.metadata?.suppressedToolCall).toEqual({
      reason: 'missing_required_arguments',
      missing: ['file_path'],
    })
    expect(result.content).toContain('缺少必填参数：file_path')
  })

  it('treats blank strings and empty arrays as missing required arguments', async () => {
    const registry = new ToolRegistry()
    const execute = vi.fn(async () => ({ content: 'should not run' }))
    registry.register({
      definition: {
        name: 'todo_write',
        description: '',
        inputSchema: {
          type: 'object',
          properties: { title: { type: 'string' }, todos: { type: 'array' } },
          required: ['title', 'todos'],
        },
      },
      execute,
    })
    const runner = new ToolRunner(registry, '/tmp/proj-A', new PermissionChecker('relaxed'))

    const result = await runner.execute('todo_write', 'tu1', { title: '   ', todos: [] }, () => {})

    expect(execute).not.toHaveBeenCalled()
    expect(result.isError).toBe(true)
    expect(result.metadata?.suppressedToolCall?.missing).toEqual(['title', 'todos'])
  })
})
