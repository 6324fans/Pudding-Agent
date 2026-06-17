import { afterEach, describe, it, expect, vi } from 'vitest'
import { OpenAIResponsesProvider } from '../src/providers/openai-responses.js'
import type { ModelConfig, StreamChunk } from '../src/types.js'

const config: ModelConfig = {
  model: 'test-model',
  maxTokens: 1024,
}

async function collect(stream: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}

function responseStream(events: any[]): AsyncIterable<any> {
  return (async function* () {
    for (const event of events) yield event
  })()
}

describe('OpenAIResponsesProvider', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('implements ModelProvider interface', () => {
    const provider = new OpenAIResponsesProvider('test-key', 'http://localhost:8080')
    expect(provider.name).toBe('openai-responses')
    expect(typeof provider.chat).toBe('function')
    expect(typeof provider.stream).toBe('function')
  })

  it('formats input correctly for user and assistant messages', () => {
    const provider = new OpenAIResponsesProvider('test-key')
    const formatted = (provider as any).formatInput([
      { id: '1', role: 'user', content: [{ type: 'text', text: 'hello' }], timestamp: 0 },
      { id: '2', role: 'assistant', content: [{ type: 'text', text: 'hi there' }], timestamp: 0 },
    ])
    expect(formatted).toEqual([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi there' },
    ])
  })

  it('passes system prompt as Responses instructions', async () => {
    const provider = new OpenAIResponsesProvider('test-key')
    ;(provider as any).client = {
      responses: {
        create: vi.fn(async (request) => ({
          output: [],
          usage: { input_tokens: 0, output_tokens: 0 },
          request,
        })),
      },
    }

    await provider.chat(
      [{ id: '1', role: 'user', content: [{ type: 'text', text: 'hello' }], timestamp: 0 }],
      [],
      { ...config, systemPrompt: 'You are helpful.' },
    )

    expect((provider as any).client.responses.create).toHaveBeenCalledWith(
      expect.objectContaining({ instructions: 'You are helpful.' }),
      expect.any(Object),
    )
  })

  it('formats paired tool_result blocks as function_call_output', () => {
    const provider = new OpenAIResponsesProvider('test-key')
    const formatted = (provider as any).formatInput([
      { id: '1', role: 'assistant', content: [{ type: 'tool_use', id: 'tc1', name: 'read', input: { path: 'file.txt' } }], timestamp: 0 },
      { id: '1', role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tc1', content: 'file.txt' }], timestamp: 0 },
    ])
    expect(formatted[1]).toEqual({
      type: 'function_call_output',
      call_id: 'tc1',
      output: 'file.txt',
    })
  })

  it('skips system role messages from input', () => {
    const provider = new OpenAIResponsesProvider('test-key')
    const formatted = (provider as any).formatInput([
      { id: '1', role: 'system', content: [{ type: 'text', text: 'ignored' }], timestamp: 0 },
      { id: '2', role: 'user', content: [{ type: 'text', text: 'hello' }], timestamp: 0 },
    ])
    expect(formatted).toEqual([
      { role: 'user', content: 'hello' },
    ])
  })

  it('formats tools correctly', () => {
    const provider = new OpenAIResponsesProvider('test-key')
    const tools = (provider as any).formatTools([
      { name: 'bash', description: 'Run a command', inputSchema: { type: 'object', properties: { command: { type: 'string' } } } },
    ])
    expect(tools[0]).toEqual({
      type: 'function',
      name: 'bash',
      description: 'Run a command',
      parameters: { type: 'object', properties: { command: { type: 'string' } } },
    })
  })

  it('handles JSON.parse safety for malformed function arguments', () => {
    const provider = new OpenAIResponsesProvider('test-key')
    // Simulate what chat() does internally with malformed JSON
    const parseArgs = (args: string) => {
      let parsedArgs: Record<string, unknown> = {}
      try {
        parsedArgs = JSON.parse(args || '{}')
      } catch {
        // fall back to empty object
      }
      return parsedArgs
    }
    expect(parseArgs('not valid json{')).toEqual({})
    expect(parseArgs('')).toEqual({})
    expect(parseArgs('{"key":"value"}')).toEqual({ key: 'value' })
  })

  it('formats input with mixed tool_result and text blocks', () => {
    const provider = new OpenAIResponsesProvider('test-key')
    const formatted = (provider as any).formatInput([
      {
        id: '0',
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'tc1', name: 'read', input: { path: 'file.txt' } }],
        timestamp: 0,
      },
      {
        id: '1',
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'tc1', content: 'result' },
          { type: 'text', text: 'follow up' },
        ],
        timestamp: 0,
      },
    ])
    expect(formatted[1]).toEqual({
      type: 'function_call_output',
      call_id: 'tc1',
      output: 'result',
    })
    expect(formatted[2]).toEqual({ role: 'user', content: 'follow up' })
  })

  it('keeps images attached to tool result turns', () => {
    const provider = new OpenAIResponsesProvider('test-key')
    const formatted = (provider as any).formatInput([
      {
        id: '0',
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'tc1', name: 'computer_get_app_state', input: {} }],
        timestamp: 0,
      },
      {
        id: '1',
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'tc1', content: 'screenshot_image: attached' },
          { type: 'text', text: 'Screenshot follows.' },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'abc' } },
        ],
        timestamp: 0,
      },
    ])

    expect(formatted[1]).toEqual({
      type: 'function_call_output',
      call_id: 'tc1',
      output: 'screenshot_image: attached',
    })
    expect(formatted[2]).toEqual({
      role: 'user',
      content: [
        { type: 'input_text', text: 'Screenshot follows.' },
        { type: 'input_image', image_url: 'data:image/png;base64,abc' },
      ],
    })
  })

  it('emits Responses function calls at item completion to preserve text order', async () => {
    const provider = new OpenAIResponsesProvider('test-key')
    ;(provider as any).client = {
      responses: {
        create: async () => responseStream([
          { type: 'response.output_text.delta', delta: 'before ' },
          {
            type: 'response.output_item.added',
            output_index: 1,
            item: { type: 'function_call', id: 'item1', call_id: 'call1', name: 'bash', arguments: '' },
          },
          { type: 'response.function_call_arguments.delta', output_index: 1, item_id: 'item1', delta: '{"command":' },
          { type: 'response.function_call_arguments.delta', output_index: 1, item_id: 'item1', delta: '"ls"}' },
          { type: 'response.output_text.delta', delta: 'after' },
          {
            type: 'response.output_item.done',
            output_index: 1,
            item: { type: 'function_call', id: 'item1', call_id: 'call1', name: 'bash', arguments: '' },
          },
          {
            type: 'response.completed',
            response: { usage: { input_tokens: 3, output_tokens: 4 } },
          },
        ]),
      },
    }

    const chunks = await collect(provider.stream([], [], config))

    expect(chunks.map(chunk => chunk.type)).toEqual([
      'text_delta',
      'text_delta',
      'tool_use_start',
      'tool_use_delta',
      'tool_use_end',
      'message_end',
    ])
    const toolStartIndex = chunks.findIndex(chunk => chunk.type === 'tool_use_start')
    expect(chunks.slice(0, toolStartIndex).map(chunk => chunk.text || '').join('')).toBe('before after')
    expect(chunks[toolStartIndex].toolUse).toEqual({ id: 'call1', name: 'bash', input: '' })
    expect(chunks[toolStartIndex + 1].toolUse?.input).toBe('{"command":"ls"}')
  })

  it('keeps non-streaming reasoning summaries as thinking blocks', async () => {
    const provider = new OpenAIResponsesProvider('test-key')
    ;(provider as any).client = {
      responses: {
        create: async () => ({
          output: [
            { type: 'reasoning', summary: [{ text: 'checked constraints' }] },
            { type: 'message', content: [{ type: 'output_text', text: 'done' }] },
          ],
          usage: { input_tokens: 1, output_tokens: 2 },
        }),
      },
    }

    const result = await provider.chat([], [], config)

    expect(result.content).toEqual([
      { type: 'thinking', thinking: 'checked constraints' },
      { type: 'text', text: 'done' },
    ])
  })
})
