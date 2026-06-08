import { afterEach, describe, expect, it, vi } from 'vitest'
import { isRetryableStreamError, withStreamRetry } from '../src/providers/stream-retry.js'
import type { StreamChunk } from '../src/types.js'

async function collect(stream: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}

function textStream(text: string): AsyncIterable<StreamChunk> {
  return (async function* () {
    yield { type: 'text_delta', text }
  })()
}

describe('stream retry', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('classifies retryable stream errors', () => {
    expect(isRetryableStreamError(new Error('500 upstream unavailable'))).toBe(true)
    expect(isRetryableStreamError({ status: 429, message: 'rate limited' })).toBe(true)
    expect(isRetryableStreamError({ name: 'APIConnectionError', message: 'connection failed' })).toBe(true)
    expect(isRetryableStreamError(new Error('terminated'))).toBe(true)
    expect(isRetryableStreamError(Object.assign(new Error('Aborted'), { name: 'AbortError' }))).toBe(false)
    expect(isRetryableStreamError({ status: 400, message: 'bad request' })).toBe(false)
  })

  it('retries retryable failures before the first chunk', async () => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0)

    let attempts = 0
    const retries: number[] = []
    const promise = collect(withStreamRetry(
      () => {
        attempts++
        if (attempts === 1) throw new Error('500 temporary')
        return textStream('ok')
      },
      undefined,
      1,
      (attempt) => retries.push(attempt),
    ))

    await vi.advanceTimersByTimeAsync(500)

    await expect(promise).resolves.toEqual([{ type: 'text_delta', text: 'ok' }])
    expect(attempts).toBe(2)
    expect(retries).toEqual([1])
  })

  it('does not retry after a chunk has been yielded', async () => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0)

    let attempts = 0
    const stream = withStreamRetry(
      () => (async function* () {
        attempts++
        yield { type: 'text_delta' as const, text: 'partial' }
        throw new Error('ECONNRESET')
      })(),
      undefined,
      1,
    )

    await expect(collect(stream)).rejects.toThrow('ECONNRESET')
    expect(attempts).toBe(1)
  })
})
