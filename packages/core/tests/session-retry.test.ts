import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ConversationHistory } from '../src/history.js'
import type { ModelProvider } from '../src/model-provider.js'
import { Session, type SessionEvents } from '../src/session.js'
import type { Message, ModelConfig, StreamChunk, ToolDefinition } from '../src/types.js'

class SequenceProvider implements ModelProvider {
  name = 'sequence'
  calls: Message[][] = []
  private index = 0

  constructor(private responses: string[]) {}

  async chat() {
    return { content: [], usage: { inputTokens: 0, outputTokens: 0 } }
  }

  async *stream(messages: Message[], _tools: ToolDefinition[], _config: ModelConfig): AsyncIterable<StreamChunk> {
    this.calls.push(messages.map((message) => ({ ...message, content: [...message.content] })))
    const text = this.responses[this.index++] ?? this.responses[this.responses.length - 1] ?? 'done'
    yield { type: 'text_delta', text }
    yield { type: 'message_end', usage: { inputTokens: 1, outputTokens: 1 } }
  }
}

function testEvents(overrides: Partial<SessionEvents> = {}): SessionEvents {
  return {
    onStreamChunk: () => {},
    onToolEvent: () => {},
    onMessageComplete: () => {},
    onError: (error) => { throw error },
    ...overrides,
  }
}

describe('Session retryLastTurn', () => {
  let history: ConversationHistory | undefined

  afterEach(() => {
    history?.close()
    history = undefined
  })

  it('removes the prior assistant response and reruns the latest user turn', async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), 'pudding-session-retry-'))
    history = new ConversationHistory(path.join(cwd, 'history.db'))
    await history.ensureReady()
    history.createSession('s1', 'Test', cwd)

    const provider = new SequenceProvider(['first', 'second'])
    const session = new Session(
      { id: 's1', projectName: 'Test', cwd, modelConfig: { model: 'test', maxTokens: 1000, contextWindow: 10000 } },
      provider,
      history,
    )

    const completed: Message[] = []
    await session.sendMessage('hello', testEvents({
      onMessageComplete: (message) => completed.push(message),
    }))

    expect(history.getMessages('s1').map((message) => message.role)).toEqual(['user', 'assistant'])
    expect((history.getMessages('s1')[1].content[0] as any).text).toBe('first')

    const replacements: Message[][] = []
    await session.retryLastTurn(testEvents({
      onMessagesReplaced: (messages) => replacements.push(messages),
      onMessageComplete: (message) => completed.push(message),
    }))

    const messages = history.getMessages('s1')
    expect(replacements).toHaveLength(1)
    expect(replacements[0].map((message) => message.role)).toEqual(['user'])
    expect(messages.map((message) => message.role)).toEqual(['user', 'assistant'])
    expect((messages[1].content[0] as any).text).toBe('second')
    expect(provider.calls[1].map((message) => message.role)).toEqual(['user'])
  })
})
