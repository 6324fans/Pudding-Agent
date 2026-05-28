# Pudding-Agent 项目代码功能详细介绍

## 目录

1. [项目概述](#项目概述)
2. [技术架构](#技术架构)
3. [核心包结构](#核心包结构)
4. [核心引擎 (packages/core)](#核心引擎)
5. [Electron 主进程 (packages/electron)](#electron-主进程)
6. [前端 UI (packages/ui)](#前端-ui)
7. [IDE 集成 (packages/vscode-extension)](#ide-集成)
8. [工具系统详解](#工具系统详解)
9. [团队模式详解](#团队模式详解)
10. [模型提供者详解](#模型提供者详解)
11. [权限系统详解](#权限系统详解)
12. [配置与扩展系统](#配置与扩展系统)

---

## 项目概述

Pudding-Agent 是一个基于 Electron 的桌面端 AI 编程助手应用。它通过 30+ 内置工具，让 AI 完整操控用户的代码库。项目采用 TypeScript 编写，使用 pnpm workspace 管理多包架构。

**核心理念：** 将 AI 从"对话助手"升级为"编程搭档"——AI 不仅回答问题，还能直接读写文件、执行命令、搜索代码、组建虚拟团队处理复杂任务。

---

## 技术架构

```
┌─────────────────────────────────────────────────────────────┐
│                      Electron 主进程                         │
│  packages/electron/src/main.ts                               │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │ SessionManager│  │ GitService  │  │  TerminalService    │  │
│  └──────┬──────┘  └──────┬──────┘  └──────────┬──────────┘  │
│         │                │                     │             │
│  ┌──────┴────────────────┴─────────────────────┴──────────┐  │
│  │                   IPC Handlers                          │  │
│  └────────────────────────┬───────────────────────────────┘  │
└───────────────────────────┼───────────────────────────────────┘
                            │ IPC
┌───────────────────────────┼───────────────────────────────────┐
│                      渲染进程                                  │
│  packages/ui/src/                                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐   │
│  │   App.tsx    │  │  Components │  │    Stores (Zustand)  │   │
│  └──────┬──────┘  └──────┬──────┘  └──────────┬──────────┘   │
│         │                │                     │              │
│  ┌──────┴────────────────┴─────────────────────┴──────────┐   │
│  │              React 19 + Tailwind CSS 4                  │   │
│  └─────────────────────────────────────────────────────────┘   │
└───────────────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────────────┐
│                      Core 引擎                                │
│  packages/core/src/                                           │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐   │
│  │   Session    │  │ ToolRunner  │  │   ModelProvider      │   │
│  └──────┬──────┘  └──────┬──────┘  └──────────┬──────────┘   │
│         │                │                     │              │
│  ┌──────┴──────┐  ┌──────┴──────┐  ┌──────────┴──────────┐   │
│  │    Tools    │  │   Team      │  │     Providers        │   │
│  │   (30+)     │  │   System    │  │  (Anthropic/OpenAI)  │   │
│  └─────────────┘  └─────────────┘  └──────────────────────┘   │
└───────────────────────────────────────────────────────────────┘
```

---

## 核心包结构

| 包名 | 路径 | 职责 |
|------|------|------|
| `@puddingagent/core` | `packages/core/` | 会话引擎、工具系统、模型提供者、MCP、IDE、Hooks、Skills |
| `@puddingagent/electron` | `packages/electron/` | Electron 主进程、IPC 处理、终端服务、Git 服务 |
| `@puddingagent/ui` | `packages/ui/` | React 19 + Zustand 5 + Tailwind CSS 4 前端界面 |
| `vscode-extension` | `packages/vscode-extension/` | VS Code 配套扩展 |
| `jetbrains-plugin` | `packages/jetbrains-plugin/` | JetBrains IDE 配套插件 |

---

## 核心引擎

### Session 类 (`packages/core/src/session.ts`)

Session 是整个系统的核心类，管理一次完整的 AI 对话会话。

**主要职责：**
- 管理对话消息历史
- 调用模型提供者生成响应
- 执行工具调用
- 处理上下文压缩（compaction）
- 管理子代理和团队
- 跟踪文件变更和使用量

**关键属性：**
```typescript
class Session {
  readonly id: string                    // 会话唯一标识
  readonly config: SessionConfig         // 会话配置
  private messages: Message[]            // 消息历史
  private provider: ModelProvider        // 模型提供者
  private toolRunner: ToolRunner         // 工具执行器
  private parallelExecutor: ParallelExecutor  // 并行执行器
  private toolRegistry: ToolRegistry     // 工具注册表
  private history: ConversationHistory   // 对话历史持久化
  private taskStore: TaskStore           // 任务存储
  private mcpManager?: McpManager        // MCP 管理器
  private hookEngine?: HookEngine        // 钩子引擎
  private skillLoader: SkillLoader       // 技能加载器
  private permissionChecker: PermissionChecker  // 权限检查器
  private usageTracker: UsageTracker     // 使用量跟踪
  private fileTracker: FileTracker       // 文件变更跟踪
  private backgroundTasks: BackgroundTaskManager  // 后台任务
  private teamRegistry: TeamRegistry     // 团队注册表
  private planMode: 'normal' | 'planning' | 'awaiting_approval'  // 规划模式状态
}
```

**关键方法：**
- `sendMessage()` - 发送用户消息并获取 AI 响应
- `compactMessages()` - 压缩对话历史
- `abort()` - 中止当前生成
- `switchModel()` - 切换模型

---

### 消息类型 (`packages/core/src/types.ts`)

系统定义了完整的消息和内容类型：

```typescript
// 消息角色
type MessageRole = 'user' | 'assistant' | 'system'

// 内容块类型
interface TextContent { type: 'text'; text: string }
interface ToolUseContent { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
interface ToolResultContent { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }
interface ImageContent { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
interface ThinkingContent { type: 'thinking'; thinking: string; signature?: string }

// 消息结构
interface Message {
  id: string
  role: MessageRole
  content: ContentBlock[]
  timestamp: number
}
```

---

### 系统提示词 (`packages/core/src/base-prompt.ts`)

系统提示词是 AI 行为的核心配置，包含多个模块化部分：

```typescript
function getBasePrompt(opts: PromptOptions): string {
  const sections = [
    getIdentitySection(),          // 身份定义
    getSystemSection(),            // 系统行为
    getDoingTasksSection(),        // 任务执行指南
    getActionsSection(),           // 行动指南
    getToolUsageSection(),         // 工具使用指南
    getToolDescriptionsSection(),  // 工具详细描述
    getTaskManagementSection(),    // 任务管理
    getAgentDispatchSection(),     // 子代理调度
    getCodingSection(),            // 编码规范
    getShellExecutionSection(),    // Shell 执行
    getGitSection(),               // Git 操作
    getPlanModeSection(),          // 规划模式
    getVerificationSection(),      // 验证流程
    getCompactionSection(),        // 压缩机制
    getResponseStyleSection(),     // 响应风格
    getSafetySection(),            // 安全守则
  ]
}
```

---

### 上下文组装 (`packages/core/src/context.ts`)

上下文组装器负责构建完整的系统提示词，包含：

```typescript
// 加载项目指令
async function loadProjectMd(cwd: string): Promise<string | null>
// 搜索 PUDDINGAGENT.md, .puddingagent/PUDDINGAGENT.md, CLAUDE.md, .claude/CLAUDE.md

// 加载全局指令
async function loadGlobalMd(): Promise<string | null>
// 从 ~/.puddingagent/PUDDINGAGENT.md 加载

// 加载项目规则
async function loadProjectRules(cwd: string): Promise<string[]>
// 从 .puddingagent/rules/*.md 加载

// 加载记忆索引
async function loadMemoryIndex(cwd: string): Promise<string | null>
// 从 ~/.puddingagent/projects/<path>/memory/MEMORY.md 加载
```

---

## Electron 主进程

### 主入口 (`packages/electron/src/main.ts`)

```typescript
// 核心服务实例
const sessionManager = new SessionManager()   // 会话管理器
const gitService = new GitService()           // Git 服务
const appLauncher = new AppLauncher()         // 应用启动器
const terminalService = new TerminalService() // 终端服务

// 自动更新
autoUpdater.autoDownload = false
autoUpdater.autoInstallOnAppQuit = true

// 文件日志记录
function setupFileLogger(): void { ... }
// 日志路径: ~/Library/Logs/Pudding-Agent/main.log (macOS)
//          %APPDATA%\Pudding-Agent\logs\main.log (Windows)
```

---

### 会话管理器 (`packages/electron/src/session-manager.ts`)

SessionManager 是 Electron 主进程的核心管理类：

**主要职责：**
- 管理多个并发会话
- 处理 IPC 通信
- 管理 MCP 服务器连接
- 协调 Git 服务和终端服务

---

### IPC 通信 (`packages/electron/src/ipc-channels.ts`)

定义了所有 IPC 通信通道：

```typescript
// 会话相关
'session:create'      // 创建新会话
'session:send'        // 发送消息
'session:abort'       // 中止生成
'session:switch-model' // 切换模型

// 文件操作
'file:read'           // 读取文件
'file:write'          // 写入文件
'file:edit'           // 编辑文件

// Git 操作
'git:status'          // 获取状态
'git:diff'            // 获取差异
'git:log'             // 获取日志

// 终端操作
'terminal:create'     // 创建终端
'terminal:write'      // 写入命令
'terminal:resize'     // 调整大小

// MCP 操作
'mcp:connect'         // 连接服务器
'mcp:disconnect'      // 断开连接
'mcp:list-tools'      // 列出工具
```

---

### Git 服务 (`packages/electron/src/git-service.ts`)

```typescript
class GitService {
  async getStatus(cwd: string): Promise<GitStatus>
  async getDiff(cwd: string, file?: string): Promise<string>
  async getLog(cwd: string, limit?: number): Promise<GitLogEntry[]>
  async getCurrentBranch(cwd: string): Promise<string>
  async getUser(cwd: string): Promise<{ name: string; email: string }>
}
```

---

### 终端服务 (`packages/electron/src/terminal-service.ts`)

```typescript
class TerminalService {
  private terminals: Map<string, TerminalSession>

  createTerminal(cols: number, rows: number): TerminalSession
  writeToTerminal(id: string, data: string): void
  resizeTerminal(id: string, cols: number, rows: number): void
  destroyTerminal(id: string): void
  destroyAll(): void
}
```

使用 `node-pty` 创建真实 PTY，支持交互式命令。

---

## 前端 UI

### 技术栈

- **React 19** - UI 框架
- **Zustand 5** - 状态管理
- **Tailwind CSS 4** - 样式系统
- **Vite** - 构建工具

### 目录结构

```
packages/ui/src/
├── App.tsx           # 主应用组件
├── main.tsx          # 入口文件
├── index.css         # 全局样式
├── components/       # UI 组件
│   ├── ChatView.tsx      # 聊天视图
│   ├── Composer.tsx      # 消息编辑器
│   ├── Sidebar.tsx       # 侧边栏
│   ├── Settings.tsx      # 设置页面
│   ├── ToolCall.tsx      # 工具调用展示
│   ├── TeamView.tsx      # 团队视图
│   └── ...
├── stores/           # Zustand 状态存储
│   ├── sessionStore.ts   # 会话状态
│   ├── modelStore.ts     # 模型状态
│   ├── settingsStore.ts  # 设置状态
│   └── ...
├── hooks/            # 自定义 Hooks
│   ├── useSession.ts     # 会话 Hook
│   ├── useModels.ts      # 模型 Hook
│   └── ...
└── lib/              # 工具函数
```

---

### 状态管理 (Zustand Stores)

```typescript
// 会话状态
interface SessionStore {
  sessions: Map<string, SessionState>
  activeSessionId: string | null
  createSession(cwd: string): string
  sendMessage(sessionId: string, content: string): void
  abortSession(sessionId: string): void
}

// 模型状态
interface ModelStore {
  groups: ModelGroup[]
  activeModelId: string | null
  addGroup(group: ModelGroup): void
  setActiveModel(modelId: string): void
  testConnection(groupId: string): Promise<boolean>
}
```

---

## IDE 集成

### VS Code 扩展 (`packages/vscode-extension/src/`)

```typescript
// extension.ts - 扩展入口
export function activate(context: vscode.ExtensionContext) {
  // 启动 RPC 服务器
  const server = new RpcServer(context)
  server.start()

  // 注册命令
  vscode.commands.registerCommand('puddingagent.openDiff', openDiffHandler)
  vscode.commands.registerCommand('puddingagent.sendSelection', sendSelectionHandler)
}

// rpc-handler.ts - RPC 处理
class RpcHandler {
  async openFile(filePath: string, line?: number): Promise<void>
  async openDiff(params: OpenDiffParams): Promise<void>
  async getDiagnostics(): Promise<DiagnosticFile[]>
  async getActiveEditor(): Promise<EditorInfo | null>
}

// selection.ts - 选区处理
function getSelection(): SelectionData | null
function getActiveFilePath(): string | null

// at-mention.ts - @ 提及处理
function getAtMentionContext(): AtMentionData | null
```

---

### IDE 管理器 (`packages/core/src/ide/`)

```typescript
class IdeManager {
  private connections: Map<string, IdeConnection>

  async connect(ideType: 'vscode' | 'jetbrains' | 'xcode'): Promise<void>
  async openFile(filePath: string, line?: number): Promise<void>
  async openDiff(params: OpenDiffParams): Promise<void>
  async getDiagnostics(): Promise<DiagnosticFile[]>
  getActiveEditor(): { filePath: string; selection: SelectionData | null } | null
  isConnected(): boolean
  getStatus(): IdeConnectionStatus
}
```

---

## 工具系统详解

### 工具注册表 (`packages/core/src/tool-registry.ts`)

```typescript
class ToolRegistry {
  private tools = new Map<string, ToolDefinition>()

  register(tool: ToolDefinition): void
  get(name: string): ToolDefinition | undefined
  getAll(): ToolDefinition[]
  getNames(): string[]
}
```

---

### 工具执行器 (`packages/core/src/tool-runner.ts`)

```typescript
class ToolRunner {
  private registry: ToolRegistry
  private permissionChecker: PermissionChecker
  private hookEngine?: HookEngine

  async executeTool(
    name: string,
    input: Record<string, unknown>,
    ctx: ToolExecutionContext
  ): Promise<ToolResult>

  planMode: 'normal' | 'planning' | 'awaiting_approval'
}
```

**执行流程：**
1. 从注册表获取工具定义
2. 检查权限（PermissionChecker）
3. 运行 PreToolUse 钩子（HookEngine）
4. 执行工具
5. 运行 PostToolUse 钩子
6. 返回结果

---

### 内置工具列表

| 工具名 | 文件 | 功能 |
|--------|------|------|
| `bash` | `bash.ts` | 执行 Shell 命令 |
| `file_read` | `file-read.ts` | 读取文件内容 |
| `file_write` | `file-write.ts` | 写入文件 |
| `file_edit` | `file-edit.ts` | 编辑文件（精确替换） |
| `multi_edit` | `multi-edit.ts` | 批量编辑文件 |
| `glob` | `glob.ts` | 文件模式匹配 |
| `grep` | `grep.ts` | 内容搜索（基于 ripgrep） |
| `ls` | `ls.ts` | 列出目录内容 |
| `tree` | `tree.ts` | 显示目录树 |
| `notebook_edit` | `notebook-edit.ts` | 编辑 Jupyter Notebook |
| `web_fetch` | `web-fetch.ts` | 获取网页内容 |
| `web_search` | `web-search.ts` | 搜索网页 |
| `lsp` | `lsp.ts` | LSP 语言服务 |
| `agent` | `agent.ts` | 调度子代理 |
| `skill` | `skill.ts` | 执行技能 |
| `save_memory` | `save-memory.ts` | 保存记忆 |
| `task_create` | `task-create.ts` | 创建任务 |
| `task_get` | `task-get.ts` | 获取任务 |
| `task_list` | `task-list.ts` | 列出任务 |
| `task_update` | `task-update.ts` | 更新任务 |
| `task_stop` | `task-stop.ts` | 停止任务 |
| `task_output` | `task-output.ts` | 获取任务输出 |
| `todo_write` | `todo-write.ts` | 写入待办 |
| `monitor` | `monitor.ts` | 后台监控 |
| `team` | `team.ts` | 创建团队 |
| `team_list` | `team-list.ts` | 列出团队 |
| `team_add_task` | `team-add-task.ts` | 添加团队任务 |
| `team_artifact` | `team-artifact.ts` | 团队产出物 |
| `team_report` | `team-report.ts` | 团队报告 |
| `background_send` | `background-send.ts` | 发送后台消息 |
| `background_status` | `background-status.ts` | 查询后台状态 |
| `background_events` | `background-events.ts` | 获取后台事件 |
| `enter_plan_mode` | `enter-plan-mode.ts` | 进入规划模式 |
| `exit_plan_mode` | `exit-plan-mode.ts` | 退出规划模式 |
| `ask_user` | `ask-user.ts` | 询问用户 |
| `notify` | `notify.ts` | 发送通知 |
| `list_mcp_resources` | `list-mcp-resources.ts` | 列出 MCP 资源 |
| `read_mcp_resource` | `read-mcp-resource.ts` | 读取 MCP 资源 |

---

## 团队模式详解

### 团队架构

```
┌─────────────────────────────────────────────────────────┐
│                    TeamManager (PM)                      │
│  packages/core/src/team/team-manager.ts                  │
│  ┌─────────────────────────────────────────────────────┐ │
│  │ - 任务分解与分配                                      │ │
│  │ - 进度监控与干预                                      │ │
│  │ - 失败处理与恢复                                      │ │
│  │ - 最终汇报                                            │ │
│  └─────────────────────────────────────────────────────┘ │
└────────────────────────┬────────────────────────────────┘
                         │
        ┌────────────────┼────────────────┐
        │                │                │
        ▼                ▼                ▼
┌───────────────┐ ┌───────────────┐ ┌───────────────┐
│  TeamMember   │ │  TeamMember   │ │  TeamMember   │
│  (Worker 1)   │ │  (Worker 2)   │ │  (Worker 3)   │
│               │ │               │ │               │
│  数据库设计    │ │  API 路由     │ │  前端组件     │
└───────────────┘ └───────────────┘ └───────────────┘
```

---

### TeamManager (`packages/core/src/team/team-manager.ts`)

```typescript
class TeamManager {
  readonly id: string
  private tasks: Map<string, TeamTask>
  private constraints: string[]

  constructor(opts: TeamManagerOptions) {
    // 初始化任务列表
    // 解析任务依赖关系
  }

  // 项目经理 AI 的决策接口
  processDecision(decision: ManagerAction): void

  // 任务管理
  addTask(task: TeamTaskInput): TeamTask
  updateTask(taskId: string, update: Partial<TeamTask>): void
  getTask(taskId: string): TeamTask | undefined
  getTasks(): TeamTask[]

  // 状态管理
  getState(): TeamManagerState
  setStatus(status: 'planning' | 'executing' | 'completed' | 'failed'): void
}
```

---

### TeamRuntime (`packages/core/src/team/team-runtime.ts`)

团队运行时是团队模式的核心引擎，负责：

```typescript
class TeamRuntime {
  // 启动团队
  async start(): Promise<void>

  // 运行 PM 决策循环
  async runManagerLoop(): Promise<void>

  // 启动 Worker
  async startWorker(member: TeamMember): Promise<void>

  // 处理 Worker 完成
  async handleWorkerComplete(memberId: string, result: SubSessionResult): Promise<void>

  // 处理失败
  async handleFailure(memberId: string, error: Error): Promise<void>

  // 结束团队
  async complete(): Promise<void>
}
```

---

### TeamMember (`packages/core/src/team/team-member.ts`)

```typescript
class TeamMember {
  readonly id: string
  readonly role: string
  readonly agentType: string
  readonly modelId?: string

  // 分配任务
  assignTask(task: TeamTask): void

  // 获取状态
  getStatus(): 'idle' | 'working' | 'completed' | 'failed'

  // 消息通信
  sendMessage(content: string): void
  receiveMessage(): TeamMessage[]
}
```

---

### 专家提示词 (`packages/core/src/team/expert-prompts.ts`)

为不同角色定义专业化的系统提示词：

```typescript
const EXPERT_PROMPTS = {
  'frontend-developer': `...`,  // 前端开发专家
  'backend-developer': `...`,   // 后端开发专家
  'database-designer': `...`,   // 数据库设计专家
  'devops-engineer': `...`,    // DevOps 工程师
  'security-auditor': `...`,   // 安全审计专家
  'code-reviewer': `...`,      // 代码审查专家
}
```

---

## 模型提供者详解

### 提供者接口 (`packages/core/src/model-provider.ts`)

```typescript
interface ModelProvider {
  name: string

  // 流式生成
  stream(
    messages: Message[],
    config: ModelConfig,
    tools?: ToolDefinition[],
    signal?: AbortSignal
  ): AsyncIterable<StreamChunk>

  // 计算 token 数
  countTokens?(text: string): Promise<number>
}
```

---

### Anthropic 提供者 (`packages/core/src/providers/anthropic.ts`)

```typescript
class AnthropicProvider implements ModelProvider {
  name = 'anthropic'
  private client: Anthropic

  constructor(apiKey: string, baseURL?: string) {
    this.client = new Anthropic({ apiKey, baseURL })
  }

  async *stream(messages, config, tools, signal): AsyncIterable<StreamChunk> {
    // 构建请求参数
    const params = {
      model: config.model,
      max_tokens: config.maxTokens,
      system: resolveSystemPrompt(config.systemPrompt),
      messages: convertMessages(messages),
      tools: convertTools(tools),
      stream: true,
    }

    // 应用推理强度
    if (config.effort) {
      applyEffort(params, config)
    }

    // 流式处理响应
    const stream = await this.client.messages.create(params, { signal })
    for await (const event of stream) {
      yield convertStreamChunk(event)
    }
  }
}
```

**特性：**
- 支持 Anthropic Messages API
- 支持 `thinking` 推理模式
- 支持 `cache_control` 缓存控制
- 自动处理 `tool_use` 工具调用
- ThinkTag 流式解析器处理思考标签

---

### OpenAI Chat 提供者 (`packages/core/src/providers/openai-chat.ts`)

```typescript
class OpenAIChatProvider implements ModelProvider {
  name = 'openai-chat'
  private client: OpenAI

  async *stream(messages, config, tools, signal): AsyncIterable<StreamChunk> {
    const params = {
      model: config.model,
      max_tokens: config.maxTokens,
      messages: convertMessages(messages),
      tools: convertTools(tools),
      stream: true,
      prompt_cache_key: config.cacheKey,
      user: config.cacheUser,
    }

    // 推理模型处理
    if (isReasoningModel(config.model)) {
      delete params.temperature
      // 使用 reasoning_effort 参数
    }

    const stream = await this.client.chat.completions.create(params, { signal })
    for await (const chunk of stream) {
      yield convertStreamChunk(chunk)
    }
  }
}
```

---

### OpenAI Responses 提供者 (`packages/core/src/providers/openai-responses.ts`)

支持 OpenAI 的 Responses API 格式，提供更丰富的交互能力。

---

### ThinkTag 解析器 (`packages/core/src/providers/think-parser.ts`)

处理模型输出中的思考标签：

```typescript
class ThinkTagStreamParser {
  // 状态机解析
  private state: 'idle' | 'tag_open' | 'thinking' | 'tag_close' | 'done'

  // 处理流式 delta
  process(delta: string): StreamChunk[]

  // 检查是否完成
  isComplete(): boolean

  // 获取思考内容
  getThinking(): string

  // 获取剩余内容
  getRemaining(): string
}
```

---

## 权限系统详解

### 权限检查器 (`packages/core/src/permissions.ts`)

```typescript
class PermissionChecker {
  private mode: PermissionMode
  private cwd: string
  private projectRules: PermissionRule[]
  private globalRules: PermissionRule[]
  private sessionAllowed: Set<string>
  private deniedPatterns: Map<string, Set<string>>

  constructor(mode: PermissionMode, cwd: string, rules?: LoadedRules)

  // 检查权限
  check(toolName: string, input: Record<string, unknown>): PermissionDecision

  // 添加会话级允许
  allowSession(toolName: string): void

  // 获取危险级别
  getDangerLevel(toolName: string, input: Record<string, unknown>): DangerLevel
}
```

---

### 权限模式

```typescript
type PermissionMode = 'strict' | 'standard' | 'relaxed'

// 权限决策
type PermissionDecision = 'allow' | 'deny' | 'ask'

// 危险级别
type DangerLevel = 'safe' | 'dangerous' | 'critical'
```

**模式行为：**

| 模式 | 读操作 | 写操作 | 执行操作 | 危险操作 |
|------|--------|--------|----------|----------|
| **strict** | 自动允许 | 询问 | 询问 | 拒绝 |
| **standard** | 自动允许 | 询问 | 询问 | 询问 |
| **relaxed** | 自动允许 | 自动允许 | 自动允许 | 询问 |

---

### 危险命令检测

```typescript
// 严重危险模式（始终拒绝）
const CRITICAL_PATTERNS = [
  /rm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+|--force\s+)*(\/|~)\s*$/,
  /rm\s+-rf\s+(\/|~)\s*$/,
  /dd\s+if=/,
  /mkfs\./,
  /:(){ :\|:& };:/,
  />\s*\/dev\/sd/,
  /sudo\s+rm\s+-rf/,
]

// 危险模式（需要确认）
const DANGEROUS_PATTERNS = [
  /rm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+|--force\s+)/,
  /git\s+push\s+--force/,
  /git\s+reset\s+--hard/,
  /npm\s+publish/,
  /DROP\s+(TABLE|DATABASE)/i,
]
```

---

### 权限规则 (`packages/core/src/permission-rules.ts`)

```typescript
interface PermissionRule {
  matcher: string      // 工具匹配模式: "*", "ToolName", "prefix*"
  decision: 'allow' | 'deny' | 'ask'
  reason?: string
}

// 加载规则
function loadPermissionRules(cwd: string): {
  projectRules: PermissionRule[]
  globalRules: PermissionRule[]
}
// 从 .puddingagent/permissions.json 和 ~/.puddingagent/permissions.json 加载
```

---

## 配置与扩展系统

### MCP (Model Context Protocol) (`packages/core/src/mcp/`)

```typescript
class McpManager {
  // 连接服务器
  async connect(config: McpServerConfig): Promise<void>

  // 断开连接
  async disconnect(name: string): Promise<void>

  // 获取工具列表
  getTools(): McpToolInfo[]

  // 获取资源列表
  async getResources(): Promise<McpResource[]>

  // 读取资源
  async readResource(uri: string): Promise<McpResourceContent>

  // 获取连接状态
  getStatus(): McpConnectionStatus
}

// 配置
interface McpServerConfig {
  transport: 'stdio' | 'sse'
  command?: string      // stdio 模式
  args?: string[]       // stdio 模式
  url?: string          // SSE 模式
  env?: Record<string, string>
}
```

---

### Hooks 系统 (`packages/core/src/hooks/`)

```typescript
class HookEngine {
  private config: HookConfig

  constructor(config: HookConfig)

  // PreToolUse 钩子
  async runPreToolUse(input: HookInput): Promise<HookOutput>

  // PostToolUse 钩子
  async runPostToolUse(input: HookInput): Promise<HookOutput>

  // SessionStart 钩子
  async runSessionStart(input: HookInput): Promise<void>

  // SessionEnd 钩子
  async runSessionEnd(input: HookInput): Promise<void>
}

// 配置
interface HookConfig {
  hooks: {
    PreToolUse?: HookRule[]
    PostToolUse?: HookRule[]
    SessionStart?: HookRule[]
    SessionEnd?: HookRule[]
  }
}

interface HookRule {
  matcher: string    // "*", "ToolName", "prefix*"
  hooks: Array<{
    type: 'command'
    command: string
    timeout?: number
  }>
}

// 输出
interface HookOutput {
  decision?: 'block' | 'allow'
  reason?: string
  message?: string
}
```

---

### Skills 系统 (`packages/core/src/skills/`)

```typescript
class SkillLoader {
  // 加载所有技能
  async loadAll(cwd: string): Promise<void>

  // 获取技能
  get(name: string): SkillDefinition | undefined

  // 获取所有技能
  getAll(): SkillDefinition[]

  // 获取可调用技能
  getInvocable(): SkillDefinition[]
}

// 技能定义
interface SkillDefinition {
  name: string
  description: string
  content: string
  userInvocable: boolean
  trigger?: string
  arguments: string[]
  argumentHint?: string
  allowedTools?: string[]
  source: 'global' | 'project'
  filePath: string
}

// 渲染技能
function renderSkill(skill: SkillDefinition, args?: string): string
// 替换 ${1}, ${2} 等参数占位符
```

---

### 记忆系统 (`packages/core/src/memory-extractor.ts`)

```typescript
// 解析记忆
function parseMemories(content: string): ExtractedMemory[]

// 保存记忆
async function saveMemories(memories: ExtractedMemory[], memDir: string): Promise<void>

// 记忆类型
interface ExtractedMemory {
  name: string
  description: string
  type: 'user' | 'feedback' | 'project' | 'reference'
  content: string
}

// 记忆目录结构
// ~/.puddingagent/projects/<sanitized-path>/memory/
// ├── MEMORY.md           # 索引文件
// ├── user_role.md        # 用户角色
// ├── feedback_testing.md # 测试反馈
// ├── project_auth.md     # 认证项目
// └── reference_linear.md # Linear 引用
```

---

### 上下文压缩 (`packages/core/src/compact.ts`)

```typescript
async function compactMessages(
  messages: Message[],
  provider: ModelProvider,
  config: ModelConfig
): Promise<CompactResult>

interface CompactResult {
  messages: Message[]       // 压缩后的消息
  originalCount: number     // 原始消息数
  keptCount: number         // 保留消息数
  summarizedCount: number   // 被总结的消息数
  memoriesExtracted: number // 提取的记忆数
}
```

**压缩策略：**
1. 保留最近的消息（基于 `compressAt` 配置）
2. 将旧消息总结为摘要
3. 提取记忆（用户偏好、项目决策等）
4. 保持对话连贯性

---

### 子代理系统 (`packages/core/src/sub-session.ts`)

```typescript
async function runSubSession(opts: SubSessionOptions): Promise<SubSessionResult>

interface SubSessionOptions {
  prompt: string                    // 子代理任务
  provider: ModelProvider           // 模型提供者
  toolRegistry: ToolRegistry        // 工具注册表
  modelConfig: ModelConfig          // 模型配置
  cwd: string                       // 工作目录
  maxTurns?: number                 // 最大轮数
  agentType?: string                // 代理类型
  signal?: AbortSignal              // 中止信号
  onToolEvent?: Function            // 工具事件回调
  onPermissionRequest?: Function    // 权限请求回调
  onAgentProgress?: Function        // 进度回调
  onAgentText?: Function            // 文本回调
  onUsage?: Function                // 使用量回调
  mailbox?: { drain(): Message[] }  // 消息邮箱
  extraTools?: ToolDefinition[]     // 额外工具
}

interface SubSessionResult {
  content: string       // 最终结果
  turns: number         // 消耗轮数
  toolsUsed: string[]   // 使用的工具
}
```

---

### 并行执行器 (`packages/core/src/parallel-executor.ts`)

```typescript
class ParallelExecutor {
  // 并行执行多个工具调用
  async executeParallel(
    toolUses: ToolUseBlock[],
    runner: ToolRunner,
    ctx: ToolExecutionContext
  ): Promise<ToolBatchResult>
}

interface ToolUseBlock {
  id: string
  name: string
  input: Record<string, unknown>
}

interface ToolBatchResult {
  results: Map<string, ToolResult>
  errors: Map<string, Error>
}
```

---

### 后台任务管理 (`packages/core/src/background-tasks.ts`)

```typescript
class BackgroundTaskManager {
  private tasks: Map<string, BackgroundTask>

  // 启动后台 Shell 任务
  async startShellTask(command: string): Promise<string>

  // 启动后台代理任务
  async startAgentTask(prompt: string, agentType?: string): Promise<string>

  // 获取任务状态
  getTask(taskId: string): BackgroundTask | undefined

  // 获取所有任务
  getTasks(): BackgroundTask[]

  // 获取任务输出
  getOutput(taskId: string, tailLines?: number): string

  // 停止任务
  stopTask(taskId: string): void

  // 设置完成回调
  setOnComplete(callback: (task: BackgroundTask) => void): void
}

interface BackgroundTask {
  id: string
  type: 'shell' | 'agent'
  status: 'running' | 'completed' | 'failed'
  command?: string
  prompt?: string
  output?: string
  result?: string
  exitCode?: number
  turns?: number
  toolsUsed?: string[]
  startedAt: number
  completedAt?: number
}
```

---

## 配置文件结构

```
~/.puddingagent/                          # 全局配置目录
├── PUDDINGAGENT.md                       # 全局指令
├── settings.json                     # 应用设置
├── permissions.json                  # 全局权限规则
├── mcp-servers.json                  # 全局 MCP 配置
├── skills/                           # 全局技能
│   └── code-review.md
└── projects/                         # 项目记忆
    └── <sanitized-path>/
        └── memory/
            ├── MEMORY.md
            └── *.md

<project>/.puddingagent/                  # 项目配置目录
├── PUDDINGAGENT.md                       # 项目指令
├── hooks.json                        # 钩子配置
├── mcp-servers.json                  # 项目 MCP 配置
├── permissions.json                  # 项目权限规则
├── skills/                           # 项目技能
│   └── code-review.md
├── rules/                            # 模块化规则
│   ├── testing.md
│   └── conventions.md
└── plans/                            # 规划模式输出
    └── *.md
```

---

## 总结

Pudding-Agent 是一个功能完整的 AI 编程助手系统，其核心特点：

1. **模块化架构** - Core、Electron、UI 分离，职责清晰
2. **强大的工具系统** - 30+ 内置工具覆盖文件操作、代码搜索、命令执行、Web 交互等
3. **团队模式** - 虚拟 AI 团队并行处理复杂任务
4. **灵活的模型支持** - 支持 Anthropic、OpenAI、Ollama 等多种提供者
5. **完善的权限系统** - 三级权限模式 + 危险命令检测
6. **可扩展性** - MCP、Hooks、Skills 三大扩展机制
7. **IDE 集成** - 支持 VS Code、JetBrains、Xcode
8. **记忆系统** - 跨会话持久化用户偏好和项目上下文
