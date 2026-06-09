import { ProxyAgent } from 'undici'
import type { WebProxyConfig } from '../config.js'
import { resolveWebProxyUrl } from '../config.js'

export type FetchOptionsWithDispatcher = RequestInit & { dispatcher?: ProxyAgent }

export function buildWebFetchOptions(
  proxy: WebProxyConfig,
  init: RequestInit = {},
): FetchOptionsWithDispatcher {
  const proxyUrl = resolveWebProxyUrl(proxy)
  const options: FetchOptionsWithDispatcher = { ...init }
  if (proxyUrl) options.dispatcher = createProxyAgent(proxyUrl)
  return options
}

export function formatWebRequestError(err: any): string {
  const message = err?.message || String(err)
  const code = err?.code || err?.cause?.code
  return code ? `${message} (${code})` : message
}

function createProxyAgent(proxyUrl: string): ProxyAgent {
  try {
    return new ProxyAgent({ uri: proxyUrl })
  } catch (err: any) {
    throw new Error(`invalid proxy URL "${proxyUrl}": ${err.message}`)
  }
}
