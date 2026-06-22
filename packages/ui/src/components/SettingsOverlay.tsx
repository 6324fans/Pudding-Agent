import { useState, useEffect, useRef, useCallback } from 'react'
import QRCode from 'qrcode'
import { useSettingsStore, type SettingsTab } from '../stores/settings-store'
import { useModelStore, type ApiProtocol, type ModelGroup } from '../stores/model-store'
import { useSessionStore } from '../stores/session-store'
import { ThemeSegmented } from './ThemeSegmented'
import { IconCheck, IconStop, IconX } from './icons'
import { ipc, type ChatBridgeEvent, type ChatBridgeRouteState, type ChatBridgeSnapshot, type ChatChannelConfig, type ChatChannelState, type MarketplacePlugin, type McpServerState, type PluginMarketplace, type SkillListItem } from '../lib/ipc-client'

function Tooltip({ text, children }: { text: string; children: React.ReactNode }) {
  const [show, setShow] = useState(false)
  return (
    <span className="relative inline-flex" onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
      {children}
      {show && (
        <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 text-[11px] text-[var(--text)] bg-[var(--surface-3)] border border-[var(--border)] rounded-[4px] whitespace-nowrap z-50 pointer-events-none">
          {text}
        </span>
      )}
    </span>
  )
}

const PROTOCOL_OPTIONS: { value: ApiProtocol; label: string }[] = [
  { value: 'anthropic', label: 'Anthropic (/v1/messages)' },
  { value: 'openai', label: 'OpenAI (/v1/chat/completions)' },
  { value: 'openai-responses', label: 'OpenAI Responses (/v1/responses)' },
]

function ProtocolSelect({ value, onChange }: { value: ApiProtocol; onChange: (v: ApiProtocol) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const current = PROTOCOL_OPTIONS.find(o => o.value === value)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full bg-[var(--surface-2)] border border-[var(--border)] rounded-[6px] px-3 py-2 text-[13px] text-[var(--text)] text-left flex items-center justify-between hover:border-[var(--border-strong)] transition-colors"
      >
        <span>{current?.label}</span>
        <span className="text-[var(--muted)]">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 border border-[var(--border)] rounded-[6px] bg-[var(--surface)] overflow-hidden" style={{ boxShadow: 'var(--shadow-soft)' }}>
          {PROTOCOL_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => { onChange(opt.value); setOpen(false) }}
              className={`w-full text-left px-3 py-2 text-[13px] transition-colors ${opt.value === value ? 'bg-[var(--accent-soft)] text-[var(--accent)]' : 'text-[var(--text)] hover:bg-[var(--surface-2)]'}`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

const TABS: { key: SettingsTab; label: string }[] = [
  { key: 'appearance', label: '外观' },
  { key: 'models', label: '模型' },
  { key: 'plugins', label: '插件' },
  { key: 'mcp', label: 'MCP' },
  { key: 'tools', label: '工具' },
  { key: 'skills', label: '技能' },
  { key: 'chatBridge', label: '聊天桥接' },
  { key: 'shortcuts', label: '快捷键' },
  { key: 'advanced', label: '版本信息' },
]

function sanitizeUpdaterError(message?: string): string {
  const raw = (message || '').replace(/\s+/g, ' ').trim()

  if (/未找到更新发布源|无法访问更新发布源|网络连接异常/.test(raw)) {
    return raw
  }
  if (/404|not found|releases\.atom|cannot find latest|no published versions/i.test(raw)) {
    return '未找到更新发布源，请确认 GitHub Releases 已发布后再试。'
  }
  if (/401|403|authentication token|authorization|forbidden|unauthorized/i.test(raw)) {
    return '无法访问更新发布源，请检查 GitHub 发布配置或访问权限。'
  }
  if (/ENOTFOUND|ECONN|ETIMEDOUT|EAI_AGAIN|network|timeout|socket|certificate/i.test(raw)) {
    return '网络连接异常，请检查网络后重试。'
  }

  return '检查更新失败，请稍后重试。'
}

export function SettingsOverlay() {
  const isOpen = useSettingsStore((s) => s.isOpen)
  const activeTab = useSettingsStore((s) => s.activeTab)
  const close = useSettingsStore((s) => s.close)
  const setActiveTab = useSettingsStore((s) => s.setActiveTab)

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div
        className="w-[680px] max-h-[80vh] flex border border-[var(--border)] rounded-[14px] bg-[var(--surface)] overflow-hidden"
        style={{ boxShadow: 'var(--shadow-soft)' }}
      >
        {/* Left nav */}
        <div className="w-[160px] bg-[var(--surface-2)] border-r border-[var(--border)] py-4 flex flex-col gap-1 px-2">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`w-full text-left px-3 py-2 rounded-[6px] text-[13px] transition-colors ${
                activeTab === tab.key
                  ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
                  : 'text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface-3)]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Right content */}
        <div className="flex-1 overflow-y-auto p-6 relative">
          <button
            onClick={close}
            className="absolute top-4 right-4 text-[var(--muted)] hover:text-[var(--text)] transition-colors"
          >
            <IconX size={18} />
          </button>

          {activeTab === 'appearance' && <AppearanceTab />}
          {activeTab === 'models' && <ModelsTab />}
          {activeTab === 'plugins' && <PluginsTab />}
          {activeTab === 'mcp' && <McpTab />}
          {activeTab === 'tools' && <ToolsTab />}
          {activeTab === 'skills' && <SkillsTab />}
          {activeTab === 'chatBridge' && <ChatBridgeTab />}
          {activeTab === 'shortcuts' && <ShortcutsTab />}
          {activeTab === 'advanced' && <AdvancedTab />}
        </div>
      </div>
    </div>
  )
}

/* ─── Appearance ─── */
function AppearanceTab() {
  return (
    <div>
      <h3 className="text-[13px] font-medium text-[var(--text)] mb-3">主题</h3>
      <ThemeSegmented />
    </div>
  )
}

type SearchProvider = 'duckduckgo' | 'brave' | 'tavily' | 'serper'

const SEARCH_PROVIDERS: { value: SearchProvider; label: string; keyField?: 'braveApiKey' | 'tavilyApiKey' | 'serperApiKey'; placeholder?: string }[] = [
  { value: 'duckduckgo', label: 'DuckDuckGo' },
  { value: 'brave', label: 'Brave Search', keyField: 'braveApiKey', placeholder: 'BSA...' },
  { value: 'tavily', label: 'Tavily', keyField: 'tavilyApiKey', placeholder: 'tvly-...' },
  { value: 'serper', label: 'Serper', keyField: 'serperApiKey', placeholder: 'Serper API Key' },
]

function ToolsTab() {
  const [provider, setProvider] = useState<SearchProvider>('duckduckgo')
  const [keys, setKeys] = useState<Record<string, string>>({})
  const [proxyEnabled, setProxyEnabled] = useState(false)
  const [proxyUrl, setProxyUrl] = useState('')
  const [proxyUseEnv, setProxyUseEnv] = useState(true)
  const [computerUseEnabled, setComputerUseEnabled] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    ipc.config.get().then((cfg: any) => {
      const ws = cfg?.webSearch || {}
      const wp = cfg?.webProxy || {}
      setProvider(resolveSearchProviderDraft(ws))
      setKeys({
        braveApiKey: ws.braveApiKey || '',
        tavilyApiKey: ws.tavilyApiKey || '',
        serperApiKey: ws.serperApiKey || '',
      })
      setProxyEnabled(Boolean(wp.enabled || ws.proxy))
      setProxyUrl(wp.url || ws.proxy || '')
      setProxyUseEnv(wp.useEnv !== false)
      setComputerUseEnabled(cfg?.computerUse?.enabled === true)
    }).catch(() => undefined)
  }, [])

  const saveTools = async () => {
    setSaving(true)
    setSaved(false)
    try {
      await ipc.config.set({
        webSearch: {
          provider,
          braveApiKey: keys.braveApiKey?.trim() || undefined,
          tavilyApiKey: keys.tavilyApiKey?.trim() || undefined,
          serperApiKey: keys.serperApiKey?.trim() || undefined,
        },
        webProxy: {
          enabled: proxyEnabled,
          url: proxyUrl.trim() || undefined,
          useEnv: proxyUseEnv,
        },
        computerUse: {
          enabled: computerUseEnabled,
        },
      } as any)
      setSaved(true)
      setTimeout(() => setSaved(false), 1800)
    } finally {
      setSaving(false)
    }
  }

  const selectedProvider = SEARCH_PROVIDERS.find(p => p.value === provider)
  const inputCls = 'w-full bg-[var(--surface-2)] border border-[var(--border)] rounded-[6px] px-3 py-2 text-[13px] text-[var(--text)] placeholder:text-[var(--muted)] outline-none focus:border-[var(--border-strong)]'
  const labelCls = 'space-y-1.5 text-[12px] text-[var(--muted)]'

  return (
    <div className="space-y-6 pr-8">
      <div>
        <h3 className="text-[13px] font-medium text-[var(--text)] mb-3">联网搜索</h3>
        <div className="space-y-3">
          <label className={labelCls}>
            搜索引擎
            <select value={provider} onChange={(e) => setProvider(e.target.value as SearchProvider)} className={inputCls}>
              {SEARCH_PROVIDERS.map(option => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>

          {SEARCH_PROVIDERS.filter(option => option.keyField).map(option => (
            <label key={option.value} className={labelCls}>
              {option.label} API Key
              <input
                type="password"
                value={keys[option.keyField!] || ''}
                onChange={(e) => setKeys(prev => ({ ...prev, [option.keyField!]: e.target.value }))}
                placeholder={option.placeholder}
                className={inputCls}
              />
            </label>
          ))}

          {selectedProvider?.keyField && !keys[selectedProvider.keyField]?.trim() && (
            <p className="text-[11px] text-[var(--warn)]">当前搜索引擎需要配置 API Key。</p>
          )}
        </div>
      </div>

      <div>
        <h3 className="text-[13px] font-medium text-[var(--text)] mb-3">Web 代理</h3>
        <div className="space-y-3">
          <label className="flex items-center gap-2 text-[12px] text-[var(--muted)]">
            <input type="checkbox" checked={proxyEnabled} onChange={(e) => setProxyEnabled(e.target.checked)} />
            启用代理
          </label>
          <label className={labelCls}>
            代理地址
            <input
              value={proxyUrl}
              onChange={(e) => setProxyUrl(e.target.value)}
              placeholder="http://127.0.0.1:7890"
              className={inputCls}
            />
          </label>
          <label className="flex items-center gap-2 text-[12px] text-[var(--muted)]">
            <input type="checkbox" checked={proxyUseEnv} onChange={(e) => setProxyUseEnv(e.target.checked)} />
            未填写地址时读取环境变量
          </label>
        </div>
      </div>

      <div>
        <h3 className="text-[13px] font-medium text-[var(--text)] mb-3">Computer Use</h3>
        <div className="space-y-3 rounded-[6px] border border-[var(--border)] bg-[var(--surface-2)] p-3">
          <label className="flex items-start gap-2 text-[12px] text-[var(--muted)]">
            <input
              type="checkbox"
              checked={computerUseEnabled}
              onChange={(e) => setComputerUseEnabled(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              <span className="block text-[13px] text-[var(--text)]">启用 Computer Use</span>
              <span className="block mt-1">启用后连接内置的 open-computer-use MCP server，模型获得后台、非侵入式的桌面控制能力（基于 Accessibility 语义，不抢前台、不动真实光标）。需在系统设置授权辅助功能与屏幕录制。</span>
            </span>
          </label>
          <div className="grid grid-cols-2 gap-2 text-[11px] text-[var(--muted)]">
            {['list_apps', 'get_app_state', 'click', 'perform_secondary_action', 'scroll', 'drag', 'type_text', 'press_key', 'set_value'].map((tool) => (
              <span key={tool} className="font-mono rounded-[4px] border border-[var(--border)] bg-[var(--surface)] px-2 py-1">
                {tool}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={saveTools}
          disabled={saving}
          className="rounded-[6px] bg-[var(--accent)] px-4 py-2 text-[13px] text-[var(--accent-ink)] disabled:opacity-50"
        >
          {saving ? '保存中...' : '保存'}
        </button>
        {saved && <span className="text-[12px] text-[var(--good)]">已保存</span>}
      </div>
    </div>
  )
}

function resolveSearchProviderDraft(webSearch: any): SearchProvider {
  if (webSearch?.provider === 'brave' || webSearch?.provider === 'tavily' || webSearch?.provider === 'serper' || webSearch?.provider === 'duckduckgo') {
    return webSearch.provider
  }
  if (webSearch?.braveApiKey) return 'brave'
  if (webSearch?.tavilyApiKey) return 'tavily'
  if (webSearch?.serperApiKey) return 'serper'
  return 'duckduckgo'
}

/* ─── Advanced ─── */
function AdvancedTab() {
  const [updateStatus, setUpdateStatus] = useState<'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'error' | 'uptodate'>('idle')
  const [updateVersion, setUpdateVersion] = useState('')
  const [downloadPercent, setDownloadPercent] = useState(0)
  const [errorMsg, setErrorMsg] = useState('')
  const [appVersion, setAppVersion] = useState('')

  useEffect(() => {
    window.electronAPI?.getVersion?.().then((v: string) => setAppVersion(v))
    const unsub1 = window.electronAPI?.onUpdaterAvailable?.((data: { version: string }) => {
      setUpdateStatus('available')
      setUpdateVersion(data.version)
    })
    const unsub2 = window.electronAPI?.onUpdaterProgress?.((data: { percent: number }) => {
      setUpdateStatus('downloading')
      setDownloadPercent(data.percent)
    })
    const unsub3 = window.electronAPI?.onUpdaterDownloaded?.(() => {
      setUpdateStatus('ready')
    })
    const unsub4 = window.electronAPI?.onUpdaterNotAvailable?.(() => {
      setUpdateStatus('uptodate')
    })
    const unsub5 = window.electronAPI?.onUpdaterError?.((data: { message: string }) => {
      setUpdateStatus('error')
      setErrorMsg(sanitizeUpdaterError(data.message))
    })
    return () => { unsub1?.(); unsub2?.(); unsub3?.(); unsub4?.(); unsub5?.() }
  }, [])

  const checkUpdate = async () => {
    setUpdateStatus('checking')
    setErrorMsg('')
    try {
      const result = await window.electronAPI?.updaterCheck?.()
      if (result?.error) {
        setUpdateStatus('error')
        setErrorMsg(sanitizeUpdaterError(result.error))
      }
    } catch {
      setUpdateStatus('error')
      setErrorMsg('检查更新失败')
    }
  }

  const downloadUpdate = () => {
    setUpdateStatus('downloading')
    setDownloadPercent(0)
    window.electronAPI?.updaterDownload?.()
  }

  const installUpdate = () => {
    window.electronAPI?.updaterInstall?.()
  }

  return (
    <div className="space-y-6">
      {/* Version & Update */}
      <div>
        <h3 className="text-[13px] font-medium text-[var(--text)] mb-3">版本信息</h3>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[13px] text-[var(--muted)]">当前版本</span>
            <span className="text-[13px] font-mono text-[var(--text)]">v{appVersion || '...'}</span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-[13px] text-[var(--muted)]">检查更新</span>
            <div className="flex items-center gap-2">
              {updateStatus === 'idle' && (
                <button
                  onClick={checkUpdate}
                  className="px-3 py-1 text-[12px] rounded-[6px] border border-[var(--border)] text-[var(--text)] hover:bg-[var(--surface-2)] transition-colors"
                >
                  检查更新
                </button>
              )}
              {updateStatus === 'uptodate' && (
                <span className="text-[12px] text-[var(--good)]">已是最新版本</span>
              )}
              {updateStatus === 'checking' && (
                <span className="text-[12px] text-[var(--muted)]">检查中...</span>
              )}
              {updateStatus === 'available' && (
                <div className="flex items-center gap-2">
                  <span className="text-[12px] text-[var(--good)]">v{updateVersion} 可用</span>
                  <button
                    onClick={downloadUpdate}
                    className="px-3 py-1 text-[12px] rounded-[6px] bg-[var(--accent)] text-[var(--accent-ink)] hover:opacity-90 transition-colors"
                  >
                    下载
                  </button>
                </div>
              )}
              {updateStatus === 'downloading' && (
                <div className="flex items-center gap-2">
                  <div className="w-24 h-1.5 rounded-full bg-[var(--surface-3)] overflow-hidden">
                    <div className="h-full rounded-full bg-[var(--accent)] transition-all" style={{ width: `${downloadPercent}%` }} />
                  </div>
                  <span className="text-[12px] text-[var(--muted)]">{downloadPercent}%</span>
                </div>
              )}
              {updateStatus === 'ready' && (
                <button
                  onClick={installUpdate}
                  className="px-3 py-1 text-[12px] rounded-[6px] bg-[var(--good)] text-white hover:opacity-90 transition-colors"
                >
                  重启并安装
                </button>
              )}
              {updateStatus === 'error' && (
                <div className="flex items-center gap-2">
                  <span className="text-[12px] text-[var(--bad)]">失败</span>
                  <button
                    onClick={checkUpdate}
                    className="px-3 py-1 text-[12px] rounded-[6px] border border-[var(--border)] text-[var(--text)] hover:bg-[var(--surface-2)] transition-colors"
                  >
                    重试
                  </button>
                </div>
              )}
            </div>
          </div>
          {errorMsg && (
            <p className="text-[11px] text-[var(--bad)]">{errorMsg}</p>
          )}
        </div>
      </div>

      {/* About */}
      <div>
        <h3 className="text-[13px] font-medium text-[var(--text)] mb-3">关于</h3>
        <div className="space-y-2 text-[13px] text-[var(--muted)]">
          <p>Pudding-Agent - AI 编程助手</p>
        </div>
      </div>
    </div>
  )
}

/* ─── Shortcuts ─── */
const SHORTCUTS = [
  { keys: '⌘ N', desc: '新建会话' },
  { keys: '⌘ W', desc: '关闭会话' },
  { keys: '⌘ K', desc: '清空对话' },
  { keys: '⌘ ,', desc: '打开设置' },
  { keys: 'Escape', desc: '停止生成' },
  { keys: 'Shift+Tab', desc: '计划模式' },
  { keys: '⌘ 1-9', desc: '切换会话' },
]

function ShortcutsTab() {
  return (
    <table className="w-full text-[13px]">
      <thead>
        <tr className="text-left text-[var(--muted)] border-b border-[var(--border)]">
          <th className="pb-2 font-normal">快捷键</th>
          <th className="pb-2 font-normal">描述</th>
        </tr>
      </thead>
      <tbody>
        {SHORTCUTS.map((s) => (
          <tr key={s.keys} className="border-b border-[var(--border)]">
            <td className="py-2 font-mono text-[12px] text-[var(--text)]">{s.keys}</td>
            <td className="py-2 text-[var(--muted)]">{s.desc}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/* ─── Chat Bridge ─── */
function ChatBridgeTab() {
  const projects = useSessionStore((s) => s.projects)
  const [snapshot, setSnapshot] = useState<ChatBridgeSnapshot | null>(null)
  const [channels, setChannels] = useState<ChatChannelConfig[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [login, setLogin] = useState<{ channelId: string; qrcode?: string; qrCodeText?: string; message: string } | null>(null)
  const [polling, setPolling] = useState(false)

  const load = useCallback(async () => {
    const [nextSnapshot, nextChannels] = await Promise.all([
      ipc.chatBridge.get(),
      ipc.chatBridge.channels(),
    ])
    setSnapshot(nextSnapshot)
    setChannels(nextChannels)
  }, [])

  useEffect(() => {
    load()
    const unsubscribe = ipc.chatBridge.onStateChanged((next) => setSnapshot(next))
    return () => unsubscribe()
  }, [load])

  const updateSnapshot = (next: ChatBridgeSnapshot) => {
    setSnapshot(next)
    ipc.chatBridge.channels().then(setChannels).catch(() => undefined)
  }

  const run = async (key: string, action: () => Promise<ChatBridgeSnapshot>) => {
    setBusy(key)
    try {
      updateSnapshot(await action())
    } finally {
      setBusy(null)
    }
  }

  const startLogin = async (channelId: string) => {
    setBusy(`login:${channelId}`)
    try {
      const result = await ipc.chatBridge.loginChannel(channelId)
      updateSnapshot(result.snapshot)
      setLogin({ channelId, qrcode: result.qrcode, qrCodeText: result.qrCodeText, message: result.message })
    } finally {
      setBusy(null)
    }
  }

  const pollLogin = async () => {
    if (!login?.channelId || !login.qrcode) return
    setPolling(true)
    try {
      const result = await ipc.chatBridge.pollLogin(login.channelId, login.qrcode)
      updateSnapshot(result.snapshot)
      setLogin(prev => prev ? { ...prev, message: result.message } : prev)
      if (result.done) setLogin(null)
    } finally {
      setPolling(false)
    }
  }

  const saveChannel = async (channel: ChatChannelConfig) => {
    setBusy(`save:${channel.id}`)
    try {
      updateSnapshot(await ipc.chatBridge.saveChannel(channel))
      const nextChannels = await ipc.chatBridge.channels()
      setChannels(nextChannels)
      setEditingId(null)
    } finally {
      setBusy(null)
    }
  }

  const eventList = snapshot?.events || []
  const routeList = snapshot?.routes || []
  const bridgeProject = snapshot?.project
  const security = snapshot?.security
  const totals = routeList.reduce((acc, route) => {
    acc.inbound += route.inboundCount
    acc.outbound += route.outboundCount
    if (route.pending) acc.pending += 1
    return acc
  }, { inbound: 0, outbound: 0, pending: 0 })

  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-center justify-between pr-8">
          <div>
            <h3 className="text-[13px] font-medium text-[var(--text)]">聊天桥接</h3>
            <p className="mt-1 text-[12px] text-[var(--muted)]">管理微信和飞书入口，把远程聊天接到 Pudding-Agent。</p>
          </div>
          <button
            onClick={() => snapshot?.enabled ? run('bridge', ipc.chatBridge.stop) : run('bridge', ipc.chatBridge.start)}
            disabled={busy === 'bridge'}
            className={`rounded-[6px] px-3 py-1.5 text-[12px] transition-colors ${
              snapshot?.enabled
                ? 'border border-[var(--border)] text-[var(--text)] hover:bg-[var(--surface-2)]'
                : 'bg-[var(--accent)] text-[var(--accent-ink)]'
            } disabled:opacity-50`}
          >
            {busy === 'bridge' ? '处理中...' : snapshot?.enabled ? '停止桥接' : '启动桥接'}
          </button>
        </div>
        <div className="mt-3 rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">Webhook</div>
              <div className="mt-1 truncate font-mono text-[12px] text-[var(--text)]">{snapshot?.webhookUrl || '未启动'}</div>
            </div>
            <span className={`shrink-0 rounded-[999px] px-2 py-1 text-[11px] ${snapshot?.enabled ? 'bg-emerald-500/10 text-[var(--good)]' : 'bg-[var(--surface-3)] text-[var(--muted)]'}`}>
              {snapshot?.enabled ? '运行中' : '已停止'}
            </span>
          </div>
          <div className="mt-3 grid grid-cols-4 gap-2">
            <BridgeMetric label="渠道" value={`${snapshot?.channels.length || 0}`} />
            <BridgeMetric label="路由" value={`${routeList.length}`} />
            <BridgeMetric label="入站" value={`${totals.inbound}`} />
            <BridgeMetric label="待回复" value={`${totals.pending}`} tone={totals.pending ? 'warn' : undefined} />
          </div>
        </div>
      </div>

      {bridgeProject && (
        <div className="rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <h3 className="text-[13px] font-medium text-[var(--text)]">默认项目</h3>
              <p className="mt-1 text-[12px] text-[var(--muted)]">微信/飞书新建会话时使用的项目；已有路由不会被改变。</p>
              <select
                value={bridgeProject.mode === 'fixed' ? bridgeProject.cwd || '' : '__active__'}
                onChange={(e) => {
                  const value = e.target.value
                  if (value === '__active__') {
                    run('bridge-project', () => ipc.chatBridge.saveProject({ mode: 'active' }))
                    return
                  }
                  const project = projects.find(p => p.cwd === value)
                  run('bridge-project', () => ipc.chatBridge.saveProject({ mode: 'fixed', cwd: value, projectName: project?.name }))
                }}
                disabled={busy === 'bridge-project'}
                className="mt-3 w-full rounded-[6px] border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--border-strong)] disabled:opacity-50"
              >
                <option value="__active__">跟随当前激活项目</option>
                {projects.map(project => (
                  <option key={project.cwd} value={project.cwd}>{project.name} - {project.cwd}</option>
                ))}
              </select>
            </div>
            <span className="shrink-0 rounded-[999px] bg-[var(--surface-2)] px-2 py-1 text-[11px] text-[var(--muted)]">
              {bridgeProject.mode === 'fixed' ? '固定项目' : '跟随当前'}
            </span>
          </div>
        </div>
      )}

      {security && (
        <div className="rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h3 className="text-[13px] font-medium text-[var(--text)]">远程配对保护</h3>
              <p className="mt-1 text-[12px] text-[var(--muted)]">开启后，新的微信/飞书聊天窗口必须先发送配对码。</p>
              <div className="mt-3 flex items-center gap-3">
                <span className="rounded-[6px] border border-[var(--border)] bg-[var(--surface-2)] px-3 py-1.5 font-mono text-[14px] text-[var(--text)]">{security.pairingCode}</span>
                <button
                  onClick={() => run('pairing-code', ipc.chatBridge.regeneratePairingCode)}
                  disabled={busy === 'pairing-code'}
                  className="rounded-[6px] border border-[var(--border)] px-2.5 py-1.5 text-[12px] text-[var(--muted)] hover:text-[var(--text)] disabled:opacity-50"
                >
                  刷新配对码
                </button>
              </div>
            </div>
            <label className="flex shrink-0 items-center gap-2 text-[12px] text-[var(--muted)]">
              <input
                type="checkbox"
                checked={security.requirePairing}
                onChange={(e) => run('pairing-toggle', () => ipc.chatBridge.saveSecurity({ requirePairing: e.target.checked }))}
              />
              启用配对
            </label>
          </div>
        </div>
      )}

      {login && (
        <div className="rounded-[8px] border border-[var(--accent-soft)] bg-[var(--surface-2)] p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h4 className="text-[13px] font-medium text-[var(--text)]">微信登录</h4>
              <p className="mt-1 text-[12px] text-[var(--muted)]">{login.message}</p>
              <WeixinQrCode value={login.qrCodeText} />
            </div>
            <div className="flex shrink-0 flex-col gap-2">
              <button
                onClick={pollLogin}
                disabled={polling || !login.qrcode}
                className="rounded-[6px] bg-[var(--accent)] px-3 py-1.5 text-[12px] text-[var(--accent-ink)] disabled:opacity-50"
              >
                {polling ? '检查中...' : '我已扫码'}
              </button>
              <button
                onClick={() => setLogin(null)}
                className="rounded-[6px] border border-[var(--border)] px-3 py-1.5 text-[12px] text-[var(--muted)] hover:text-[var(--text)]"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {channels.map((channel) => (
          <ChatChannelCard
            key={channel.id}
            channel={channel}
            status={snapshot?.channels.find(s => s.channelId === channel.id)}
            editing={editingId === channel.id}
            busy={busy}
            webhookUrl={snapshot?.webhookUrl || ''}
            onEdit={() => setEditingId(channel.id)}
            onCancel={() => setEditingId(null)}
            onSave={saveChannel}
            onStart={() => run(`start:${channel.id}`, () => ipc.chatBridge.startChannel(channel.id))}
            onStop={() => run(`stop:${channel.id}`, () => ipc.chatBridge.stopChannel(channel.id))}
            onLogin={() => startLogin(channel.id)}
          />
        ))}
      </div>

      <div>
        <h3 className="mb-3 text-[13px] font-medium text-[var(--text)]">会话路由</h3>
        <div className="overflow-hidden rounded-[8px] border border-[var(--border)]">
          {routeList.length === 0 ? (
            <div className="px-4 py-6 text-center text-[12px] text-[var(--muted)]">收到第一条远程消息后会自动创建路由</div>
          ) : (
            routeList.map(route => (
              <ChatBridgeRouteRow
                key={route.routeKey}
                route={route}
                busy={busy}
                onReset={() => run(`route-reset:${route.routeKey}`, () => ipc.chatBridge.resetRoute(route.routeKey))}
                onNewSession={() => run(`route-new:${route.routeKey}`, () => ipc.chatBridge.newRouteSession(route.routeKey))}
                onUntrust={() => run(`route-untrust:${route.routeKey}`, () => ipc.chatBridge.untrustRoute(route.routeKey))}
              />
            ))
          )}
        </div>
      </div>

      <div>
        <h3 className="mb-3 text-[13px] font-medium text-[var(--text)]">最近事件</h3>
        <div className="max-h-[220px] overflow-y-auto rounded-[8px] border border-[var(--border)]">
          {eventList.length === 0 ? (
            <div className="px-4 py-6 text-center text-[12px] text-[var(--muted)]">暂无事件</div>
          ) : (
            eventList.map(event => <ChatBridgeEventRow key={event.id} event={event} />)
          )}
        </div>
      </div>
    </div>
  )
}

function ChatChannelCard({
  channel,
  status,
  editing,
  busy,
  webhookUrl,
  onEdit,
  onCancel,
  onSave,
  onStart,
  onStop,
  onLogin,
}: {
  channel: ChatChannelConfig
  status?: ChatBridgeSnapshot['channels'][number]
  editing: boolean
  busy: string | null
  webhookUrl: string
  onEdit: () => void
  onCancel: () => void
  onSave: (channel: ChatChannelConfig) => void
  onStart: () => void
  onStop: () => void
  onLogin: () => void
}) {
  const state = status?.state || 'stopped'
  const isBusy = busy?.endsWith(`:${channel.id}`)

  return (
    <div className="overflow-hidden rounded-[8px] border border-[var(--border)] bg-[var(--surface)]">
      <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className={`h-2.5 w-2.5 rounded-full ${stateDotClass(state)}`} />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-medium text-[var(--text)]">{channel.label}</span>
              <span className="rounded-[4px] bg-[var(--surface-2)] px-1.5 py-0.5 text-[10px] text-[var(--muted)]">{channel.kind === 'weixin' ? '微信' : '飞书'}</span>
            </div>
            <div className="mt-0.5 truncate font-mono text-[11px] text-[var(--muted)]">{channel.id}</div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className={`rounded-[999px] px-2 py-1 text-[11px] ${stateBadgeClass(state)}`}>{stateLabel(state)}</span>
          {channel.kind === 'weixin' && (
            <button onClick={onLogin} disabled={isBusy} className="rounded-[6px] border border-[var(--border)] px-2.5 py-1.5 text-[12px] text-[var(--text)] hover:bg-[var(--surface-2)] disabled:opacity-50">
              登录
            </button>
          )}
          {state === 'connected' || state === 'starting' ? (
            <button onClick={onStop} disabled={isBusy} className="rounded-[6px] border border-[var(--border)] px-2.5 py-1.5 text-[12px] text-[var(--muted)] hover:text-[var(--text)] disabled:opacity-50">
              停止
            </button>
          ) : (
            <button onClick={onStart} disabled={isBusy || !channel.enabled} className="rounded-[6px] bg-[var(--accent)] px-2.5 py-1.5 text-[12px] text-[var(--accent-ink)] disabled:opacity-50">
              启动
            </button>
          )}
          <button onClick={editing ? onCancel : onEdit} className="rounded-[6px] border border-[var(--border)] px-2.5 py-1.5 text-[12px] text-[var(--muted)] hover:text-[var(--text)]">
            {editing ? '收起' : '配置'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 px-4 py-3 text-[12px]">
        <InfoLine label="账号" value={status?.account || channel.accountId || '未绑定'} />
        <InfoLine label="最近入站" value={status?.lastInboundAt ? formatTime(status.lastInboundAt) : '暂无'} />
        <InfoLine label="最近出站" value={status?.lastOutboundAt ? formatTime(status.lastOutboundAt) : '暂无'} />
        <InfoLine label="能力" value={capabilityText(status)} />
      </div>

      {status?.lastError && (
        <div className="mx-4 mb-3 rounded-[6px] border border-red-500/20 bg-red-500/5 px-3 py-2 text-[12px] text-[var(--bad)]">
          {status.lastError}
        </div>
      )}

      {editing && (
        <ChatChannelForm channel={channel} webhookUrl={webhookUrl} onSave={onSave} onCancel={onCancel} />
      )}
    </div>
  )
}

function BridgeMetric({ label, value, tone }: { label: string; value: string; tone?: 'warn' }) {
  return (
    <div className="rounded-[6px] border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
      <div className="text-[11px] text-[var(--muted)]">{label}</div>
      <div className={`mt-1 font-mono text-[14px] ${tone === 'warn' ? 'text-[var(--warn)]' : 'text-[var(--text)]'}`}>{value}</div>
    </div>
  )
}

function ChatBridgeRouteRow({
  route,
  busy,
  onReset,
  onNewSession,
  onUntrust,
}: {
  route: ChatBridgeRouteState
  busy: string | null
  onReset: () => void
  onNewSession: () => void
  onUntrust: () => void
}) {
  const isBusy = busy === `route-reset:${route.routeKey}` || busy === `route-new:${route.routeKey}` || busy === `route-untrust:${route.routeKey}`

  return (
    <div className="border-b border-[var(--border)] bg-[var(--surface)] px-4 py-3 last:border-b-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <span className={`h-2 w-2 shrink-0 rounded-full ${route.lastError ? 'bg-[var(--bad)]' : route.pending ? 'bg-[var(--warn)] animate-pulse' : 'bg-[var(--good)]'}`} />
            <span className="truncate text-[13px] font-medium text-[var(--text)]">{route.conversationName || route.routeKey}</span>
            <span className="rounded-[4px] bg-[var(--surface-2)] px-1.5 py-0.5 text-[10px] text-[var(--muted)]">{route.channelId}</span>
            <span className={`rounded-[4px] px-1.5 py-0.5 text-[10px] ${route.trusted ? 'bg-emerald-500/10 text-[var(--good)]' : 'bg-amber-500/10 text-[var(--warn)]'}`}>{route.trusted ? '可信' : '未配对'}</span>
          </div>
          <div className="mt-1 truncate font-mono text-[11px] text-[var(--muted)]">{route.sessionId || '未绑定会话'}</div>
          {route.lastText && <div className="mt-2 truncate text-[12px] text-[var(--muted)]">{route.lastText}</div>}
          {route.lastError && <div className="mt-2 truncate text-[12px] text-[var(--bad)]">{route.lastError}</div>}
        </div>
        <div className="shrink-0">
          <div className="grid grid-cols-3 gap-2 text-right">
            <RouteStat label="入" value={route.inboundCount} />
            <RouteStat label="出" value={route.outboundCount} />
            <RouteStat label="状态" value={route.pending ? '处理中' : '空闲'} />
          </div>
          <div className="mt-2 flex justify-end gap-2">
            <button
              onClick={onNewSession}
              disabled={isBusy}
              className="rounded-[6px] border border-[var(--border)] px-2 py-1 text-[11px] text-[var(--text)] hover:bg-[var(--surface-2)] disabled:opacity-50"
            >
              新会话
            </button>
            <button
              onClick={onReset}
              disabled={isBusy || !route.sessionId}
              className="rounded-[6px] border border-[var(--border)] px-2 py-1 text-[11px] text-[var(--muted)] hover:text-[var(--text)] disabled:opacity-50"
            >
              解绑
            </button>
            <button
              onClick={onUntrust}
              disabled={isBusy || !route.trusted}
              className="rounded-[6px] border border-[var(--border)] px-2 py-1 text-[11px] text-[var(--muted)] hover:text-[var(--text)] disabled:opacity-50"
            >
              取消信任
            </button>
          </div>
        </div>
      </div>
      <div className="mt-2 flex gap-3 text-[11px] text-[var(--muted)]">
        <span>{route.senderName || '未知发送者'}</span>
        <span>{route.lastInboundAt ? `入站 ${formatTime(route.lastInboundAt)}` : '暂无入站'}</span>
        <span>{route.lastOutboundAt ? `出站 ${formatTime(route.lastOutboundAt)}` : '暂无出站'}</span>
      </div>
    </div>
  )
}

function RouteStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="min-w-[52px] rounded-[6px] bg-[var(--surface-2)] px-2 py-1">
      <div className="text-[10px] text-[var(--muted)]">{label}</div>
      <div className="mt-0.5 truncate font-mono text-[11px] text-[var(--text)]">{value}</div>
    </div>
  )
}

function ChatChannelForm({ channel, webhookUrl, onSave, onCancel }: { channel: ChatChannelConfig; webhookUrl: string; onSave: (channel: ChatChannelConfig) => void; onCancel: () => void }) {
  const [draft, setDraft] = useState<ChatChannelConfig>(channel)
  const inputCls = 'w-full bg-[var(--surface-2)] border border-[var(--border)] rounded-[6px] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--border-strong)]'
  const labelCls = 'space-y-1.5 text-[12px] text-[var(--muted)]'

  useEffect(() => setDraft(channel), [channel])

  const update = (patch: Partial<ChatChannelConfig>) => setDraft(prev => ({ ...prev, ...patch }))
  const updateWeixin = (patch: NonNullable<ChatChannelConfig['weixin']>) => setDraft(prev => ({ ...prev, weixin: { ...(prev.weixin || {}), ...patch } }))
  const updateFeishu = (patch: NonNullable<ChatChannelConfig['feishu']>) => setDraft(prev => ({ ...prev, feishu: { ...(prev.feishu || {}), ...patch } }))
  const feishuPath = draft.feishu?.webhookPath || `/chat-bridge/feishu/${draft.id}`

  return (
    <div className="border-t border-[var(--border)] bg-[var(--surface-2)] px-4 py-4">
      <div className="grid grid-cols-2 gap-3">
        <label className={labelCls}>
          显示名称
          <input value={draft.label} onChange={(e) => update({ label: e.target.value })} className={inputCls} />
        </label>
        <label className={labelCls}>
          账号标识
          <input value={draft.accountId || ''} onChange={(e) => update({ accountId: e.target.value })} placeholder="default" className={inputCls} />
        </label>
        <label className="col-span-2 flex items-center gap-2 text-[12px] text-[var(--muted)]">
          <input type="checkbox" checked={draft.enabled} onChange={(e) => update({ enabled: e.target.checked })} />
          启用这个渠道
        </label>
      </div>

      {draft.kind === 'weixin' ? (
        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className={labelCls}>
            Base URL
            <input value={draft.weixin?.baseUrl || ''} onChange={(e) => updateWeixin({ baseUrl: e.target.value })} placeholder="https://ilinkai.weixin.qq.com" className={inputCls} />
          </label>
          <label className={labelCls}>
            Bot Type
            <input value={draft.weixin?.botType || ''} onChange={(e) => updateWeixin({ botType: e.target.value })} placeholder="3" className={inputCls} />
          </label>
          <label className={labelCls}>
            Channel Version
            <input value={draft.weixin?.channelVersion || ''} onChange={(e) => updateWeixin({ channelVersion: e.target.value })} placeholder="2.4.3" className={inputCls} />
          </label>
          <label className={labelCls}>
            Token
            <input type="password" value={draft.weixin?.token || ''} onChange={(e) => updateWeixin({ token: e.target.value })} placeholder="扫码后自动写入，也可手动粘贴" className={inputCls} />
          </label>
        </div>
      ) : (
        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className={labelCls}>
            App ID
            <input value={draft.feishu?.appId || ''} onChange={(e) => updateFeishu({ appId: e.target.value })} placeholder="cli_xxx" className={inputCls} />
          </label>
          <label className={labelCls}>
            App Secret
            <input type="password" value={draft.feishu?.appSecret || ''} onChange={(e) => updateFeishu({ appSecret: e.target.value })} placeholder="飞书应用密钥" className={inputCls} />
          </label>
          <label className={labelCls}>
            Verification Token
            <input type="password" value={draft.feishu?.verificationToken || ''} onChange={(e) => updateFeishu({ verificationToken: e.target.value })} placeholder="可选" className={inputCls} />
          </label>
          <label className={labelCls}>
            Encrypt Key
            <input type="password" value={draft.feishu?.encryptKey || ''} onChange={(e) => updateFeishu({ encryptKey: e.target.value })} placeholder="暂不解密，先预留" className={inputCls} />
          </label>
          <label className="col-span-2 space-y-1.5 text-[12px] text-[var(--muted)]">
            Webhook Path
            <input value={feishuPath} onChange={(e) => updateFeishu({ webhookPath: e.target.value })} className={inputCls} />
            <span className="block font-mono text-[11px] text-[var(--muted)]">{webhookUrl}{feishuPath}</span>
          </label>
        </div>
      )}

      <div className="mt-4 flex gap-2">
        <button onClick={() => onSave(draft)} className="rounded-[6px] bg-[var(--accent)] px-3 py-1.5 text-[12px] text-[var(--accent-ink)]">保存</button>
        <button onClick={onCancel} className="rounded-[6px] border border-[var(--border)] px-3 py-1.5 text-[12px] text-[var(--muted)] hover:text-[var(--text)]">取消</button>
      </div>
    </div>
  )
}

function ChatBridgeEventRow({ event }: { event: ChatBridgeEvent }) {
  return (
    <div className="border-b border-[var(--border)] px-4 py-2.5 last:border-b-0">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className={`h-2 w-2 shrink-0 rounded-full ${eventDotClass(event.kind)}`} />
          <span className="truncate text-[12px] text-[var(--text)]">{event.text}</span>
        </div>
        <span className="shrink-0 font-mono text-[11px] text-[var(--muted)]">{formatTime(event.timestamp)}</span>
      </div>
      <div className="mt-1 flex gap-2 font-mono text-[11px] text-[var(--muted)]">
        <span>{event.channelId}</span>
        {event.routeKey && <span className="truncate">{event.routeKey}</span>}
      </div>
    </div>
  )
}

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] text-[var(--muted)]">{label}</div>
      <div className="mt-0.5 truncate text-[12px] text-[var(--text)]">{value}</div>
    </div>
  )
}

function stateLabel(state: ChatChannelState): string {
  const labels: Record<ChatChannelState, string> = {
    stopped: '已停止',
    starting: '启动中',
    login_required: '待登录',
    connected: '已连接',
    degraded: '降级',
    failed: '失败',
  }
  return labels[state]
}

function stateDotClass(state: ChatChannelState): string {
  if (state === 'connected') return 'bg-[var(--good)]'
  if (state === 'starting') return 'bg-[var(--warn)] animate-pulse'
  if (state === 'failed' || state === 'degraded') return 'bg-[var(--bad)]'
  if (state === 'login_required') return 'bg-[var(--warn)]'
  return 'bg-[var(--muted)]'
}

function stateBadgeClass(state: ChatChannelState): string {
  if (state === 'connected') return 'bg-emerald-500/10 text-[var(--good)]'
  if (state === 'failed' || state === 'degraded') return 'bg-red-500/10 text-[var(--bad)]'
  if (state === 'login_required' || state === 'starting') return 'bg-amber-500/10 text-[var(--warn)]'
  return 'bg-[var(--surface-2)] text-[var(--muted)]'
}

function eventDotClass(kind: ChatBridgeEvent['kind']): string {
  if (kind === 'error') return 'bg-[var(--bad)]'
  if (kind === 'inbound') return 'bg-[var(--accent)]'
  if (kind === 'login') return 'bg-[var(--warn)]'
  return 'bg-[var(--good)]'
}

function capabilityText(status?: ChatBridgeSnapshot['channels'][number]): string {
  if (!status) return '未知'
  const caps = status.capabilities
  const items = [caps.text && '文本', caps.media && '媒体', caps.typing && 'Typing', caps.direct && '私聊', caps.group && '群聊'].filter(Boolean)
  return items.join(' / ') || '无'
}

function formatTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

function WeixinQrCode({ value }: { value?: string }) {
  const [src, setSrc] = useState<string | null>(null)
  const text = value?.trim() || ''

  useEffect(() => {
    let cancelled = false
    setSrc(null)
    if (!text) return
    if (/^data:image\//i.test(text)) {
      setSrc(text)
      return
    }
    QRCode.toDataURL(text, { errorCorrectionLevel: 'M', margin: 2, width: 240 })
      .then(url => {
        if (!cancelled) setSrc(url)
      })
      .catch(() => {
        if (!cancelled) setSrc(null)
      })
    return () => {
      cancelled = true
    }
  }, [text])

  if (!text) {
    return <p className="mt-2 text-[12px] text-[var(--muted)]">二维码内容为空</p>
  }

  return (
    <div className="mt-3 space-y-2">
      <div className="inline-flex h-[264px] w-[264px] items-center justify-center rounded-[8px] border border-[var(--border)] bg-white p-3">
        {src ? (
          <img src={src} alt="微信登录二维码" className="h-60 w-60" />
        ) : (
          <span className="text-[12px] text-zinc-500">二维码生成失败</span>
        )}
      </div>
      <p className="max-w-[360px] break-all font-mono text-[11px] text-[var(--muted)]">{text}</p>
    </div>
  )
}

/* ─── Models ─── */
function formatContextWindow(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(n % 1000000 === 0 ? 0 : 1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}K`
  return String(n)
}

function ModelsTab() {
  const groups = useModelStore((s) => s.groups)
  const activeModelId = useModelStore((s) => s.activeModelId)
  const addGroup = useModelStore((s) => s.addGroup)
  const removeGroup = useModelStore((s) => s.removeGroup)
  const updateGroup = useModelStore((s) => s.updateGroup)
  const addModel = useModelStore((s) => s.addModel)
  const updateModel = useModelStore((s) => s.updateModel)
  const removeModel = useModelStore((s) => s.removeModel)
  const loadFromConfig = useModelStore((s) => s.loadFromConfig)
  const [expandedGroupId, setExpandedGroupId] = useState<string | null>(null)
  const [showNewGroup, setShowNewGroup] = useState(false)
  const [newGroupName, setNewGroupName] = useState('')
  const [newGroupProtocol, setNewGroupProtocol] = useState<ApiProtocol>('anthropic')
  const [newGroupUrl, setNewGroupUrl] = useState('')
  const [newGroupKey, setNewGroupKey] = useState('')

  useEffect(() => { loadFromConfig() }, [loadFromConfig])
  useEffect(() => {
    if (!activeModelId) return
    const activeGroup = groups.find((group) => group.models.some((model) => model.id === activeModelId))
    if (activeGroup) setExpandedGroupId(activeGroup.id)
  }, [activeModelId, groups])

  const handleAddGroup = () => {
    if (!newGroupName.trim()) return
    addGroup(newGroupName.trim(), newGroupProtocol, newGroupUrl.trim(), newGroupKey.trim())
    setNewGroupName('')
    setNewGroupProtocol('anthropic')
    setNewGroupUrl('')
    setNewGroupKey('')
    setShowNewGroup(false)
  }

  const inputCls = 'w-full bg-[var(--surface-2)] border border-[var(--border)] rounded-[6px] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--border-strong)]'
  const btnPrimary = 'bg-[var(--accent)] text-[var(--accent-ink)] rounded-[6px] px-3 py-1.5 text-[12px]'
  const btnGhost = 'border border-[var(--border)] rounded-[6px] px-3 py-1.5 text-[12px] text-[var(--muted)] hover:text-[var(--text)]'

  return (
    <div>
      <button onClick={() => setShowNewGroup(true)} className={btnPrimary + ' mb-4'}>
        + 新建分组
      </button>

      {showNewGroup && (
        <div className="mb-4 border border-[var(--border)] rounded-[6px] p-4 space-y-3">
          <input value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)} placeholder="分组名称" className={inputCls} />
          <ProtocolSelect value={newGroupProtocol} onChange={setNewGroupProtocol} />
          <input value={newGroupUrl} onChange={(e) => setNewGroupUrl(e.target.value)} placeholder="Base URL" className={inputCls} />
          <input type="password" value={newGroupKey} onChange={(e) => setNewGroupKey(e.target.value)} placeholder="API Key" className={inputCls} />
          <div className="flex gap-2">
            <button onClick={handleAddGroup} className={btnPrimary}>确认</button>
            <button onClick={() => setShowNewGroup(false)} className={btnGhost}>取消</button>
          </div>
        </div>
      )}

      {groups.map((group) => (
        <ModelGroupCard
          key={group.id}
          group={group}
          expanded={expandedGroupId === group.id}
          onToggle={() => setExpandedGroupId(expandedGroupId === group.id ? null : group.id)}
          onDelete={() => removeGroup(group.id)}
          onUpdate={(updates) => updateGroup(group.id, updates)}
          onAddModel={(model) => addModel(group.id, model)}
          onUpdateModel={(modelId, updates) => updateModel(group.id, modelId, updates)}
          onRemoveModel={(modelId) => removeModel(group.id, modelId)}
        />
      ))}

      {groups.length === 0 && !showNewGroup && (
        <p className="text-[13px] text-[var(--muted)] text-center py-8">暂无分组，点击上方按钮创建</p>
      )}
    </div>
  )
}

/* ─── Model Edit Form ─── */
function ModelEditForm({ model, inputCls, onSave, onCancel }: {
  model: { modelId: string; name: string; contextWindow: number; maxTokens: number; compressAt: number }
  inputCls: string
  onSave: (updates: { modelId: string; name: string; contextWindow: number; maxTokens: number; compressAt: number }) => void
  onCancel: () => void
}) {
  const [name, setName] = useState(model.name)
  const [modelId, setModelId] = useState(model.modelId)
  const [ctx, setCtx] = useState(String(model.contextWindow))
  const [maxTokens, setMaxTokens] = useState(String(model.maxTokens || 32000))
  const [compress, setCompress] = useState(String(Math.round(model.compressAt * 100)))
  const btnPrimary = 'bg-[var(--accent)] text-[var(--accent-ink)] rounded-[6px] px-3 py-1.5 text-[12px]'
  const btnGhost = 'border border-[var(--border)] rounded-[6px] px-3 py-1.5 text-[12px] text-[var(--muted)] hover:text-[var(--text)]'

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="显示名称" className={inputCls} />
        <input value={modelId} onChange={(e) => setModelId(e.target.value)} placeholder="Model ID" className={inputCls} />
        <input value={ctx} onChange={(e) => setCtx(e.target.value)} placeholder="200000" type="number" className={inputCls + ' [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none'} />
        <input value={maxTokens} onChange={(e) => setMaxTokens(e.target.value)} placeholder="32000" type="number" className={inputCls + ' [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none'} />
        <input value={compress} onChange={(e) => setCompress(e.target.value)} placeholder="90" type="number" className={inputCls + ' [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none'} />
      </div>
      <div className="flex gap-2">
        <button onClick={() => onSave({ name: name.trim(), modelId: modelId.trim(), contextWindow: parseInt(ctx) || 200000, maxTokens: parseInt(maxTokens) || 32000, compressAt: (parseInt(compress) || 90) / 100 })} className={btnPrimary}>保存</button>
        <button onClick={onCancel} className={btnGhost}>取消</button>
      </div>
    </div>
  )
}

/* ─── Model Group Card ─── */
interface ModelGroupCardProps {
  group: ModelGroup
  expanded: boolean
  onToggle: () => void
  onDelete: () => void
  onUpdate: (updates: Partial<Omit<ModelGroup, 'id' | 'models'>>) => void
  onAddModel: (model: { modelId: string; name: string; contextWindow: number; maxTokens: number; compressAt: number }) => void
  onUpdateModel: (modelId: string, updates: Partial<{ modelId: string; name: string; contextWindow: number; maxTokens: number; compressAt: number }>) => void
  onRemoveModel: (modelId: string) => void
}

function ModelGroupCard({ group, expanded, onToggle, onDelete, onUpdate, onAddModel, onUpdateModel, onRemoveModel }: ModelGroupCardProps) {
  const activeModelId = useModelStore((s) => s.activeModelId)
  const [editUrl, setEditUrl] = useState(group.baseUrl)
  const [editKey, setEditKey] = useState(group.apiKey)
  const [editName, setEditName] = useState(group.name)
  const [editingName, setEditingName] = useState(false)
  const [showAddModel, setShowAddModel] = useState(false)
  const [editingModelId, setEditingModelId] = useState<string | null>(null)
  const [mName, setMName] = useState('')
  const [mId, setMId] = useState('')
  const [mCtx, setMCtx] = useState('200000')
  const [mMaxTokens, setMMaxTokens] = useState('32000')
  const [mCompress, setMCompress] = useState('90')
  const [testing, setTesting] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<{ id: string; success: boolean; msg: string } | null>(null)

  const inputCls = 'w-full bg-[var(--surface-2)] border border-[var(--border)] rounded-[6px] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--border-strong)]'
  const btnPrimary = 'bg-[var(--accent)] text-[var(--accent-ink)] rounded-[6px] px-3 py-1.5 text-[12px]'
  const btnGhost = 'border border-[var(--border)] rounded-[6px] px-3 py-1.5 text-[12px] text-[var(--muted)] hover:text-[var(--text)]'

  const handleTestModel = async (modelId: string, modelEntryId: string) => {
    setTesting(modelEntryId)
    setTestResult(null)
    const result = await window.electronAPI?.modelTest?.({ protocol: group.protocol, baseUrl: group.baseUrl, apiKey: group.apiKey, modelId })
    if (result?.success) {
      setTestResult({ id: modelEntryId, success: true, msg: result.reply || '' })
    } else {
      setTestResult({ id: modelEntryId, success: false, msg: result?.error || '连接失败' })
    }
    setTesting(null)
  }

  const handleAddModel = () => {
    if (!mName.trim() || !mId.trim()) return
    onAddModel({
      name: mName.trim(),
      modelId: mId.trim(),
      contextWindow: parseInt(mCtx) || 200000,
      maxTokens: parseInt(mMaxTokens) || 32000,
      compressAt: (parseInt(mCompress) || 90) / 100,
    })
    setMName('')
    setMId('')
    setMCtx('200000')
    setMMaxTokens('32000')
    setMCompress('90')
    setShowAddModel(false)
  }

  return (
    <div className="mb-3 border border-[var(--border)] rounded-[6px] overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-[var(--surface-2)] transition-colors" onClick={onToggle}>
        <div className="flex items-center gap-2">
          <span className="text-[12px] text-[var(--muted)]">{expanded ? '▼' : '▶'}</span>
          {editingName ? (
            <input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onBlur={() => { onUpdate({ name: editName }); setEditingName(false) }}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { onUpdate({ name: editName }); setEditingName(false) } }}
              onClick={(e) => e.stopPropagation()}
              autoFocus
              className="text-[13px] text-[var(--text)] font-medium bg-[var(--surface-2)] border border-[var(--border)] rounded px-1.5 py-0.5 outline-none w-32"
            />
          ) : (
            <span className="text-[13px] text-[var(--text)] font-medium" onDoubleClick={(e) => { e.stopPropagation(); setEditingName(true) }}>{group.name}</span>
          )}
          <select
            value={group.protocol}
            onChange={(e) => { e.stopPropagation(); onUpdate({ protocol: e.target.value as ApiProtocol }) }}
            onClick={(e) => e.stopPropagation()}
            className="text-[11px] text-[var(--muted)] border border-[var(--border)] rounded px-1.5 py-0.5 bg-transparent outline-none cursor-pointer"
          >
            <option value="anthropic">anthropic</option>
            <option value="openai">openai</option>
            <option value="openai-responses">openai-responses</option>
          </select>
        </div>
        <button onClick={(e) => { e.stopPropagation(); onDelete() }} className="text-[12px] text-[var(--muted)] hover:text-red-500 transition-colors">
          删除
        </button>
      </div>
      {expanded && (
        <div className="border-t border-[var(--border)] px-4 py-4 space-y-3">
          <input value={editUrl} onChange={(e) => setEditUrl(e.target.value)} onBlur={() => onUpdate({ baseUrl: editUrl })} placeholder="Base URL" className={inputCls} />
          <input type="password" value={editKey} onChange={(e) => setEditKey(e.target.value)} onBlur={() => onUpdate({ apiKey: editKey })} placeholder="API Key" className={inputCls} />

          <div className="space-y-2">
            {group.models.map((model) => (
              <div key={model.id} className="border border-[var(--border)] rounded-[6px] px-3 py-2 space-y-1">
                {editingModelId === model.id ? (
                  <ModelEditForm
                    model={model}
                    inputCls={inputCls}
                    onSave={(updates) => { onUpdateModel(model.id, updates); setEditingModelId(null) }}
                    onCancel={() => setEditingModelId(null)}
                  />
                ) : (
                  <>
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <div className="text-[13px] text-[var(--text)]">{model.name}</div>
                          {model.id === activeModelId && (
                            <span className="rounded-[4px] bg-[var(--accent-soft)] px-1.5 py-0.5 text-[10px] text-[var(--accent)]">
                              当前
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-[var(--muted)]">
                          {model.modelId} &middot; {formatContextWindow(model.contextWindow)} &middot; 输出 {formatContextWindow(model.maxTokens || 32000)} &middot; {Math.round(model.compressAt * 100)}%
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleTestModel(model.modelId, model.id)}
                          disabled={testing === model.id}
                          className="text-[12px] text-[var(--accent)] hover:opacity-80 transition-colors disabled:opacity-50"
                        >
                          {testing === model.id ? '测试中...' : '测试'}
                        </button>
                        <button onClick={() => setEditingModelId(model.id)} className="text-[12px] text-[var(--accent)] hover:opacity-80 transition-colors">编辑</button>
                        <button onClick={() => onRemoveModel(model.id)} className="text-[12px] text-[var(--muted)] hover:text-red-500 transition-colors">删除</button>
                      </div>
                    </div>
                    {testResult?.id === model.id && (
                      <div className={`text-[11px] ${testResult.success ? 'text-[var(--good)]' : 'text-[var(--bad)]'}`}>
                        {testResult.success ? '✓' : '✗'} {testResult.msg}
                      </div>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>

          {showAddModel ? (
            <div className="border border-[var(--border)] rounded-[6px] p-3 space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <input value={mName} onChange={(e) => setMName(e.target.value)} placeholder="显示名称" className={inputCls} />
                <input value={mId} onChange={(e) => setMId(e.target.value)} placeholder="Model ID" className={inputCls} />
                <div className="relative">
                  <input value={mCtx} onChange={(e) => setMCtx(e.target.value)} placeholder="200000" type="number" className={inputCls + ' pr-8 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none'} />
                  <span className="absolute right-2 top-1/2 -translate-y-1/2"><Tooltip text="上下文窗口大小 (tokens)"><span className="text-[var(--muted)] cursor-help">ⓘ</span></Tooltip></span>
                </div>
                <div className="relative">
                  <input value={mMaxTokens} onChange={(e) => setMMaxTokens(e.target.value)} placeholder="32000" type="number" className={inputCls + ' pr-8 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none'} />
                  <span className="absolute right-2 top-1/2 -translate-y-1/2"><Tooltip text="最大输出 tokens"><span className="text-[var(--muted)] cursor-help">ⓘ</span></Tooltip></span>
                </div>
                <div className="relative">
                  <input value={mCompress} onChange={(e) => setMCompress(e.target.value)} placeholder="90" type="number" className={inputCls + ' pr-8 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none'} />
                  <span className="absolute right-2 top-1/2 -translate-y-1/2"><Tooltip text="压缩阈值 (%)"><span className="text-[var(--muted)] cursor-help">ⓘ</span></Tooltip></span>
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={handleAddModel} className={btnPrimary}>添加</button>
                <button onClick={() => setShowAddModel(false)} className={btnGhost}>取消</button>
              </div>
            </div>
          ) : (
            <button onClick={() => setShowAddModel(true)} className={btnGhost}>+ 添加模型</button>
          )}
        </div>
      )}
    </div>
  )
}

/* ─── MCP ─── */
type McpConfigDraft = McpServerState['config']
type McpSaveScope = 'global' | 'project'

function serversToConfig(servers: McpServerState[]): Record<string, McpConfigDraft> {
  return servers.reduce<Record<string, McpConfigDraft>>((acc, server) => {
    acc[server.name] = server.config
    return acc
  }, {})
}

function parseArgs(input: string): string[] {
  return Array.from(input.matchAll(/"([^"]*)"|'([^']*)'|[^\s]+/g))
    .map((match) => match[1] ?? match[2] ?? match[0])
    .filter(Boolean)
}

function formatKeyValueLines(values?: Record<string, string>): string {
  if (!values) return ''
  return Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n')
}

function parseKeyValueLines(input: string): Record<string, string> | undefined {
  const entries = input
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const index = line.indexOf('=')
      if (index === -1) return null
      return [line.slice(0, index).trim(), line.slice(index + 1).trim()] as const
    })
    .filter((entry): entry is readonly [string, string] => Boolean(entry?.[0]))
  if (entries.length === 0) return undefined
  return Object.fromEntries(entries)
}

function McpServerForm({
  initialName = '',
  initialConfig,
  existingNames,
  activeProjectCwd,
  onSave,
  onCancel,
}: {
  initialName?: string
  initialConfig?: McpConfigDraft
  existingNames: string[]
  activeProjectCwd: string
  onSave: (name: string, config: McpConfigDraft, scope: McpSaveScope, previousName?: string) => void
  onCancel: () => void
}) {
  const [name, setName] = useState(initialName)
  const [scope, setScope] = useState<McpSaveScope>('global')
  const [transport, setTransport] = useState<'stdio' | 'sse'>(initialConfig?.transport || 'stdio')
  const [command, setCommand] = useState(initialConfig?.command || '')
  const [args, setArgs] = useState(initialConfig?.args?.join(' ') || '')
  const [url, setUrl] = useState(initialConfig?.url || '')
  const [env, setEnv] = useState(formatKeyValueLines(initialConfig?.env))
  const [headers, setHeaders] = useState(formatKeyValueLines(initialConfig?.headers))
  const [disabled, setDisabled] = useState(Boolean(initialConfig?.disabled))
  const [error, setError] = useState('')
  const inputCls = 'w-full bg-[var(--surface-2)] border border-[var(--border)] rounded-[6px] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--border-strong)]'
  const labelCls = 'space-y-1.5 text-[12px] text-[var(--muted)]'

  const submit = () => {
    const nextName = name.trim()
    if (!nextName) {
      setError('请输入服务器名称')
      return
    }
    if (nextName !== initialName && existingNames.includes(nextName)) {
      setError('服务器名称已存在')
      return
    }
    const config: McpConfigDraft = transport === 'stdio'
      ? {
          transport,
          command: command.trim(),
          args: parseArgs(args),
          env: parseKeyValueLines(env),
          disabled,
        }
      : {
          transport,
          url: url.trim(),
          headers: parseKeyValueLines(headers),
          disabled,
        }
    if (transport === 'stdio' && !config.command) {
      setError('请输入启动命令')
      return
    }
    if (transport === 'sse' && !config.url) {
      setError('请输入 SSE URL')
      return
    }
    onSave(nextName, config, scope, initialName || undefined)
  }

  return (
    <div className="border border-[var(--border)] rounded-[8px] p-4 space-y-3 bg-[var(--surface)]">
      <div className="grid grid-cols-2 gap-3">
        <label className={labelCls}>
          名称
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="filesystem" className={inputCls} />
        </label>
        <label className={labelCls}>
          保存位置
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value as McpSaveScope)}
            className={inputCls}
          >
            <option value="global">全局</option>
            <option value="project" disabled={!activeProjectCwd}>当前项目</option>
          </select>
        </label>
      </div>

      <div className="flex rounded-[6px] border border-[var(--border)] overflow-hidden w-fit">
        {(['stdio', 'sse'] as const).map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setTransport(item)}
            className={`px-3 py-1.5 text-[12px] transition-colors ${
              transport === item ? 'bg-[var(--accent)] text-[var(--accent-ink)]' : 'text-[var(--muted)] hover:bg-[var(--surface-2)]'
            }`}
          >
            {item}
          </button>
        ))}
      </div>

      {transport === 'stdio' ? (
        <>
          <label className={labelCls}>
            命令
            <input value={command} onChange={(e) => setCommand(e.target.value)} placeholder="npx" className={inputCls} />
          </label>
          <label className={labelCls}>
            参数
            <input value={args} onChange={(e) => setArgs(e.target.value)} placeholder="-y @modelcontextprotocol/server-filesystem /path" className={inputCls} />
          </label>
          <label className={labelCls}>
            环境变量
            <textarea value={env} onChange={(e) => setEnv(e.target.value)} placeholder="KEY=value" rows={3} className={inputCls + ' resize-none'} />
          </label>
        </>
      ) : (
        <>
          <label className={labelCls}>
            URL
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/sse" className={inputCls} />
          </label>
          <label className={labelCls}>
            Headers
            <textarea value={headers} onChange={(e) => setHeaders(e.target.value)} placeholder="Authorization=Bearer token" rows={3} className={inputCls + ' resize-none'} />
          </label>
        </>
      )}

      <label className="flex items-center gap-2 text-[12px] text-[var(--muted)]">
        <input type="checkbox" checked={disabled} onChange={(e) => setDisabled(e.target.checked)} />
        保存后保持禁用
      </label>
      {error && <div className="text-[12px] text-[var(--bad)]">{error}</div>}
      <div className="flex gap-2">
        <button onClick={submit} className="bg-[var(--accent)] text-[var(--accent-ink)] rounded-[6px] px-3 py-1.5 text-[12px]">保存</button>
        <button onClick={onCancel} className="border border-[var(--border)] rounded-[6px] px-3 py-1.5 text-[12px] text-[var(--muted)] hover:text-[var(--text)]">取消</button>
      </div>
    </div>
  )
}

function McpTab() {
  const [servers, setServers] = useState<McpServerState[]>([])
  const [expanded, setExpanded] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [formServerName, setFormServerName] = useState<string | null | 'new'>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const projects = useSessionStore((s) => s.projects)
  const activeSessionId = useSessionStore((s) => s.activeSessionId)
  const activeProject = projects.find((p) => p.sessions.some((s) => s.id === activeSessionId))
  const cwd = activeProject?.cwd || ''

  const loadServers = useCallback(async () => {
    setLoading(true)
    try {
      const states = await window.electronAPI?.mcpListServers()
      setServers(states ?? [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadServers()
    const unsubscribe = window.electronAPI?.onMcpStateChanged((states) => {
      setServers(states)
    })
    return () => { unsubscribe?.() }
  }, [loadServers])

  const statusDot = (status: string) => {
    switch (status) {
      case 'connected': return <span className="text-green-500">●</span>
      case 'connecting': return <span className="text-yellow-400 animate-pulse">●</span>
      case 'failed': return <span className="text-red-500">●</span>
      case 'disabled': return <span className="text-[var(--muted)]">○</span>
      default: return <span className="text-[var(--muted)]">●</span>
    }
  }

  const saveConfig = async (nextConfig: Record<string, McpConfigDraft>, scope: McpSaveScope) => {
    setSaving(true)
    setError('')
    try {
      await window.electronAPI?.mcpSaveConfig(nextConfig, scope, scope === 'project' ? cwd : undefined)
      await loadServers()
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存 MCP 配置失败')
    } finally {
      setSaving(false)
    }
  }

  const handleReconnect = async (name: string) => {
    await window.electronAPI?.mcpReconnect(name)
    await loadServers()
  }

  const handleToggle = async (name: string, enabled: boolean) => {
    const allServers = serversToConfig(servers)
    allServers[name] = { ...allServers[name], disabled: !enabled } as McpConfigDraft
    await saveConfig(allServers, 'global')
  }

  const handleDelete = async (name: string) => {
    const allServers = serversToConfig(servers)
    delete allServers[name]
    await saveConfig(allServers, 'global')
  }

  const handleSaveServer = async (name: string, config: McpConfigDraft, scope: McpSaveScope, previousName?: string) => {
    const allServers = serversToConfig(servers)
    if (previousName && previousName !== name) delete allServers[previousName]
    allServers[name] = config
    await saveConfig(allServers, scope)
    setFormServerName(null)
    setExpanded(name)
  }

  if (loading) return <p className="text-[13px] text-[var(--muted)] animate-pulse">加载中...</p>
  const editingServer = typeof formServerName === 'string' && formServerName !== 'new'
    ? servers.find((server) => server.name === formServerName)
    : undefined

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between pr-8">
        <div>
          <h3 className="text-[13px] font-medium text-[var(--text)]">MCP</h3>
          <p className="mt-1 text-[12px] text-[var(--muted)]">管理 MCP 服务器。</p>
        </div>
        <button
          type="button"
          onClick={() => setFormServerName('new')}
          disabled={saving}
          className="bg-[var(--accent)] text-[var(--accent-ink)] rounded-[6px] px-3 py-1.5 text-[12px] disabled:opacity-50"
        >
          新增 MCP
        </button>
      </div>
      {error && <div className="text-[12px] text-[var(--bad)]">{error}</div>}
      {formServerName && (
        <McpServerForm
          initialName={editingServer?.name}
          initialConfig={editingServer?.config}
          existingNames={servers.map((server) => server.name)}
          activeProjectCwd={cwd}
          onSave={handleSaveServer}
          onCancel={() => setFormServerName(null)}
        />
      )}

      {servers.length === 0 && <p className="text-[13px] text-[var(--muted)] text-center py-4">暂无 MCP 服务器配置</p>}
      {servers.map((server) => (
        <div key={server.name} className="border border-[var(--border)] rounded-[6px] overflow-hidden">
          <div
            className="flex items-center justify-between px-3 py-2.5 cursor-pointer hover:bg-[var(--surface-2)] transition-colors"
            onClick={() => setExpanded(expanded === server.name ? null : server.name)}
          >
            <div className="flex items-center gap-2">
              {statusDot(server.status)}
              <span className="text-[13px] text-[var(--text)]">{server.name}</span>
              <span className="text-[11px] text-[var(--muted)] border border-[var(--border)] rounded px-1.5 py-0.5">{server.config.transport}</span>
              {server.status === 'connected' && (
                <span className="text-[11px] text-[var(--muted)]">{server.tools.length} 个工具</span>
              )}
            </div>
            <span className="text-[11px] text-[var(--muted)]">{expanded === server.name ? '▼' : '▶'}</span>
          </div>

          {expanded === server.name && (
            <div className="border-t border-[var(--border)] px-3 py-3 space-y-2">
              <div className="text-[12px] text-[var(--muted)]">
                {server.config.transport === 'stdio' && <span>CMD: {server.config.command} {server.config.args?.join(' ')}</span>}
                {server.config.transport === 'sse' && <span>URL: {server.config.url}</span>}
              </div>
              {server.error && <div className="text-[12px] text-red-500 break-all">错误: {server.error}</div>}
              {server.tools.length > 0 && (
                <div className="max-h-[160px] overflow-y-auto space-y-0.5">
                  {server.tools.map((tool) => (
                    <div key={tool.name} className="text-[12px] text-[var(--text)] pl-2">
                      <span className="text-green-500 mr-1">*</span>{tool.name}
                      {tool.description && <span className="text-[var(--muted)] ml-1">- {tool.description}</span>}
                    </div>
                  ))}
                </div>
              )}
              <div className="flex gap-2 pt-2 border-t border-[var(--border)]">
                {server.status === 'failed' && (
                  <button onClick={() => handleReconnect(server.name)} className="text-[12px] text-yellow-500 hover:text-yellow-400">重连</button>
                )}
                {server.status !== 'disabled' && server.status !== 'connecting' && (
                  <button onClick={() => handleToggle(server.name, false)} className="text-[12px] text-[var(--muted)] hover:text-red-500">禁用</button>
                )}
                {server.status === 'disabled' && (
                  <button onClick={() => handleToggle(server.name, true)} className="text-[12px] text-[var(--muted)] hover:text-green-500">启用</button>
                )}
                <button onClick={() => setFormServerName(server.name)} className="text-[12px] text-[var(--muted)] hover:text-[var(--text)]">编辑</button>
                <button onClick={() => handleDelete(server.name)} className="text-[12px] text-[var(--muted)] hover:text-red-500">删除</button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

/* ─── Plugins ─── */
function PluginsTab() {
  const [marketplaces, setMarketplaces] = useState<PluginMarketplace[]>([])
  const [plugins, setPlugins] = useState<MarketplacePlugin[]>([])
  const [errors, setErrors] = useState<{ marketplaceId: string; message: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [newMarketplace, setNewMarketplace] = useState('')
  const [filter, setFilter] = useState('')
  const [activeView, setActiveView] = useState<'discover' | 'installed' | 'marketplaces'>('discover')
  const [error, setError] = useState('')

  const loadPlugins = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [nextMarketplaces, result] = await Promise.all([
        window.electronAPI?.pluginsListMarketplaces(),
        window.electronAPI?.pluginsList(),
      ])
      setMarketplaces(nextMarketplaces ?? [])
      setPlugins(result?.plugins ?? [])
      setErrors(result?.errors ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载插件失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadPlugins()
  }, [loadPlugins])

  const addMarketplace = async () => {
    const source = newMarketplace.trim()
    if (!source) return
    setAdding(true)
    setError('')
    try {
      const next = await window.electronAPI?.pluginsAddMarketplace(source)
      setMarketplaces(next ?? [])
      setNewMarketplace('')
      await loadPlugins()
      setActiveView('discover')
    } catch (err) {
      setError(err instanceof Error ? err.message : '添加 Marketplace 失败')
    } finally {
      setAdding(false)
    }
  }

  const removeMarketplace = async (id: string) => {
    setError('')
    try {
      const next = await window.electronAPI?.pluginsRemoveMarketplace(id)
      setMarketplaces(next ?? [])
      await loadPlugins()
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除 Marketplace 失败')
    }
  }

  const installPlugin = async (plugin: MarketplacePlugin) => {
    setError('')
    try {
      await window.electronAPI?.pluginsInstall(plugin)
      await loadPlugins()
    } catch (err) {
      setError(err instanceof Error ? err.message : '安装插件失败')
    }
  }

  const uninstallPlugin = async (id: string) => {
    setError('')
    try {
      await window.electronAPI?.pluginsUninstall(id)
      await loadPlugins()
    } catch (err) {
      setError(err instanceof Error ? err.message : '卸载插件失败')
    }
  }

  const setPluginEnabled = async (id: string, enabled: boolean) => {
    setError('')
    try {
      await window.electronAPI?.pluginsSetEnabled(id, enabled)
      await loadPlugins()
    } catch (err) {
      setError(err instanceof Error ? err.message : '更新插件状态失败')
    }
  }

  const filteredPlugins = plugins.filter((plugin) => {
    const query = filter.trim().toLowerCase()
    if (!query) return true
    return (
      plugin.name.toLowerCase().includes(query) ||
      plugin.marketplaceName.toLowerCase().includes(query) ||
      plugin.description?.toLowerCase().includes(query)
    )
  })
  const installedPlugins = plugins.filter((plugin) => plugin.installed)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between pr-8">
        <div>
          <h3 className="text-[13px] font-medium text-[var(--text)]">插件</h3>
          <p className="mt-1 text-[12px] text-[var(--muted)]">从 Marketplaces 发现可用插件。</p>
        </div>
        <button
          type="button"
          onClick={loadPlugins}
          disabled={loading}
          className="border border-[var(--border)] rounded-[6px] px-3 py-1.5 text-[12px] text-[var(--muted)] hover:text-[var(--text)] disabled:opacity-50"
        >
          刷新
        </button>
      </div>

      <div className="flex rounded-[6px] border border-[var(--border)] overflow-hidden w-fit">
        {([
          ['discover', 'Discover'],
          ['installed', 'Installed'],
          ['marketplaces', 'Marketplaces'],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setActiveView(key)}
            className={`px-3 py-1.5 text-[12px] transition-colors ${
              activeView === key ? 'bg-[var(--accent)] text-[var(--accent-ink)]' : 'text-[var(--muted)] hover:bg-[var(--surface-2)]'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {error && <div className="text-[12px] text-[var(--bad)]">{error}</div>}
      {errors.length > 0 && (
        <div className="space-y-1 rounded-[6px] border border-[var(--bad)]/30 bg-[var(--surface-2)] p-3">
          {errors.map((item) => (
            <div key={item.marketplaceId} className="text-[12px] text-[var(--bad)]">
              {item.marketplaceId}: {item.message}
            </div>
          ))}
        </div>
      )}

      {activeView === 'discover' ? (
        <div className="space-y-3">
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="搜索插件"
            className="w-full bg-[var(--surface-2)] border border-[var(--border)] rounded-[6px] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--border-strong)]"
          />
          {loading && <p className="text-[13px] text-[var(--muted)] animate-pulse">加载中...</p>}
          {!loading && filteredPlugins.length === 0 && (
            <p className="text-[13px] text-[var(--muted)] text-center py-8">暂无插件</p>
          )}
          {!loading && filteredPlugins.map((plugin) => (
            <div key={plugin.id} className="border border-[var(--border)] rounded-[6px] px-3 py-2.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-medium text-[var(--text)]">{plugin.name}</span>
                    <span className="text-[10px] text-[var(--muted)] border border-[var(--border)] rounded px-1.5 py-0.5">
                      {plugin.marketplaceName}
                    </span>
                    {plugin.version && <span className="font-mono text-[10px] text-[var(--muted)]">{plugin.version}</span>}
                  </div>
                  {plugin.description && <p className="mt-1 text-[12px] text-[var(--muted)]">{plugin.description}</p>}
                  {plugin.path && <p className="mt-1 font-mono text-[11px] text-[var(--muted)]">{plugin.path}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {plugin.installed ? (
                    <span className={`text-[11px] ${plugin.enabled === false ? 'text-[var(--muted)]' : 'text-[var(--good)]'}`}>
                      {plugin.enabled === false ? '已安装未启动' : '已安装'}
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => installPlugin(plugin)}
                      className="rounded-[6px] bg-[var(--accent)] px-3 py-1.5 text-[12px] text-[var(--accent-ink)]"
                    >
                      安装
                    </button>
                  )}
                  {plugin.url && (
                    <button
                      type="button"
                      onClick={() => window.open(plugin.url)}
                      className="text-[12px] text-[var(--muted)] hover:text-[var(--text)]"
                    >
                      查看
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : activeView === 'installed' ? (
        <div className="space-y-3">
          {loading && <p className="text-[13px] text-[var(--muted)] animate-pulse">加载中...</p>}
          {!loading && installedPlugins.length === 0 && (
            <p className="text-[13px] text-[var(--muted)] text-center py-8">暂无已安装插件</p>
          )}
          {!loading && installedPlugins.map((plugin) => (
            <div key={plugin.id} className="border border-[var(--border)] rounded-[6px] px-3 py-2.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-medium text-[var(--text)]">{plugin.name}</span>
                    <span className="text-[10px] text-[var(--muted)] border border-[var(--border)] rounded px-1.5 py-0.5">
                      {plugin.marketplaceName}
                    </span>
                    <span className={`text-[10px] ${plugin.enabled === false ? 'text-[var(--muted)]' : 'text-[var(--good)]'}`}>
                      {plugin.enabled === false ? '未启动' : '已启动'}
                    </span>
                  </div>
                  {plugin.description && <p className="mt-1 text-[12px] text-[var(--muted)]">{plugin.description}</p>}
                  {plugin.path && <p className="mt-1 font-mono text-[11px] text-[var(--muted)]">{plugin.path}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setPluginEnabled(plugin.id, plugin.enabled === false)}
                    className="text-[12px] text-[var(--muted)] hover:text-[var(--text)]"
                  >
                    {plugin.enabled === false ? '启动' : '不启动'}
                  </button>
                  <button
                    type="button"
                    onClick={() => uninstallPlugin(plugin.id)}
                    className="text-[12px] text-[var(--muted)] hover:text-[var(--bad)]"
                  >
                    卸载
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="border border-[var(--border)] rounded-[8px] p-3 space-y-2">
            <div className="text-[12px] text-[var(--muted)]">添加 Marketplace URL 或 owner/repo</div>
            <div className="flex gap-2">
              <input
                value={newMarketplace}
                onChange={(e) => setNewMarketplace(e.target.value)}
                placeholder="anthropics/claude-plugins-official"
                className="min-w-0 flex-1 bg-[var(--surface-2)] border border-[var(--border)] rounded-[6px] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--border-strong)]"
              />
              <button
                type="button"
                onClick={addMarketplace}
                disabled={adding || !newMarketplace.trim()}
                className="bg-[var(--accent)] text-[var(--accent-ink)] rounded-[6px] px-3 py-1.5 text-[12px] disabled:opacity-50"
              >
                添加
              </button>
            </div>
          </div>

          {marketplaces.map((marketplace) => {
            const isDefault = marketplace.id === 'anthropics/claude-plugins-official'
            return (
              <div key={marketplace.id} className="border border-[var(--border)] rounded-[6px] px-3 py-2.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-medium text-[var(--text)]">{marketplace.name}</span>
                      {isDefault && <span className="text-[10px] text-[var(--muted)] border border-[var(--border)] rounded px-1.5 py-0.5">默认</span>}
                    </div>
                    <div className="mt-1 truncate font-mono text-[11px] text-[var(--muted)]">{marketplace.source}</div>
                  </div>
                  {!isDefault && (
                    <button
                      type="button"
                      onClick={() => removeMarketplace(marketplace.id)}
                      className="shrink-0 text-[12px] text-[var(--muted)] hover:text-[var(--bad)]"
                    >
                      删除
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/* ─── Skills ─── */
function SkillsTab() {
  const [skills, setSkills] = useState<SkillListItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [busySkill, setBusySkill] = useState<string | null>(null)
  const activeSessionId = useSessionStore((s) => s.activeSessionId)

  const loadSkills = useCallback(async () => {
    if (!activeSessionId) {
      setSkills([])
      return
    }
    setLoading(true)
    setError('')
    try {
      const result = await window.electronAPI?.listSkills(activeSessionId)
      setSkills(result ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载技能失败')
    } finally {
      setLoading(false)
    }
  }, [activeSessionId])

  useEffect(() => {
    loadSkills()
  }, [loadSkills])

  const setSkillInvocable = useCallback(async (skill: SkillListItem, userInvocable: boolean) => {
    if (!activeSessionId || !skill.filePath || !window.electronAPI?.setSkillInvocable) return
    setBusySkill(skill.filePath)
    setError('')
    try {
      await window.electronAPI.setSkillInvocable(activeSessionId, skill.filePath, userInvocable)
      await loadSkills()
    } catch (err) {
      setError(err instanceof Error ? err.message : '更新技能状态失败')
    } finally {
      setBusySkill(null)
    }
  }, [activeSessionId, loadSkills])

  const deleteSkill = useCallback(async (skill: SkillListItem) => {
    if (!activeSessionId || !skill.filePath || !window.electronAPI?.deleteSkill) return
    const ok = window.confirm(`删除技能 /${skill.name}？此操作会删除对应的${skill.entryType === 'directory' ? '目录' : '文件'}。`)
    if (!ok) return
    setBusySkill(skill.filePath)
    setError('')
    try {
      await window.electronAPI.deleteSkill(activeSessionId, skill.filePath)
      await loadSkills()
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除技能失败')
    } finally {
      setBusySkill(null)
    }
  }, [activeSessionId, loadSkills])

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between pr-8">
        <div>
          <h3 className="text-[13px] font-medium text-[var(--text)]">技能</h3>
          <p className="mt-1 text-[12px] text-[var(--muted)]">技能会出现在输入框的斜杠菜单中。</p>
        </div>
        <button
          type="button"
          onClick={loadSkills}
          disabled={loading || !activeSessionId}
          className="border border-[var(--border)] rounded-[6px] px-3 py-1.5 text-[12px] text-[var(--muted)] hover:text-[var(--text)] disabled:opacity-50"
        >
          刷新
        </button>
      </div>

      {!activeSessionId && (
        <p className="text-[13px] text-[var(--muted)] text-center py-8">选择一个会话后查看当前项目可用技能</p>
      )}
      {loading && <p className="text-[13px] text-[var(--muted)] animate-pulse">加载中...</p>}
      {error && <p className="text-[12px] text-[var(--bad)]">{error}</p>}
      {!loading && activeSessionId && skills.length === 0 && (
        <p className="text-[13px] text-[var(--muted)] text-center py-8">暂无技能，支持全局 ~/.puddingagent/skills 与项目 .puddingagent/skills</p>
      )}
      {!loading && skills.map((skill) => (
        <div key={`${skill.source || 'skill'}:${skill.name}`} className="border border-[var(--border)] rounded-[6px] px-3 py-2.5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[13px] text-[var(--text)]">/{skill.name}</span>
                <span className={`inline-flex items-center gap-1 text-[10px] border rounded px-1.5 py-0.5 ${skill.userInvocable !== false ? 'text-[var(--good)] border-[var(--good)]/40' : 'text-[var(--muted)] border-[var(--border)]'}`}>
                  {skill.userInvocable !== false ? <IconCheck size={11} /> : <IconStop size={11} />}
                  {skill.userInvocable !== false ? '起效' : '不起效'}
                </span>
                {skill.source && (
                  <span className="text-[10px] text-[var(--muted)] border border-[var(--border)] rounded px-1.5 py-0.5">
                    {skill.source === 'project' ? '项目' : '全局'}
                  </span>
                )}
              </div>
              {skill.description && <p className="mt-1 text-[12px] text-[var(--muted)]">{skill.description}</p>}
              {skill.argumentHint && <p className="mt-1 font-mono text-[11px] text-[var(--muted)]">{skill.argumentHint}</p>}
            </div>
            {skill.filePath && (
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSkillInvocable(skill, skill.userInvocable === false)}
                  disabled={busySkill === skill.filePath}
                  className="text-[12px] text-[var(--muted)] hover:text-[var(--text)] disabled:opacity-50"
                >
                  {skill.userInvocable === false ? '起效' : '不起效'}
                </button>
                <button
                  type="button"
                  onClick={() => deleteSkill(skill)}
                  disabled={busySkill === skill.filePath}
                  className="text-[12px] text-[var(--muted)] hover:text-[var(--bad)] disabled:opacity-50"
                >
                  删除
                </button>
              </div>
            )}
          </div>
          {skill.filePath && (
            <div className="mt-2 truncate font-mono text-[11px] text-[var(--muted)]">{skill.filePath}</div>
          )}
        </div>
      ))}
    </div>
  )
}
