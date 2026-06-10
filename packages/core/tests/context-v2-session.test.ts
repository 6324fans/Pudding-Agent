import { mkdirSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createContextFactStore } from '../src/context-v2/store.js'
import { ConversationHistory } from '../src/history.js'
import type { ModelProvider } from '../src/model-provider.js'
import { Session, type SessionEvents } from '../src/session.js'
import type { Message, ModelConfig, PromptSegment, StreamChunk, ToolDefinition } from '../src/types.js'

class PromptCaptureProvider implements ModelProvider {
  name = 'prompt-capture'
  systemPrompt: string | PromptSegment[] | undefined

  async chat() {
    return { content: [], usage: { inputTokens: 0, outputTokens: 0 } }
  }

  async *stream(_messages: Message[], _tools: ToolDefinition[], config: ModelConfig): AsyncIterable<StreamChunk> {
    this.systemPrompt = config.systemPrompt
    yield { type: 'text_delta', text: 'ok' }
    yield { type: 'message_end', usage: { inputTokens: 1, outputTokens: 1 } }
  }
}

function testEvents(): SessionEvents {
  return {
    onStreamChunk: () => {},
    onToolEvent: () => {},
    onMessageComplete: () => {},
    onError: (error) => { throw error },
  }
}

describe('Session Context V2 prompt injection', () => {
  let history: ConversationHistory | undefined
  const originalConfigDir = process.env.PUDDINGAGENT_CONFIG_DIR

  afterEach(() => {
    history?.close()
    history = undefined
    if (originalConfigDir === undefined) {
      delete process.env.PUDDINGAGENT_CONFIG_DIR
    } else {
      process.env.PUDDINGAGENT_CONFIG_DIR = originalConfigDir
    }
  })

  it('injects Context V2 facts after the assembled system prompt', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'pudding-context-v2-session-'))
    const cwd = path.join(root, 'repo')
    const configDir = path.join(root, 'config')
    mkdirSync(cwd)
    process.env.PUDDINGAGENT_CONFIG_DIR = configDir

    const store = createContextFactStore({ cwd, configDir, now: () => 1000 })
    await store.saveFact({
      id: 'billing-release',
      kind: 'project',
      scope: 'project',
      title: 'Billing release',
      content: 'Billing releases require the migration checklist before deploy.',
      citations: [{ id: 'billing-doc', type: 'file', ref: 'docs/billing.md' }],
      source: 'test',
      tags: ['billing', 'release'],
      confidence: 0.95,
    })

    history = new ConversationHistory(path.join(root, 'history.db'))
    await history.ensureReady()
    history.createSession('s1', 'Test', cwd)

    const provider = new PromptCaptureProvider()
    const session = new Session(
      { id: 's1', projectName: 'Test', cwd, modelConfig: { model: 'test', maxTokens: 1000, contextWindow: 10000 } },
      provider,
      history,
    )

    await session.sendMessage('How do billing releases work?', testEvents())

    expect(Array.isArray(provider.systemPrompt)).toBe(true)
    const segments = provider.systemPrompt as PromptSegment[]
    const dateIndex = segments.findIndex((segment) => segment.content.includes('# Current Date'))
    const contextV2Index = segments.findIndex((segment) => segment.content.includes('# 上下文片段'))

    expect(contextV2Index).toBeGreaterThan(dateIndex)
    expect(segments[contextV2Index].cacheable).toBe(false)
    expect(segments[contextV2Index].content).toContain('Billing releases require the migration checklist')
    expect(segments[contextV2Index].content).toContain('[billing-doc] file:docs/billing.md')
  })
})
