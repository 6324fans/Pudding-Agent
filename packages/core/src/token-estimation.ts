import type { Message } from './types.js'
import { calculateMetrics, type TestMetrics } from './test-metrics.js'

export function estimateTokensWithMetrics(messages: Message[]): { tokens: number; metrics: TestMetrics[] } {
  const metrics: TestMetrics[] = []
  const start = Date.now()
  const tokens = estimateTokens(messages)
  metrics.push({ timestamp: Date.now(), operation: 'estimateTokens', duration: Date.now() - start })
  const totalDuration = calculateMetrics(metrics)
  return { tokens, metrics: [{ timestamp: Date.now(), operation: 'total', duration: totalDuration }] }
}

export function estimateTokens(messages: Message[]): number {
  let tokens = 0
  for (const msg of messages) {
    for (const block of msg.content) {
      if (block.type === 'text') {
        tokens += estimateTextTokens(block.text)
      } else if (block.type === 'thinking') {
        tokens += estimateTextTokens(block.thinking)
      } else if (block.type === 'tool_use') {
        tokens += estimateTextTokens(JSON.stringify(block.input)) + Math.ceil(block.name.length / 4)
        if (block.id) tokens += Math.ceil(block.id.length / 4)
      } else if (block.type === 'tool_result') {
        tokens += estimateTextTokens(block.content)
        if (block.tool_use_id) tokens += Math.ceil(block.tool_use_id.length / 4)
      } else if (block.type === 'image') {
        tokens += 1300
      }
    }
  }
  return tokens
}

export function estimateTextTokensPublic(text: string): number {
  return estimateTextTokens(text)
}

function estimateTextTokens(text: string): number {
  let tokens = 0
  for (const char of text) {
    const code = char.codePointAt(0)!
    if (code >= 0x4E00 && code <= 0x9FFF) {
      // CJK Unified Ideographs — ~1.5 tokens per character
      tokens += 1.5
    } else if (code >= 0x3000 && code <= 0x303F) {
      // CJK punctuation
      tokens += 1
    } else if (code >= 0xFF00 && code <= 0xFFEF) {
      // Fullwidth forms
      tokens += 1
    } else if (code > 0x7F) {
      // Other non-ASCII (e.g. accented Latin, Cyrillic, etc.)
      tokens += 1
    } else {
      // ASCII — ~4 chars per token
      tokens += 0.25
    }
  }
  return Math.ceil(tokens)
}
