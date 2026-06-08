import type { StreamChunk } from '../types.js'

export type StreamRetryCallback = (
  attempt: number,
  error: Error,
  delayMs: number,
  maxRetries: number,
) => void

const DEFAULT_STREAM_MAX_RETRIES = 2

function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err))
}

export function isRetryableStreamError(err: unknown): boolean {
  if (!err) return false
  const e = err as any
  if (e.name === 'AbortError' || e.name === 'APIUserAbortError') return false

  const explicitStatus = typeof e?.status === 'number' ? e.status : undefined
  const msg = String(e?.message ?? e)
  const statusMatch = /^\s*(\d{3})\b/.exec(msg)
  const status = explicitStatus ?? (statusMatch ? Number(statusMatch[1]) : undefined)
  if (status !== undefined) {
    return status === 408 || status === 409 || status === 429 || status >= 500
  }

  if (e?.name === 'APIConnectionError' || e?.name === 'APIConnectionTimeoutError') return true

  const haystack = [msg, e?.code, e?.cause?.message, e?.cause?.code]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()

  return /terminated|econnreset|etimedout|epipe|eai_again|socket hang up|other side closed|und_err|fetch failed|network/.test(haystack)
}

export async function* withStreamRetry(
  makeStream: () => AsyncIterable<StreamChunk>,
  signal?: AbortSignal,
  maxRetries = DEFAULT_STREAM_MAX_RETRIES,
  onRetry?: StreamRetryCallback,
): AsyncIterable<StreamChunk> {
  for (let attempt = 0; ; attempt++) {
    let yieldedAny = false
    try {
      for await (const chunk of makeStream()) {
        yieldedAny = true
        yield chunk
      }
      return
    } catch (err) {
      if (yieldedAny || signal?.aborted || attempt >= maxRetries || !isRetryableStreamError(err)) {
        throw err
      }

      const delay = 500 * 2 ** attempt + Math.floor(Math.random() * 250)
      onRetry?.(attempt + 1, toError(err), delay, maxRetries)
      await new Promise<void>((resolve, reject) => {
        const onAbort = () => {
          clearTimeout(timer)
          reject(new DOMException('Aborted', 'AbortError'))
        }
        const timer = setTimeout(() => {
          signal?.removeEventListener('abort', onAbort)
          resolve()
        }, delay)
        signal?.addEventListener('abort', onAbort, { once: true })
      })
    }
  }
}
