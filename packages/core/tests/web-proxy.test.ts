import { describe, expect, it } from 'vitest'
import { buildWebFetchOptions } from '../src/tools/web-proxy.js'

describe('web proxy fetch options', () => {
  it('does not add a dispatcher when proxy is disabled', () => {
    const options = buildWebFetchOptions({ enabled: false }, { method: 'GET' })

    expect(options.method).toBe('GET')
    expect(options.dispatcher).toBeUndefined()
  })

  it('adds a dispatcher when proxy is enabled', () => {
    const options = buildWebFetchOptions({ enabled: true, url: 'http://127.0.0.1:7890' })

    expect(options.dispatcher).toBeDefined()
  })

  it('throws a diagnostic error for invalid proxy URLs', () => {
    expect(() => buildWebFetchOptions({ enabled: true, url: 'not a proxy url' }))
      .toThrow('invalid proxy URL "not a proxy url"')
  })
})
