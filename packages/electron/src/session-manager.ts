import { v4 as uuid } from 'uuid'
import path from 'node:path'
import {
  Session, type SessionEvents, AnthropicProvider, OpenAIChatProvider, OpenAIResponsesProvider,
  ConversationHistory, loadAppConfig, saveAppConfig, getConfigDir, type ModelConfig, type SessionConfig, type StreamChunk,
  type PermissionCallback, createAskUserTool, type AskUserCallback, createNotifyTool, type NotifyCallback,
  createBrowserOpenTool,
  McpManager, loadMcpConfig, saveMcpConfig, type McpServerConfig, type McpServerState,
  IdeManager, type IdeConnection, type OpenDiffParams, type OpenDiffResult, type DiagnosticFile,
  codegraph, compressImageForAPI, resolveConfiguredModel, resolveModelCapabilityProfile,
  type RuntimeModelResolution, type ResolvedConfiguredModel,
} from '@puddingagent/core'
import type { ToolExecutionEvent } from '@puddingagent/core'
import { Notification, shell, type BrowserWindow } from 'electron'

export interface PendingPermissionInfo {
  id: string
  sessionId: string
  toolName: string
  input: Record<string, unknown>
  createdAt: string
  assistantContext?: string
}

export interface ResolvedPermissionInfo extends PendingPermissionInfo {
  allowed: boolean
}

export class SessionManager {
  private sessions = new Map<string, Session>()
  private history: ConversationHistory
  private mcpManager: McpManager
  private ideManager: IdeManager
  private window: BrowserWindow | null = null
  private readyPromise: Promise<void>
  private pendingPermissions = new Map<string, PendingPermissionInfo & { resolve: (allowed: boolean) => void }>()
  private permissionListeners = new Set<(request: PendingPermissionInfo) => void>()
  private permissionResolvedListeners = new Set<(request: ResolvedPermissionInfo) => void>()
  private pendingAskUser = new Map<string, { resolve: (answer: string) => void }>()
  private pendingPlanReviews = new Map<string, { resolve: (result: { approved: boolean; feedback?: string }) => void }>()
  private permissionModes = new Map<string, string>()
  private assistantDrafts = new Map<string, string>()
  constructor() {
    const dbPath = path.join(getConfigDir(), 'history.db')
    this.history = new ConversationHistory(dbPath)
    this.readyPromise = this.history.ensureReady()
    this.mcpManager = new McpManager(() => {
      this.window?.webContents.send('mcp:state-changed', this.mcpManager.getServerStates())
    })
    this.ideManager = new IdeManager({
      onConnectionChanged: (connections) => {
        this.window?.webContents.send('ide:state-changed', connections)
      },
      onSelectionChanged: (data) => {
        // Preserve last selected text if new event only has filePath (cursor moved, no selection)
        if (!data.text && this.lastIdeSelection?.text && data.filePath === this.lastIdeSelection.filePath) {
          data = { ...data, text: this.lastIdeSelection.text, selection: this.lastIdeSelection.selection }
        }
        this.lastIdeSelection = data
        // Only set ideContext on the active session, not all sessions
        if (this.activeSessionId) {
          const activeSession = this.sessions.get(this.activeSessionId)
          if (activeSession) {
            activeSession.ideContext = data
          }
        }
        this.window?.webContents.send('ide:selection-changed', data)
      },
      onAtMentioned: (data) => {
        this.window?.webContents.send('ide:at-mentioned', data)
      },
    })
  }

  private lastIdeSelection: any = null
  private activeSessionId: string | null = null

  async ensureReady(): Promise<void> {
    await this.readyPromise
  }

  setWindow(window: BrowserWindow): void {
    this.window = window
  }

  startIdeDiscovery(cwd: string): void {
    this.ideManager.startDiscovery(cwd)
  }

  getIdeConnections(): IdeConnection[] {
    return this.ideManager.getConnections()
  }

  async ideOpenFile(filePath: string, line?: number, column?: number): Promise<void> {
    await this.ideManager.openFile(filePath, line, column)
  }

  async ideOpenDiff(params: OpenDiffParams): Promise<OpenDiffResult> {
    return this.ideManager.openDiff(params)
  }

  async ideCloseAllDiffTabs(): Promise<void> {
    await this.ideManager.closeAllDiffTabs()
  }

  async ideGetDiagnostics(filePaths: string[]): Promise<DiagnosticFile[]> {
    return this.ideManager.getDiagnostics(filePaths)
  }

  createSession(projectName: string, cwd: string): string {
    const sessionId = uuid()
    this.history.createSession(sessionId, projectName, cwd)
    this.window?.webContents.send('session:changed', {
      action: 'created',
      sessionId,
      projectName,
      cwd,
    })
    return sessionId
  }

  sessionExists(sessionId: string): boolean {
    return this.history.listSessions().some(s => s.id === sessionId)
  }

  listAllProjects() {
    const sessions = this.history.listSessions()
    const projects = new Map<string, { name: string; cwd: string; sessions: typeof sessions }>()
    for (const s of sessions) {
      if (!projects.has(s.cwd)) {
        projects.set(s.cwd, { name: s.projectName, cwd: s.cwd, sessions: [] })
      }
      projects.get(s.cwd)!.sessions.push(s)
    }
    return Array.from(projects.values())
  }

  searchSessions(query: string, cwd?: string) {
    return this.history.searchSessions(query, cwd || undefined)
  }

  private createProvider(group: { protocol?: string; apiKey: string; baseUrl?: string }) {
    switch (group.protocol) {
      case 'openai':
        return new OpenAIChatProvider(group.apiKey, group.baseUrl)
      case 'openai-responses':
        return new OpenAIResponsesProvider(group.apiKey, group.baseUrl)
      case 'anthropic':
      default:
        return new AnthropicProvider(group.apiKey, group.baseUrl || undefined)
    }
  }

  private buildModelConfig(model: ResolvedConfiguredModel, appConfig: Record<string, any>): ModelConfig {
    const modelProfile = resolveModelCapabilityProfile({
      providerId: model.groupId,
      modelId: model.modelId,
      overrideProfileId: model.profileId,
      profiles: appConfig.modelProfiles ?? appConfig.modelCapabilityProfiles,
    })
    return {
      model: model.modelId,
      maxTokens: model.maxTokens,
      contextWindow: model.contextWindow,
      compressAt: model.compressAt,
      modelProfile,
    }
  }

  private resolveModelById(modelId: string): RuntimeModelResolution & { protocol?: string; modelEntryId?: string } {
    const config = loadAppConfig()
    const data = config.modelGroups
    const resolved = resolveConfiguredModel(data?.groups, modelId)
    if (resolved.status !== 'resolved') {
      return { status: 'failed', warning: resolved.message }
    }
    const provider = this.createProvider({ ...resolved.model.group, baseUrl: resolved.model.baseUrl } as any)
    const modelConfig = this.buildModelConfig(resolved.model, config)
    return {
      status: 'resolved',
      provider,
      modelConfig,
      protocol: resolved.model.protocol || 'anthropic',
      modelEntryId: resolved.model.modelEntryId,
      warning: resolved.message,
    }
  }

  private resolveActiveModel(): RuntimeModelResolution & { protocol?: string; modelEntryId?: string } {
    const config = loadAppConfig()
    const activeModelId = config.modelGroups?.activeModelId
    if (!activeModelId) {
      return { status: 'failed', warning: 'No active model selected. Please configure a model in settings.' }
    }
    return this.resolveModelById(activeModelId)
  }

  setSessionModel(sessionId: string, modelId: string): void {
    this.history.setSessionModel(sessionId, modelId)
    // Also update global config as "last used" for new sessions
    const config = loadAppConfig()
    if (config.modelGroups) {
      config.modelGroups.activeModelId = modelId
      saveAppConfig(config)
    }
    // If session is already active, hot-swap the provider
    const session = this.sessions.get(sessionId)
    if (session) {
      const resolved = this.resolveModelById(modelId)
      if (resolved.status === 'resolved') {
        session.updateProvider(resolved.provider, resolved.modelConfig)
        ;(session as any)._protocol = resolved.protocol
      }
    }
  }

  getSessionModel(sessionId: string): string | null {
    return this.history.getSessionModel(sessionId)
  }

  async activateSession(sessionId: string): Promise<void> {
    const meta = this.history.listSessions().find(s => s.id === sessionId)
    if (!meta) throw new Error(`Session ${sessionId} not found`)
    this.activeSessionId = sessionId
    this.ideManager.startDiscovery(meta.cwd)
    if (this.sessions.has(sessionId)) return

    const sessionModelId = this.history.getSessionModel(sessionId)
    let modelConfig: ModelConfig
    let provider: any
    let protocol: string

    if (sessionModelId) {
      const resolved = this.resolveModelById(sessionModelId)
      if (resolved.status === 'resolved') {
        modelConfig = resolved.modelConfig
        provider = resolved.provider
        protocol = resolved.protocol || 'anthropic'
      } else {
        // Stored model no longer exists, fall back to global
        const active = this.resolveActiveModel()
        if (active.status !== 'resolved') throw new Error(active.warning)
        provider = active.provider
        modelConfig = active.modelConfig
        protocol = active.protocol || 'anthropic'
        this.history.setSessionModel(sessionId, active.modelEntryId ?? active.modelConfig.model)
      }
    } else {
      // New session, no model stored yet — use global default
      const active = this.resolveActiveModel()
      if (active.status !== 'resolved') throw new Error(active.warning)
      provider = active.provider
      modelConfig = active.modelConfig
      protocol = active.protocol || 'anthropic'
      this.history.setSessionModel(sessionId, active.modelEntryId ?? active.modelConfig.model)
    }

    const sessionConfig: SessionConfig = {
      id: sessionId, projectName: meta.projectName, cwd: meta.cwd, modelConfig,
    }
    const permissionCallback: PermissionCallback = (request) => {
      return new Promise<boolean>((resolve) => {
        const id = uuid()
        const payload = { id, sessionId, toolName: request.toolName, input: request.input, createdAt: new Date().toISOString(), assistantContext: this.assistantDrafts.get(sessionId)?.trim() || undefined }
        this.pendingPermissions.set(id, { ...payload, resolve })
        for (const listener of this.permissionListeners) listener(payload)
        this.window?.webContents.send('permission:request', payload)
      })
    }
    const onPlanReview = async (planFile: string, content: string) => {
      return new Promise<{ approved: boolean; feedback?: string }>((resolve) => {
        const id = uuid()
        this.pendingPlanReviews.set(id, { resolve })
        this.window?.webContents.send('plan:review', { id, sessionId, planFile, content })
      })
    }
    const session = new Session(sessionConfig, provider, this.history, permissionCallback, this.mcpManager, onPlanReview)
    session.resolveModel = (modelId: string) => this.resolveModelById(modelId)
    const onAskUser: AskUserCallback = async (question, options, multiSelect) => {
      return new Promise<string>((resolve) => {
        const id = uuid()
        this.pendingAskUser.set(id, { resolve })
        this.window?.webContents.send('ask_user:request', { id, sessionId, question, options, multiSelect })
      })
    }
    session.registerTool(createAskUserTool(onAskUser))
    const onNotify: NotifyCallback = (message: string) => {
      const notification = new Notification({ title: 'Pudding-Agent', body: message })
      notification.on('click', () => { this.window?.focus() })
      notification.show()
    }
    session.registerTool(createNotifyTool(onNotify))
    session.registerTool(createBrowserOpenTool(async (url) => {
      await shell.openExternal(url)
    }))
    session.loadHistory()
    ;(session as any)._protocol = protocol
    session.onNotificationReady = () => {
      this.window?.webContents.send('background:state-changed', { sessionId })
      if ((session as any).abortController) return
      const notificationEvents: SessionEvents = {
        onStreamChunk: (chunk: StreamChunk) => {
          this.window?.webContents.send('query:stream', { sessionId, chunk })
        },
        onToolEvent: (event: ToolExecutionEvent) => {
          this.window?.webContents.send('query:tool-event', { sessionId, event })
        },
        onMessageComplete: (message) => {
          this.window?.webContents.send('query:complete', { sessionId, message })
        },
        onMessagesReplaced: (messages) => {
          this.window?.webContents.send('session:messages-updated', { sessionId, messages })
        },
        onError: (error) => {
          this.window?.webContents.send('query:error', { sessionId, error: error.message })
        },
        onRetrying: (attempt: number, error: Error, delayMs: number, category: string, maxRetries?: number) => {
          this.window?.webContents.send('query:retrying', { sessionId, attempt, maxRetries, error: error.message, delayMs, category })
        },
        onAgentProgress: (agentToolUseId: string, event: any) => {
          this.window?.webContents.send('agent:progress', { sessionId, agentToolUseId, ...event })
        },
        onAgentText: (agentToolUseId: string, text: string) => {
          this.window?.webContents.send('agent:text', { sessionId, agentToolUseId, text })
        },
        onAgentComplete: (agentToolUseId: string, result: any) => {
          this.window?.webContents.send('agent:complete', { sessionId, agentToolUseId, ...result })
        },
        onUsage: (usage) => {
          this.window?.webContents.send('query:usage', { sessionId, usage })
        },
      }
      this.window?.webContents.send('background:notification', { sessionId })
      session.processNotifications(notificationEvents).then(() => {
        this.window?.webContents.send('query:finished', { sessionId })
      }).catch((err: any) => {
        this.window?.webContents.send('query:error', { sessionId, error: err.message })
      })
    }
    this.sessions.set(sessionId, session)
    this.evaluateCodegraphState(meta.cwd)
  }

  async sendMessage(sessionId: string, text: string, images?: { data: string; mediaType: string }[]): Promise<any | undefined> {
    // Ensure session is activated with latest model config
    if (!this.sessions.has(sessionId)) {
      await this.activateSession(sessionId)
    }
    const session = this.sessions.get(sessionId)!

    // Apply stored permission mode (in case it was set before session was activated)
    const storedMode = this.permissionModes.get(sessionId)
    if (storedMode) {
      session.setPermissionMode(storedMode as any)
    }

    // Refresh model config in case user edited model params (contextWindow, maxTokens, etc.)
    const sessionModelId = this.history.getSessionModel(sessionId)
    if (sessionModelId) {
      const resolved = this.resolveModelById(sessionModelId)
      if (resolved) {
        const mc = session.config.modelConfig
        if (mc.model !== resolved.modelConfig.model || (session as any)._protocol !== resolved.protocol) {
          session.updateProvider(resolved.provider, resolved.modelConfig)
          ;(session as any)._protocol = resolved.protocol
        } else if (mc.contextWindow !== resolved.modelConfig.contextWindow ||
                   mc.compressAt !== resolved.modelConfig.compressAt ||
                   mc.maxTokens !== resolved.modelConfig.maxTokens) {
          session.updateProvider(session.getProvider(), resolved.modelConfig)
        }
      }
    }

    let completedMessage: any | undefined
    this.assistantDrafts.set(sessionId, '')
    const events: SessionEvents = {
      onStreamChunk: (chunk: StreamChunk) => {
        if (chunk.type === 'text_delta' && chunk.text) {
          this.assistantDrafts.set(sessionId, `${this.assistantDrafts.get(sessionId) || ''}${chunk.text}`)
        }
        this.window?.webContents.send('query:stream', { sessionId, chunk })
      },
      onToolEvent: (event: ToolExecutionEvent) => {
        this.window?.webContents.send('query:tool-event', { sessionId, event })
        if (event.type === 'complete' && event.toolName === 'enter_plan_mode') {
          this.window?.webContents.send('plan:mode-changed', { sessionId, mode: 'planning' })
        } else if (event.type === 'complete' && event.toolName === 'exit_plan_mode') {
          this.window?.webContents.send('plan:mode-changed', { sessionId, mode: 'normal' })
        }
      },
      onMessageComplete: (message) => {
        completedMessage = message
        this.window?.webContents.send('query:complete', { sessionId, message })
      },
      onMessagesReplaced: (messages) => {
        this.window?.webContents.send('session:messages-updated', { sessionId, messages })
      },
      onError: (error) => {
        this.window?.webContents.send('query:error', { sessionId, error: error.message })
      },
      onRetrying: (attempt: number, error: Error, delayMs: number, category: string, maxRetries?: number) => {
        this.window?.webContents.send('query:retrying', {
          sessionId,
          attempt,
          maxRetries,
          error: error.message || String(error),
          delayMs,
          category,
        })
      },
      onAgentProgress: (agentToolUseId: string, event: any) => {
        this.window?.webContents.send('agent:progress', { sessionId, agentToolUseId, ...event })
      },
      onAgentText: (agentToolUseId: string, text: string) => {
        this.window?.webContents.send('agent:text', { sessionId, agentToolUseId, text })
      },
      onAgentComplete: (agentToolUseId: string, result: any) => {
        this.window?.webContents.send('agent:complete', { sessionId, agentToolUseId, ...result })
      },
      onUsage: (usage) => {
        this.window?.webContents.send('query:usage', { sessionId, usage })
      },
    }

    // Compress images in the main process so the renderer can keep a simple attachment UI.
    let extraContent: Array<{ type: 'image'; source: { type: 'base64'; media_type: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'; data: string } }> | undefined
    if (images?.length) {
      extraContent = await Promise.all(images.map(async (img) => {
        try {
          const compressed = await compressImageForAPI(img.data, img.mediaType)
          return {
            type: 'image' as const,
            source: {
              type: 'base64' as const,
              media_type: compressed.mediaType,
              data: compressed.data,
            },
          }
        } catch (err) {
          const rawSize = Buffer.from(img.data, 'base64').length
          const base64Size = Math.ceil((rawSize * 4) / 3)
          if (base64Size > 5 * 1024 * 1024) {
            throw new Error(`Image too large (${(base64Size / 1024 / 1024).toFixed(1)}MB) and compression failed`)
          }
          console.warn('[IMAGE] Compression failed, sending original:', (err as Error).message)
          return {
            type: 'image' as const,
            source: {
              type: 'base64' as const,
              media_type: img.mediaType as 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp',
              data: img.data,
            },
          }
        }
      }))
    }

    try {
      await session.sendMessage(text, events, extraContent)
      this.window?.webContents.send('query:finished', { sessionId })
      this.assistantDrafts.delete(sessionId)
      return completedMessage
    } catch (err: any) {
      console.error('[SEND] Error:', err.message, err.stack)
      this.window?.webContents.send('query:error', { sessionId, error: err.message })
      this.assistantDrafts.delete(sessionId)
      return undefined
    }
  }

  async retrySession(sessionId: string): Promise<void> {
    if (!this.sessions.has(sessionId)) {
      await this.activateSession(sessionId)
    }
    const session = this.sessions.get(sessionId)!

    const storedMode = this.permissionModes.get(sessionId)
    if (storedMode) {
      session.setPermissionMode(storedMode as any)
    }

    this.assistantDrafts.set(sessionId, '')
    const events: SessionEvents = {
      onStreamChunk: (chunk: StreamChunk) => {
        if (chunk.type === 'text_delta' && chunk.text) {
          this.assistantDrafts.set(sessionId, `${this.assistantDrafts.get(sessionId) || ''}${chunk.text}`)
        }
        this.window?.webContents.send('query:stream', { sessionId, chunk })
      },
      onToolEvent: (event: ToolExecutionEvent) => {
        this.window?.webContents.send('query:tool-event', { sessionId, event })
        if (event.type === 'complete' && event.toolName === 'enter_plan_mode') {
          this.window?.webContents.send('plan:mode-changed', { sessionId, mode: 'planning' })
        } else if (event.type === 'complete' && event.toolName === 'exit_plan_mode') {
          this.window?.webContents.send('plan:mode-changed', { sessionId, mode: 'normal' })
        }
      },
      onMessageComplete: (message) => {
        this.window?.webContents.send('query:complete', { sessionId, message })
      },
      onMessagesReplaced: (messages) => {
        this.window?.webContents.send('session:messages-updated', { sessionId, messages })
      },
      onError: (error) => {
        this.window?.webContents.send('query:error', { sessionId, error: error.message })
      },
      onRetrying: (attempt: number, error: Error, delayMs: number, category: string, maxRetries?: number) => {
        this.window?.webContents.send('query:retrying', {
          sessionId,
          attempt,
          maxRetries,
          error: error.message || String(error),
          delayMs,
          category,
        })
      },
      onAgentProgress: (agentToolUseId: string, event: any) => {
        this.window?.webContents.send('agent:progress', { sessionId, agentToolUseId, ...event })
      },
      onAgentText: (agentToolUseId: string, text: string) => {
        this.window?.webContents.send('agent:text', { sessionId, agentToolUseId, text })
      },
      onAgentComplete: (agentToolUseId: string, result: any) => {
        this.window?.webContents.send('agent:complete', { sessionId, agentToolUseId, ...result })
      },
      onUsage: (usage) => {
        this.window?.webContents.send('query:usage', { sessionId, usage })
      },
    }

    try {
      await session.retryLastTurn(events)
      this.window?.webContents.send('query:finished', { sessionId })
      this.assistantDrafts.delete(sessionId)
    } catch (err: any) {
      console.error('[RETRY] Error:', err.message, err.stack)
      this.window?.webContents.send('query:error', { sessionId, error: err.message })
      this.assistantDrafts.delete(sessionId)
    }
  }

  getActiveProjectContext(): { projectName: string; cwd: string } {
    const activeMeta = this.activeSessionId
      ? this.history.listSessions().find(s => s.id === this.activeSessionId)
      : null
    if (activeMeta) return { projectName: activeMeta.projectName, cwd: activeMeta.cwd }
    return { projectName: 'Chat Bridge', cwd: process.cwd() }
  }

  abortSession(sessionId: string): void {
    this.sessions.get(sessionId)?.abort()
  }

  abortAgent(sessionId: string, agentToolUseId: string): void {
    this.sessions.get(sessionId)?.abortAgent(agentToolUseId)
  }

  backgroundAgent(sessionId: string, agentToolUseId: string): void {
    const session = this.sessions.get(sessionId)
    if (session) {
      session.backgroundAgent(agentToolUseId)
    }
  }

  respondToPermission(id: string, allowed: boolean): void {
    const pending = this.pendingPermissions.get(id)
    if (pending) {
      pending.resolve(allowed)
      this.pendingPermissions.delete(id)
      const { resolve: _resolve, ...info } = pending
      const payload = { ...info, allowed }
      for (const listener of this.permissionResolvedListeners) listener(payload)
      this.window?.webContents.send('permission:resolved', payload)
    }
  }

  onPermissionRequest(listener: (request: PendingPermissionInfo) => void): () => void {
    this.permissionListeners.add(listener)
    return () => this.permissionListeners.delete(listener)
  }

  onPermissionResolved(listener: (request: ResolvedPermissionInfo) => void): () => void {
    this.permissionResolvedListeners.add(listener)
    return () => this.permissionResolvedListeners.delete(listener)
  }

  getLatestPendingPermission(sessionId: string): PendingPermissionInfo | null {
    const pending = Array.from(this.pendingPermissions.values())
      .filter(item => item.sessionId === sessionId)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    const latest = pending[0]
    if (!latest) return null
    const { resolve: _resolve, ...info } = latest
    return info
  }

  respondToLatestPermission(sessionId: string, allowed: boolean): PendingPermissionInfo | null {
    const latest = this.getLatestPendingPermission(sessionId)
    if (!latest) return null
    this.respondToPermission(latest.id, allowed)
    return latest
  }

  respondToAskUser(id: string, answer: string): void {
    const pending = this.pendingAskUser.get(id)
    if (pending) {
      pending.resolve(answer)
      this.pendingAskUser.delete(id)
    }
  }

  respondToPlanReview(id: string, approved: boolean, feedback?: string): void {
    const pending = this.pendingPlanReviews.get(id)
    if (pending) {
      pending.resolve({ approved, feedback })
      this.pendingPlanReviews.delete(id)
    }
  }

  deleteSession(sessionId: string): void {
    this.sessions.delete(sessionId)
    this.history.deleteSession(sessionId)
    this.window?.webContents.send('session:changed', { action: 'deleted', sessionId })
  }

  renameSession(sessionId: string, title: string): void {
    this.history.updateSessionTitle(sessionId, title)
    this.window?.webContents.send('session:changed', { action: 'renamed', sessionId, title })
  }

  getMessages(sessionId: string) {
    return this.history.getMessages(sessionId)
  }

  getUsage(sessionId: string) {
    const session = this.sessions.get(sessionId)
    if (!session) return null
    return session.getUsageSnapshot()
  }

  getFileChanges(sessionId: string) {
    const session = this.sessions.get(sessionId)
    if (!session) return []
    return session.getFileTracker().getChangedFiles()
  }

  getFileHistory(sessionId: string, filePath: string) {
    const session = this.sessions.get(sessionId)
    if (!session) return []
    return session.getFileTracker().getFileHistory(filePath)
  }

  async rewindFile(sessionId: string, snapshotId: string) {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error('Session not found')
    return session.getFileTracker().rewindFile(snapshotId)
  }

  async rewindToTurn(sessionId: string, turnIndex: number) {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error('Session not found')
    return session.getFileTracker().rewindToTurn(turnIndex)
  }

  acceptFile(sessionId: string, filePath: string): void {
    const session = this.sessions.get(sessionId)
    if (session) session.getFileTracker().acceptFile(filePath)
  }

  acceptAllFiles(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (session) session.getFileTracker().acceptAllFiles()
  }

  getBackgroundTasks(sessionId: string): any[] {
    const session = this.sessions.get(sessionId)
    if (!session) return []
    return (session as any).backgroundTasks.listAll()
  }

  stopBackgroundTask(sessionId: string, taskId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    ;(session as any).backgroundTasks.stop(taskId)
    this.window?.webContents.send('background:state-changed', { sessionId })
  }

  getBackgroundTaskOutput(sessionId: string, taskId: string, tail?: number): string {
    const session = this.sessions.get(sessionId)
    if (!session) return ''
    return (session as any).backgroundTasks.getOutput(taskId, tail)
  }

  getTeamStatus(sessionId: string, taskId: string): any {
    const session = this.sessions.get(sessionId)
    if (!session) return null
    return session.getTeamStatus(taskId)
  }

  getTeamEvents(sessionId: string, taskId: string, tail?: number): any[] {
    const session = this.sessions.get(sessionId)
    if (!session) return []
    return session.getTeamEvents(taskId, tail)
  }

  sendTeamMessage(sessionId: string, taskId: string, payload: { message: string; target?: string; intent?: string; priority?: string }): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    session.sendTeamMessage(taskId, payload)
    this.window?.webContents.send('team:state-changed', { sessionId, taskId })
  }

  close(): void {
    this.mcpManager.close()
    this.history.close()
  }

  async initMcp(cwd: string): Promise<void> {
    const configs = loadMcpConfig(cwd)
    await this.mcpManager.loadConfig(configs)
  }

  async reloadMcp(cwd?: string): Promise<void> {
    const activeMeta = this.activeSessionId
      ? this.history.listSessions().find(s => s.id === this.activeSessionId)
      : null
    const targetCwd = cwd || activeMeta?.cwd || process.cwd()
    await this.mcpManager.close()
    await this.initMcp(targetCwd)
  }

  getMcpServerStates(): McpServerState[] {
    return this.mcpManager.getServerStates()
  }

  async reconnectMcpServer(name: string): Promise<void> {
    await this.mcpManager.reconnectServer(name)
  }

  async toggleMcpServer(name: string, enabled: boolean): Promise<void> {
    if (enabled) {
      await this.mcpManager.reconnectServer(name)
    } else {
      await this.mcpManager.disconnectServer(name)
    }
  }

  async getSkills(sessionId: string): Promise<{ name: string; description: string; argumentHint?: string; userInvocable: boolean; source: 'global' | 'project'; filePath: string; entryType: 'file' | 'directory' }[]> {
    const session = await this.getSessionForSkillAction(sessionId)
    if (!session) return []
    const loader = session.getSkillLoader()
    return loader.getAll().map(s => ({
      name: s.name,
      description: s.description,
      argumentHint: s.argumentHint,
      userInvocable: s.userInvocable,
      source: s.source,
      filePath: s.filePath,
      entryType: s.entryType,
    }))
  }

  async deleteSkill(sessionId: string, filePath: string): Promise<void> {
    const session = await this.getSessionForSkillAction(sessionId)
    if (!session) throw new Error('Session not found')
    await session.getSkillLoader().delete(filePath)
    await session.reloadSkills()
    this.window?.webContents.send('skills:changed', { sessionId })
  }

  async setSkillInvocable(sessionId: string, filePath: string, userInvocable: boolean): Promise<void> {
    const session = await this.getSessionForSkillAction(sessionId)
    if (!session) throw new Error('Session not found')
    await session.getSkillLoader().setInvocable(filePath, userInvocable)
    await session.reloadSkills()
    this.window?.webContents.send('skills:changed', { sessionId })
  }

  private async getSessionForSkillAction(sessionId: string): Promise<Session | null> {
    if (!this.sessions.has(sessionId)) {
      try { await this.activateSession(sessionId) } catch { return null }
    }
    const session = this.sessions.get(sessionId)
    if (!session) return null
    await session.ensureSkillsReady()
    await session.reloadSkills()
    return session
  }

  setPermissionMode(sessionId: string, mode: string): void {
    this.permissionModes.set(sessionId, mode)
    const session = this.sessions.get(sessionId)
    if (session) {
      session.setPermissionMode(mode as any)
    }
  }

  async compactSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session) {
      this.window?.webContents.send('query:error', { sessionId, error: 'Session not active' })
      this.window?.webContents.send('query:finished', { sessionId })
      return
    }

    // Defer terminal compact_* events until AFTER session:messages-updated so
    // any UI-side reaction (e.g. inserting a "[Context compressed]" marker)
    // is not clobbered by the subsequent full-messages replacement.
    const deferredChunks: StreamChunk[] = []
    const isTerminalCompactChunk = (chunk: StreamChunk) =>
      chunk.type === 'compact_complete' ||
      chunk.type === 'compact_skipped' ||
      chunk.type === 'compact_failed'

    const events: SessionEvents = {
      onStreamChunk: (chunk: StreamChunk) => {
        if (isTerminalCompactChunk(chunk)) {
          deferredChunks.push(chunk)
          return
        }
        this.window?.webContents.send('query:stream', { sessionId, chunk })
      },
      onToolEvent: () => {},
      onMessageComplete: () => {},
      onError: (error) => {
        this.window?.webContents.send('query:error', { sessionId, error: error.message })
      },
      onUsage: (usage) => {
        this.window?.webContents.send('query:usage', { sessionId, usage })
      },
    }
    try {
      await session.compactNow(events)
      const messages = session.getMessages()
      this.window?.webContents.send('session:messages-updated', { sessionId, messages })
      for (const chunk of deferredChunks) {
        this.window?.webContents.send('query:stream', { sessionId, chunk })
      }
    } catch (err: any) {
      this.window?.webContents.send('query:error', { sessionId, error: err.message })
    }
    this.window?.webContents.send('query:finished', { sessionId })
  }

  clearSession(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (session) {
      session.clearMessages()
      this.window?.webContents.send('session:messages-updated', { sessionId, messages: [] })
    }
  }

  setEffort(sessionId: string, effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'): void {
    const session = this.sessions.get(sessionId)
    if (session) {
      session.setEffort(effort)
    }
  }

  setPlanMode(sessionId: string, mode: 'normal' | 'planning'): void {
    const session = this.sessions.get(sessionId)
    if (session) {
      session.setPlanMode(mode)
    }
  }

  getPlanMode(sessionId: string): string {
    const session = this.sessions.get(sessionId)
    return session?.getPlanMode() || 'normal'
  }

  getTasks(sessionId: string) {
    return this.history.getTasks(sessionId)
  }

  async saveMcpServers(servers: Record<string, McpServerConfig>, scope: 'global' | 'project', cwd?: string): Promise<void> {
    saveMcpConfig(servers, scope, cwd)
    await this.reloadMcp(cwd)
  }

  private getDismissedCodegraphCwds(): string[] {
    const cfg = loadAppConfig() as { dismissedCodegraphForCwds?: string[] }
    return Array.isArray(cfg.dismissedCodegraphForCwds) ? cfg.dismissedCodegraphForCwds : []
  }

  evaluateCodegraphState(cwd: string): void {
    const initialized = codegraph.isInitialized(cwd)
    const dismissed = this.getDismissedCodegraphCwds().includes(cwd)
    this.window?.webContents.send('codegraph:project-state', { cwd, initialized, dismissed })
  }

  async runCodegraphInit(cwd: string): Promise<void> {
    // Ensure .codegraph is in .gitignore before indexing
    this.ensureGitignore(cwd)
    const onLine = (line: string) => {
      this.window?.webContents.send('codegraph:init-progress', { cwd, line })
    }
    await codegraph.init(cwd, onLine)
    this.evaluateCodegraphState(cwd)
  }

  private ensureGitignore(cwd: string): void {
    const fs = require('node:fs')
    const path = require('node:path')
    const gitignorePath = path.join(cwd, '.gitignore')
    const entry = '.codegraph'
    try {
      if (!fs.existsSync(gitignorePath)) return
      const content: string = fs.readFileSync(gitignorePath, 'utf-8')
      const lines = content.split('\n').map((l: string) => l.trim())
      if (!lines.includes(entry) && !lines.includes(entry + '/')) {
        const suffix = content.endsWith('\n') ? '' : '\n'
        fs.appendFileSync(gitignorePath, `${suffix}${entry}\n`)
      }
    } catch { /* non-critical, don't block init */ }
  }

  async runCodegraphReindex(cwd: string): Promise<void> {
    const onLine = (line: string) => {
      this.window?.webContents.send('codegraph:init-progress', { cwd, line })
    }
    await codegraph.forceReindex(cwd, onLine)
    this.evaluateCodegraphState(cwd)
  }

  dismissCodegraphForCwd(cwd: string): void {
    const cfg = loadAppConfig() as { dismissedCodegraphForCwds?: string[] }
    const list = Array.isArray(cfg.dismissedCodegraphForCwds) ? [...cfg.dismissedCodegraphForCwds] : []
    if (!list.includes(cwd)) list.push(cwd)
    saveAppConfig({ ...cfg, dismissedCodegraphForCwds: list })
    this.evaluateCodegraphState(cwd)
  }
}
