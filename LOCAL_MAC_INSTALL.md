# macOS 本地打包、安装与签名

当需要把当前工作区打成 macOS app、替换到 `/Applications`，并使用
Pudding-Agent 的本地专用证书签名时，使用这份流程。

## 一键流程

```sh
corepack pnpm mac:install-local
```

这个命令会完成三件事：

1. 构建 unsigned macOS `.app` 目录（禁用 electron-builder 自动签名和在线 timestamp）。
2. 用 `out/mac-arm64/Pudding-Agent.app` 替换 `/Applications/Pudding-Agent.app`。
3. 使用 `Pudding Dedicated Local Code Signing` 执行本地离线签名（`--timestamp=none`）。

安装步骤默认会清除 `com.apple.quarantine`，并重置 macOS TCC 中的
AppleEvents、Accessibility、ScreenCapture 权限记录。重新打开 app 后，
macOS 可能会再次弹出相关权限确认，这是正常现象。

## 常用选项

复用已有打包产物，不重新打包：

```sh
corepack pnpm mac:install-local -- --skip-package
```

替换到指定 app 路径：

```sh
corepack pnpm mac:install-local -- --app /Applications/Pudding-Agent.app
```

从指定打包产物安装：

```sh
corepack pnpm mac:install-local -- --source /path/to/Pudding-Agent.app
```

保留已有 TCC 权限记录：

```sh
corepack pnpm mac:install-local -- --no-reset-tcc
```

只对已安装 app 重新执行 local 签名：

```sh
corepack pnpm mac:sign-local -- --app /Applications/Pudding-Agent.app --clear-quarantine
```

## 本地签名信息

签名脚本会创建并复用一个专用 keychain：

```text
~/Library/Keychains/pudding-local-codesign.keychain-db
```

默认签名证书名称：

```text
Pudding Dedicated Local Code Signing
```

默认钥匙串密码：

```text
pudding-local-codesign
```

如果 macOS 弹出 `"codesign" 想使用 "pudding-local-codesign" 钥匙串`，输入上面的默认密码即可。只有设置了 `PUDDING_LOCAL_SIGN_KEYCHAIN_PASSWORD` 环境变量时，才使用自定义密码。

可以通过环境变量覆盖这些默认值：

```sh
PUDDING_LOCAL_SIGN_CERT="Custom Local Code Signing" \
PUDDING_LOCAL_SIGN_KEYCHAIN="$HOME/Library/Keychains/custom.keychain-db" \
PUDDING_LOCAL_SIGN_KEYCHAIN_PASSWORD="change-me" \
corepack pnpm mac:install-local
```
