import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

type ConfigModule = typeof import('../src/config.js')

describe('web tool config', () => {
  let homeDir: string
  let loadWebToolConfig: ConfigModule['loadWebToolConfig']
  let resolveWebProxyUrl: ConfigModule['resolveWebProxyUrl']

  beforeEach(async () => {
    homeDir = mkdtempSync(path.join(tmpdir(), 'pudding-web-config-'))
    vi.stubEnv('HOME', homeDir)
    vi.stubEnv('USERPROFILE', homeDir)
    vi.resetModules()
    const configModule = await import('../src/config.js')
    loadWebToolConfig = configModule.loadWebToolConfig
    resolveWebProxyUrl = configModule.resolveWebProxyUrl
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    rmSync(homeDir, { recursive: true, force: true })
  })

  it('keeps web proxy disabled when no config exists', () => {
    expect(loadWebToolConfig()).toEqual({ webProxy: { enabled: false, useEnv: true }, webSearch: {} })
    expect(resolveWebProxyUrl(loadWebToolConfig().webProxy)).toBeUndefined()
  })

  it('uses explicit proxy before environment fallback', () => {
    vi.stubEnv('HTTPS_PROXY', 'http://env-proxy:7890')
    writeConfig({ webProxy: { enabled: true, url: 'http://127.0.0.1:7890' } })

    const config = loadWebToolConfig()

    expect(resolveWebProxyUrl(config.webProxy)).toBe('http://127.0.0.1:7890')
  })

  it('uses environment proxy only when proxy is enabled', () => {
    vi.stubEnv('HTTPS_PROXY', 'http://env-proxy:7890')
    writeConfig({ webProxy: { enabled: true } })

    expect(resolveWebProxyUrl(loadWebToolConfig().webProxy)).toBe('http://env-proxy:7890')

    writeConfig({ webProxy: { enabled: false } })
    expect(resolveWebProxyUrl(loadWebToolConfig().webProxy)).toBeUndefined()
  })

  it('honors legacy webSearch proxy config', () => {
    writeConfig({ webSearch: { proxy: 'http://legacy-proxy:7890' } })

    const config = loadWebToolConfig()

    expect(config.webProxy.enabled).toBe(true)
    expect(resolveWebProxyUrl(config.webProxy)).toBe('http://legacy-proxy:7890')
  })
})

function writeConfig(config: Record<string, unknown>): void {
  const configDir = path.join(process.env.HOME!, '.puddingagent')
  mkdirSync(configDir, { recursive: true })
  writeFileSync(path.join(configDir, 'config.json'), JSON.stringify(config), 'utf-8')
}
