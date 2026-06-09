import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'

const CONFIG_DIR = path.join(process.env.HOME || process.env.USERPROFILE || '', '.puddingagent')
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json')

export type WebSearchProvider = 'duckduckgo' | 'brave' | 'tavily' | 'serper'

export interface WebProxyConfig {
  enabled?: boolean
  url?: string
  useEnv?: boolean
}

export interface WebSearchConfig {
  provider?: WebSearchProvider
  braveApiKey?: string
  tavilyApiKey?: string
  serperApiKey?: string
  proxy?: string
}

export interface WebToolConfig {
  webProxy: WebProxyConfig
  webSearch: WebSearchConfig
}

export interface ExperimentalConfig {
  contextEngine?: boolean
}

export function loadAppConfig(): Record<string, any> {
  if (!existsSync(CONFIG_FILE)) {
    return {}
  }
  return JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'))
}

export function saveAppConfig(config: Record<string, any>): void {
  mkdirSync(CONFIG_DIR, { recursive: true })
  const existing = loadAppConfig()
  const merged = { ...existing, ...config }
  writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2), 'utf-8')
}

export function getConfigDir(): string {
  return CONFIG_DIR
}

export function loadWebToolConfig(): WebToolConfig {
  const config = loadAppConfig()
  const legacySearchProxy = typeof config.webSearch?.proxy === 'string' ? config.webSearch.proxy.trim() : ''
  const webProxy = config.webProxy || {}
  const proxyUrl = typeof webProxy.url === 'string' && webProxy.url.trim()
    ? webProxy.url.trim()
    : legacySearchProxy

  return {
    webProxy: {
      enabled: Boolean(webProxy.enabled || legacySearchProxy),
      useEnv: webProxy.useEnv !== false,
      ...(proxyUrl ? { url: proxyUrl } : {}),
    },
    webSearch: {
      ...(config.webSearch || {}),
      ...normalizedWebSearchProvider(config.webSearch?.provider),
    },
  }
}

export function loadExperimentalConfig(): ExperimentalConfig {
  const config = loadAppConfig()
  return {
    contextEngine: Boolean(config.experimentalContextEngine ?? config.experimental?.contextEngine),
  }
}

export function resolveWebProxyUrl(proxy: WebProxyConfig = {}): string | undefined {
  if (!proxy.enabled) return undefined
  const explicit = proxy.url?.trim()
  if (explicit) return explicit
  if (proxy.useEnv === false) return undefined
  return firstEnvValue('HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy')
}

function normalizeWebSearchProvider(provider: unknown): WebSearchProvider | undefined {
  if (provider === 'brave' || provider === 'tavily' || provider === 'serper' || provider === 'duckduckgo') {
    return provider
  }
  return undefined
}

function normalizedWebSearchProvider(provider: unknown): { provider?: WebSearchProvider } {
  const normalized = normalizeWebSearchProvider(provider)
  return normalized ? { provider: normalized } : {}
}

function firstEnvValue(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]?.trim()
    if (value) return value
  }
  return undefined
}
