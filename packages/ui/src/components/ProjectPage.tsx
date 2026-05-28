import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type ClipboardEvent, type KeyboardEvent, type ReactNode } from 'react'
import { ipc } from '../lib/ipc-client'
import { useSessionStore } from '../stores/session-store'
import { useModelStore } from '../stores/model-store'
import { useSettingsStore } from '../stores/settings-store'
import { ImagePreview } from './ImagePreview'
import { buildPromptWithAttachments, formatBytes, getFilesFromDataTransfer, readLocalFiles, type AttachedImage, type TextAttachment } from '../lib/attachments'
import {
  IconFiles,
  IconGitBranch,
  IconPlus,
  IconSend,
  IconSession,
  IconX,
} from './icons'
import type { McpServerState } from '../lib/ipc-client'

function StatusDot({ color }: { color: string }) {
  return (
    <span
      className="inline-block h-[7px] w-[7px] shrink-0 rounded-full"
      style={{ backgroundColor: color }}
    />
  )
}

function QuickCard({
  children,
  onClick,
}: {
  children: ReactNode
  onClick?: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="min-h-[92px] rounded-[8px] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-left shadow-[var(--shadow)] transition-colors hover:bg-[var(--surface-2)]"
    >
      {children}
    </button>
  )
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h3 className="mb-2 px-1 text-[11px] font-semibold uppercase text-[var(--muted)]">
      {children}
    </h3>
  )
}

export function ProjectPage() {
  const projects = useSessionStore((s) => s.projects)
  const sessionStates = useSessionStore((s) => s.sessionStates)
  const lastSelectedProjectCwd = useSessionStore((s) => s.lastSelectedProjectCwd)
  const addProject = useSessionStore((s) => s.addProject)
  const createSession = useSessionStore((s) => s.createSession)
  const switchSession = useSessionStore((s) => s.switchSession)
  const openSettings = useSettingsStore((s) => s.open)
  const activeModelId = useModelStore((s) => s.activeModelId)
  const setActiveModel = useModelStore((s) => s.setActiveModel)
  const modelGroups = useModelStore((s) => s.groups)

  const [prompt, setPrompt] = useState('')
  const [isStarting, setIsStarting] = useState(false)
  const [mcpServers, setMcpServers] = useState<McpServerState[]>([])
  const [currentBranch, setCurrentBranch] = useState('')
  const [images, setImages] = useState<AttachedImage[]>([])
  const [attachments, setAttachments] = useState<TextAttachment[]>([])
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const project = projects.find((p) => p.cwd === lastSelectedProjectCwd) ?? projects[0]
  const allSessions = useMemo(() => projects.flatMap((p) => p.sessions), [projects])
  const recentSessions = allSessions.slice(0, 5)
  const connectedCount = mcpServers.filter((s) => s.status === 'connected').length
  const activeModel = useMemo(() => {
    if (!activeModelId) return null
    for (const group of modelGroups) {
      const model = group.models.find((m) => m.id === activeModelId)
      if (model) return { model, group }
    }
    return null
  }, [activeModelId, modelGroups])

  useEffect(() => {
    window.electronAPI?.mcpListServers().then(setMcpServers)
    window.electronAPI?.onMcpStateChanged((states) => setMcpServers(states))
  }, [])

  useEffect(() => {
    if (!project?.cwd) {
      setCurrentBranch('')
      return
    }
    window.electronAPI?.gitBranchList(project.cwd)
      .then((result) => setCurrentBranch(result.current || ''))
      .catch(() => setCurrentBranch(''))
  }, [project?.cwd])

  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }, [prompt])

  const startWithPrompt = async () => {
    const text = prompt.trim()
    const hasAttachments = images.length > 0 || attachments.length > 0
    if ((!text && !hasAttachments) || !project || isStarting) return

    setIsStarting(true)
    try {
      const finalText = buildPromptWithAttachments(text, attachments)
      const projectName = project.cwd.split('/').filter(Boolean).pop() || project.name || 'untitled'
      const { sessionId } = await ipc.session.create(projectName, project.cwd)
      if (activeModelId) await ipc.session.setModel(sessionId, activeModelId)
      await useSessionStore.getState().loadProjects()
      await switchSession(sessionId)

      const userMessage = {
        id: crypto.randomUUID(),
        role: 'user' as const,
        content: [
          { type: 'text' as const, text: finalText },
          ...images.map((img) => ({
            type: 'image' as const,
            source: { type: 'base64' as const, media_type: img.mediaType, data: img.data },
          })),
        ],
        timestamp: Date.now(),
      }
      useSessionStore.setState((s) => ({ messages: [...s.messages, userMessage] }))
      useSessionStore.getState().markStreaming(sessionId, true)
      await ipc.query.send(sessionId, finalText, images.length > 0 ? images : undefined)
      setPrompt('')
      setImages([])
      setAttachments([])
    } finally {
      setIsStarting(false)
    }
  }

  const addFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) return
    const result = await readLocalFiles(files)
    setImages((prev) => [...prev, ...result.images])
    setAttachments((prev) => [...prev, ...result.attachments])
  }, [])

  const handleFilesSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.target.files || [])
    event.target.value = ''
    addFiles(selected)
  }

  const handlePaste = useCallback((event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = getFilesFromDataTransfer(event.clipboardData)
    if (files.length > 0) {
      event.preventDefault()
      addFiles(files)
    }
  }, [addFiles])

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      startWithPrompt()
    }
  }

  if (projects.length === 0) {
    return (
      <div className="flex-1 bg-[var(--bg)] px-8">
        <div className="mx-auto flex h-full max-w-[980px] flex-col items-center justify-center">
          <h2 className="mb-12 text-center text-[30px] font-semibold leading-tight tracking-[0] text-[var(--text)]">
            我们应该构建什么？
          </h2>
          <div className="w-full max-w-[720px] rounded-[20px] border border-[var(--border)] bg-[var(--surface)] shadow-[0_18px_60px_rgba(0,0,0,0.08)]">
            <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3 text-[12px] text-[var(--muted)]">
              <span>选择项目后即可运行工具、MCP 和会话能力</span>
            </div>
            <textarea
              disabled
              rows={3}
              placeholder="尽管问"
              className="min-h-[96px] w-full resize-none bg-transparent px-4 py-4 text-[15px] text-[var(--text)] placeholder-[var(--muted)] outline-none disabled:cursor-default"
            />
            <div className="flex items-center justify-between px-4 pb-4">
              <button
                onClick={addProject}
                className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] text-[var(--muted)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
                aria-label="新建项目"
                title="新建项目"
              >
                <IconPlus size={18} />
              </button>
              <button
                onClick={addProject}
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--accent-ink)] transition-opacity hover:opacity-90"
                aria-label="新建项目"
                title="新建项目"
              >
                <IconSend size={17} />
              </button>
            </div>
          </div>
          <p className="mt-5 text-[13px] text-[var(--muted)]">
            添加本地项目后，Pudding-Agent 会加载 Pudding-Agent 的完整会话、工具和 IDE 能力。
          </p>
          <button
            onClick={addProject}
            className="mt-6 inline-flex items-center gap-2 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-[13px] font-medium text-[var(--text)] transition-colors hover:bg-[var(--surface-2)]"
          >
            <IconPlus size={15} />
            新建项目
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto bg-[var(--bg)]">
      <div className="mx-auto flex min-h-full max-w-[980px] flex-col px-8 py-10">
        <div className="flex flex-1 flex-col justify-center pb-8">
          <h2 className="mb-12 text-center text-[30px] font-semibold leading-tight tracking-[0] text-[var(--text)]">
            我们应该在 {project.name} 中构建什么？
          </h2>

          <div className="mx-auto w-full max-w-[720px]">
            <div className="rounded-[20px] border border-[var(--border)] bg-[var(--surface)] shadow-[0_18px_60px_rgba(0,0,0,0.08)]">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={handleFilesSelected}
              />
              <textarea
                ref={textareaRef}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                rows={3}
                placeholder="尽管问"
                className="min-h-[96px] w-full resize-none bg-transparent px-4 py-4 text-[15px] text-[var(--text)] placeholder-[var(--muted)] outline-none"
              />
              {(images.length > 0 || attachments.length > 0) && (
                <div className="space-y-2 px-4 pb-3">
                  <ImagePreview images={images} onRemove={(index) => setImages((prev) => prev.filter((_, i) => i !== index))} />
                  {attachments.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {attachments.map((file) => (
                        <div
                          key={file.id}
                          className={`inline-flex max-w-full items-center gap-2 rounded-[8px] border px-2.5 py-1.5 text-[12px] ${
                            file.error
                              ? 'border-[var(--bad)]/30 text-[var(--bad)]'
                              : 'border-[var(--border)] text-[var(--text)]'
                          }`}
                          title={file.error || file.name}
                        >
                          <IconFiles size={14} />
                          <span className="max-w-[220px] truncate">{file.name}</span>
                          <span className="shrink-0 text-[var(--muted)]">{formatBytes(file.size)}</span>
                          <button
                            type="button"
                            onClick={() => setAttachments((prev) => prev.filter((item) => item.id !== file.id))}
                            className="shrink-0 rounded-[4px] text-[var(--muted)] hover:text-[var(--text)]"
                            aria-label={`移除 ${file.name}`}
                          >
                            <IconX size={13} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <div className="flex items-center justify-between gap-3 px-4 pb-4">
                <div className="flex min-w-0 flex-wrap items-center gap-2 text-[12px] text-[var(--muted)]">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] text-[var(--muted)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
                    aria-label="上传本地图片或文件"
                    title="上传本地图片或文件"
                  >
                    <IconPlus size={18} />
                  </button>
                  <span className="inline-flex items-center gap-1 rounded-[7px] bg-[var(--surface-2)] px-2 py-1">
                    <IconFiles size={14} />
                    {project.name}
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-[7px] bg-[var(--surface-2)] px-2 py-1">
                    本地模式
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-[7px] bg-[var(--surface-2)] px-2 py-1">
                    <IconGitBranch size={14} />
                    {currentBranch || '无分支'}
                  </span>
                </div>
                <button
                  onClick={startWithPrompt}
                  disabled={(!prompt.trim() && images.length === 0 && attachments.length === 0) || isStarting}
                  className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--accent-ink)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                  aria-label="发送"
                  title="发送"
                >
                  <IconSend size={17} />
                </button>
              </div>
            </div>

            <div className="mt-3 flex items-center justify-between rounded-b-[20px] bg-[var(--surface-2)] px-4 py-2 text-[12px] text-[var(--muted)]">
              <span className="truncate" style={{ fontFamily: 'var(--font-mono)' }}>{project.cwd}</span>
            </div>
          </div>

          <div className="mx-auto mt-8 grid w-full max-w-[720px] grid-cols-3 gap-3">
            <QuickCard onClick={() => openSettings('mcp')}>
              <div className="mb-3 flex items-center gap-2">
                <StatusDot color={connectedCount > 0 ? 'var(--good)' : 'var(--muted)'} />
                <span className="text-[13px] font-semibold">连接 MCP</span>
              </div>
              <p className="text-[12px] leading-5 text-[var(--muted)]">已连接 {connectedCount} / {mcpServers.length}</p>
            </QuickCard>
            <QuickCard onClick={() => openSettings('models')}>
              <div className="mb-3 flex items-center gap-2">
                <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[var(--accent)] text-[10px] text-[var(--accent-ink)]">AI</span>
                <span className="text-[13px] font-semibold">切换模型</span>
              </div>
              <p className="truncate text-[12px] leading-5 text-[var(--muted)]">{activeModel?.model.name || '未选择模型'}</p>
            </QuickCard>
            <QuickCard onClick={() => createSession(project.cwd)}>
              <div className="mb-3 flex items-center gap-2">
                <IconSession size={18} />
                <span className="text-[13px] font-semibold">新对话</span>
              </div>
              <p className="text-[12px] leading-5 text-[var(--muted)]">保留项目上下文，开启独立会话</p>
            </QuickCard>
          </div>
        </div>

        <div className="pb-8">
          <div>
            <SectionTitle>最近对话</SectionTitle>
            <div className="space-y-1">
              {recentSessions.length === 0 ? (
                <p className="rounded-[8px] border border-[var(--border)] bg-[var(--surface)] px-3 py-3 text-[12px] text-[var(--muted)]">暂无会话</p>
              ) : recentSessions.map((session) => {
                const state = sessionStates[session.id]
                const dotColor = state?.isStreaming ? 'var(--warn)' : state?.error ? 'var(--bad)' : 'var(--good)'
                return (
                  <button
                    key={session.id}
                    onClick={() => switchSession(session.id)}
                    className="flex w-full items-center gap-2 rounded-[8px] px-3 py-2 text-left text-[13px] transition-colors hover:bg-[var(--surface-2)]"
                  >
                    <StatusDot color={dotColor} />
                    <span className="truncate">{session.title || session.id.slice(0, 8)}</span>
                    <span className="ml-auto text-[11px] text-[var(--muted)]">{session.projectName}</span>
                  </button>
                )
              })}
            </div>
          </div>

        </div>

        {modelGroups.length > 0 && (
          <div className="border-t border-[var(--border)] py-3">
            <div className="flex flex-wrap items-center gap-2 text-[12px] text-[var(--muted)]">
              <span>模型</span>
              {modelGroups.flatMap((g) => g.models.map((m) => ({ ...m, groupName: g.name }))).slice(0, 8).map((model) => (
                <button
                  key={model.id}
                  onClick={() => setActiveModel(model.id)}
                  className={`rounded-[7px] px-2 py-1 transition-colors ${model.id === activeModelId ? 'bg-[var(--accent)] text-[var(--accent-ink)]' : 'bg-[var(--surface-2)] hover:text-[var(--text)]'}`}
                >
                  {model.name}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
