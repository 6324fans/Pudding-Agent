import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { randomBytes } from 'node:crypto'
import { loadAppConfig, saveAppConfig } from '@puddingagent/core'
import type { BrowserWindow } from 'electron'
import type { PendingPermissionInfo, SessionManager } from './session-manager.js'

export type ChatChannelKind = 'weixin' | 'feishu'
export type ChatChannelState = 'stopped' | 'starting' | 'login_required' | 'connected' | 'degraded' | 'failed'
export type ChatConversationKind = 'direct' | 'group' | 'thread'

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
  capabilities: ChatChannelCapabilities
  lastInboundAt?: string
  lastOutboundAt?: string
  lastError?: string
  details?: Record<string, unknown>
}

export interface ChatChannelCapabilities {
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

export interface ChatBridgeSnapshot {
  enabled: boolean
  webhookPort: number
  webhookUrl: string
  security: ChatBridgeSecurityConfig
  project: ChatBridgeProjectConfig
  channels: ChatChannelStatus[]
  routes: ChatBridgeRouteState[]
  events: ChatBridgeEvent[]
}

export interface ChatBridgeProjectConfig {
  mode: 'active' | 'fixed'
  cwd?: string
  projectName?: string
}

export interface ChatBridgeSecurityConfig {
  requirePairing: boolean
  pairingCode: string
  trustedRoutes: Record<string, { pairedAt: string; label?: string }>
}

export interface ChatBridgeRouteState {
  routeKey: string
  channelId: string
  sessionId?: string
  conversationKind: ChatConversationKind
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

export interface ChatBridgeEvent {
  id: string
  channelId: string
  kind: 'inbound' | 'outbound' | 'status' | 'error' | 'login'
  text: string
  routeKey?: string
  timestamp: string
}

export interface ChatBridgeConfig {
  enabled?: boolean
  webhookPort?: number
  channels?: ChatChannelConfig[]
  routeBindings?: Record<string, string>
  security?: Partial<ChatBridgeSecurityConfig>
  project?: Partial<ChatBridgeProjectConfig>
}

export interface ChatChannelMessage {
  id: string
  routeKey: string
  channelId: string
  accountId?: string
  sender: { id: string; displayName?: string }
  conversation: { id: string; kind: ChatConversationKind; displayName?: string }
  text?: string
  timestamp: string
  raw?: unknown
}

interface WeixinQrStartResponse {
  qrcode?: string
  qrcode_img_content?: string
}

interface WeixinQrStatusResponse {
  status?: string
  bot_token?: string
  ilink_bot_id?: string
  ilink_user_id?: string
  baseurl?: string
  errmsg?: string
}

interface WeixinGetUpdatesResponse {
  ret?: number
  errcode?: number
  errmsg?: string
  msgs?: WeixinRawMessage[]
  get_updates_buf?: string
}

interface WeixinRawMessage {
  message_id?: number
  from_user_id?: string
  to_user_id?: string
  create_time_ms?: number
  session_id?: string
  group_id?: string
  item_list?: Array<{ type?: number; text_item?: { text?: string } }>
}

const DEFAULT_BRIDGE_PORT = 47831
const DEFAULT_WEIXIN_BASE_URL = 'https://ilinkai.weixin.qq.com'
const DEFAULT_WEIXIN_BOT_TYPE = '3'
const DEFAULT_WEIXIN_VERSION = '2.4.3'
const MAX_EVENTS = 120
const DEDUP_TTL_MS = 10 * 60 * 1000
const MAX_OUTBOUND_TEXT_CHARS = 3500
const FEISHU_TOKEN_REFRESH_SKEW_MS = 5 * 60 * 1000

interface FeishuTenantTokenCache {
  token: string
  expiresAt: number
}

export class ChatBridgeService {
  private window: BrowserWindow | null = null
  private config: Required<Pick<ChatBridgeConfig, 'enabled' | 'webhookPort'>> & { channels: ChatChannelConfig[] }
  private security: ChatBridgeSecurityConfig
  private project: ChatBridgeProjectConfig
  private statuses = new Map<string, ChatChannelStatus>()
  private events: ChatBridgeEvent[] = []
  private server?: Server
  private weixinUpdateBuffers = new Map<string, string>()
  private weixinPollTimers = new Map<string, NodeJS.Timeout>()
  private routeBindings = new Map<string, string>()
  private routeQueues = new Map<string, Promise<void>>()
  private routeStats = new Map<string, ChatBridgeRouteState>()
  private seenMessages = new Map<string, number>()
  private feishuTokenCache = new Map<string, FeishuTenantTokenCache>()
  private unsubscribePermissions?: () => void

  constructor(private readonly sessionManager?: SessionManager) {
    const bridgeConfig = loadBridgeConfig()
    this.config = normalizeBridgeConfig(bridgeConfig)
    this.security = normalizeSecurityConfig(bridgeConfig.security)
    this.project = normalizeProjectConfig(bridgeConfig.project)
    this.routeBindings = new Map(Object.entries(bridgeConfig.routeBindings || {}))
    for (const channel of this.config.channels) {
      this.statuses.set(channel.id, this.initialStatus(channel))
    }
    this.unsubscribePermissions = this.sessionManager?.onPermissionRequest(request => {
      this.handlePermissionRequest(request).catch(err => {
        this.pushEvent('bridge', 'error', `远程审批通知失败：${errorMessage(err)}`)
        this.emitStateChanged()
      })
    })
  }

  setWindow(window: BrowserWindow): void {
    this.window = window
  }

  async start(): Promise<ChatBridgeSnapshot> {
    this.config.enabled = true
    this.persistConfig()
    await this.ensureWebhookServer()
    for (const channel of this.config.channels.filter(c => c.enabled)) {
      await this.startChannel(channel.id)
    }
    this.emitStateChanged()
    return this.snapshot()
  }

  async stop(): Promise<ChatBridgeSnapshot> {
    this.config.enabled = false
    this.persistConfig()
    for (const channel of this.config.channels) {
      this.stopWeixinPolling(channel.id)
      this.setStatus(channel, { state: 'stopped', details: { phase: 'bridge-stopped' } })
    }
    await this.closeWebhookServer()
    this.emitStateChanged()
    return this.snapshot()
  }

  async startChannel(channelId: string): Promise<ChatBridgeSnapshot> {
    const channel = this.requireChannel(channelId)
    if (!channel.enabled) {
      this.setStatus(channel, { state: 'stopped', details: { phase: 'disabled' } })
      return this.snapshot()
    }
    this.setStatus(channel, { state: 'starting', lastError: undefined, details: { phase: 'starting' } })
    try {
      if (channel.kind === 'weixin') {
        await this.startWeixin(channel)
      } else {
        await this.startFeishu(channel)
      }
    } catch (err) {
      this.setStatus(channel, {
        state: 'failed',
        lastError: errorMessage(err),
        details: { phase: 'start-failed' },
      })
      this.pushEvent(channel.id, 'error', errorMessage(err))
    }
    this.emitStateChanged()
    return this.snapshot()
  }

  async stopChannel(channelId: string): Promise<ChatBridgeSnapshot> {
    const channel = this.requireChannel(channelId)
    this.stopWeixinPolling(channel.id)
    this.setStatus(channel, { state: 'stopped', details: { phase: 'stopped' } })
    this.pushEvent(channel.id, 'status', '渠道已停止')
    this.emitStateChanged()
    return this.snapshot()
  }

  async saveChannel(input: ChatChannelConfig): Promise<ChatBridgeSnapshot> {
    const existing = this.config.channels.find(c => c.id === input.id)
    const normalized = mergeSecretFields(normalizeChannelConfig(input), existing)
    const index = this.config.channels.findIndex(c => c.id === normalized.id)
    if (index === -1) {
      this.config.channels.push(normalized)
    } else {
      this.config.channels[index] = normalized
    }
    this.persistConfig()
    this.statuses.set(normalized.id, this.initialStatus(normalized))
    if (this.config.enabled && normalized.enabled) {
      await this.startChannel(normalized.id)
    } else {
      this.emitStateChanged()
    }
    return this.snapshot()
  }

  async loginChannel(channelId: string): Promise<{ snapshot: ChatBridgeSnapshot; qrcode?: string; qrCodeText?: string; message: string }> {
    const channel = this.requireChannel(channelId)
    if (channel.kind !== 'weixin') {
      return { snapshot: this.snapshot(), message: '飞书使用 App ID / App Secret 连接，没有扫码登录流程。' }
    }
    const qr = await this.startWeixinLogin(channel)
    this.emitStateChanged()
    return {
      snapshot: this.snapshot(),
      qrcode: qr.qrcode,
      qrCodeText: qr.qrCodeText,
      message: qr.message,
    }
  }

  async pollWeixinLogin(channelId: string, qrcode: string): Promise<{ snapshot: ChatBridgeSnapshot; message: string; done: boolean }> {
    const channel = this.requireChannel(channelId)
    if (channel.kind !== 'weixin') throw new Error('Only Weixin supports QR polling')
    const result = await this.getWeixinQrStatus(channel, qrcode)
    const status = result.status || 'unknown'
    if (status === 'confirmed' || status === 'binded_redirect') {
      channel.weixin = {
        ...channel.weixin,
        token: result.bot_token || channel.weixin?.token,
        ilinkUserId: result.ilink_user_id || result.ilink_bot_id || channel.weixin?.ilinkUserId,
        baseUrl: result.baseurl || channel.weixin?.baseUrl || DEFAULT_WEIXIN_BASE_URL,
      }
      channel.accountId = channel.weixin.ilinkUserId || channel.accountId || 'weixin'
      this.persistConfig()
      await this.startWeixin(channel)
      this.pushEvent(channel.id, 'login', '微信登录成功')
      return { snapshot: this.snapshot(), message: '微信登录成功。', done: true }
    }
    const message = status === 'wait'
      ? '等待扫码'
      : status === 'scaned'
        ? '已扫码，请在手机上确认'
        : status === 'need_verifycode'
          ? '需要手机验证码确认'
          : status === 'expired'
            ? '二维码已过期，请重新登录'
            : `登录状态：${status}`
    this.setStatus(channel, { state: 'login_required', details: { phase: 'qr-poll', status } })
    return { snapshot: this.snapshot(), message, done: false }
  }

  async resetRoute(routeKey: string): Promise<ChatBridgeSnapshot> {
    if (!routeKey) throw new Error('Route key is required')
    this.routeBindings.delete(routeKey)
    this.saveRouteBindings()
    this.updateRouteState(routeKey, { sessionId: undefined, pending: false })
    this.pushEvent(routeChannelId(routeKey), 'status', '已解除路由会话绑定', routeKey)
    this.emitStateChanged()
    return this.snapshot()
  }

  async newRouteSession(routeKey: string): Promise<ChatBridgeSnapshot> {
    if (!routeKey) throw new Error('Route key is required')
    if (!this.sessionManager) throw new Error('Session manager unavailable')
    const route = this.routeStats.get(routeKey)
    const context = this.resolveProjectContext()
    const sessionId = this.sessionManager.createSession(context.projectName, context.cwd)
    const sender = route?.senderName || routeKey
    const conversation = route?.conversationName || routeKey
    this.sessionManager.renameSession(sessionId, `Chat ${sender} @ ${conversation}`)
    this.bindRoute(routeKey, sessionId)
    this.updateRouteState(routeKey, { sessionId, pending: false })
    this.pushEvent(routeChannelId(routeKey), 'status', `已为路由新建会话：${sessionId}`, routeKey)
    this.emitStateChanged()
    return this.snapshot()
  }

  async untrustRoute(routeKey: string): Promise<ChatBridgeSnapshot> {
    if (!routeKey) throw new Error('Route key is required')
    const { [routeKey]: _removed, ...trustedRoutes } = this.security.trustedRoutes
    this.security = { ...this.security, trustedRoutes }
    this.updateRouteState(routeKey, { trusted: this.isTrustedRoute(routeKey) })
    this.persistConfig()
    this.pushEvent(routeChannelId(routeKey), 'status', '已取消路由信任', routeKey)
    this.emitStateChanged()
    return this.snapshot()
  }

  async saveSecurity(input: Partial<ChatBridgeSecurityConfig>): Promise<ChatBridgeSnapshot> {
    this.security = normalizeSecurityConfig({
      ...this.security,
      ...input,
      trustedRoutes: this.security.trustedRoutes,
    })
    this.persistConfig()
    this.pushEvent('bridge', 'status', this.security.requirePairing ? '已开启远程配对保护' : '已关闭远程配对保护')
    this.emitStateChanged()
    return this.snapshot()
  }

  async regeneratePairingCode(): Promise<ChatBridgeSnapshot> {
    this.security = { ...this.security, pairingCode: createPairingCode() }
    this.persistConfig()
    this.pushEvent('bridge', 'status', '已刷新远程配对码')
    this.emitStateChanged()
    return this.snapshot()
  }

  async saveProject(input: Partial<ChatBridgeProjectConfig>): Promise<ChatBridgeSnapshot> {
    this.project = normalizeProjectConfig(input)
    this.persistConfig()
    this.pushEvent('bridge', 'status', this.project.mode === 'fixed'
      ? `桥接默认项目已固定为：${this.project.projectName || this.project.cwd}`
      : '桥接默认项目已设为跟随当前激活项目')
    this.emitStateChanged()
    return this.snapshot()
  }

  snapshot(): ChatBridgeSnapshot {
    const webhookUrl = `http://127.0.0.1:${this.config.webhookPort}`
    return {
      enabled: this.config.enabled,
      webhookPort: this.config.webhookPort,
      webhookUrl,
      security: this.security,
      project: this.project,
      channels: this.config.channels.map(channel => this.statuses.get(channel.id) || this.initialStatus(channel)),
      routes: this.getRouteStates(),
      events: [...this.events],
    }
  }

  getChannels(): ChatChannelConfig[] {
    return this.config.channels.map(channel => ({
      ...channel,
      weixin: channel.weixin ? maskWeixinConfig(channel.weixin) : undefined,
      feishu: channel.feishu ? maskFeishuConfig(channel.feishu) : undefined,
    }))
  }

  close(): void {
    for (const channel of this.config.channels) this.stopWeixinPolling(channel.id)
    this.unsubscribePermissions?.()
    this.unsubscribePermissions = undefined
    void this.closeWebhookServer()
  }

  private async startWeixin(channel: ChatChannelConfig): Promise<void> {
    const token = channel.weixin?.token?.trim()
    if (!token) {
      this.setStatus(channel, {
        state: 'login_required',
        account: channel.accountId,
        details: { phase: 'missing-token', login: 'qr' },
      })
      return
    }
    this.setStatus(channel, {
      state: 'connected',
      account: channel.accountId || channel.weixin?.ilinkUserId || 'weixin',
      details: {
        phase: 'token-ready',
        baseUrl: channel.weixin?.baseUrl || DEFAULT_WEIXIN_BASE_URL,
        botType: channel.weixin?.botType || DEFAULT_WEIXIN_BOT_TYPE,
      },
    })
    this.pushEvent(channel.id, 'status', '微信渠道已就绪')
    this.startWeixinPolling(channel)
  }

  private async startFeishu(channel: ChatChannelConfig): Promise<void> {
    const missing = missingFeishuCredentials(channel)
    if (missing.length > 0) {
      this.setStatus(channel, {
        state: 'login_required',
        account: channel.accountId || 'default',
        lastError: `缺少飞书配置: ${missing.join(', ')}`,
        details: { phase: 'missing-credentials', webhookPath: feishuWebhookPath(channel) },
      })
      return
    }
    this.setStatus(channel, {
      state: 'connected',
      account: channel.accountId || 'default',
      lastError: undefined,
      details: {
        phase: 'webhook-ready',
        webhookUrl: `${this.snapshot().webhookUrl}${feishuWebhookPath(channel)}`,
        appId: maskSecret(channel.feishu?.appId),
      },
    })
    this.pushEvent(channel.id, 'status', '飞书渠道已就绪')
  }

  private async startWeixinLogin(channel: ChatChannelConfig): Promise<{ qrcode?: string; qrCodeText?: string; message: string }> {
    const body = { local_token_list: channel.weixin?.token ? [channel.weixin.token] : [] }
    const baseUrl = channel.weixin?.baseUrl || DEFAULT_WEIXIN_BASE_URL
    const botType = channel.weixin?.botType || DEFAULT_WEIXIN_BOT_TYPE
    const response = await fetchJson<WeixinQrStartResponse>({
      url: `${trimSlash(baseUrl)}/ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(botType)}`,
      init: {
        method: 'POST',
        headers: weixinHeaders(channel),
        body: JSON.stringify(body),
      },
      label: 'weixin qr login',
    })
    const qrcode = response.qrcode?.trim()
    const qrCodeText = response.qrcode_img_content || qrcode
    if (!qrcode && !qrCodeText) throw new Error('微信登录接口没有返回二维码')
    this.setStatus(channel, {
      state: 'login_required',
      details: {
        phase: 'qr-issued',
        qrcode,
        issuedAt: new Date().toISOString(),
      },
    })
    this.pushEvent(channel.id, 'login', '已生成微信登录二维码')
    return { qrcode, qrCodeText, message: '请用手机微信扫描二维码，并在手机上确认登录。' }
  }

  private async getWeixinQrStatus(channel: ChatChannelConfig, qrcode: string): Promise<WeixinQrStatusResponse> {
    const baseUrl = channel.weixin?.baseUrl || DEFAULT_WEIXIN_BASE_URL
    return fetchJson<WeixinQrStatusResponse>({
      url: `${trimSlash(baseUrl)}/ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`,
      init: { method: 'GET', headers: weixinCommonHeaders(channel) },
      label: 'weixin qr status',
    })
  }

  private async pollWeixinUpdates(channel: ChatChannelConfig): Promise<ChatChannelMessage[]> {
    const token = channel.weixin?.token?.trim()
    if (!token) throw new Error('微信未登录')
    const baseUrl = channel.weixin?.baseUrl || DEFAULT_WEIXIN_BASE_URL
    const response = await fetchJson<WeixinGetUpdatesResponse>({
      url: `${trimSlash(baseUrl)}/ilink/bot/getupdates`,
      init: {
        method: 'POST',
        headers: { ...weixinHeaders(channel), Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          get_updates_buf: this.weixinUpdateBuffers.get(channel.id) || '',
          base_info: weixinBaseInfo(channel),
        }),
      },
      label: 'weixin getupdates',
      timeoutMs: 35_000,
    })
    if ((response.ret ?? 0) !== 0 || (response.errcode ?? 0) !== 0) {
      throw new Error(response.errmsg || `微信 getupdates 失败: ret=${response.ret} errcode=${response.errcode}`)
    }
    this.weixinUpdateBuffers.set(channel.id, response.get_updates_buf || '')
    return (response.msgs || []).map(raw => weixinToChannelMessage(channel, raw)).filter(Boolean) as ChatChannelMessage[]
  }

  private async ensureWebhookServer(): Promise<void> {
    if (this.server) return
    this.server = createServer((req, res) => {
      this.handleWebhook(req, res).catch(err => {
        res.statusCode = 500
        res.end(JSON.stringify({ error: errorMessage(err) }))
      })
    })
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject)
      this.server!.listen(this.config.webhookPort, '127.0.0.1', () => {
        this.server!.off('error', reject)
        resolve()
      })
    })
  }

  private async closeWebhookServer(): Promise<void> {
    if (!this.server) return
    const server = this.server
    this.server = undefined
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }

  private async handleWebhook(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method === 'GET' && req.url === '/health') {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ ok: true }))
      return
    }
    if (req.method !== 'POST' || !req.url) {
      res.statusCode = 404
      res.end('not found')
      return
    }
    const channel = this.config.channels.find(c => c.kind === 'feishu' && req.url!.startsWith(feishuWebhookPath(c)))
    if (!channel) {
      res.statusCode = 404
      res.end('unknown webhook')
      return
    }
    const payload = await readJsonBody(req)
    if (!this.verifyFeishuWebhook(channel, payload)) {
      res.statusCode = 403
      res.end(JSON.stringify({ code: 403, msg: 'invalid verification token' }))
      return
    }
    const challenge = typeof payload.challenge === 'string' ? payload.challenge : undefined
    if (challenge) {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ challenge }))
      return
    }
    if (payload.encrypt) {
      this.pushEvent(channel.id, 'error', '收到飞书加密事件，但当前版本暂未启用解密，请先关闭 Encrypt Key 或等待后续版本。')
      res.statusCode = 400
      res.end(JSON.stringify({ code: 400, msg: 'encrypted event unsupported' }))
      return
    }
    const message = feishuToChannelMessage(channel, payload)
    if (message) {
      this.handleInboundMessage(channel, message)
    }
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ code: 0 }))
  }

  private handleInboundMessage(channel: ChatChannelConfig, message: ChatChannelMessage): void {
    if (this.hasSeenMessage(channel, message)) return
    this.setStatus(channel, {
      state: 'connected',
      account: message.accountId || channel.accountId,
      lastInboundAt: message.timestamp,
      lastError: undefined,
      details: { ...(this.statuses.get(channel.id)?.details || {}), lastRouteKey: message.routeKey },
    })
    this.recordRouteInbound(message)
    this.pushEvent(channel.id, 'inbound', message.text || '(媒体消息)', message.routeKey)
    if (isImmediateBridgeCommand(message.text)) {
      this.processInboundMessage(channel, message)
        .catch(err => {
          const text = errorMessage(err)
          this.pushEvent(channel.id, 'error', text, message.routeKey)
          this.setStatus(channel, {
            state: 'degraded',
            lastError: text,
            details: { ...(this.statuses.get(channel.id)?.details || {}), phase: 'control-command-error', lastRouteKey: message.routeKey },
          })
          this.recordRouteError(message.routeKey, text)
          this.emitStateChanged()
        })
      this.emitStateChanged()
      return
    }
    const previous = this.routeQueues.get(message.routeKey) || Promise.resolve()
    const next = previous
      .catch(() => undefined)
      .then(() => this.processInboundMessage(channel, message))
      .catch(err => {
        const text = errorMessage(err)
        this.pushEvent(channel.id, 'error', text, message.routeKey)
        this.setStatus(channel, {
          state: 'degraded',
          lastError: text,
          details: { ...(this.statuses.get(channel.id)?.details || {}), phase: 'route-error', lastRouteKey: message.routeKey },
        })
        this.recordRouteError(message.routeKey, text)
        this.emitStateChanged()
      })
    this.routeQueues.set(message.routeKey, next)
    next.finally(() => {
      if (this.routeQueues.get(message.routeKey) === next) this.routeQueues.delete(message.routeKey)
    }).catch(() => undefined)
    this.emitStateChanged()
  }

  private async processInboundMessage(channel: ChatChannelConfig, message: ChatChannelMessage): Promise<void> {
    const text = message.text?.trim()
    const command = text?.toUpperCase()
    if (!text) {
      await this.sendText(channel, message, '当前只支持文本消息，图片/文件会在后续版本接入。')
      return
    }
    if (!this.sessionManager) {
      await this.sendText(channel, message, '聊天桥接未连接到 Pudding 会话管理器，请重启应用后再试。')
      return
    }
    if (text.startsWith('/pair')) {
      await this.handlePairCommand(channel, message, text)
      return
    }
    if (this.security.requirePairing && !this.isTrustedRoute(message.routeKey)) {
      await this.sendText(channel, message, '当前聊天窗口还未配对。请在 Pudding-Agent 设置页查看配对码后发送：/pair <配对码>')
      return
    }
    if (command === '/HELP') {
      await this.sendText(channel, message, [
        '可用指令：',
        '/pair <配对码> 配对当前聊天窗口',
        '/status 查看当前路由和会话状态',
        '/new 新建并绑定一个 Pudding 会话',
        '/reset 解除当前聊天窗口的会话绑定',
        '/stop 中止当前绑定会话正在执行的任务',
        '/OK 批准当前会话最新工具审批',
        '/NO 拒绝当前会话最新工具审批',
        '/P 查看当前会话最新工具审批',
        '/help 查看指令列表',
      ].join('\n'))
      return
    }
    if (command === '/STATUS') {
      await this.sendText(channel, message, this.buildRouteStatus(channel, message))
      return
    }
    if (command === '/RESET') {
      this.routeBindings.delete(message.routeKey)
      this.saveRouteBindings()
      this.updateRouteState(message.routeKey, { sessionId: undefined, pending: false })
      await this.sendText(channel, message, '已解除当前聊天窗口的 Pudding 会话绑定。发送任意文本会自动创建新会话。')
      return
    }
    if (command === '/STOP') {
      const sessionId = this.routeBindings.get(message.routeKey)
      if (!sessionId) {
        await this.sendText(channel, message, '当前聊天窗口还没有绑定 Pudding 会话。')
        return
      }
      this.sessionManager.abortSession(sessionId)
      this.updateRouteState(message.routeKey, { pending: false })
      await this.sendText(channel, message, `已请求中止当前会话：${sessionId}`)
      return
    }
    if (command === '/P') {
      await this.sendPermissionStatus(channel, message)
      return
    }
    if (command === '/OK' || command === '/NO') {
      await this.respondToPermissionFromRoute(channel, message, command === '/OK')
      return
    }
    if (command === '/NEW') {
      const sessionId = this.createRouteSession(message)
      this.bindRoute(message.routeKey, sessionId)
      await this.sendText(channel, message, `已新建并绑定 Pudding 会话：${sessionId}`)
      return
    }

    const sessionId = this.ensureRouteSession(message)
    const completed = await this.sessionManager.sendMessage(sessionId, text)
    const reply = assistantText(completed) || '我这边没有拿到可发送的文本回复，请在 Pudding 界面查看会话详情。'
    await this.sendText(channel, message, reply)
  }

  private buildRouteStatus(channel: ChatChannelConfig, message: ChatChannelMessage): string {
    const sessionId = this.routeBindings.get(message.routeKey)
    const status = this.statuses.get(channel.id)
    return [
      `渠道：${channel.label}`,
      `状态：${status?.state || 'unknown'}`,
      `路由：${message.routeKey}`,
      `会话：${sessionId || '未绑定，发送任意文本会自动创建'}`,
      `配对：${this.isTrustedRoute(message.routeKey) ? '已配对' : this.security.requirePairing ? '未配对' : '未开启配对保护'}`,
      `最近错误：${status?.lastError || '无'}`,
    ].join('\n')
  }

  private async handlePairCommand(channel: ChatChannelConfig, message: ChatChannelMessage, text: string): Promise<void> {
    const code = text.replace(/^\/pair\s*/i, '').trim()
    if (!this.security.requirePairing) {
      this.trustRoute(message)
      await this.sendText(channel, message, '当前未开启配对保护，但已记录这个聊天窗口为可信路由。')
      return
    }
    if (!code) {
      await this.sendText(channel, message, '请发送：/pair <配对码>')
      return
    }
    if (code !== this.security.pairingCode) {
      await this.sendText(channel, message, '配对码不正确，请在 Pudding-Agent 设置页确认最新配对码。')
      return
    }
    this.trustRoute(message)
    await this.sendText(channel, message, '配对成功。现在可以向 Pudding-Agent 发送任务了。')
  }

  private async sendPermissionStatus(channel: ChatChannelConfig, message: ChatChannelMessage): Promise<void> {
    if (!this.sessionManager) return
    const sessionId = this.routeBindings.get(message.routeKey)
    if (!sessionId) {
      await this.sendText(channel, message, '当前聊天窗口还没有绑定 Pudding 会话。')
      return
    }
    if (!this.sessionManager.sessionExists(sessionId)) {
      this.routeBindings.delete(message.routeKey)
      this.saveRouteBindings()
      this.updateRouteState(message.routeKey, { sessionId: undefined, pending: false })
      await this.sendText(channel, message, '当前绑定的 Pudding 会话已不存在，已自动解绑。发送任意普通消息会创建新会话。')
      return
    }
    const pending = this.sessionManager.getLatestPendingPermission(sessionId)
    await this.sendText(channel, message, pending ? formatPermissionRequest(pending) : '当前会话没有待处理的工具审批。')
  }

  private async respondToPermissionFromRoute(channel: ChatChannelConfig, message: ChatChannelMessage, allowed: boolean): Promise<void> {
    if (!this.sessionManager) return
    const sessionId = this.routeBindings.get(message.routeKey)
    if (!sessionId) {
      await this.sendText(channel, message, '当前聊天窗口还没有绑定 Pudding 会话。')
      return
    }
    if (!this.sessionManager.sessionExists(sessionId)) {
      this.routeBindings.delete(message.routeKey)
      this.saveRouteBindings()
      this.updateRouteState(message.routeKey, { sessionId: undefined, pending: false })
      await this.sendText(channel, message, '当前绑定的 Pudding 会话已不存在，已自动解绑。发送任意普通消息会创建新会话。')
      return
    }
    const pending = this.sessionManager.respondToLatestPermission(sessionId, allowed)
    await this.sendText(channel, message, pending ? `${allowed ? '已批准' : '已拒绝'}：${pending.toolName}` : '当前会话没有待处理的工具审批。')
  }

  private async handlePermissionRequest(request: PendingPermissionInfo): Promise<void> {
    const routeKey = this.routeKeyForSession(request.sessionId)
    if (!routeKey) return
    const route = this.routeStats.get(routeKey)
    const channel = this.config.channels.find(c => c.id === (route?.channelId || routeChannelId(routeKey)))
    if (!channel || !channel.enabled) return
    const source = this.messageForRoute(channel, routeKey, request)
    await this.sendText(channel, source, formatPermissionRequest(request))
  }

  private routeKeyForSession(sessionId: string): string | undefined {
    for (const [routeKey, boundSessionId] of this.routeBindings) {
      if (boundSessionId === sessionId) return routeKey
    }
    return undefined
  }

  private messageForRoute(channel: ChatChannelConfig, routeKey: string, request: PendingPermissionInfo): ChatChannelMessage {
    const route = this.routeStats.get(routeKey)
    const parts = routeKey.split(':')
    const conversationKind = (parts[2] as ChatConversationKind) || route?.conversationKind || 'direct'
    const conversationId = parts.slice(3).join(':') || route?.conversationName || routeKey
    return {
      id: `permission-${request.id}`,
      routeKey,
      channelId: channel.id,
      accountId: parts[1] || channel.accountId,
      sender: { id: route?.senderName || conversationId },
      conversation: { id: conversationId, kind: conversationKind, displayName: route?.conversationName },
      timestamp: request.createdAt,
    }
  }

  private ensureRouteSession(message: ChatChannelMessage): string {
    const existing = this.routeBindings.get(message.routeKey)
    if (existing) {
      if (this.sessionManager?.sessionExists(existing)) return existing
      this.routeBindings.delete(message.routeKey)
      this.updateRouteState(message.routeKey, { sessionId: undefined, pending: false, lastError: undefined })
      this.pushEvent(message.channelId, 'status', `旧绑定会话不存在，已自动重建：${existing}`, message.routeKey)
      this.saveRouteBindings()
    }
    const sessionId = this.createRouteSession(message)
    this.bindRoute(message.routeKey, sessionId)
    return sessionId
  }

  private createRouteSession(message: ChatChannelMessage): string {
    if (!this.sessionManager) throw new Error('Session manager unavailable')
    const context = this.resolveProjectContext()
    const sessionId = this.sessionManager.createSession(context.projectName, context.cwd)
    const sender = message.sender.displayName || message.sender.id
    const conversation = message.conversation.displayName || message.conversation.id
    this.sessionManager.renameSession(sessionId, `Chat ${sender} @ ${conversation}`)
    return sessionId
  }

  private bindRoute(routeKey: string, sessionId: string): void {
    for (const [existingRouteKey, existingSessionId] of this.routeBindings) {
      if (existingRouteKey !== routeKey && existingSessionId === sessionId) {
        this.routeBindings.delete(existingRouteKey)
        this.updateRouteState(existingRouteKey, { sessionId: undefined, pending: false })
        this.pushEvent(routeChannelId(existingRouteKey), 'status', '会话已迁移到新的聊天路由', existingRouteKey)
      }
    }
    this.routeBindings.set(routeKey, sessionId)
    this.updateRouteState(routeKey, { sessionId })
    this.saveRouteBindings()
  }

  private saveRouteBindings(): void {
    this.persistConfig()
  }

  private persistConfig(): void {
    saveBridgeConfig({ ...this.config, routeBindings: Object.fromEntries(this.routeBindings), security: this.security, project: this.project })
  }

  private resolveProjectContext(): { projectName: string; cwd: string } {
    if (this.project.mode === 'fixed' && this.project.cwd) {
      return {
        projectName: this.project.projectName || lastPathSegment(this.project.cwd) || 'Chat Bridge',
        cwd: this.project.cwd,
      }
    }
    if (!this.sessionManager) throw new Error('Session manager unavailable')
    return this.sessionManager.getActiveProjectContext()
  }

  private async sendText(channel: ChatChannelConfig, source: ChatChannelMessage, text: string): Promise<void> {
    const chunks = splitOutboundText(text)
    for (const chunk of chunks) {
      if (channel.kind === 'weixin') {
        await this.sendWeixinText(channel, source, chunk)
      } else {
        await this.sendFeishuText(channel, source, chunk)
      }
    }
    const deliveredAt = new Date().toISOString()
    this.setStatus(channel, {
      state: 'connected',
      account: source.accountId || channel.accountId,
      lastOutboundAt: deliveredAt,
      lastError: undefined,
      details: { ...(this.statuses.get(channel.id)?.details || {}), lastRouteKey: source.routeKey },
    })
    this.recordRouteOutbound(source.routeKey)
    this.pushEvent(channel.id, 'outbound', text.slice(0, 240), source.routeKey)
    this.emitStateChanged()
  }

  private async sendWeixinText(channel: ChatChannelConfig, source: ChatChannelMessage, text: string): Promise<void> {
    const token = channel.weixin?.token?.trim()
    if (!token) throw new Error('微信未登录，无法发送回复')
    const baseUrl = channel.weixin?.baseUrl || DEFAULT_WEIXIN_BASE_URL
    const body = {
      msg: {
        from_user_id: '',
        to_user_id: source.sender.id || source.conversation.id,
        client_id: `pudding-weixin-${Date.now()}-${randomBytes(3).toString('hex')}`,
        message_type: 2,
        message_state: 2,
        item_list: [{ type: 1, text_item: { text } }],
      },
      base_info: weixinBaseInfo(channel),
    }
    const response = await fetchJson<{ ret?: number; errcode?: number; errmsg?: string }>({
      url: `${trimSlash(baseUrl)}/ilink/bot/sendmessage`,
      init: {
        method: 'POST',
        headers: { ...weixinHeaders(channel), Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      },
      label: 'weixin sendmessage',
      timeoutMs: 30_000,
    })
    if ((response.ret ?? 0) !== 0 || (response.errcode ?? 0) !== 0) {
      throw new Error(response.errmsg || `微信 sendmessage 失败: ret=${response.ret} errcode=${response.errcode}`)
    }
  }

  private async sendFeishuText(channel: ChatChannelConfig, source: ChatChannelMessage, text: string): Promise<void> {
    const token = await this.getFeishuTenantToken(channel)
    const uuid = `pudding-feishu-${Date.now()}-${randomBytes(3).toString('hex')}`
    const content = JSON.stringify({ zh_cn: { content: [[{ tag: 'md', text }]] } })
    try {
      const response = await fetchJson<{ code?: number; msg?: string }>({
        url: `https://open.feishu.cn/open-apis/im/v1/messages/${encodeURIComponent(source.id)}/reply`,
        init: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ msg_type: 'post', content, uuid }),
        },
        label: 'feishu message reply',
        timeoutMs: 30_000,
      })
      assertFeishuOk(response, '飞书消息回复失败')
      return
    } catch (err) {
      this.pushEvent(channel.id, 'error', `飞书 reply 失败，尝试按会话发送：${errorMessage(err)}`, source.routeKey)
    }
    const response = await fetchJson<{ code?: number; msg?: string }>({
      url: 'https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id',
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ receive_id: source.conversation.id, msg_type: 'post', content, uuid }),
      },
      label: 'feishu message create',
      timeoutMs: 30_000,
    })
    assertFeishuOk(response, '飞书消息发送失败')
  }

  private async getFeishuTenantToken(channel: ChatChannelConfig): Promise<string> {
    const appId = channel.feishu?.appId
    const appSecret = channel.feishu?.appSecret
    if (!appId || !appSecret) throw new Error('飞书缺少 App ID 或 App Secret')
    const cacheKey = `${channel.id}:${appId}`
    const cached = this.feishuTokenCache.get(cacheKey)
    if (cached && cached.expiresAt - FEISHU_TOKEN_REFRESH_SKEW_MS > Date.now()) return cached.token
    const response = await fetchJson<{ code?: number; msg?: string; tenant_access_token?: string; expire?: number }>({
      url: 'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
      },
      label: 'feishu tenant_access_token',
      timeoutMs: 30_000,
    })
    if (response.code !== undefined && response.code !== 0) throw new Error(response.msg || `飞书鉴权失败: code ${response.code}`)
    if (!response.tenant_access_token) throw new Error('飞书鉴权未返回 tenant_access_token')
    this.feishuTokenCache.set(cacheKey, {
      token: response.tenant_access_token,
      expiresAt: Date.now() + Math.max(60, response.expire || 7200) * 1000,
    })
    return response.tenant_access_token
  }

  private startWeixinPolling(channel: ChatChannelConfig): void {
    this.stopWeixinPolling(channel.id)
    const poll = async () => {
      try {
        const latest = this.config.channels.find(c => c.id === channel.id)
        if (!latest || !this.config.enabled || !latest.enabled || latest.kind !== 'weixin') return
        const messages = await this.pollWeixinUpdates(latest)
        for (const message of messages) this.handleInboundMessage(latest, message)
        this.weixinPollTimers.set(channel.id, setTimeout(poll, 800))
      } catch (err) {
        const latest = this.config.channels.find(c => c.id === channel.id) || channel
        this.setStatus(latest, {
          state: 'degraded',
          lastError: errorMessage(err),
          details: { ...(this.statuses.get(channel.id)?.details || {}), phase: 'poll-failed' },
        })
        this.pushEvent(channel.id, 'error', errorMessage(err))
        this.emitStateChanged()
        this.weixinPollTimers.set(channel.id, setTimeout(poll, 5_000))
      }
    }
    this.weixinPollTimers.set(channel.id, setTimeout(poll, 0))
  }

  private stopWeixinPolling(channelId: string): void {
    const timer = this.weixinPollTimers.get(channelId)
    if (timer) clearTimeout(timer)
    this.weixinPollTimers.delete(channelId)
  }

  private verifyFeishuWebhook(channel: ChatChannelConfig, payload: any): boolean {
    const expected = channel.feishu?.verificationToken?.trim()
    if (!expected) return true
    return payload?.token === expected || payload?.header?.token === expected
  }

  private hasSeenMessage(channel: ChatChannelConfig, message: ChatChannelMessage): boolean {
    const now = Date.now()
    for (const [key, seenAt] of this.seenMessages) {
      if (now - seenAt > DEDUP_TTL_MS) this.seenMessages.delete(key)
    }
    const key = `${channel.id}:${message.id}`
    if (this.seenMessages.has(key)) return true
    this.seenMessages.set(key, now)
    return false
  }

  private getRouteStates(): ChatBridgeRouteState[] {
    const routes = new Map(this.routeStats)
    for (const [routeKey, sessionId] of this.routeBindings) {
      routes.set(routeKey, {
        routeKey,
        channelId: routeKey.split(':')[0] || 'unknown',
        sessionId,
        conversationKind: 'direct',
        inboundCount: 0,
        outboundCount: 0,
        pending: this.routeQueues.has(routeKey),
        trusted: this.isTrustedRoute(routeKey),
        ...(routes.get(routeKey) || {}),
      })
    }
    return Array.from(routes.values()).map(route => ({
      ...route,
      sessionId: this.routeBindings.get(route.routeKey) || route.sessionId,
      pending: this.routeQueues.has(route.routeKey) || route.pending,
      trusted: this.isTrustedRoute(route.routeKey),
    }))
  }

  private recordRouteInbound(message: ChatChannelMessage): void {
    const existing = this.routeStats.get(message.routeKey)
    this.routeStats.set(message.routeKey, {
      routeKey: message.routeKey,
      channelId: message.channelId,
      sessionId: this.routeBindings.get(message.routeKey) || existing?.sessionId,
      conversationKind: message.conversation.kind,
      conversationName: message.conversation.displayName || message.conversation.id,
      senderName: message.sender.displayName || message.sender.id,
      inboundCount: (existing?.inboundCount || 0) + 1,
      outboundCount: existing?.outboundCount || 0,
      pending: true,
      trusted: this.isTrustedRoute(message.routeKey),
      lastInboundAt: message.timestamp,
      lastOutboundAt: existing?.lastOutboundAt,
      lastText: message.text || existing?.lastText,
      lastError: undefined,
    })
  }

  private recordRouteOutbound(routeKey: string): void {
    const existing = this.routeStats.get(routeKey)
    if (!existing) return
    this.routeStats.set(routeKey, {
      ...existing,
      outboundCount: existing.outboundCount + 1,
      pending: false,
      lastOutboundAt: new Date().toISOString(),
      lastError: undefined,
    })
  }

  private recordRouteError(routeKey: string, error: string): void {
    const existing = this.routeStats.get(routeKey)
    if (!existing) return
    this.routeStats.set(routeKey, { ...existing, pending: false, lastError: error })
  }

  private updateRouteState(routeKey: string, patch: Partial<ChatBridgeRouteState>): void {
    const existing = this.routeStats.get(routeKey)
    this.routeStats.set(routeKey, {
      routeKey,
      channelId: routeKey.split(':')[0] || 'unknown',
      conversationKind: existing?.conversationKind || 'direct',
      inboundCount: existing?.inboundCount || 0,
      outboundCount: existing?.outboundCount || 0,
      pending: existing?.pending || false,
      trusted: this.isTrustedRoute(routeKey),
      ...existing,
      ...patch,
    })
  }

  private isTrustedRoute(routeKey: string): boolean {
    return !this.security.requirePairing || Boolean(this.security.trustedRoutes[routeKey])
  }

  private trustRoute(message: ChatChannelMessage): void {
    this.security = {
      ...this.security,
      trustedRoutes: {
        ...this.security.trustedRoutes,
        [message.routeKey]: {
          pairedAt: new Date().toISOString(),
          label: message.conversation.displayName || message.sender.displayName || message.sender.id,
        },
      },
    }
    this.updateRouteState(message.routeKey, { trusted: true })
    this.persistConfig()
    this.pushEvent(message.channelId, 'status', '路由配对成功', message.routeKey)
  }

  private initialStatus(channel: ChatChannelConfig): ChatChannelStatus {
    return {
      channelId: channel.id,
      kind: channel.kind,
      label: channel.label,
      state: channel.enabled ? 'stopped' : 'stopped',
      enabled: channel.enabled,
      account: channel.accountId,
      capabilities: capabilitiesFor(channel.kind),
      details: { phase: channel.enabled ? 'idle' : 'disabled' },
    }
  }

  private setStatus(channel: ChatChannelConfig, patch: Partial<ChatChannelStatus>): void {
    const current = this.statuses.get(channel.id) || this.initialStatus(channel)
    this.statuses.set(channel.id, {
      ...current,
      ...patch,
      channelId: channel.id,
      kind: channel.kind,
      label: channel.label,
      enabled: channel.enabled,
      capabilities: capabilitiesFor(channel.kind),
    })
  }

  private pushEvent(channelId: string, kind: ChatBridgeEvent['kind'], text: string, routeKey?: string): void {
    this.events.unshift({
      id: `${Date.now()}-${randomBytes(3).toString('hex')}`,
      channelId,
      kind,
      text,
      routeKey,
      timestamp: new Date().toISOString(),
    })
    this.events = this.events.slice(0, MAX_EVENTS)
  }

  private emitStateChanged(): void {
    this.window?.webContents.send('chat-bridge:state-changed', this.snapshot())
  }

  private requireChannel(channelId: string): ChatChannelConfig {
    const channel = this.config.channels.find(c => c.id === channelId)
    if (!channel) throw new Error(`Channel ${channelId} not found`)
    return channel
  }
}

function loadBridgeConfig(): ChatBridgeConfig {
  return (loadAppConfig().chatBridge || {}) as ChatBridgeConfig
}

function saveBridgeConfig(config: ChatBridgeConfig): void {
  saveAppConfig({ chatBridge: config })
}

function normalizeBridgeConfig(config: ChatBridgeConfig): Required<Pick<ChatBridgeConfig, 'enabled' | 'webhookPort'>> & { channels: ChatChannelConfig[] } {
  const channels = Array.isArray(config.channels) && config.channels.length > 0
    ? config.channels.map(normalizeChannelConfig)
    : defaultChannels()
  return {
    enabled: Boolean(config.enabled),
    webhookPort: typeof config.webhookPort === 'number' ? config.webhookPort : DEFAULT_BRIDGE_PORT,
    channels,
  }
}

function normalizeSecurityConfig(input: Partial<ChatBridgeSecurityConfig> | undefined): ChatBridgeSecurityConfig {
  return {
    requirePairing: Boolean(input?.requirePairing),
    pairingCode: input?.pairingCode?.trim() || createPairingCode(),
    trustedRoutes: input?.trustedRoutes && typeof input.trustedRoutes === 'object' ? input.trustedRoutes : {},
  }
}

function normalizeProjectConfig(input: Partial<ChatBridgeProjectConfig> | undefined): ChatBridgeProjectConfig {
  if (input?.mode === 'fixed' && input.cwd?.trim()) {
    const cwd = input.cwd.trim()
    return {
      mode: 'fixed',
      cwd,
      projectName: input.projectName?.trim() || lastPathSegment(cwd) || 'Chat Bridge',
    }
  }
  return { mode: 'active' }
}

function createPairingCode(): string {
  return randomBytes(3).toString('hex').toUpperCase()
}

function lastPathSegment(value: string): string {
  return value.split(/[\\/]/).filter(Boolean).pop() || ''
}

function normalizeChannelConfig(input: ChatChannelConfig): ChatChannelConfig {
  const kind = input.kind === 'feishu' ? 'feishu' : 'weixin'
  const id = input.id?.trim() || kind
  return {
    id,
    kind,
    label: input.label?.trim() || (kind === 'weixin' ? '微信' : '飞书'),
    enabled: input.enabled !== false,
    accountId: input.accountId?.trim() || undefined,
    weixin: kind === 'weixin' ? {
      baseUrl: input.weixin?.baseUrl?.trim() || DEFAULT_WEIXIN_BASE_URL,
      botType: input.weixin?.botType?.trim() || DEFAULT_WEIXIN_BOT_TYPE,
      channelVersion: input.weixin?.channelVersion?.trim() || DEFAULT_WEIXIN_VERSION,
      token: normalizeSecretInput(input.weixin?.token),
      ilinkUserId: input.weixin?.ilinkUserId?.trim() || undefined,
    } : undefined,
    feishu: kind === 'feishu' ? {
      appId: input.feishu?.appId?.trim() || undefined,
      appSecret: normalizeSecretInput(input.feishu?.appSecret),
      verificationToken: normalizeSecretInput(input.feishu?.verificationToken),
      encryptKey: normalizeSecretInput(input.feishu?.encryptKey),
      webhookPath: normalizeWebhookPath(input.feishu?.webhookPath || `/chat-bridge/feishu/${id}`),
    } : undefined,
  }
}

function defaultChannels(): ChatChannelConfig[] {
  return [
    normalizeChannelConfig({ id: 'weixin', kind: 'weixin', label: '微信', enabled: false }),
    normalizeChannelConfig({ id: 'feishu', kind: 'feishu', label: '飞书', enabled: false }),
  ]
}

function capabilitiesFor(kind: ChatChannelKind): ChatChannelCapabilities {
  if (kind === 'weixin') {
    return { text: true, media: true, receiveMedia: true, typing: true, direct: true, group: false, thread: false, login: 'qr', streamingHint: true }
  }
  return { text: true, media: true, receiveMedia: true, typing: true, direct: true, group: false, thread: false, login: 'token', streamingHint: true }
}

function missingFeishuCredentials(channel: ChatChannelConfig): string[] {
  const missing: string[] = []
  if (!channel.feishu?.appId) missing.push('appId')
  if (!channel.feishu?.appSecret) missing.push('appSecret')
  return missing
}

function feishuWebhookPath(channel: ChatChannelConfig): string {
  return normalizeWebhookPath(channel.feishu?.webhookPath || `/chat-bridge/feishu/${channel.id}`)
}

function normalizeWebhookPath(path: string): string {
  const trimmed = path.trim() || '/'
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`
}

function buildRouteKey(input: { channelId: string; accountId?: string; conversationKind: ChatConversationKind; conversationId: string }): string {
  return `${input.channelId}:${input.accountId?.trim() || 'default'}:${input.conversationKind}:${input.conversationId}`
}

function routeChannelId(routeKey: string): string {
  return routeKey.split(':')[0] || 'unknown'
}

function feishuToChannelMessage(channel: ChatChannelConfig, payload: any): ChatChannelMessage | null {
  const event = payload?.event || payload
  const message = event?.message
  const sender = event?.sender
  if (!message?.message_id || !message?.chat_id) return null
  if (message.chat_type && message.chat_type !== 'p2p') return null
  const senderId = sender?.sender_id?.open_id || sender?.sender_id?.user_id || sender?.sender_id?.union_id
  if (!senderId) return null
  const text = parseFeishuText(message.message_type, message.content)
  const accountId = channel.accountId || 'default'
  return {
    id: message.message_id,
    channelId: channel.id,
    accountId,
    routeKey: buildRouteKey({ channelId: channel.id, accountId, conversationKind: 'direct', conversationId: message.chat_id }),
    sender: { id: senderId },
    conversation: { id: message.chat_id, kind: 'direct', displayName: '飞书私聊' },
    text,
    timestamp: formatTimestamp(message.create_time),
    raw: payload,
  }
}

function parseFeishuText(messageType: string | undefined, content: string | undefined): string | undefined {
  if (!content) return undefined
  try {
    const parsed = JSON.parse(content)
    if (messageType === 'text') return typeof parsed.text === 'string' ? parsed.text.trim() : undefined
    if (messageType === 'post') {
      const lines = parsed?.content
      if (!Array.isArray(lines)) return undefined
      return lines.flatMap((line: any) => Array.isArray(line) ? line : [])
        .map((item: any) => typeof item?.text === 'string' ? item.text : '')
        .join('')
        .trim() || undefined
    }
  } catch {
    return content.trim()
  }
  return undefined
}

function weixinToChannelMessage(channel: ChatChannelConfig, raw: WeixinRawMessage): ChatChannelMessage | null {
  const senderId = raw.from_user_id
  const conversationId = raw.group_id || raw.session_id || raw.from_user_id
  if (!senderId || !conversationId) return null
  const accountId = channel.accountId || channel.weixin?.ilinkUserId || 'default'
  const kind: ChatConversationKind = raw.group_id ? 'group' : 'direct'
  const text = (raw.item_list || [])
    .filter(item => item.type === 1 && item.text_item?.text)
    .map(item => item.text_item?.text || '')
    .join('')
    .trim() || undefined
  return {
    id: String(raw.message_id || `${Date.now()}`),
    channelId: channel.id,
    accountId,
    routeKey: buildRouteKey({ channelId: channel.id, accountId, conversationKind: kind, conversationId }),
    sender: { id: senderId },
    conversation: { id: conversationId, kind, displayName: kind === 'group' ? '微信群聊' : '微信私聊' },
    text,
    timestamp: new Date(raw.create_time_ms || Date.now()).toISOString(),
    raw,
  }
}

async function readJsonBody(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  const text = Buffer.concat(chunks).toString('utf-8')
  return text ? JSON.parse(text) : {}
}

async function fetchJson<T>(params: { url: string; init: RequestInit; label: string; timeoutMs?: number }): Promise<T> {
  const controller = params.timeoutMs ? new AbortController() : undefined
  const timer = controller ? setTimeout(() => controller.abort(), params.timeoutMs) : undefined
  try {
    const response = await fetch(params.url, { ...params.init, signal: controller?.signal })
    const text = await response.text()
    if (!response.ok) throw new Error(`${params.label} ${response.status}: ${text}`)
    return (text ? JSON.parse(text) : {}) as T
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function assertFeishuOk(response: { code?: number; msg?: string }, fallback: string): void {
  if (response.code === undefined || response.code === 0) return
  throw new Error(response.msg ? `${response.msg} (code ${response.code})` : `${fallback}: code ${response.code}`)
}

function weixinHeaders(channel: ChatChannelConfig): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    AuthorizationType: 'ilink_bot_token',
    ...weixinCommonHeaders(channel),
  }
}

function weixinCommonHeaders(channel: ChatChannelConfig): Record<string, string> {
  return {
    'iLink-App-Id': 'bot',
    'iLink-App-ClientVersion': String(buildClientVersion(channel.weixin?.channelVersion || DEFAULT_WEIXIN_VERSION)),
    'X-WECHAT-UIN': Buffer.from(String(randomBytes(4).readUInt32BE(0)), 'utf-8').toString('base64'),
  }
}

function weixinBaseInfo(channel: ChatChannelConfig): Record<string, string> {
  return {
    channel_version: channel.weixin?.channelVersion || DEFAULT_WEIXIN_VERSION,
    bot_agent: 'Pudding-Agent/1.0',
  }
}

function buildClientVersion(version: string): number {
  const [major = 0, minor = 0, patch = 0] = version.split('.').map(part => Number.parseInt(part, 10) || 0)
  return ((major & 0xff) << 16) | ((minor & 0xff) << 8) | (patch & 0xff)
}

function normalizeSecretInput(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  if (!trimmed || trimmed === '••••••••') return undefined
  return trimmed
}

function mergeSecretFields(next: ChatChannelConfig, previous?: ChatChannelConfig): ChatChannelConfig {
  if (!previous) return next
  if (next.kind === 'weixin') {
    return {
      ...next,
      weixin: {
        ...next.weixin,
        token: next.weixin?.token || previous.weixin?.token,
      },
    }
  }
  return {
    ...next,
    feishu: {
      ...next.feishu,
      appSecret: next.feishu?.appSecret || previous.feishu?.appSecret,
      verificationToken: next.feishu?.verificationToken || previous.feishu?.verificationToken,
      encryptKey: next.feishu?.encryptKey || previous.feishu?.encryptKey,
    },
  }
}

function maskWeixinConfig(input: NonNullable<ChatChannelConfig['weixin']>): NonNullable<ChatChannelConfig['weixin']> {
  return { ...input, token: input.token ? '••••••••' : undefined }
}

function maskFeishuConfig(input: NonNullable<ChatChannelConfig['feishu']>): NonNullable<ChatChannelConfig['feishu']> {
  return {
    ...input,
    appSecret: input.appSecret ? '••••••••' : undefined,
    verificationToken: input.verificationToken ? '••••••••' : undefined,
    encryptKey: input.encryptKey ? '••••••••' : undefined,
  }
}

function maskSecret(value: string | undefined): string | undefined {
  if (!value) return undefined
  if (value.length <= 8) return '••••'
  return `${value.slice(0, 4)}••••${value.slice(-4)}`
}

function formatTimestamp(value: string | undefined): string {
  if (!value) return new Date().toISOString()
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed)) return new Date().toISOString()
  return new Date(parsed < 10_000_000_000 ? parsed * 1000 : parsed).toISOString()
}

function trimSlash(value: string): string {
  return value.replace(/\/+$/, '')
}

function assistantText(message: any): string {
  const blocks = Array.isArray(message?.content) ? message.content : []
  return blocks
    .filter((block: any) => block?.type === 'text' && typeof block.text === 'string')
    .map((block: any) => block.text)
    .join('\n')
    .trim()
}

function isImmediateBridgeCommand(text: string | undefined): boolean {
  const command = text?.trim().toUpperCase()
  return command === '/P' ||
    command === '/OK' ||
    command === '/NO' ||
    command === '/STOP' ||
    Boolean(command?.startsWith('/PAIR'))
}

function formatPermissionRequest(request: PendingPermissionInfo): string {
  const input = JSON.stringify(request.input, null, 2)
  const clipped = input.length > 1200 ? `${input.slice(0, 1200)}\n...` : input
  const context = request.assistantContext?.trim()
  return [
    context ? `触发原因：\n${clipText(context, 1200)}` : undefined,
    context ? '' : undefined,
    '需要工具审批：',
    `工具：${request.toolName}`,
    `时间：${new Date(request.createdAt).toLocaleString()}`,
    '参数：',
    clipped,
    '',
    '回复 /OK 批准，/NO 拒绝，/P 查看当前待审批项。',
  ].filter(Boolean).join('\n')
}

function clipText(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}\n...` : text
}

function splitOutboundText(text: string): string[] {
  const value = text.trim()
  if (!value) return ['']
  if (value.length <= MAX_OUTBOUND_TEXT_CHARS) return [value]
  const chunks: string[] = []
  let rest = value
  while (rest.length > MAX_OUTBOUND_TEXT_CHARS) {
    const slice = rest.slice(0, MAX_OUTBOUND_TEXT_CHARS)
    const breakAt = Math.max(slice.lastIndexOf('\n'), slice.lastIndexOf('。'), slice.lastIndexOf('. '))
    const cut = breakAt > 800 ? breakAt + 1 : MAX_OUTBOUND_TEXT_CHARS
    chunks.push(rest.slice(0, cut).trim())
    rest = rest.slice(cut).trim()
  }
  if (rest) chunks.push(rest)
  return chunks.map((chunk, index) => chunks.length > 1 ? `(${index + 1}/${chunks.length})\n${chunk}` : chunk)
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
