import { describe, expect, it } from 'vitest'
import { runSubSession } from '../src/sub-session.js'
import { ToolRegistry } from '../src/tool-registry.js'
import type { ContentBlock, Message, ModelConfig, StreamChunk, ToolDefinition } from '../src/types.js'
import type { ModelProvider } from '../src/model-provider.js'

class CompactAwareProvider implements ModelProvider {
  name = 'compact-aware'
  compactCalls = 0
  mainCalls = 0

  async chat(): Promise<{ content: ContentBlock[]; usage: { inputTokens: number; outputTokens: number } }> {
    return { content: [{ type: 'text', text: 'unused' }], usage: { inputTokens: 0, outputTokens: 0 } }
  }

  async *stream(messages: Message[], tools: ToolDefinition[], _config: ModelConfig): AsyncIterable<StreamChunk> {
    if (tools.length === 0) {
      this.compactCalls++
      yield { type: 'text_delta', text: '<summary>sub-session summary with archive handoff</summary>' }
      return
    }

    this.mainCalls++
    const compacted = messages.some(message =>
      message.content.some(block =>
        block.type === 'text' && block.text.includes('Context from prior conversation'),
      ),
    )
    if (compacted) {
      yield { type: 'text_delta', text: 'final after compact' }
      yield { type: 'message_end', usage: { inputTokens: 1, outputTokens: 1 } }
      return
    }

    yield { type: 'tool_use_start', toolUse: { id: `tool-${this.mainCalls}`, name: 'file_read', input: '' } }
    yield { type: 'tool_use_delta', toolUse: { id: `tool-${this.mainCalls}`, name: 'file_read', input: '{"path":"x"}' } }
    yield { type: 'tool_use_end' }
    yield { type: 'message_end', usage: { inputTokens: 10_000, outputTokens: 1 } }
  }
}

describe('runSubSession compaction', () => {
  it('compacts sub-session history and continues with the summary', async () => {
    const registry = new ToolRegistry()
    registry.register({
      definition: { name: 'file_read', description: 'Read', inputSchema: { type: 'object', properties: {} } },
      execute: async () => ({ content: 'tool evidence' }),
    })
    const provider = new CompactAwareProvider()
    const config: ModelConfig = {
      model: 'test',
      maxTokens: 1000,
      contextWindow: 1000,
      compressAt: 0.5,
    }

    const result = await runSubSession({
      prompt: 'do repeated work',
      provider,
      toolRegistry: registry,
      modelConfig: config,
      cwd: '/tmp',
      maxTurns: 10,
    })

    expect(result.status).toBe('completed')
    expect(result.content).toBe('final after compact')
    expect(provider.compactCalls).toBeGreaterThan(0)
  })
})
