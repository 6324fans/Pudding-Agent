import type { AppConfig, Message, StreamChunk, ToolExecutionEvent } from '@puddingagent/core'

export interface CodegraphState {
  cwd: string
  initialized: boolean
  dismissed: boolean
}

export interface McpServerState {
  name: string
  config: { transport: 'stdio' | 'sse'; command?: string; args?: string[]; url?: string; env?: Record<string, string>; headers?: Record<string, string>; disabled?: boolean }
  status: 'connected' | 'connecting' | 'failed' | 'disconnected' | 'disabled'
  error?: string
  tools: { name: string; description?: string }[]
  instructions?: string
}

export interface SkillListItem {
  name: string
  description: string
  argumentHint?: string
  userInvocable?: boolean
  source?: 'global' | 'project'
  filePath?: string
  entryType?: 'file' | 'directory'
}

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

export type ChatChannelKind = 'weixin' | 'feishu'
export type ChatChannelState = 'stopped' | 'starting' | 'login_required' | 'connected' | 'degraded' | 'failed'

export interface ChatChannelConfig {
  id: string
  kind: ChatChannelKind
  label: string
  enabled: boolean
  accountId?: string
  weixin?: {
    baseUrl?: string
    botType?: string
    channelVersion?: string
    token?: string
    ilinkUserId?: string
  }
  feishu?: {
    appId?: string
    appSecret?: string
    verificationToken?: string
    encryptKey?: string
    webhookPath?: string
  }
}

export interface ChatChannelStatus {
  channelId: string
  kind: ChatChannelKind
  label: string
  state: ChatChannelState
  enabled: boolean
  account?: string
  lastInboundAt?: string
  lastOutboundAt?: string
  lastError?: string
  details?: Record<string, unknown>
  capabilities: {
    text: boolean
    media: boolean
    receiveMedia: boolean
    typing: boolean
    direct: boolean
    group: boolean
    thread: boolean
    login: 'qr' | 'token' | 'none'
    streamingHint: boolean
  }
}

export interface ChatBridgeEvent {
  id: string
  channelId: string
  kind: 'inbound' | 'outbound' | 'status' | 'error' | 'login'
  text: string
  routeKey?: string
  timestamp: string
}

export interface ChatBridgeRouteState {
  routeKey: string
  channelId: string
  sessionId?: string
  conversationKind: 'direct' | 'group' | 'thread'
  conversationName?: string
  senderName?: string
  inboundCount: number
  outboundCount: number
  pending: boolean
  trusted: boolean
  lastInboundAt?: string
  lastOutboundAt?: string
  lastText?: string
  lastError?: string
}

export interface ChatBridgeSnapshot {
  enabled: boolean
  webhookPort: number
  webhookUrl: string
  project: {
    mode: 'active' | 'fixed'
    cwd?: string
    projectName?: string
  }
  security: {
    requirePairing: boolean
    pairingCode: string
    trustedRoutes: Record<string, { pairedAt: string; label?: string }>
  }
  channels: ChatChannelStatus[]
  routes: ChatBridgeRouteState[]
  events: ChatBridgeEvent[]
}

declare global {
  interface Window {
    electronAPI?: {
      invoke: (channel: string, data?: unknown) => Promise<unknown>
      on: (channel: string, callback: (event: unknown, ...args: unknown[]) => void) => () => void
      send: (channel: string, data: unknown) => void
      mcpListServers: () => Promise<McpServerState[]>
      mcpReconnect: (serverName: string) => Promise<void>
      mcpToggle: (serverName: string, enabled: boolean) => Promise<void>
      mcpSaveConfig: (servers: any, scope: string, cwd?: string) => Promise<void>
      onMcpStateChanged: (callback: (states: McpServerState[]) => void) => (() => void) | void
      pluginsListMarketplaces: () => Promise<PluginMarketplace[]>
      pluginsAddMarketplace: (source: string) => Promise<PluginMarketplace[]>
      pluginsRemoveMarketplace: (id: string) => Promise<PluginMarketplace[]>
      pluginsList: () => Promise<{ plugins: MarketplacePlugin[]; errors: { marketplaceId: string; message: string }[] }>
      pluginsInstall: (plugin: MarketplacePlugin) => Promise<InstalledPlugin[]>
      pluginsUninstall: (id: string) => Promise<InstalledPlugin[]>
      pluginsSetEnabled: (id: string, enabled: boolean) => Promise<InstalledPlugin[]>
      listSkills: (sessionId: string) => Promise<SkillListItem[]>
      deleteSkill?: (sessionId: string, filePath: string) => Promise<{ success: boolean }>
      setSkillInvocable?: (sessionId: string, filePath: string, userInvocable: boolean) => Promise<{ success: boolean }>
      onSkillsChanged?: (callback: (payload: { sessionId: string }) => void) => () => void
      onSessionChanged?: (callback: (payload: SessionChangedPayload) => void) => () => void
      agentAbort?: (sessionId: string, agentToolUseId: string) => Promise<void>
      // Apps
      appsDetect: () => Promise<{ apps: { id: string; name: string; shortName: string; available: boolean }[] }>
      appsOpen: (appId: string, cwd: string) => Promise<{ success: boolean; error?: string }>
      // Git
      gitBranchList: (cwd: string) => Promise<{ branches: string[]; current: string }>
      gitBranchSwitch: (cwd: string, branch: string) => Promise<{ success: boolean; error?: string }>
      gitBranchCreate: (cwd: string, branch: string, from?: string) => Promise<{ success: boolean; error?: string }>
      gitBranchDelete: (cwd: string, branch: string) => Promise<{ success: boolean; error?: string }>
      gitStatus: (cwd: string) => Promise<{ dirty: boolean; changes: number }>
      gitStash?: (cwd: string) => Promise<{ success: boolean; error?: string }>
      gitStashPop?: (cwd: string) => Promise<{ success: boolean; error?: string }>
      gitHasStash?: (cwd: string) => Promise<boolean>
      gitWatchStart?: (cwd: string) => Promise<{ success: boolean }>
      gitWatchStop?: (cwd: string) => Promise<{ success: boolean }>
      onGitBranchChanged?: (callback: (payload: { cwd: string; branches: string[]; current: string }) => void) => () => void
      // Terminal
      terminalCreate: (cwd: string) => Promise<{ id: string }>
      terminalWrite: (id: string, data: string) => void
      terminalResize: (id: string, cols: number, rows: number) => void
      terminalDestroy: (id: string) => Promise<{ success: boolean }>
      onTerminalData: (callback: (payload: { id: string; data: string }) => void) => () => void
      onTerminalExit: (callback: (payload: { id: string; code: number }) => void) => () => void
      // Updater
      updaterCheck?: () => Promise<{ updateAvailable?: boolean; version?: string; error?: string }>
      updaterDownload?: () => Promise<void>
      updaterInstall?: () => Promise<void>
      onUpdaterAvailable?: (callback: (data: { version: string }) => void) => () => void
      onUpdaterProgress?: (callback: (data: { percent: number }) => void) => () => void
      onUpdaterDownloaded?: (callback: () => void) => () => void
      onUpdaterNotAvailable?: (callback: () => void) => () => void
      onUpdaterError?: (callback: (data: { message: string }) => void) => () => void
      getVersion?: () => Promise<string>
      // Model
      modelTest?: (params: { protocol: string; baseUrl: string; apiKey: string; modelId: string }) => Promise<{ success: boolean; reply?: string; error?: string }>
      // Chat Bridge
      chatBridgeGet?: () => Promise<ChatBridgeSnapshot>
      chatBridgeChannels?: () => Promise<ChatChannelConfig[]>
      chatBridgeStart?: () => Promise<ChatBridgeSnapshot>
      chatBridgeStop?: () => Promise<ChatBridgeSnapshot>
      chatBridgeStartChannel?: (channelId: string) => Promise<ChatBridgeSnapshot>
      chatBridgeStopChannel?: (channelId: string) => Promise<ChatBridgeSnapshot>
      chatBridgeSaveChannel?: (channel: ChatChannelConfig) => Promise<ChatBridgeSnapshot>
      chatBridgeLoginChannel?: (channelId: string) => Promise<{ snapshot: ChatBridgeSnapshot; qrcode?: string; qrCodeText?: string; message: string }>
      chatBridgePollLogin?: (channelId: string, qrcode: string) => Promise<{ snapshot: ChatBridgeSnapshot; message: string; done: boolean }>
      chatBridgeResetRoute?: (routeKey: string) => Promise<ChatBridgeSnapshot>
      chatBridgeNewRouteSession?: (routeKey: string) => Promise<ChatBridgeSnapshot>
      chatBridgeUntrustRoute?: (routeKey: string) => Promise<ChatBridgeSnapshot>
      chatBridgeSaveSecurity?: (security: Partial<ChatBridgeSnapshot['security']>) => Promise<ChatBridgeSnapshot>
      chatBridgeRegeneratePairingCode?: () => Promise<ChatBridgeSnapshot>
      chatBridgeSaveProject?: (project: Partial<ChatBridgeSnapshot['project']>) => Promise<ChatBridgeSnapshot>
      onChatBridgeStateChanged?: (callback: (snapshot: ChatBridgeSnapshot) => void) => () => void
      // CodeGraph
      codegraphApi: {
        init: (cwd: string) => Promise<void>
        reindex: (cwd: string) => Promise<void>
        dismiss: (cwd: string) => Promise<void>
        refreshState: (cwd: string) => Promise<void>
        onState: (cb: (s: CodegraphState) => void) => () => void
        onInitProgress: (cb: (e: { cwd: string; line: string }) => void) => () => void
      }
    }
  }
}

function invoke(channel: string, data?: unknown): Promise<any> {
  if (!window.electronAPI) {
    console.warn('[IPC] electronAPI not available, channel:', channel)
    return Promise.resolve(null)
  }
  return window.electronAPI.invoke(channel, data)
}

function on(channel: string, cb: (event: unknown, ...args: unknown[]) => void): () => void {
  if (!window.electronAPI) return () => {}
  return window.electronAPI.on(channel, cb)
}

function send(channel: string, data: unknown): void {
  if (!window.electronAPI) return
  window.electronAPI.send(channel, data)
}

interface ProjectGroup {
  name: string
  cwd: string
  sessions: {
    id: string
    projectName: string
    cwd: string
    title?: string | null
    createdAt?: number
    updatedAt?: number
    lastMessagePreview?: string | null
    lastMessageRole?: string | null
    lastMessageAt?: number | null
  }[]
}

export interface SessionSearchResult {
  sessionId: string
  projectName: string
  cwd: string
  title?: string | null
  createdAt?: number
  updatedAt?: number
  lastMessagePreview?: string | null
  lastMessageRole?: string | null
  lastMessageAt?: number | null
  matchCount: number
  matches: {
    messageId: string
    role: string
    timestamp: number
    snippet: string
  }[]
}

export interface SessionChangedPayload {
  action: 'created' | 'deleted' | 'renamed'
  sessionId: string
  projectName?: string
  cwd?: string
  title?: string
}

export const ipc = {
  session: {
    create: (projectName: string, cwd: string) =>
      invoke('session:create', { projectName, cwd }) as Promise<{ sessionId: string }>,
    list: () =>
      invoke('session:list') as Promise<ProjectGroup[]>,
    search: (query: string, cwd?: string) =>
      invoke('session:search', { query, cwd }) as Promise<SessionSearchResult[]>,
    switch: (sessionId: string) =>
      invoke('session:switch', { sessionId }) as Promise<{ messages: Message[]; usage?: any; modelId?: string }>,
    delete: (sessionId: string) =>
      invoke('session:delete', { sessionId }) as Promise<{ success: boolean }>,
    rename: (sessionId: string, title: string) =>
      invoke('session:rename', { sessionId, title }) as Promise<{ success: boolean }>,
    setModel: (sessionId: string, modelId: string) =>
      invoke('session:set-model', { sessionId, modelId }) as Promise<{ success: boolean }>,
    getModel: (sessionId: string) =>
      invoke('session:get-model', { sessionId }) as Promise<{ modelId: string | null }>,
    onChanged: (cb: (payload: SessionChangedPayload) => void) =>
      window.electronAPI?.onSessionChanged?.(cb) || on('session:changed', (_e, data) => cb(data as SessionChangedPayload)),
  },

  query: {
    send: (sessionId: string, text: string, images?: { data: string; mediaType: string }[]) =>
      invoke('query:send', { sessionId, text, images }) as Promise<{ success: boolean }>,
    retry: (sessionId: string) =>
      invoke('query:retry', { sessionId }) as Promise<{ success: boolean }>,
    abort: (sessionId: string) =>
      invoke('query:abort', { sessionId }) as Promise<{ success: boolean }>,
    onStream: (cb: (data: { sessionId: string; chunk: StreamChunk }) => void) =>
      on('query:stream', (_e, data) => cb(data as any)),
    onToolEvent: (cb: (data: { sessionId: string; event: ToolExecutionEvent }) => void) =>
      on('query:tool-event', (_e, data) => cb(data as any)),
    onComplete: (cb: (data: { sessionId: string; message: Message }) => void) =>
      on('query:complete', (_e, data) => cb(data as any)),
    onError: (cb: (data: { sessionId: string; error: string }) => void) =>
      on('query:error', (_e, data) => cb(data as any)),
    onRetrying: (cb: (data: { sessionId: string; attempt: number; maxRetries?: number; error: string; delayMs: number; category: string }) => void) =>
      on('query:retrying', (_e, data) => cb(data as any)),
  },

  config: {
    get: () =>
      invoke('config:get') as Promise<AppConfig>,
    set: (config: Partial<AppConfig>) =>
      invoke('config:set', config) as Promise<{ success: boolean }>,
  },

  chatBridge: {
    get: () =>
      invoke('chat-bridge:get') as Promise<ChatBridgeSnapshot>,
    channels: () =>
      invoke('chat-bridge:channels') as Promise<ChatChannelConfig[]>,
    start: () =>
      invoke('chat-bridge:start') as Promise<ChatBridgeSnapshot>,
    stop: () =>
      invoke('chat-bridge:stop') as Promise<ChatBridgeSnapshot>,
    startChannel: (channelId: string) =>
      invoke('chat-bridge:start-channel', { channelId }) as Promise<ChatBridgeSnapshot>,
    stopChannel: (channelId: string) =>
      invoke('chat-bridge:stop-channel', { channelId }) as Promise<ChatBridgeSnapshot>,
    saveChannel: (channel: ChatChannelConfig) =>
      invoke('chat-bridge:save-channel', { channel }) as Promise<ChatBridgeSnapshot>,
    loginChannel: (channelId: string) =>
      invoke('chat-bridge:login-channel', { channelId }) as Promise<{ snapshot: ChatBridgeSnapshot; qrcode?: string; qrCodeText?: string; message: string }>,
    pollLogin: (channelId: string, qrcode: string) =>
      invoke('chat-bridge:poll-login', { channelId, qrcode }) as Promise<{ snapshot: ChatBridgeSnapshot; message: string; done: boolean }>,
    resetRoute: (routeKey: string) =>
      invoke('chat-bridge:reset-route', { routeKey }) as Promise<ChatBridgeSnapshot>,
    newRouteSession: (routeKey: string) =>
      invoke('chat-bridge:new-route-session', { routeKey }) as Promise<ChatBridgeSnapshot>,
    untrustRoute: (routeKey: string) =>
      invoke('chat-bridge:untrust-route', { routeKey }) as Promise<ChatBridgeSnapshot>,
    saveSecurity: (security: Partial<ChatBridgeSnapshot['security']>) =>
      invoke('chat-bridge:save-security', { security }) as Promise<ChatBridgeSnapshot>,
    regeneratePairingCode: () =>
      invoke('chat-bridge:regenerate-pairing-code') as Promise<ChatBridgeSnapshot>,
    saveProject: (project: Partial<ChatBridgeSnapshot['project']>) =>
      invoke('chat-bridge:save-project', { project }) as Promise<ChatBridgeSnapshot>,
    onStateChanged: (cb: (snapshot: ChatBridgeSnapshot) => void) =>
      on('chat-bridge:state-changed', (_e, data) => cb(data as ChatBridgeSnapshot)),
  },

  dialog: {
    openFolder: () =>
      invoke('dialog:open-folder') as Promise<{ path: string | null }>,
  },

  agent: {
    abort: (sessionId: string, agentToolUseId: string) =>
      invoke('agent:abort', { sessionId, agentToolUseId }),
    background: (sessionId: string, agentToolUseId: string) =>
      invoke('agent:background', { sessionId, agentToolUseId }),
    onProgress: (cb: (data: { sessionId: string; agentToolUseId: string; toolName: string; toolStatus: string; toolInput?: Record<string, unknown>; toolResult?: { content: string; isError?: boolean }; toolCount: number }) => void) =>
      on('agent:progress', (_e, data) => cb(data as any)),
    onText: (cb: (data: { sessionId: string; agentToolUseId: string; text: string }) => void) =>
      on('agent:text', (_e, data) => cb(data as any)),
    onComplete: (cb: (data: { sessionId: string; agentToolUseId: string; content: string; turns: number; toolsUsed: string[] }) => void) =>
      on('agent:complete', (_e, data) => cb(data as any)),
  },

  background: {
    list: (sessionId: string) =>
      invoke('background:list', { sessionId }) as Promise<any[]>,
    stop: (sessionId: string, taskId: string) =>
      invoke('background:stop', { sessionId, taskId }) as Promise<{ success: boolean }>,
    output: (sessionId: string, taskId: string, tail?: number) =>
      invoke('background:output', { sessionId, taskId, tail }) as Promise<string>,
    onStateChanged: (cb: (data: { sessionId: string }) => void) =>
      on('background:state-changed', (_e, data) => cb(data as any)),
    onNotification: (cb: (data: { sessionId: string }) => void) =>
      on('background:notification', (_e, data) => cb(data as any)),
  },
}
