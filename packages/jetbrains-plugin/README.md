# Pudding-Agent — JetBrains Plugin

JetBrains IDE 与 Pudding-Agent 桌面应用之间的双向通信插件。

## 功能

- **代码选中同步** — 在 IDE 中选中代码，Pudding-Agent 自动获取作为 AI 上下文（隐式注入，不显示在对话中）
- **活跃文件追踪** — Pudding-Agent 始终知道你当前正在编辑的文件
- **@引用** — 右键菜单 "Send to Pudding-Agent (@)" 将文件/代码段发送给 AI
- **文件跳转** — Pudding-Agent 可在 IDE 中打开文件并跳转到指定行

## 兼容性

支持所有基于 IntelliJ Platform 2023.1+ 的 IDE:

- IntelliJ IDEA (Community / Ultimate)
- WebStorm
- PyCharm
- GoLand
- CLion
- PhpStorm
- RubyMine
- Rider
- DataGrip
- Android Studio

## 安装

1. 从 [GitHub Releases](https://github.com/6324fans/Pudding-Agent/releases) 下载最新的 `pudding-agent-x.x.x.zip` 文件
2. 打开 IDE → Settings → Plugins → ⚙️ → Install Plugin from Disk...
3. 选择下载的 .zip 文件
4. 重启 IDE

## 使用

1. 安装插件后重启 IDE
2. 打开项目（与 Pudding-Agent 中的项目路径一致）
3. 启动 Pudding-Agent 桌面应用并打开相同项目
4. 自动连接 — Pudding-Agent Composer 底部状态栏显示绿色圆点 + 当前 IDE 名称

### 代码选中

在 IDE 中选中代码后，Pudding-Agent 底部状态栏会显示当前文件名和选中行范围。发送消息时，选中的代码会作为隐式上下文传给 AI（一次性，不保存到对话历史）。

### 右键菜单

在编辑器中选中代码 → 右键 → "Send to Pudding-Agent (@)"

## 工作原理

插件启动时在本地随机端口启动 WebSocket 服务器（基于 Ktor），并写入 lockfile 到 `~/.puddingagent/ide/<port>.lock`。Pudding-Agent 桌面应用每 5 秒扫描该目录，匹配项目路径后自动连接。通信使用 JSON-RPC 2.0 协议。

插件会监听项目打开/关闭事件，自动更新 lockfile 中的 workspaceFolders。

## 故障排查

**连接不上?**
- 确认 Pudding-Agent 和 IDE 打开的是**同一个项目路径**
- 检查 `~/.puddingagent/ide/` 目录下是否有 `.lock` 文件
- 在 Pudding-Agent 中切换到对应项目的会话
- 重启 IDE

**残留 lockfile?**
- Pudding-Agent 会自动清理无效的 lockfile（检测 PID 存活）
- 手动清理: `rm ~/.puddingagent/ide/*.lock`

## 开发

需要 JDK 17：

```bash
cd packages/jetbrains-plugin
export JAVA_HOME=/opt/homebrew/opt/openjdk@17  # macOS
./gradlew buildPlugin    # 构建，输出在 build/distributions/
./gradlew runIde         # 在沙盒 IDE 中运行
```
