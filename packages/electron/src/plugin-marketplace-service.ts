import { loadAppConfig, saveAppConfig } from '@puddingagent/core'

export interface PluginMarketplace {
  id: string
  source: string
  name: string
  url?: string
}

export interface MarketplacePlugin {
  id: string
  name: string
  marketplaceId: string
  marketplaceName: string
  path?: string
  description?: string
  version?: string
  author?: string
  url?: string
  installed?: boolean
  enabled?: boolean
  installedAt?: number
}

export interface InstalledPlugin {
  id: string
  name: string
  marketplaceId: string
  marketplaceName: string
  path?: string
  description?: string
  version?: string
  author?: string
  url?: string
  enabled: boolean
  installedAt: number
}

interface GitHubRepo {
  owner: string
  repo: string
  ref: string
}

const DEFAULT_MARKETPLACE_SOURCE = 'anthropics/claude-plugins-official'
const GITHUB_PROXY_PREFIX = 'https://gh-proxy.com/'
const DEFAULT_MARKETPLACE: PluginMarketplace = {
  id: DEFAULT_MARKETPLACE_SOURCE,
  source: DEFAULT_MARKETPLACE_SOURCE,
  name: 'Claude Plugins Official',
  url: `https://github.com/${DEFAULT_MARKETPLACE_SOURCE}`,
}

function getConfiguredMarketplaces(): PluginMarketplace[] {
  const config = loadAppConfig()
  const saved = Array.isArray(config.pluginMarketplaces) ? config.pluginMarketplaces : []
  const normalized = saved
    .map(normalizeMarketplace)
    .filter((marketplace): marketplace is PluginMarketplace => Boolean(marketplace))
  if (!normalized.some((marketplace) => marketplace.id === DEFAULT_MARKETPLACE.id)) {
    normalized.unshift(DEFAULT_MARKETPLACE)
  }
  return normalized
}

function getInstalledPlugins(): InstalledPlugin[] {
  const config = loadAppConfig()
  if (!Array.isArray(config.installedPlugins)) return []
  return config.installedPlugins
    .filter((plugin: unknown): plugin is InstalledPlugin => Boolean(plugin && typeof plugin === 'object' && typeof (plugin as InstalledPlugin).id === 'string'))
    .map((plugin) => ({
      ...plugin,
      enabled: plugin.enabled !== false,
      installedAt: typeof plugin.installedAt === 'number' ? plugin.installedAt : Date.now(),
    }))
}

function saveInstalledPlugins(plugins: InstalledPlugin[]): void {
  saveAppConfig({ installedPlugins: plugins })
}

function mergeInstalledState(plugin: MarketplacePlugin, installed: Map<string, InstalledPlugin>): MarketplacePlugin {
  const installedPlugin = installed.get(plugin.id)
  if (!installedPlugin) return { ...plugin, installed: false }
  return {
    ...plugin,
    installed: true,
    enabled: installedPlugin.enabled,
    installedAt: installedPlugin.installedAt,
  }
}

function saveConfiguredMarketplaces(marketplaces: PluginMarketplace[]): void {
  saveAppConfig({ pluginMarketplaces: marketplaces })
}

function normalizeMarketplace(input: unknown): PluginMarketplace | null {
  if (!input || typeof input !== 'object') return null
  const value = input as Partial<PluginMarketplace>
  const source = typeof value.source === 'string' ? value.source.trim() : ''
  if (!source) return null
  const id = source
  return {
    id,
    source,
    name: typeof value.name === 'string' && value.name.trim() ? value.name.trim() : formatMarketplaceName(source),
    url: typeof value.url === 'string' ? value.url : marketplaceUrl(source),
  }
}

function formatMarketplaceName(source: string): string {
  const repo = parseGitHubSource(source)
  if (repo) {
    return repo.repo
      .split(/[-_]/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ')
  }
  try {
    return new URL(source).hostname
  } catch {
    return source
  }
}

function marketplaceUrl(source: string): string | undefined {
  const repo = parseGitHubSource(source)
  if (repo) return `https://github.com/${repo.owner}/${repo.repo}`
  if (/^https?:\/\//.test(source)) return source
  return undefined
}

function parseGitHubSource(source: string): GitHubRepo | null {
  const trimmed = source.trim()
  const shorthand = trimmed.match(/^([^/\s]+)\/([^#/\s]+)(?:#(.+))?$/)
  if (shorthand) {
    return { owner: shorthand[1], repo: shorthand[2].replace(/\.git$/, ''), ref: shorthand[3] || 'main' }
  }

  try {
    const url = new URL(trimmed)
    if (url.hostname !== 'github.com') return null
    const parts = url.pathname.replace(/^\/|\/$/g, '').split('/')
    if (parts.length < 2) return null
    return {
      owner: parts[0],
      repo: parts[1].replace(/\.git$/, ''),
      ref: url.hash.replace(/^#/, '') || 'main',
    }
  } catch {
    return null
  }
}

async function fetchJson(url: string, timeoutMs = 12000): Promise<any> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      headers: { 'user-agent': 'pudding-agent-plugin-marketplace' },
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`GET ${url} -> ${response.status}`)
    return response.json()
  } finally {
    clearTimeout(timeout)
  }
}

function shouldRetryWithGitHubProxy(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.hostname === 'api.github.com' || parsed.hostname === 'raw.githubusercontent.com'
  } catch {
    return false
  }
}

function proxiedGitHubUrl(url: string): string {
  return `${GITHUB_PROXY_PREFIX}${url}`
}

async function fetchGitHubJson(url: string): Promise<any> {
  try {
    return await fetchJson(url)
  } catch (err) {
    if (!shouldRetryWithGitHubProxy(url)) throw err
    return fetchJson(proxiedGitHubUrl(url))
  }
}

async function tryFetchJson(url: string): Promise<any | null> {
  try {
    return await fetchGitHubJson(url)
  } catch {
    return null
  }
}

function githubContentsUrl(repo: GitHubRepo, subpath: string): string {
  return `https://api.github.com/repos/${repo.owner}/${repo.repo}/contents/${subpath}?ref=${encodeURIComponent(repo.ref)}`
}

function githubRawUrl(repo: GitHubRepo, subpath: string): string {
  return `https://raw.githubusercontent.com/${repo.owner}/${repo.repo}/${repo.ref}/${subpath}`
}

function pluginFromManifest(
  marketplace: PluginMarketplace,
  repo: GitHubRepo | null,
  path: string,
  fallbackName: string,
  manifest: any,
): MarketplacePlugin {
  const name = typeof manifest?.name === 'string' && manifest.name ? manifest.name : fallbackName
  return {
    id: `${marketplace.id}:${path || name}`,
    name,
    marketplaceId: marketplace.id,
    marketplaceName: marketplace.name,
    path,
    description: typeof manifest?.description === 'string' ? manifest.description : undefined,
    version: typeof manifest?.version === 'string' ? manifest.version : undefined,
    author: typeof manifest?.author === 'string' ? manifest.author : undefined,
    url: repo ? `https://github.com/${repo.owner}/${repo.repo}/tree/${repo.ref}/${path}` : undefined,
  }
}

async function listGitHubMarketplacePlugins(marketplace: PluginMarketplace, repo: GitHubRepo): Promise<MarketplacePlugin[]> {
  const marketplaceManifest = await tryFetchJson(githubRawUrl(repo, '.claude-plugin/marketplace.json'))
  const pluginDirs = Array.isArray(marketplaceManifest?.plugins)
    ? marketplaceManifest.plugins
        .map((entry: any) => typeof entry === 'string' ? entry : entry?.path)
        .filter((entry: unknown): entry is string => typeof entry === 'string')
    : []

  const entries = pluginDirs.length > 0
    ? pluginDirs.map((pluginPath) => ({ name: pluginPath.split('/').filter(Boolean).pop() || pluginPath, path: pluginPath.replace(/^\/+/, '') }))
    : (await fetchGitHubJson(githubContentsUrl(repo, 'plugins')))
        .filter((entry: any) => entry?.type === 'dir')
        .map((entry: any) => ({ name: entry.name, path: entry.path }))

  const limited = entries.slice(0, 80)
  const plugins = await Promise.all(limited.map(async (entry) => {
    const manifest = await tryFetchJson(githubRawUrl(repo, `${entry.path}/.claude-plugin/plugin.json`))
    return pluginFromManifest(marketplace, repo, entry.path, entry.name, manifest)
  }))

  return plugins.sort((a, b) => a.name.localeCompare(b.name))
}

async function listJsonMarketplacePlugins(marketplace: PluginMarketplace): Promise<MarketplacePlugin[]> {
  const manifest = await fetchJson(marketplace.source)
  const entries = Array.isArray(manifest?.plugins) ? manifest.plugins : []
  return entries.map((entry: any, index: number) => {
    const name = typeof entry?.name === 'string' && entry.name ? entry.name : `plugin-${index + 1}`
    return {
      id: `${marketplace.id}:${entry?.path || entry?.url || name}`,
      name,
      marketplaceId: marketplace.id,
      marketplaceName: marketplace.name,
      path: typeof entry?.path === 'string' ? entry.path : undefined,
      description: typeof entry?.description === 'string' ? entry.description : undefined,
      version: typeof entry?.version === 'string' ? entry.version : undefined,
      author: typeof entry?.author === 'string' ? entry.author : undefined,
      url: typeof entry?.url === 'string' ? entry.url : undefined,
    } satisfies MarketplacePlugin
  })
}

export class PluginMarketplaceService {
  listMarketplaces(): PluginMarketplace[] {
    return getConfiguredMarketplaces()
  }

  addMarketplace(source: string): PluginMarketplace[] {
    const trimmed = source.trim()
    if (!trimmed) throw new Error('Marketplace URL is required')
    const marketplaces = getConfiguredMarketplaces()
    if (!marketplaces.some((marketplace) => marketplace.id === trimmed)) {
      marketplaces.push({
        id: trimmed,
        source: trimmed,
        name: formatMarketplaceName(trimmed),
        url: marketplaceUrl(trimmed),
      })
      saveConfiguredMarketplaces(marketplaces)
    }
    return marketplaces
  }

  removeMarketplace(id: string): PluginMarketplace[] {
    const marketplaces = getConfiguredMarketplaces().filter((marketplace) => marketplace.id !== id)
    const next = marketplaces.some((marketplace) => marketplace.id === DEFAULT_MARKETPLACE.id)
      ? marketplaces
      : [DEFAULT_MARKETPLACE, ...marketplaces]
    saveConfiguredMarketplaces(next)
    return next
  }

  async listPlugins(): Promise<{ plugins: MarketplacePlugin[]; errors: { marketplaceId: string; message: string }[] }> {
    const marketplaces = getConfiguredMarketplaces()
    const installed = new Map(getInstalledPlugins().map((plugin) => [plugin.id, plugin]))
    const results = await Promise.all(marketplaces.map(async (marketplace) => {
      try {
        const repo = parseGitHubSource(marketplace.source)
        const plugins = repo
          ? await listGitHubMarketplacePlugins(marketplace, repo)
          : await listJsonMarketplacePlugins(marketplace)
        return { marketplace, plugins, error: null as string | null }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { marketplace, plugins: [] as MarketplacePlugin[], error: message }
      }
    }))

    return {
      plugins: results.flatMap((result) => result.plugins).map((plugin) => mergeInstalledState(plugin, installed)),
      errors: results
        .filter((result) => result.error)
        .map((result) => ({ marketplaceId: result.marketplace.id, message: result.error! })),
    }
  }

  installPlugin(plugin: MarketplacePlugin): InstalledPlugin[] {
    const installed = getInstalledPlugins()
    const existing = installed.find((item) => item.id === plugin.id)
    if (existing) {
      existing.enabled = true
      saveInstalledPlugins(installed)
      return installed
    }

    installed.push({
      id: plugin.id,
      name: plugin.name,
      marketplaceId: plugin.marketplaceId,
      marketplaceName: plugin.marketplaceName,
      path: plugin.path,
      description: plugin.description,
      version: plugin.version,
      author: plugin.author,
      url: plugin.url,
      enabled: true,
      installedAt: Date.now(),
    })
    saveInstalledPlugins(installed)
    return installed
  }

  uninstallPlugin(id: string): InstalledPlugin[] {
    const installed = getInstalledPlugins().filter((plugin) => plugin.id !== id)
    saveInstalledPlugins(installed)
    return installed
  }

  setPluginEnabled(id: string, enabled: boolean): InstalledPlugin[] {
    const installed = getInstalledPlugins()
    const plugin = installed.find((item) => item.id === id)
    if (!plugin) throw new Error('Plugin is not installed')
    plugin.enabled = enabled
    saveInstalledPlugins(installed)
    return installed
  }
}
