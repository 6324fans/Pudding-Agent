import { describe, it, expect } from 'vitest'
import { AnthropicProvider } from '../src/providers/anthropic.js'

describe('AnthropicProvider', () => {
  it('should instantiate with an API key', () => {
    const provider = new AnthropicProvider('test-key')
    expect(provider.name).toBe('anthropic')
  })

  it('should format messages correctly', () => {
    const provider = new AnthropicProvider('test-key')
    const formatted = (provider as any).formatMessages([
      { id: '1', role: 'user', content: [{ type: 'text', text: 'hello' }], timestamp: Date.now() },
      { id: '2', role: 'system', content: [{ type: 'text', text: 'sys' }], timestamp: Date.now() },
    ])
    expect(formatted).toHaveLength(1)
    expect(formatted[0].role).toBe('user')
    expect(formatted[0].content[0]).toMatchObject({ type: 'text', text: 'hello' })
  })

  it('should map content blocks', () => {
    const provider = new AnthropicProvider('test-key')
    const textBlock = (provider as any).mapContentBlock({ type: 'text', text: 'hi' })
    expect(textBlock).toEqual({ type: 'text', text: 'hi' })

    const toolBlock = (provider as any).mapContentBlock({ type: 'tool_use', id: 'x', name: 'bash', input: { cmd: 'ls' } })
    expect(toolBlock).toEqual({ type: 'tool_use', id: 'x', name: 'bash', input: { cmd: 'ls' } })
  })

  it('keeps images attached to tool result turns', () => {
    const provider = new AnthropicProvider('test-key')
    const formatted = (provider as any).formatMessages([
      { id: '1', role: 'assistant', content: [{ type: 'tool_use', id: 'tc1', name: 'computer_get_app_state', input: {} }], timestamp: 0 },
      {
        id: '2',
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'tc1', content: 'screenshot_image: attached' },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'abc' } },
        ],
        timestamp: 0,
      },
    ])

    const userTurn = formatted.find((message: any) => (
      message.role === 'user' &&
      Array.isArray(message.content) &&
      message.content.some((block: any) => block.type === 'tool_result')
    ))
    expect(userTurn.content[0]).toEqual({ type: 'tool_result', tool_use_id: 'tc1', content: 'screenshot_image: attached' })
    expect(userTurn.content[1]).toMatchObject({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'abc' } })
  })
})
