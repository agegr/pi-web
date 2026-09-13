# 使用 Pi Web 开发 Pi Web（防卡死工作流）

当 Pi Web 的代码正在被 Pi 修改时，**不要把同一个开发中的 Pi Web 页面同时当作聊天控制台和效果预览页**。代码热更新可能会重建页面或中断流式聊天连接，表现为页面卡住、一直转圈或消息无法继续显示。

推荐把“控制 Pi”和“查看修改效果”分开，使用两个独立进程。

## 两个页面各做一件事

| 角色 | 地址 | 用途 |
| --- | --- | --- |
| 开发预览页 | `http://127.0.0.1:30141` | 运行当前源码、查看和验收修改效果。不要依赖它持续和 Pi 聊天。 |
| 稳定控制台 | `http://127.0.0.1:30142` | 使用已发布的稳定版 Pi Web 与 Pi 聊天，让 Pi 修改当前源码。 |

两个实例都使用同一台电脑上的 `~/.pi/agent` 数据，因此模型设置、凭据和会话数据可以共用。不要在两个页面同时向同一个会话发送消息。

## 启动身份和模型预检

开发预览必须使用与 `~/.pi/agent` 所属用户相同的本机 Windows 用户启动。Pi 的模型运行时会在读取凭据时创建 `auth.json.lock`；只有读取权限、没有写入权限的沙箱或服务账号会触发 `EPERM`，随后页面会显示“Model list is temporarily unavailable”。

因此，不要从 Codex 沙箱、受限服务账号或只读挂载中启动 `30141`。请在普通 PowerShell 或 Windows Terminal 中运行上面的 `npm run dev`，并确认：

```powershell
whoami
$env:USERPROFILE
Get-Acl (Join-Path $env:USERPROFILE ".pi\agent") | Select-Object Owner, AccessToString
```

启动后先检查模型接口，再打开预览页面：

```powershell
$cwd = [uri]::EscapeDataString((Get-Location).Path)
$models = Invoke-RestMethod "http://127.0.0.1:30141/api/models?cwd=$cwd"
if ($models.modelError) { throw "模型接口异常：$($models.modelError)" }
if (@($models.modelList).Count -eq 0) { throw "模型接口返回空列表，请检查 ~/.pi/agent 权限和模型配置。" }
"可用模型：$(@($models.modelList).Count)"
```

如果错误中出现 `EPERM`、`operation not permitted` 或 `auth.json.lock`，先停止当前服务，再回到普通本机 PowerShell 重启；不要先删除 `auth.json`、重新登录或修改模型配置。这个错误通常是启动身份不对，而不是模型配置丢失。

## 启动方式

### 1. 启动当前源码的开发预览页

在第一个 PowerShell 窗口运行：

```powershell
cd "D:\pi Agent\pi-web-source"
npm run dev
```

访问 `http://127.0.0.1:30141`。这是唯一允许从此源码目录启动的 `next dev` 进程；不要为了换端口再启动第二个 `next dev`，它们会争用 `.next/dev/lock`。

### 2. 启动稳定控制台

在第二个 PowerShell 窗口运行：

```powershell
npx @agegr/pi-web@latest -- -p 30142 --no-open
```

访问 `http://127.0.0.1:30142`。在此页面创建或打开 Pi 会话，并将工作目录设为：

```text
D:\pi Agent\pi-web-source
```

之后所有“请修改代码”的请求都在 30142 发出；所有效果验收在 30141 进行。

## 预览必须加载当前源码

`30141` 是开发预览，不是生产站点。它必须直接加载当前工作区的源码和 Turbopack 资源，并且**不能注册或继续使用生产版 Service Worker**。

这条规则是为避免 2026 年 9 月 12 日出现过的“源码已经修改，但页面仍显示旧文件浏览器和旧只读预览”问题：浏览器之前在同一个 `127.0.0.1:30141` 来源下保留了生产 Service Worker，Service Worker 又从 Cache Storage 返回旧的 `/_next/static/` 资源，所以服务器虽然已经是新代码，页面却没有更新。

项目现在在开发环境的 `app/layout.tsx` 中启动一次性清理：注销旧 Service Worker、删除 `pi-web-*` Cache Storage，然后刷新页面。`components/PwaRegistration.tsx` 只允许在生产环境注册 `public/sw.js`。这两层保护必须保留，不能为了“离线可用”而让开发环境注册生产 worker。

每次修改后的验收按下面顺序进行：

1. 在 `30141` 执行一次普通刷新；如果页面仍像旧版本，先清理该站点的 Service Worker 和 Cache Storage，再刷新。
2. 确认页面中的 UI 变化与当前工作区文件一致，再开始功能验收。
3. 如果清理后仍无变化，才检查 `30141` 的服务器日志、HMR/Turbopack 报错和接口响应；不要先运行 `next build`，也不要启动第二个 `next dev`。

开发预览和生产运行时可以使用不同的构建方式，但验收结论必须来自当前源码对应的实例。看到旧页面时，先按“浏览器资源缓存问题”排查，而不是把它判断为代码没有生效。

## 给 Pi 的建议请求

可以在每个任务中附上：

> 你正在修改 Pi Web 自身。开发预览在 30141，聊天控制台在 30142。修改前先说明计划；修改后不要运行 build，运行 typecheck 和 lint，并告诉我如何在 30141 验收。

常用检查：

```powershell
node_modules/.bin/tsc --noEmit
npm run lint
npm test
```

开发期间不要运行 `npm run build` 或 `next build`；它们会写入 `.next`，可能影响正在运行的开发服务器。

## 页面卡住时

1. 先确认卡住的是 30141（预览）还是 30142（控制台）。
2. 如果只有 30141 卡住，保持 30142 的对话不动，在 30142 告诉 Pi 检查刚才的修改；先刷新 30141。
3. 如果浏览器出现 HMR/Turbopack 模块错误，先显式刷新该页面；这不一定表示源代码或服务器已经坏了。
4. 如果 30142 也无法继续，保留两个 PowerShell 窗口，记录终端末尾的红色报错和卡住时的页面表现，再排查。
5. 不要因为单个浏览器页面卡住就立刻运行 build、切换到 Webpack，或为同一个源码目录启动第二个开发服务器。

## 为什么这样更稳定

30142 运行的是与源码分开的、稳定的已发布 Pi Web。即使 Pi 修改了当前源码导致 30141 重载、报错或暂时不可用，30142 与 Pi 的聊天连接不受这次源码热更新影响，仍可继续要求 Pi 修复问题。
