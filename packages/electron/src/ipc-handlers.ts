import { ipcMain, dialog } from 'electron'
import { IPC_CHANNELS } from './ipc-channels.js'
import type { SessionManager } from './session-manager.js'
import { loadAppConfig, saveAppConfig, AnthropicProvider, OpenAIChatProvider, OpenAIResponsesProvider } from '@puddingagent/core'
import { GitService } from './git-service.js'
import { AppLauncher } from './app-launcher.js'
import { TerminalService } from './terminal-service.js'
import { PluginMarketplaceService } from './plugin-marketplace-service.js'
import { ChatBridgeService } from './chat-bridge-service.js'

interface DevToolServices {
  gitService: GitService
  appLauncher: AppLauncher
  terminalService: TerminalService
  pluginMarketplaceService: PluginMarketplaceService
  chatBridgeService: ChatBridgeService
}

function ipcPayload(payload: unknown): Record<string, unknown> {
  return payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined
}

function requiredSessionId(payload: unknown): string {
  const sessionId = optionalString(ipcPayload(payload).sessionId)
  if (!sessionId) throw new Error('sessionId is required')
  return sessionId
}

export function registerIpcHandlers(sessionManager: SessionManager, services: DevToolServices): void {
  ipcMain.on('permission:response', (_event, { id, allowed }) => {
    sessionManager.respondToPermission(id, allowed)
  })

  ipcMain.on('ask_user:response', (_event, { id, answer }) => {
    sessionManager.respondToAskUser(id, answer)
  })

  ipcMain.on('plan:respond', (_event, { id, approved, feedback }) => {
    sessionManager.respondToPlanReview(id, approved, feedback)
  })

  ipcMain.handle(IPC_CHANNELS.SESSION_CREATE, async (_event, { projectName, cwd }) => {
    const sessionId = sessionManager.createSession(projectName, cwd)
    return { sessionId }
  })

  ipcMain.handle(IPC_CHANNELS.SESSION_LIST, async () => {
    return sessionManager.listAllProjects()
  })

  ipcMain.handle(IPC_CHANNELS.SESSION_SEARCH, async (_event, { query, cwd }) => {
    return sessionManager.searchSessions(query || '', cwd || undefined)
  })

  ipcMain.handle(IPC_CHANNELS.SESSION_SWITCH, async (_event, { sessionId }) => {
    await sessionManager.activateSession(sessionId)
    const messages = sessionManager.getMessages(sessionId)
    const usage = sessionManager.getUsage(sessionId)
    const modelId = sessionManager.getSessionModel(sessionId)
    return { messages, usage, modelId }
  })

  ipcMain.handle(IPC_CHANNELS.SESSION_DELETE, async (_event, { sessionId }) => {
    sessionManager.deleteSession(sessionId)
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.SESSION_RENAME, async (_event, { sessionId, title }) => {
    sessionManager.renameSession(sessionId, title)
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.SESSION_SET_MODEL, async (_event, { sessionId, modelId }) => {
    sessionManager.setSessionModel(sessionId, modelId)
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.SESSION_GET_MODEL, async (_event, { sessionId }) => {
    return { modelId: sessionManager.getSessionModel(sessionId) }
  })

  ipcMain.handle(IPC_CHANNELS.CONTEXT_INSPECT, async (_event, payload = {}) => {
    const input = ipcPayload(payload)
    return sessionManager.inspectContext(requiredSessionId(input), {
      userMessage: optionalString(input.userMessage),
    })
  })

  ipcMain.handle(IPC_CHANNELS.CONTEXT_REFRESH, async (_event, payload = {}) => {
    const input = ipcPayload(payload)
    return sessionManager.refreshContext(requiredSessionId(input), {
      userMessage: optionalString(input.userMessage),
    })
  })

  ipcMain.handle(IPC_CHANNELS.VERIFICATION_INSPECT, async (_event, payload = {}) => {
    return sessionManager.inspectVerification(requiredSessionId(payload))
  })

  ipcMain.handle(IPC_CHANNELS.QUERY_SEND, async (_event, { sessionId, text, images }) => {
    sessionManager.sendMessage(sessionId, text, images)
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.QUERY_RETRY, async (_event, { sessionId }) => {
    sessionManager.retrySession(sessionId)
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.QUERY_ABORT, async (_event, { sessionId }) => {
    sessionManager.abortSession(sessionId)
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.AGENT_ABORT, async (_event, { sessionId, agentToolUseId }) => {
    sessionManager.abortAgent(sessionId, agentToolUseId)
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.AGENT_BACKGROUND, async (_event, { sessionId, agentToolUseId }) => {
    sessionManager.backgroundAgent(sessionId, agentToolUseId)
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.CONFIG_GET, async () => {
    return loadAppConfig()
  })

  ipcMain.handle(IPC_CHANNELS.CONFIG_SET, async (_event, config) => {
    saveAppConfig(config)
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.DIALOG_OPEN_FOLDER, async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (result.canceled) return { path: null }
    return { path: result.filePaths[0] }
  })

  ipcMain.handle(IPC_CHANNELS.SKILLS_LIST, async (_event, { sessionId }) => {
    return sessionManager.getSkills(sessionId)
  })

  ipcMain.handle(IPC_CHANNELS.SKILLS_DELETE, async (_event, { sessionId, filePath }) => {
    await sessionManager.deleteSkill(sessionId, filePath)
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.SKILLS_SET_INVOCABLE, async (_event, { sessionId, filePath, userInvocable }) => {
    await sessionManager.setSkillInvocable(sessionId, filePath, Boolean(userInvocable))
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.SESSION_SET_PERMISSION, async (_event, { sessionId, mode }) => {
    sessionManager.setPermissionMode(sessionId, mode)
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.SESSION_COMPACT, async (_event, { sessionId }) => {
    await sessionManager.compactSession(sessionId)
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.SESSION_CLEAR, async (_event, { sessionId }) => {
    sessionManager.clearSession(sessionId)
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.SESSION_SET_EFFORT, async (_event, { sessionId, effort }) => {
    sessionManager.setEffort(sessionId, effort)
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.SESSION_SET_PLAN_MODE, async (_event, { sessionId, mode }) => {
    sessionManager.setPlanMode(sessionId, mode)
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.SESSION_GET_PLAN_MODE, async (_event, { sessionId }) => {
    return { mode: sessionManager.getPlanMode(sessionId) }
  })

  ipcMain.handle(IPC_CHANNELS.FILE_GET_CHANGES, async (_event, { sessionId }) => {
    return sessionManager.getFileChanges(sessionId)
  })

  ipcMain.handle(IPC_CHANNELS.FILE_GET_HISTORY, async (_event, { sessionId, filePath }) => {
    return sessionManager.getFileHistory(sessionId, filePath)
  })

  ipcMain.handle(IPC_CHANNELS.FILE_REWIND, async (_event, { sessionId, snapshotId }) => {
    return sessionManager.rewindFile(sessionId, snapshotId)
  })

  ipcMain.handle(IPC_CHANNELS.FILE_REWIND_TURN, async (_event, { sessionId, turnIndex }) => {
    return sessionManager.rewindToTurn(sessionId, turnIndex)
  })

  ipcMain.handle(IPC_CHANNELS.FILE_ACCEPT, async (_event, { sessionId, filePath }) => {
    sessionManager.acceptFile(sessionId, filePath)
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.FILE_ACCEPT_ALL, async (_event, { sessionId }) => {
    sessionManager.acceptAllFiles(sessionId)
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.SESSION_GET_TASKS, async (_event, { sessionId }) => {
    return sessionManager.getTasks(sessionId)
  })

  const { gitService, appLauncher, terminalService, pluginMarketplaceService, chatBridgeService } = services

  // Git
  ipcMain.handle(IPC_CHANNELS.GIT_BRANCH_LIST, async (_event, { cwd }) => {
    return gitService.listBranches(cwd)
  })
  ipcMain.handle(IPC_CHANNELS.GIT_BRANCH_SWITCH, async (_event, { cwd, branch }) => {
    return gitService.switchBranch(cwd, branch)
  })
  ipcMain.handle(IPC_CHANNELS.GIT_BRANCH_CREATE, async (_event, { cwd, branch, from }) => {
    return gitService.createBranch(cwd, branch, from)
  })
  ipcMain.handle(IPC_CHANNELS.GIT_BRANCH_DELETE, async (_event, { cwd, branch }) => {
    return gitService.deleteBranch(cwd, branch)
  })
  ipcMain.handle(IPC_CHANNELS.GIT_STATUS, async (_event, { cwd }) => {
    return gitService.getStatus(cwd)
  })
  ipcMain.handle(IPC_CHANNELS.GIT_STASH, async (_event, { cwd }) => {
    return gitService.stash(cwd)
  })
  ipcMain.handle(IPC_CHANNELS.GIT_STASH_POP, async (_event, { cwd }) => {
    return gitService.stashPop(cwd)
  })
  ipcMain.handle(IPC_CHANNELS.GIT_HAS_STASH, async (_event, { cwd }) => {
    return gitService.hasStash(cwd)
  })

  // Per-sender branch watch subscriptions: senderId -> cwd -> dispose fn
  const branchWatches = new Map<number, Map<string, () => void>>()

  const stopWatchesForSender = (senderId: number) => {
    const map = branchWatches.get(senderId)
    if (!map) return
    for (const dispose of map.values()) dispose()
    branchWatches.delete(senderId)
  }

  ipcMain.handle(IPC_CHANNELS.GIT_WATCH_START, async (event, { cwd }: { cwd: string }) => {
    const sender = event.sender
    const senderId = sender.id
    let map = branchWatches.get(senderId)
    if (!map) {
      map = new Map()
      branchWatches.set(senderId, map)
      sender.once('destroyed', () => stopWatchesForSender(senderId))
    }
    if (map.has(cwd)) return { success: true }
    const dispose = gitService.watchBranches(cwd, (state) => {
      if (sender.isDestroyed()) return
      sender.send(IPC_CHANNELS.GIT_BRANCH_CHANGED, { cwd, ...state })
    })
    map.set(cwd, dispose)
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.GIT_WATCH_STOP, async (event, { cwd }: { cwd: string }) => {
    const map = branchWatches.get(event.sender.id)
    const dispose = map?.get(cwd)
    if (dispose) {
      dispose()
      map!.delete(cwd)
    }
    return { success: true }
  })

  // Apps
  ipcMain.handle(IPC_CHANNELS.APPS_DETECT, async () => {
    return { apps: appLauncher.detect() }
  })
  ipcMain.handle(IPC_CHANNELS.APPS_OPEN, async (_event, { appId, cwd }) => {
    const result = await appLauncher.open(appId, cwd)
    if (result.success && cwd) {
      sessionManager.startIdeDiscovery(cwd)
    }
    return result
  })

  // Plugins
  ipcMain.handle(IPC_CHANNELS.PLUGINS_LIST_MARKETPLACES, async () => {
    return pluginMarketplaceService.listMarketplaces()
  })
  ipcMain.handle(IPC_CHANNELS.PLUGINS_ADD_MARKETPLACE, async (_event, { source }) => {
    return pluginMarketplaceService.addMarketplace(source || '')
  })
  ipcMain.handle(IPC_CHANNELS.PLUGINS_REMOVE_MARKETPLACE, async (_event, { id }) => {
    return pluginMarketplaceService.removeMarketplace(id)
  })
  ipcMain.handle(IPC_CHANNELS.PLUGINS_LIST, async () => {
    return pluginMarketplaceService.listPlugins()
  })
  ipcMain.handle(IPC_CHANNELS.PLUGINS_INSTALL, async (_event, { plugin }) => {
    return pluginMarketplaceService.installPlugin(plugin)
  })
  ipcMain.handle(IPC_CHANNELS.PLUGINS_UNINSTALL, async (_event, { id }) => {
    return pluginMarketplaceService.uninstallPlugin(id)
  })
  ipcMain.handle(IPC_CHANNELS.PLUGINS_SET_ENABLED, async (_event, { id, enabled }) => {
    return pluginMarketplaceService.setPluginEnabled(id, Boolean(enabled))
  })

  // Terminal
  ipcMain.handle(IPC_CHANNELS.TERMINAL_CREATE, async (_event, { cwd }) => {
    return terminalService.create(cwd)
  })
  ipcMain.on(IPC_CHANNELS.TERMINAL_WRITE, (_event, { id, data }) => {
    terminalService.write(id, data)
  })
  ipcMain.on(IPC_CHANNELS.TERMINAL_RESIZE, (_event, { id, cols, rows }) => {
    terminalService.resize(id, cols, rows)
  })
  ipcMain.handle(IPC_CHANNELS.TERMINAL_DESTROY, async (_event, { id }) => {
    return terminalService.destroy(id)
  })

  // IDE Integration
  ipcMain.handle(IPC_CHANNELS.IDE_GET_STATE, async () => {
    return sessionManager.getIdeConnections()
  })

  ipcMain.handle(IPC_CHANNELS.IDE_OPEN_FILE, async (_event, { filePath, line, column }) => {
    try {
      await sessionManager.ideOpenFile(filePath, line, column)
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.IDE_OPEN_DIFF, async (_event, params) => {
    try {
      return await sessionManager.ideOpenDiff(params)
    } catch (err: any) {
      return { action: 'rejected', error: err.message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.IDE_CLOSE_DIFF_TABS, async () => {
    try {
      await sessionManager.ideCloseAllDiffTabs()
      return { success: true }
    } catch {
      return { success: true }
    }
  })

  ipcMain.handle(IPC_CHANNELS.IDE_GET_DIAGNOSTICS, async (_event, { filePaths }) => {
    try {
      return await sessionManager.ideGetDiagnostics(filePaths)
    } catch (err: any) {
      return { files: [] }
    }
  })

  ipcMain.handle(IPC_CHANNELS.CODEGRAPH_INIT, async (_evt, cwd: string) => {
    return sessionManager.runCodegraphInit(cwd)
  })

  ipcMain.handle(IPC_CHANNELS.CODEGRAPH_REINDEX, async (_evt, cwd: string) => {
    return sessionManager.runCodegraphReindex(cwd)
  })

  ipcMain.handle(IPC_CHANNELS.CODEGRAPH_DISMISS, async (_evt, cwd: string) => {
    sessionManager.dismissCodegraphForCwd(cwd)
  })

  ipcMain.handle(IPC_CHANNELS.CODEGRAPH_STATE, async (_evt, cwd: string) => {
    sessionManager.evaluateCodegraphState(cwd)
  })

  ipcMain.handle(IPC_CHANNELS.MODEL_TEST, async (_event, { protocol, baseUrl, apiKey, modelId }) => {
    try {
      const provider = (() => {
        switch (protocol) {
          case 'openai':
            return new OpenAIChatProvider(apiKey, baseUrl)
          case 'openai-responses':
            return new OpenAIResponsesProvider(apiKey, baseUrl)
          case 'anthropic':
          default:
            return new AnthropicProvider(apiKey, baseUrl || undefined)
        }
      })()
      const messages = [{ id: '1', role: 'user' as const, content: [{ type: 'text' as const, text: 'hi' }], timestamp: Date.now() }]
      const config = { model: modelId, maxTokens: 100 }
      let reply = ''
      for await (const chunk of provider.stream(messages, [], config)) {
        if (chunk.type === 'text_delta' && chunk.text) reply += chunk.text
      }
      return { success: true, reply: reply.slice(0, 100) }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // Chat Bridge
  ipcMain.handle(IPC_CHANNELS.CHAT_BRIDGE_GET, async () => {
    return chatBridgeService.snapshot()
  })

  ipcMain.handle(IPC_CHANNELS.CHAT_BRIDGE_CHANNELS, async () => {
    return chatBridgeService.getChannels()
  })

  ipcMain.handle(IPC_CHANNELS.CHAT_BRIDGE_START, async () => {
    return chatBridgeService.start()
  })

  ipcMain.handle(IPC_CHANNELS.CHAT_BRIDGE_STOP, async () => {
    return chatBridgeService.stop()
  })

  ipcMain.handle(IPC_CHANNELS.CHAT_BRIDGE_START_CHANNEL, async (_event, { channelId }) => {
    return chatBridgeService.startChannel(channelId)
  })

  ipcMain.handle(IPC_CHANNELS.CHAT_BRIDGE_STOP_CHANNEL, async (_event, { channelId }) => {
    return chatBridgeService.stopChannel(channelId)
  })

  ipcMain.handle(IPC_CHANNELS.CHAT_BRIDGE_SAVE_CHANNEL, async (_event, { channel }) => {
    return chatBridgeService.saveChannel(channel)
  })

  ipcMain.handle(IPC_CHANNELS.CHAT_BRIDGE_LOGIN_CHANNEL, async (_event, { channelId }) => {
    return chatBridgeService.loginChannel(channelId)
  })

  ipcMain.handle(IPC_CHANNELS.CHAT_BRIDGE_POLL_LOGIN, async (_event, { channelId, qrcode }) => {
    return chatBridgeService.pollWeixinLogin(channelId, qrcode)
  })

  ipcMain.handle(IPC_CHANNELS.CHAT_BRIDGE_RESET_ROUTE, async (_event, { routeKey }) => {
    return chatBridgeService.resetRoute(routeKey)
  })

  ipcMain.handle(IPC_CHANNELS.CHAT_BRIDGE_NEW_ROUTE_SESSION, async (_event, { routeKey }) => {
    return chatBridgeService.newRouteSession(routeKey)
  })

  ipcMain.handle(IPC_CHANNELS.CHAT_BRIDGE_UNTRUST_ROUTE, async (_event, { routeKey }) => {
    return chatBridgeService.untrustRoute(routeKey)
  })

  ipcMain.handle(IPC_CHANNELS.CHAT_BRIDGE_SAVE_SECURITY, async (_event, { security }) => {
    return chatBridgeService.saveSecurity(security)
  })

  ipcMain.handle(IPC_CHANNELS.CHAT_BRIDGE_REGENERATE_PAIRING_CODE, async () => {
    return chatBridgeService.regeneratePairingCode()
  })

  ipcMain.handle(IPC_CHANNELS.CHAT_BRIDGE_SAVE_PROJECT, async (_event, { project }) => {
    return chatBridgeService.saveProject(project)
  })

  // Background Tasks
  ipcMain.handle(IPC_CHANNELS.BACKGROUND_LIST, async (_event, { sessionId }) => {
    return sessionManager.getBackgroundTasks(sessionId)
  })

  ipcMain.handle(IPC_CHANNELS.BACKGROUND_STOP, async (_event, { sessionId, taskId }) => {
    sessionManager.stopBackgroundTask(sessionId, taskId)
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.BACKGROUND_OUTPUT, async (_event, { sessionId, taskId, tail }) => {
    return sessionManager.getBackgroundTaskOutput(sessionId, taskId, tail)
  })

  ipcMain.handle(IPC_CHANNELS.TEAM_GET_STATUS, async (_event, { sessionId, taskId }) => {
    return sessionManager.getTeamStatus(sessionId, taskId)
  })

  ipcMain.handle(IPC_CHANNELS.TEAM_GET_EVENTS, async (_event, { sessionId, taskId, tail }) => {
    return sessionManager.getTeamEvents(sessionId, taskId, tail)
  })

  ipcMain.handle(IPC_CHANNELS.TEAM_SEND, async (_event, { sessionId, taskId, payload }) => {
    sessionManager.sendTeamMessage(sessionId, taskId, payload)
    return { success: true }
  })
}
