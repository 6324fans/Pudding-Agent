import { useState, useEffect, useRef, useCallback } from 'react'
import { useSettingsStore, type SettingsTab } from '../stores/settings-store'
import { useModelStore, type ApiProtocol, type ModelGroup } from '../stores/model-store'
import { useSessionStore } from '../stores/session-store'
import { ThemeSegmented } from './ThemeSegmented'
import { IconX } from './icons'
import { useCodegraph } from '../hooks/useCodegraph'
import type { MarketplacePlugin, McpServerState, PluginMarketplace, SkillListItem } from '../lib/ipc-client'

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
  { key: 'skills', label: '技能' },
  { key: 'shortcuts', label: '快捷键' },
  { key: 'advanced', label: '版本信息' },
]

function sanitizeUpdaterError(message?: string): string {
  const raw = (message || '').replace(/\s+/g, ' ').trim()

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
          {activeTab === 'skills' && <SkillsTab />}
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
  const codegraph = useCodegraph(cwd)

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
          <p className="mt-1 text-[12px] text-[var(--muted)]">管理 MCP 服务器和项目代码索引能力。</p>
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

      {/* CodeGraph index */}
      {cwd && (
        <div className="flex items-center justify-between px-3 py-2.5 border border-[var(--border)] rounded-[6px]">
          <div>
            <span className="text-[13px] text-[var(--text)]">CodeGraph 索引</span>
            <span className="text-[11px] text-[var(--muted)] ml-2">
              {codegraph.status === 'indexing'
                ? (codegraph.progress || '正在索引当前项目')
                : codegraph.status === 'ready'
                  ? '重建当前项目的代码索引'
                  : codegraph.status === 'error'
                    ? (codegraph.error || '索引失败，可重试')
                    : '为当前项目建立代码索引'}
            </span>
          </div>
          <button
            type="button"
            onClick={codegraph.run}
            disabled={codegraph.status === 'indexing'}
            className="px-3 py-1 text-[12px] rounded-[6px] border border-[var(--border)] text-[var(--text)] hover:bg-[var(--surface-2)] transition-colors disabled:opacity-50"
          >
            {codegraph.status === 'indexing'
              ? '索引中...'
              : codegraph.status === 'ready'
                ? '重建索引'
                : codegraph.status === 'error'
                  ? '重试'
                  : '建立索引'}
          </button>
        </div>
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
                {skill.source && (
                  <span className="text-[10px] text-[var(--muted)] border border-[var(--border)] rounded px-1.5 py-0.5">
                    {skill.source === 'project' ? '项目' : '全局'}
                  </span>
                )}
              </div>
              {skill.description && <p className="mt-1 text-[12px] text-[var(--muted)]">{skill.description}</p>}
              {skill.argumentHint && <p className="mt-1 font-mono text-[11px] text-[var(--muted)]">{skill.argumentHint}</p>}
            </div>
          </div>
          {skill.filePath && (
            <div className="mt-2 truncate font-mono text-[11px] text-[var(--muted)]">{skill.filePath}</div>
          )}
        </div>
      ))}
    </div>
  )
}
