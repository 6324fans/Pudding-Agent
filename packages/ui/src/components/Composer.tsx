import { useRef, useCallback, useEffect, useState, type ChangeEvent, type KeyboardEvent, type ClipboardEvent, type DragEvent } from 'react'
import { ImagePreview } from './ImagePreview'
import { SlashCommandMenu, type SlashCommand } from './SlashCommandMenu'
import { BranchSwitcher } from './BranchSwitcher'
import { IconCodeGraph, IconFiles, IconPlus, IconSend, IconStop, IconX } from './icons'
import { useSessionStore } from '../stores/session-store'
import { useIdeStore } from '../stores/ide-store'
import { isSameOrChildPath } from '../lib/path-match'
import { useCodegraph } from '../hooks/useCodegraph'
import { buildPromptWithAttachments, formatBytes, getFilesFromDataTransfer, readLocalFiles, type TextAttachment } from '../lib/attachments'

interface Props {
  onSend: (text: string, images?: { data: string; mediaType: string }[]) => void
  onAbort: () => void
  isStreaming: boolean
  aborting?: boolean
  onSlashCommand?: (command: string) => void
  permissionMode?: string
  onPermissionChange?: (mode: string) => void
  effort?: 'off' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  onEffortChange?: (effort: 'off' | 'low' | 'medium' | 'high' | 'xhigh' | 'max') => void
  planMode?: boolean
  onPlanToggle?: () => void
  modelName?: string
  modelId?: string
  models?: { id: string; name: string; groupName: string }[]
  onModelChange?: (modelId: string) => void
  onModelClick?: () => void
  contextUsedPercent?: number
  skills?: { name: string; description: string }[]
}

export function Composer({
  onSend,
  onAbort,
  isStreaming,
  aborting = false,
  onSlashCommand,
  permissionMode = 'standard',
  onPermissionChange,
  effort = 'max',
  onEffortChange,
  planMode,
  onPlanToggle,
  modelName,
  modelId,
  models,
  onModelChange,
  onModelClick,
  contextUsedPercent,
  skills,
}: Props) {
  const [showSlashMenu, setShowSlashMenu] = useState(false)
  const [slashOnlySkills, setSlashOnlySkills] = useState(false)
  const [slashInsertPos, setSlashInsertPos] = useState(0)
  const [slashFilter, setSlashFilter] = useState('')
  const [showPermMenu, setShowPermMenu] = useState(false)
  const [showEffortMenu, setShowEffortMenu] = useState(false)
  const [showModelMenu, setShowModelMenu] = useState(false)
  const [queueExpanded, setQueueExpanded] = useState(false)
  const [attachments, setAttachments] = useState<TextAttachment[]>([])
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const isComposingRef = useRef(false)

  const messageQueue = useSessionStore((s) => s.messageQueue)
  const enqueueMessage = useSessionStore((s) => s.enqueueMessage)
  const removeFromQueue = useSessionStore((s) => s.removeFromQueue)
  const projects = useSessionStore((s) => s.projects)
  const activeSessionId = useSessionStore((s) => s.activeSessionId)
  const draft = useSessionStore((s) => (activeSessionId ? s.drafts[activeSessionId] : undefined))
  const setDraftText = useSessionStore((s) => s.setDraftText)
  const setDraftImages = useSessionStore((s) => s.setDraftImages)
  const clearDraft = useSessionStore((s) => s.clearDraft)
  const text = draft?.text ?? ''
  const images = draft?.images ?? []
  const setText = useCallback(
    (next: string) => {
      if (activeSessionId) setDraftText(activeSessionId, next)
    },
    [activeSessionId, setDraftText],
  )
  const setImages = useCallback(
    (updater: { data: string; mediaType: string }[] | ((prev: { data: string; mediaType: string }[]) => { data: string; mediaType: string }[])) => {
      if (!activeSessionId) return
      const current = useSessionStore.getState().drafts[activeSessionId]?.images ?? []
      const next = typeof updater === 'function' ? updater(current) : updater
      setDraftImages(activeSessionId, next)
    },
    [activeSessionId, setDraftImages],
  )
  const resetDraft = useCallback(() => {
    if (activeSessionId) clearDraft(activeSessionId)
  }, [activeSessionId, clearDraft])
  const resetComposer = useCallback(() => {
    resetDraft()
    setAttachments([])
  }, [resetDraft])

  const activeProject = projects.find((p) => p.sessions.some((s) => s.id === activeSessionId))
  const cwd = activeProject?.cwd || ''
  const codegraph = useCodegraph(cwd)

  const ideConnections = useIdeStore((s) => s.connections)
  const ideSelection = useIdeStore((s) => s.selection)
  const connectedIde = ideConnections.find((c) => c.status === 'connected' && c.workspaceFolders.some(f => isSameOrChildPath(cwd, f)))

  const addFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) return
    const result = await readLocalFiles(files)
    if (result.images.length > 0) {
      setImages((prev) => [...prev, ...result.images])
    }
    if (result.attachments.length > 0) {
      setAttachments((prev) => [...prev, ...result.attachments])
    }
  }, [setImages])

  const handlePaste = useCallback(
    (e: ClipboardEvent<HTMLTextAreaElement>) => {
      const files = getFilesFromDataTransfer(e.clipboardData)
      if (files.length > 0) {
        e.preventDefault()
        addFiles(files)
      }
    },
    [addFiles],
  )

  const handleDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      addFiles(Array.from(e.dataTransfer?.files || []))
    },
    [addFiles],
  )

  const handleFilesSelected = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.target.files || [])
    event.target.value = ''
    addFiles(selected)
  }, [addFiles])

  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
  }, [])

  const handleTextChange = (value: string) => {
    setText(value)
    // Check for / at start (commands + skills)
    if (value === '/' || (value.startsWith('/') && !value.includes(' '))) {
      setShowSlashMenu(true)
      setSlashFilter(value.slice(1))
      setSlashOnlySkills(false)
      setSlashInsertPos(0)
    } else {
      // Check for / typed mid-text (skills only)
      const lastSlash = value.lastIndexOf('/')
      const afterSlash = lastSlash >= 0 ? value.slice(lastSlash + 1) : ''
      if (lastSlash > 0 && !afterSlash.includes(' ')) {
        setShowSlashMenu(true)
        setSlashFilter(afterSlash)
        setSlashOnlySkills(true)
        setSlashInsertPos(lastSlash)
      } else {
        setShowSlashMenu(false)
      }
    }
  }

  const handleSlashSelect = (cmd: SlashCommand) => {
    setShowSlashMenu(false)
    if (cmd.section === 'skill') {
      // Insert skill name at the slash position, keep text before it
      const prefix = text.slice(0, slashInsertPos)
      setText(`${prefix}/${cmd.name} `)
      textareaRef.current?.focus()
    } else {
      resetComposer()
      onSlashCommand?.(`/${cmd.name}`)
    }
  }

  const submit = useCallback(() => {
    const trimmedText = text.trim()
    const finalText = buildPromptWithAttachments(trimmedText, attachments)
    const hasContent = !!trimmedText || images.length > 0 || attachments.length > 0
    if (!hasContent) return

    if (isStreaming) {
      if (images.length === 0) {
        enqueueMessage(finalText)
        resetComposer()
      }
      return
    }

    onSend(finalText, images.length > 0 ? images : undefined)
    resetComposer()
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
  }, [attachments, enqueueMessage, images, isStreaming, onSend, resetComposer, text])

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (isComposingRef.current) return
    if (showSlashMenu && ['ArrowDown', 'ArrowUp', 'Tab', 'Enter'].includes(e.key)) return
    if (e.key === 'Escape' && showSlashMenu) {
      setShowSlashMenu(false)
      return
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (text.startsWith('/') && !text.includes(' ')) {
        onSlashCommand?.(text)
        resetComposer()
        setShowSlashMenu(false)
        return
      }
      submit()
    }
  }

  const handleInput = () => {
    const el = textareaRef.current
    if (el) {
      el.style.height = 'auto'
      const maxH = 200
      if (el.scrollHeight > maxH) {
        el.style.height = `${maxH}px`
        el.style.overflowY = 'auto'
      } else {
        el.style.height = `${el.scrollHeight}px`
        el.style.overflowY = 'hidden'
      }
    }
  }

  // Resize textarea whenever the active session (and thus the draft) changes,
  // so switching back to a session with a long draft restores the right height.
  useEffect(() => {
    handleInput()
  }, [activeSessionId])

  const handleClearQueue = () => {
    const len = messageQueue.length
    for (let i = len - 1; i >= 0; i--) removeFromQueue(i)
    setQueueExpanded(false)
  }

  const permLabel =
    permissionMode === 'strict' ? '严格模式' : permissionMode === 'relaxed' ? '完全访问' : '标准模式'
  const permDotColor =
    permissionMode === 'relaxed'
      ? 'bg-[var(--warn)]'
      : permissionMode === 'strict'
        ? 'bg-[var(--bad)]'
        : 'bg-[var(--good)]'

  const contextPercent =
    typeof contextUsedPercent === 'number' && Number.isFinite(contextUsedPercent)
      ? Math.max(0, Math.min(100, Math.round(contextUsedPercent)))
      : null
  const contextColor =
    contextPercent === null
      ? 'var(--muted)'
      : contextPercent >= 85
        ? 'var(--bad)'
        : contextPercent >= 65
          ? 'var(--warn)'
          : 'var(--good)'

  return (
    <div
      className="border-t border-[var(--border)] bg-[var(--surface)] px-6 py-3"
      onDrop={handleDrop}
      onDragOver={handleDragOver}
    >
      {/* Queue chip */}
      {messageQueue.length > 0 && (
        <div className="mb-2">
          <button
            onClick={() => setQueueExpanded(!queueExpanded)}
            className="inline-flex items-center gap-2 rounded-[8px] bg-[var(--surface-3)] px-3 py-1.5 text-[12px] text-[var(--text)] transition-colors hover:opacity-80"
          >
            <span className="inline-block h-2 w-2 rounded-full bg-[var(--warn)]" />
            队列：{messageQueue.length} 条消息
          </button>
          {queueExpanded && (
            <div className="mt-1 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-2 shadow-[var(--shadow-soft)]">
              {messageQueue.map((msg, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between gap-2 rounded px-2 py-1 text-[12px] text-[var(--text)] hover:bg-[var(--surface-2)]"
                >
                  <span className="truncate">{msg}</span>
                  <button
                    onClick={() => removeFromQueue(i)}
                    className="shrink-0 text-[var(--muted)] hover:text-[var(--bad)]"
                    aria-label={`移除第 ${i + 1} 条排队消息`}
                  >
                    &times;
                  </button>
                </div>
              ))}
              <button
                onClick={handleClearQueue}
                className="mt-1 w-full rounded px-2 py-1 text-[11px] text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--bad)]"
              >
                全部清空
              </button>
            </div>
          )}
        </div>
      )}

      {/* Image preview */}
      <ImagePreview images={images} onRemove={(i) => setImages((prev) => prev.filter((_, idx) => idx !== i))} />
      {attachments.length > 0 && (
        <div className="mx-auto mb-2 flex max-w-[760px] flex-wrap gap-2">
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

      {/* Main input area */}
      <div className="mx-auto max-w-[760px]">
        <div className="relative mb-2">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={handleFilesSelected}
          />
          <SlashCommandMenu
            filter={slashFilter}
            visible={showSlashMenu}
            onSelect={handleSlashSelect}
            onClose={() => setShowSlashMenu(false)}
            skills={skills}
            skillsOnly={slashOnlySkills}
          />
          <div className="flex items-end gap-3">
            {/* CodeGraph indicator — left of input */}
            {codegraph.status !== 'hidden' && (
              <div className="relative group shrink-0">
                <button
                  type="button"
                  onClick={codegraph.run}
                  disabled={codegraph.status === 'indexing'}
                  aria-label={
                    codegraph.status === 'ready'
                      ? '重建代码图谱索引'
                      : codegraph.status === 'error'
                        ? '重试建立代码图谱索引'
                        : '建立代码图谱索引'
                  }
                  className={`flex h-[54px] w-[52px] flex-col items-center justify-center gap-1 rounded-[10px] border transition-colors ${
                    codegraph.status === 'ready'
                      ? 'border-[var(--good)]/30 text-[var(--good)] hover:bg-[var(--good)]/5'
                      : codegraph.status === 'indexing'
                      ? 'border-[var(--border)] text-[var(--accent)] cursor-wait'
                      : codegraph.status === 'error'
                      ? 'border-[var(--bad)]/30 text-[var(--bad)] hover:bg-[var(--bad)]/5'
                      : 'border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)] hover:border-[var(--border-strong)]'
                  }`}
                >
                  <IconCodeGraph size={17} />
                  <span className={`text-[9px] leading-none whitespace-nowrap ${codegraph.status === 'indexing' ? 'animate-pulse' : ''}`}>
                    {codegraph.status === 'idle'
                      ? '图谱'
                      : codegraph.status === 'indexing'
                        ? '索引'
                        : codegraph.status === 'ready'
                          ? '就绪'
                          : '重试'}
                  </span>
                </button>
                {/* Tooltip */}
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 rounded-[8px] bg-[var(--surface)] border border-[var(--border)] shadow-[var(--shadow-soft)] text-[11px] text-[var(--text)] whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity duration-200 z-50">
                  {codegraph.status === 'idle' && '建立代码图谱，让 AI 理解调用关系'}
                  {codegraph.status === 'indexing' && (codegraph.progress || '正在扫描项目文件...')}
                  {codegraph.status === 'ready' && '代码图谱已就绪，点击可重建索引'}
                  {codegraph.status === 'error' && (codegraph.error || '索引失败，点击重试')}
                  <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-[1px] w-2 h-2 rotate-45 bg-[var(--surface)] border-r border-b border-[var(--border)]" />
                </div>
              </div>
            )}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex h-[54px] w-[36px] shrink-0 items-center justify-center rounded-[10px] border border-[var(--border)] text-[var(--muted)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
              aria-label="上传本地图片或文件"
              title="上传本地图片或文件"
            >
              <IconPlus size={18} />
            </button>
            <textarea
              ref={textareaRef}
              value={text}
              onChange={(e) => {
                handleTextChange(e.target.value)
                handleInput()
              }}
              onKeyDown={handleKeyDown}
              onCompositionStart={() => {
                isComposingRef.current = true
              }}
              onCompositionEnd={() => {
                isComposingRef.current = false
              }}
              onPaste={handlePaste}
              rows={1}
              placeholder="输入消息... (/ 打开命令)"
              className="flex-1 resize-none rounded-[10px] bg-[var(--surface-2)] border border-[var(--border)] px-4 py-3 text-[14px] text-[var(--text)] placeholder-[var(--muted)] focus:border-[var(--border-strong)] focus:outline-none transition-colors font-[var(--font-sans)]"
            />
            {/* Action buttons */}
            {isStreaming ? (
              <div className="flex items-center gap-2">
                {(text.trim() || attachments.length > 0) && images.length === 0 && (
                  <button
                    onClick={submit}
                    className="flex items-center gap-1.5 rounded-[8px] bg-[var(--accent)] px-3 py-2 text-[12px] text-[var(--accent-ink)] transition-colors hover:opacity-90"
                  >
                    <IconSend size={14} />
                    加入队列
                  </button>
                )}
                <button
                  onClick={() => { if (!aborting) onAbort() }}
                  disabled={aborting}
                  className="flex items-center gap-1.5 rounded-[8px] border border-[var(--bad)] px-3 py-2 text-[12px] text-[var(--bad)] transition-colors hover:bg-[var(--bad)] hover:text-[var(--accent-ink)] disabled:opacity-60 disabled:cursor-wait disabled:hover:bg-transparent disabled:hover:text-[var(--bad)]"
                >
                  <IconStop size={14} />
                  {aborting ? '正在停止…' : '停止'}
                </button>
              </div>
            ) : (
              <button
                onClick={submit}
                disabled={!text.trim() && images.length === 0 && attachments.length === 0}
                className="flex items-center gap-1.5 rounded-[8px] bg-[var(--accent)] px-3 py-2 text-[12px] text-[var(--accent-ink)] transition-colors hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <IconSend size={14} />
                发送
              </button>
            )}
          </div>
        </div>

        {/* Status bar */}
        <div className="flex items-center justify-between text-[12px] min-w-0">
          <div className="flex items-center gap-3 min-w-0">
            {/* Permission dropdown */}
            <div className="relative shrink-0">
              <button
                onClick={() => setShowPermMenu(!showPermMenu)}
                className="flex items-center gap-1 text-[var(--text)] hover:opacity-80 transition-opacity whitespace-nowrap"
              >
                <span className={`inline-block h-1.5 w-1.5 rounded-full ${permDotColor}`} />
                {permLabel} ▾
              </button>
              {showPermMenu && (
                <div className="absolute bottom-full left-0 mb-1 border border-[var(--border)] bg-[var(--surface)] rounded-[8px] z-50 min-w-[130px] shadow-[var(--shadow-soft)] overflow-hidden">
                  <button
                    onClick={() => { onPermissionChange?.('relaxed'); setShowPermMenu(false) }}
                    className={`block w-full text-left px-3 py-1.5 text-[12px] hover:bg-[var(--surface-2)] ${permissionMode === 'relaxed' ? 'text-[var(--warn)]' : 'text-[var(--text)]'}`}
                  >
                    完全访问
                  </button>
                  <button
                    onClick={() => { onPermissionChange?.('standard'); setShowPermMenu(false) }}
                    className={`block w-full text-left px-3 py-1.5 text-[12px] hover:bg-[var(--surface-2)] ${permissionMode === 'standard' ? 'text-[var(--good)]' : 'text-[var(--text)]'}`}
                  >
                    标准模式
                  </button>
                  <button
                    onClick={() => { onPermissionChange?.('strict'); setShowPermMenu(false) }}
                    className={`block w-full text-left px-3 py-1.5 text-[12px] hover:bg-[var(--surface-2)] ${permissionMode === 'strict' ? 'text-[var(--bad)]' : 'text-[var(--text)]'}`}
                  >
                    严格模式
                  </button>
                </div>
              )}
            </div>

            {/* Effort dropdown */}
            <div className="relative shrink-0">
              <button
                onClick={() => setShowEffortMenu(!showEffortMenu)}
                className={`flex items-center gap-1 transition-colors whitespace-nowrap ${effort === 'off' ? 'text-[var(--muted)] hover:text-[var(--text)]' : 'text-[var(--good)]'}`}
              >
                <span className={`inline-block h-1.5 w-1.5 rounded-full ${effort === 'off' ? 'bg-[var(--muted)]' : 'bg-[var(--good)]'}`} />
                {(() => {
                  const labels: Record<string, string> = { off: '推理:关', low: '推理:低', medium: '推理:中', high: '推理:高', xhigh: '推理:超', max: '推理:最大' }
                  return labels[effort]
                })()} ▾
              </button>
              {showEffortMenu && (
                <div className="absolute bottom-full left-0 mb-1 border border-[var(--border)] bg-[var(--surface)] rounded-[8px] z-50 min-w-[150px] shadow-[var(--shadow-soft)] overflow-hidden">
                  <div className="px-3 py-1.5 text-[10px] text-[var(--muted)] flex items-center justify-between border-b border-[var(--border)]">
                    <span>速度</span>
                    <span>智能</span>
                  </div>
                  {(['off', 'low', 'medium', 'high', 'xhigh', 'max'] as const).map((lvl) => {
                    const labels = { off: '关闭', low: '低', medium: '中', high: '高', xhigh: '超高', max: '最大' } as const
                    return (
                      <button
                        key={lvl}
                        onClick={() => { onEffortChange?.(lvl); setShowEffortMenu(false) }}
                        className={`block w-full text-left px-3 py-1.5 text-[12px] hover:bg-[var(--surface-2)] ${effort === lvl ? 'text-[var(--good)]' : 'text-[var(--text)]'}`}
                      >
                        {labels[lvl]}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Plan toggle */}
            <button
              onClick={onPlanToggle}
              className={`flex items-center gap-1 transition-colors whitespace-nowrap shrink-0 ${planMode ? 'text-[var(--plan)]' : 'text-[var(--muted)] hover:text-[var(--text)]'}`}
            >
              <span className={`inline-block h-1.5 w-1.5 rounded-full ${planMode ? 'bg-[var(--plan)]' : 'bg-[var(--muted)]'}`} />
              规划
            </button>

            {/* Branch switcher */}
            {cwd && <BranchSwitcher cwd={cwd} />}

            {/* IDE connection + selection */}
            {connectedIde && (
              <span className="flex items-center gap-1 text-[var(--good)] min-w-0 shrink truncate">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--good)] shrink-0" />
                <span className="shrink-0">{connectedIde.ideName}</span>
                {ideSelection?.filePath && (
                  <span className="text-[var(--muted)] ml-1 truncate">
                    · {ideSelection.filePath.split('/').pop()}
                    {ideSelection.text ? ` (${ideSelection.selection?.start.line}-${ideSelection.selection?.end.line})` : ''}
                  </span>
                )}
              </span>
            )}
          </div>

          <div className="flex shrink-0 items-center justify-end gap-3 min-w-0 max-w-[48%]">
            <div
              className="flex items-center gap-1.5 text-[var(--muted)] whitespace-nowrap"
              title={contextPercent === null ? '暂无上下文用量' : `上下文已使用 ${contextPercent}%`}
            >
              <span className="h-1.5 w-16 overflow-hidden rounded-full bg-[var(--surface-3)]">
                <span
                  className="block h-full rounded-full transition-[width]"
                  style={{ width: `${contextPercent ?? 0}%`, backgroundColor: contextColor }}
                />
              </span>
              <span className="text-[11px]">
                上下文 {contextPercent === null ? '--' : `${contextPercent}%`}
              </span>
            </div>

            {/* Model dropdown */}
            <div className="relative min-w-0 shrink">
              <button
                onClick={() => {
                  if (models && models.length > 0) setShowModelMenu(!showModelMenu)
                  else onModelClick?.()
                }}
                className="text-[var(--text)] hover:text-[var(--accent)] transition-colors whitespace-nowrap truncate max-w-full block"
                title={modelName || '未选择模型'}
              >
                {modelName || '未选择模型'} ▾
              </button>
              {showModelMenu && models && models.length > 0 && (
                <div className="absolute bottom-full right-0 mb-1 border border-[var(--border)] bg-[var(--surface)] rounded-[8px] z-50 min-w-[200px] max-h-[240px] overflow-y-auto shadow-[var(--shadow-soft)]">
                  {models.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => { onModelChange?.(m.id); setShowModelMenu(false) }}
                      className={`block w-full text-left px-3 py-1.5 text-[12px] hover:bg-[var(--surface-2)] ${m.id === modelId ? 'bg-[var(--accent-soft)] text-[var(--accent)]' : 'text-[var(--text)]'}`}
                    >
                      {m.id === modelId && <span className="mr-1">✓</span>}
                      <span>{m.name}</span>
                      <span className="text-[11px] text-[var(--muted)] ml-2">{m.groupName}</span>
                    </button>
                  ))}
                  <button
                    onClick={() => { setShowModelMenu(false); onModelClick?.() }}
                    className="block w-full text-left px-3 py-1.5 text-[12px] hover:bg-[var(--surface-2)] text-[var(--muted)] border-t border-[var(--border)]"
                  >
                    设置...
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
