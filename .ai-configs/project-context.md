# 项目上下文

> 此文件由 `/init-context` 引导生成，描述 Pudding-Agent 的项目背景信息。
> 所有研发流程 skill 会读取此文件作为前置上下文。

## 基础信息

- **项目名称**：Pudding-Agent
- **项目描述**：基于 Electron 的源码可见（source-available）桌面端 AI 编程助手。通过 30+ 内置工具让 AI 完整读写、执行代码库，支持多模型协议（Anthropic Messages / OpenAI Chat Completions / OpenAI Responses），并可组建虚拟 AI 团队并行处理复杂任务。
- **仓库地址**：https://github.com/6324fans/Pudding-Agent
- **当前版本**：1.0.8

## 技术栈

- **语言**：TypeScript 5.7（target ES2022，strict 模式）；JetBrains 插件使用 Kotlin（Gradle 构建）
- **前端框架**：React 19
- **UI 组件库**：Radix UI（Dialog / Collapsible / Scroll-Area 等）+ Tailwind CSS 4
- **状态管理**：Zustand 5
- **后端框架**：无传统后端。Electron 33 主进程（Node.js）作为应用后端，承载 Session / Git / Terminal 等服务；`packages/core` 为核心引擎（依赖 `@anthropic-ai/sdk`、`openai`、`@modelcontextprotocol/sdk`）
- **数据库**：无传统数据库，本地存储使用 sql.js（SQLite WASM）+ electron-store
- **构建工具**：Vite 6（UI）+ tsc（core）+ esbuild（electron / vscode-extension）+ electron-builder 25（打包发布）+ Gradle（JetBrains 插件）
- **包管理器**：pnpm 10.34.1（workspace 多包管理）

## 项目结构

```
packages/
├── core/             # 核心引擎：会话(Session)、工具运行器(ToolRunner)、模型提供者(ModelProvider)、权限系统
├── electron/         # Electron 主进程：SessionManager / GitService / TerminalService / IPC Handlers
├── ui/               # React 前端：App.tsx / Components / Zustand Stores（React 19 + Tailwind CSS 4）
├── vscode-extension/ # VS Code 扩展：与 Pudding-Agent 双向通信（WebSocket）
└── jetbrains-plugin/ # JetBrains 插件（Kotlin / Gradle）

docs/                 # 文档（含 ui-style-guide.md、project-introduction.md 等）
scripts/              # 构建辅助脚本（dev.ts、打包/签名/公证、node-pty 权限修复等）
assets/               # 静态资源（图标等）
.github/workflows/    # CI（release.yml：tag 触发构建发布）
CLAUDE.md             # 项目开发指南（含 UI 设计规范摘要 + 技术栈 + 命令）
tsconfig.base.json    # 共享 TS 配置（strict + ES2022）
```

## 设计规范

> 详细规范见 [docs/ui-style-guide.md](../docs/ui-style-guide.md)，CLAUDE.md 中亦有摘要。

- **设计系统**：深色优先（dark-first）现代极简科技风，自研设计规范（无外部设计系统）
- **主色调**：品牌紫蓝渐变 `#818cf8 → #a78bfa`（135° 线性渐变）
- **背景色**：页面 `#0a0b0f` / 卡片 `#12131a` / 输入框 `#181a24`
- **文字色**：主 `#e4e5eb` / 次 `#a0a3b1` / 弱化 `#6b6e7e`
- **功能色**：成功 `#34d399` / 警告 `#fbbf24` / 错误 `#f87171` / 规划 `#a78bfa`
- **字体**：Inter（主体）+ JetBrains Mono（代码 / 路径 / 技术标识）
- **圆角**：按钮 8–10px，卡片 12px，小元素 4–6px
- **关键交互**：输入框聚焦 = 品牌色边框 + 辉光阴影；主按钮 = 品牌渐变 + 白字 + 辉光；状态指示 = 6–7px 圆点 + 脉冲动画；选中项 = `rgba(99,102,241,0.15)` 半透明背景
- **响应式断点**：桌面端应用为主（macOS / Windows），无移动端断点

## 编码规范

- **代码风格**：以 `tsconfig.base.json`（strict）为准；未发现 ESLint / Prettier / Biome 等统一配置文件，沿用 TypeScript strict 编译约束
- **命名约定**：组件 PascalCase；Zustand store / hook 用驼峰；包名 kebab-case；遵循各包现有命名习惯
- **Git 分支策略**：Trunk-based —— 直接在 `main` 分支提交，无长期 feature 分支
- **提交规范**：Conventional Commits（松散），如 `chore:` / `fix:` / `feat:`，也允许简短描述性提交

## 业务领域

- **产品类型**：开发者工具 / C 端桌面应用（source-available，非商业许可）
- **核心业务**：AI 编程助手 —— 让 AI 通过 30+ 内置工具读写、执行代码库，原生支持三大模型协议，并支持虚拟 AI 团队并行处理复杂任务；内置权限系统由用户掌控
- **目标用户**：开发者 / 程序员（需要自备 API Key，可接入 Claude / GPT / Gemini / Ollama 等任意 OpenAI 兼容端点）

## 团队约束

- **Review 流程**：Trunk-based，直接提交 main，无强制 PR review（开源协作仍可通过 PR 贡献）
- **测试要求**：核心逻辑 + 关键流程需验证。`packages/core` 使用 vitest 编写单测（`pnpm test`）；关键用户流程（打开会话、工具调用、模型切换等）需手动或端到端验证
- **部署方式**：GitHub Actions 自动化（`.github/workflows/release.yml`）—— push tag `v*` 或手动触发 → electron-builder 构建 → 发布至 GitHub Releases（当前支持 macOS arm64 / Windows）

## 补充说明

- 项目采用 **pnpm workspace** 多包架构，`packages/core` 被其他包以 `workspace:*` 引用，修改 core 后需 `pnpm run build` 重新编译（dev 模式下 core 可 `tsc --watch`）。
- 开发启动：`pnpm run dev`（tsx 调度多包）；完整构建：`pnpm run build`；打包安装包：`pnpm run package`。
- macOS 安装包未签名，需 `xattr -cr` 解除隔离（见 `LOCAL_MAC_INSTALL.md`）；本地签名/安装脚本见 `scripts/sign-mac-local.mjs`、`scripts/install-mac-local.mjs`。
- `postinstall` 会自动修复 node-pty 权限并准备 Electron dev app，环境变更后注意执行。
- AI 相关代码集中在 `packages/core`：会话循环、工具系统、模型协议适配、MCP 集成、权限控制 —— 新增 AI 能力优先在此扩展。
