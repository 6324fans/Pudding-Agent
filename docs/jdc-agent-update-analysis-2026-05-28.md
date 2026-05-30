# JDC_AGENT 更新分析（2026-05-28）

## 结论先行

本次 `JDC_AGENT` 远端 `main` 从本地的 `0c377c9`（v3.6.7）前进到 `d4cfb26`，共 11 个提交，版本号到 v3.7.1。由于本机终端访问 `github.com:443` 超时，`git pull --ff-only` 未成功完成；我改用 GitHub Compare API 和 `codeload.github.com` 下载了远端 `main` 快照做对比分析。本文只记录分析结论，没有改动 `Pudding-Agent` 业务代码。

对 `Pudding-Agent` 最有价值的更新是：

1. MCP 工具在每次发送消息前动态同步，能修复“会话已创建后 MCP 工具晚到导致模型看不到工具”的竞态问题。
2. OpenAI / Responses 协议对 reasoning 内容和流式结束 flush 做了补强，能减少思考内容丢失、最后一段文本没落库等问题。
3. 图片发送前增加 `sharp` 压缩管线，适合补到 `Pudding-Agent` 现有图片附件能力后面，降低大图超过 API 限制的概率。
4. Anthropic provider 增加 Claude Code Max / relay 兼容逻辑，价值较高但风险也高，建议作为可配置能力验证，不建议直接无条件替换。
5. CodeGraph 下载脚本改为固定 v0.9.6 + 直连下载地址 + 内置 SHA，能提升可复现性，但 `Pudding-Agent` 现有脚本已有 GitHub 代理兜底，适合“取其思路”而不是照搬。

## 拉取与对比范围

- 本地 JDC_AGENT 基准：`0c377c9a533f69a436c653742c060b677fe1fd91`
- 远端 main 最新：`d4cfb26`
- 变更规模：57 个文件，约 964 行新增、211 行删除
- 终端拉取结果：`git pull --ff-only` 失败，错误为无法连接 `https://github.com/u53/JDC_AGENT.git/`
- 替代方式：通过 `https://api.github.com/repos/u53/JDC_AGENT/compare/...` 获取提交/文件变更，通过 `https://codeload.github.com/u53/JDC_AGENT/zip/refs/heads/main` 下载远端快照

## 提交列表

| 提交 | 时间（UTC） | 说明 |
| --- | --- | --- |
| `d48f400` | 2026-05-28 02:34 | 修复 OpenAI 协议下 thinking 内容保存 |
| `543960c` | 2026-05-28 02:40 | 修复图片粘贴时 stale closure 导致写入错误 session |
| `0126195` | 2026-05-28 03:06 | 升级版本到 3.6.8 |
| `3993560` | 2026-05-28 06:32 | 新增图片压缩管线和粘贴占位符 |
| `4cb97da` | 2026-05-28 06:32 | 升级版本到 3.6.9 |
| `f82d190` | 2026-05-28 12:38 | 支持 Claude Code Max 协议，兼容 Anthropic relay |
| `9e099e3` | 2026-05-28 13:07 | 每次 sendMessage 同步 MCP tools，修复竞态 |
| `5607034` | 2026-05-28 13:12 | CodeGraph 固定到 v0.9.6，避免 latest 404 |
| `99c1b65` | 2026-05-28 13:15 | 尝试移除 GH_TOKEN 以避开 public repo 404 |
| `b2a663c` | 2026-05-28 13:18 | 恢复 GH_TOKEN，应对共享 runner 403 |
| `d4cfb26` | 2026-05-28 13:23 | 改用直接下载 URL，绕开 GitHub API |

## 功能变化详解

### 1. 图片压缩与粘贴链路

新增文件：

- `packages/core/src/utils/image-constants.ts`
- `packages/core/src/utils/image-resizer.ts`
- `packages/core/src/__tests__/image-resizer.test.ts`

核心逻辑：

- 新增 `compressImageForAPI(base64Data, mediaType)`。
- 使用 `sharp` 读取图片元信息。
- 目标限制是 API base64 体积不超过 5MB，因此把 raw buffer 目标设为约 3.75MB。
- 最大宽高限制为 2000x2000。
- 小图直接透传；大图先尝试 PNG 压缩，再 resize，再 JPEG quality 80/60/40/20，最后用更激进的 1000px + JPEG 20 兜底。
- Electron `SessionManager.sendMessage` 在图片送入 core session 前统一压缩，并在压缩失败时检查原图是否超过 5MB。
- UI `Composer` 在粘贴图片时会向输入框插入 `[image_1]` 这类占位符，同时修复用 stale `activeSessionId` 导致图片写错草稿的问题。

对 `Pudding-Agent` 的帮助：

- `Pudding-Agent` 现在已经有 `packages/ui/src/lib/attachments.ts`，支持读取图片和文本附件，但图片只读成 base64 后直接发送，`packages/core` 里没有压缩器，也没有 `sharp` 依赖。
- 建议借鉴服务端压缩管线，接在 `packages/electron/src/session-manager.ts` 的图片入参处理处。这样 UI 不需要承担大图处理压力，也能统一约束 API 限制。
- 不建议照搬 JDC 的 `[image_1]` 占位符逻辑，因为 `Pudding-Agent` 现在的附件体验已经更完整，支持文本附件和图片预览。可以保留当前附件 UI，只补后端压缩。

### 2. Anthropic / Claude Code Max relay 兼容

主要变更在 `packages/core/src/providers/anthropic.ts`。

核心逻辑：

- 新增 Claude Code 相关常量、稳定 `device_id` / `session_id`、fingerprint 和 attribution header。
- stream 请求改为 `POST /v1/messages?beta=true`。
- 增加多个 `anthropic-beta` header，包括 interleaved thinking、claude-code、context-1m、token-efficient-tools、structured outputs、effort、prompt caching scope。
- 伪装/对齐 Claude Code CLI 请求头，例如 `User-Agent: claude-cli/...`、`x-app: cli`、`X-Claude-Code-Session-Id` 等。
- system prompt 注入 `You are Claude Code...` 前缀，并把 cacheable / dynamic prompt 分块。
- `applyEffort` 改为 `params.thinking = { type: 'adaptive' }`，并删除 temperature/top_p/top_k。
- 原始 SSE parser 更宽容，支持 `data:<json>` 和 `data: <json>` 两种格式。
- formatMessages 增强了 Anthropic 的严格交替约束、孤儿 tool_result 修复、无结果 tool_use 删除、最后消息 cache_control。

对 `Pudding-Agent` 的帮助：

- 如果 `Pudding-Agent` 有 Anthropic relay / Claude Code Max 类兼容目标，这块很有价值。
- 但它是高风险变更：请求路径、headers、thinking 策略、system prompt 都被重写了，而且新 `applyEffort` 不再判断 `config.effort`，会无条件启用 adaptive thinking。
- 建议做成 provider 配置项，例如 `anthropicCompatMode: "official" | "claude-code-max"`，先在 relay 场景验证，不要直接替换当前官方 Anthropic 调用逻辑。

### 3. OpenAI / Responses reasoning 和 stream flush 修复

主要变更：

- `openai-chat.ts`
  - 非流式返回支持保存 `reasoning_content` 或 `reasoning` 到 `thinking` block。
  - 流式返回同时识别 `reasoning_content` 和 `reasoning`。
  - 对 `stop` 之外的 finish reason 也会 flush。
  - 如果最终只收到 usage chunk，也会先 flush。
  - stream 异常结束时增加最后的 flush safety net。
- `openai-responses.ts`
  - 非流式返回支持 `type === "reasoning"` 的 summary。
  - stream completed 时标记 flushed。
  - stream 结束但未 completed 时也会 flush。

对 `Pudding-Agent` 的帮助：

- `Pudding-Agent` 当前 OpenAI Chat 只处理流式 `reasoning_content`，非流式 reasoning 没保存。
- 当前 stream 对 finish reason 的处理较窄，可能在 `length`、`content_filter` 或连接提前结束时丢最后的 buffered 文本。
- 这块是低风险高收益，建议优先移植，并补一两个 provider 流式单测。

### 4. MCP tools 动态同步

主要变更在 `packages/core/src/session.ts`：

- 新增 `syncMcpTools()`。
- 每次 `sendMessage()` 前从 `mcpManager.getTools()` 重新读取当前 MCP 工具。
- 如果工具还没注册到 `toolRegistry`，就按 `server__tool` 名称拆出 serverName/toolName 并注册 `createMcpToolHandler(...)`。

对 `Pudding-Agent` 的帮助：

- `Pudding-Agent` 当前只在 `Session` 构造时注册一次 MCP tools。如果 MCP server 是异步连接、重连、或在 session 创建后才加载工具，模型当轮可能看不到新工具。
- 这个修复非常适合移植，改动小、收益明确。
- 移植时建议顺手处理两个边界：
  - MCP tool 如果服务端更新了 description/inputSchema，是否需要覆盖旧注册。
  - MCP server 断开后，是否需要隐藏或保留旧工具。目前 JDC 只新增不删除。

### 5. 工具名从 snake_case 改为 Claude 风格 PascalCase

变更范围很广：

- `file_read` -> `Read`
- `file_write` -> `Write`
- `file_edit` -> `Edit`
- `bash` -> `Bash`
- `glob` -> `Glob`
- `grep` -> `Grep`
- `ls` -> `LS`
- `web_search` -> `WebSearch`
- `task_create` -> `TaskCreate`
- `todo_write` -> `TodoWrite`
- `enter_plan_mode` -> `EnterPlanMode`
- 其他内置工具同样同步更新

同时更新了：

- base prompt 中对工具名的提示。
- permissions 的读/写工具集合和默认规则。
- parallel executor 的只读工具/长耗时工具集合。
- plan mode allowlist。
- UI permission dialog 和 tool card router。
- agent types 的 allowedTools。

对 `Pudding-Agent` 的帮助：

- 这很可能是为了贴近 Claude Code Max 协议/提示习惯，对 relay 兼容有帮助。
- 但对 `Pudding-Agent` 来说属于高破坏半径变更：历史消息、工具卡片、权限规则、agent allowedTools、plan mode、测试用例、MCP 工具调用习惯都会受影响。
- 如果不做 Claude Code Max 深度兼容，不建议短期迁移。更稳的方式是保留现有 snake_case，对特定 provider 做工具名映射层。

### 6. CodeGraph 下载脚本

主要变更在 `scripts/fetch-codegraph.ts`：

- 删除 GitHub release API 查询逻辑。
- 固定 `CODEGRAPH_VERSION = "v0.9.6"`。
- 使用 `https://github.com/colbymchenry/codegraph/releases/download/v0.9.6/<asset>` 直连下载。
- 内置各平台 asset 的 SHA256。
- 版本文件写固定版本。
- release workflow 中不再给 `pnpm fetch-codegraph` 注入 `GH_TOKEN`。

对 `Pudding-Agent` 的帮助：

- `Pudding-Agent` 当前脚本仍走 GitHub API / latest，但已经自带 `gh-proxy.com` 兜底，这是 JDC 没有的能力。
- JDC 这次改动的关键价值是“固定版本 + 固定 SHA + 直连 asset”，可复现性更好，也能绕开 `/releases/latest` 的 API 问题。
- 建议不要照搬删除代理逻辑。更合适的方案是：保留 `Pudding-Agent` 的 GitHub proxy fallback，同时增加默认固定版本和内置 SHA；必要时仍支持 `--version=` 覆盖。

### 7. 构建与依赖

主要变更：

- `packages/core/package.json` 增加 `sharp` 和 `@types/sharp`。
- `packages/electron/package.json` 增加 `sharp`。
- `packages/electron/build.mjs` 把 `sharp` 加入 external，避免被 esbuild 打包。
- Electron 版本从 3.6.7 升到 3.7.1。

对 `Pudding-Agent` 的帮助：

- 如果移植图片压缩，必须同步处理 `sharp` 依赖和 Electron 打包 external。
- `Pudding-Agent` 根 `package.json` 有 `onlyBuiltDependencies` 控制，加入 `sharp` 时要注意 pnpm 是否允许 native dependency 构建。

## 建议移植优先级

| 优先级 | 建议 | 原因 |
| --- | --- | --- |
| P0 | 移植 `syncMcpTools()` | 修复真实竞态，改动小，对现有体验正向 |
| P0 | 移植 OpenAI / Responses reasoning 与 stream flush 修复 | 低风险，能减少消息内容丢失 |
| P1 | 移植图片压缩管线 | 与 Pudding 现有附件能力互补，能减少大图失败 |
| P1 | CodeGraph 改成固定版本 + SHA，同时保留 gh-proxy | 提升可复现性，兼容国内网络 |
| P2 | Anthropic Claude Code Max 兼容做成可选 provider 模式 | 有潜力，但需要实测 relay / 官方 API 行为 |
| P3 | 工具名 PascalCase 迁移 | 破坏面大，除非明确要对齐 Claude Code 协议，否则先不动 |

## 对 Pudding-Agent 的落地建议

短期最稳路线：

1. 先补 MCP 动态同步。
2. 再补 OpenAI provider 的 reasoning 保存和 flush safety net。
3. 加 `sharp` 图片压缩，但保持现在的附件 UI 和文本附件能力。
4. CodeGraph 脚本只借鉴“固定版本 + SHA”，保留现有代理兜底。

需要单独评估的路线：

1. Claude Code Max relay 兼容。
2. 内置工具名整体 PascalCase 化。

这两项最好一起设计，因为 JDC 的 Anthropic 兼容和工具名迁移显然是互相配合的；如果只拿一半，容易出现 provider 能发请求但模型调用工具名不匹配的问题。

