# Pi Web

[English](./README.md) | [日本語](./README.ja.md) | [Русский](./README.ru.md)

[pi 编程智能体](https://github.com/earendil-works/pi)的本地浏览器界面。Pi Web 与 pi 共用本机配置和会话文件，可在浏览器中查找和继续对话、运行智能体、配置模型与资源，并查看项目文件。

中文微信群：请查看 [GitHub Discussions 帖子](https://github.com/agegr/pi-web/discussions/271)。

![Pi Web 展示包含结构化 Markdown、工具调用和项目导航的 pi 会话](https://raw.githubusercontent.com/agegr/pi-web/main/docs/screenshot2.png)

## 功能

- **会话工作区**：按项目查找、继续、重命名、导出和删除对话，并查看运行状态、上下文占用、花费和压缩信息。
- **两种分支方式**：**新会话**会从较早的消息创建独立会话文件；**从此处编辑**会在当前会话内创建分支。
- **项目文件工具**：浏览和上传文件、查看 Git Diff，并预览源码、Markdown、图片、音频、PDF 和 DOCX；文件变化后会自动刷新。
- **Git worktree**：从侧边栏切换 checkout，同时把同一仓库不同 worktree 的会话归在一起。
- **网页配置**：无需离开 Pi Web，即可管理 Provider 登录和 API Key、模型、模型测试、插件包及技能。
- **英文和简体中文界面**：Pi Web 首次打开时跟随浏览器语言，也可从顶部栏切换语言。

## 快速开始

Pi Web 要求 Node.js 22.19.0 或更高版本。先用 `node --version` 检查版本，然后运行：

```bash
npx @agegr/pi-web@latest
```

服务就绪后，命令行会尝试自动打开浏览器。如果没有打开，请访问 [http://127.0.0.1:30141](http://127.0.0.1:30141)。Pi Web 默认仅监听 `127.0.0.1`。

如果尚未配置模型 Provider，请打开**模型（Models）**面板登录或添加 API Key。

如需全局安装 `pi-web` 命令：

```bash
npm install -g @agegr/pi-web@latest
pi-web
```

更新前先用 `Ctrl+C` 停止正在运行的进程，再次执行同一条安装命令。卸载时运行 `npm uninstall -g @agegr/pi-web`。

## 配置

端口和主机名以命令行参数为准，优先于对应的环境变量。`--no-open` 与 `PI_WEB_NO_OPEN=1` 中任意一个都会关闭自动打开浏览器。

| 参数或环境变量 | 用途 | 默认值 |
| --- | --- | --- |
| `--port <端口>`、`-p <端口>` 或 `PORT` | 服务端口 | `30141` |
| `--hostname <主机>`、`-H <主机>` 或 `PI_WEB_HOSTNAME` | 监听主机名（如 `127.0.0.1`、`0.0.0.0` 或你的 Tailscale 地址） | `127.0.0.1` |
| `--no-open` 或 `PI_WEB_NO_OPEN=1` | 不自动打开浏览器 | 自动打开 |
| `PI_WEB_ALLOWED_HOSTS` | 额外允许的代理或自定义主机名，多个值用逗号分隔，必须精确匹配 | 未设置 |
| `PI_WEB_PASSWORD` | 锁定 Basic Auth 密码（用户名固定为 `pi`）。未设置时，服务会在第一次网络请求时自动生成 6 位 PIN 并写入 `~/.pi-web/`，跨重启保留。 | 自动生成 6 位 PIN |

例如：

```bash
pi-web -p 8080 -H 0.0.0.0 --no-open
```

### 远程访问

监听非回环地址会暴露一个可执行高权限操作的智能体。Basic Auth 不会加密传输中的密码——不要通过明文 HTTP 将 Pi Web 暴露到互联网；远程访问应使用可信反向代理提供 HTTPS，或通过可信 VPN。如果反向代理传递外部主机名，请把该名称精确加入 `PI_WEB_ALLOWED_HOSTS`。这个白名单不会改变 Pi Web 的监听地址。

默认情况下**不设置密码**。第一次有网络请求到达 Pi Web 时，服务会自动生成一个 6 位 PIN 写入运行存储（跨重启保留）。在顶栏点击 **连接手机** 图标即可看到当前 PIN；弹窗里的二维码还内置了一次性配对令牌，手机扫码后直接进 Pi Web，无需输密码。

若想使用自己的密码而非自动生成的，配置 `PI_WEB_PASSWORD` 环境变量即可：

```bash
PI_WEB_PASSWORD='你的密码' pi-web --hostname 0.0.0.0
```

### 手机访问

`http://127.0.0.1:30141` 只在运行 Pi Web 的电脑上有效——在手机上，`127.0.0.1` 指的是手机自己。请改用电脑的真实地址：

**同一 Wi-Fi。** 监听所有接口，然后在手机上打开 `http://<电脑局域网IP>:30141`：

```bash
pi-web --hostname 0.0.0.0
```

顶栏 **连接手机** 弹窗的二维码编码了地址加一次性配对令牌，手机扫码直接进入桌面端会话，**无需输密码**。

**任意网络，通过 Tailscale。** 在电脑和手机上都安装 Tailscale 并加入同一个 tailnet，然后监听 tailnet 地址（用 `tailscale ip -4` 查询本机的 100.x 地址）：

```bash
pi-web --hostname 100.x.x.x
```

当使用 `-H 0.0.0.0` 时，启动器会自动查询 Tailscale IP，二维码编码这个地址，手机直接能扫。Tailscale 客户端：[iOS](https://apps.apple.com/us/app/tailscale/id1470499037) · [Android](https://play.google.com/store/apps/details?id=com.tailscale.ipn)。想分享给别人，把对方邀请进同一个 tailnet，再把地址发给他即可。

**手机端认证。** 只有手机直接填 URL（不通过扫码）访问时才会被要求输入 6 位 PIN。走二维码路径会跳过这一步——首次扫码时配对令牌会自动兑换成 30 天的会话 cookie。cookie 跨服务重启持续有效（因为签名密钥存放在 `~/.pi-web/session.key`），但当服务的 `PI_WEB_PASSWORD` 值变更时会失效。

### 手机访问

`http://127.0.0.1:30141` 只在运行 Pi Web 的电脑上有效——在手机上，`127.0.0.1` 指的是手机自己。请改用电脑的真实地址：

**同一 Wi-Fi。** 监听局域网地址，然后在手机上打开 `http://<电脑局域网IP>:30141`：

```bash
PI_WEB_PASSWORD='你的密码' pi-web --hostname 0.0.0.0
```

**任意网络，通过 Tailscale。** 在电脑和手机上都安装 Tailscale 并加入同一个 tailnet，然后监听 tailnet 地址（用 `tailscale ip -4` 查询本机的 100.x 地址）：

```bash
PI_WEB_PASSWORD='你的密码' pi-web --hostname 100.x.x.x
```

在手机上打开 `http://<tailscale-ip>:30141`。Tailscale 客户端：[iOS](https://apps.apple.com/us/app/tailscale/id1470499037) · [Android](https://play.google.com/store/apps/details?id=com.tailscale.ipn)。想分享给别人，把对方邀请进同一个 tailnet，再把地址发给他即可。

监听非回环地址时，务必设置 `PI_WEB_PASSWORD`。首次登录成功后，浏览器会保留一个 30 天的会话 cookie——cookie 过期、清空浏览器数据或换设备时才会再次询问密码。

### HTTP 代理

服务端的模型和 API 请求会读取标准的 `HTTP_PROXY`、`HTTPS_PROXY` 和 `NO_PROXY` 环境变量。

macOS 或 Linux：

```bash
HTTP_PROXY=http://127.0.0.1:7890 \
HTTPS_PROXY=http://127.0.0.1:7890 \
NO_PROXY=localhost,127.0.0.1 \
npx @agegr/pi-web@latest
```

Windows PowerShell：

```powershell
$env:HTTP_PROXY = "http://127.0.0.1:7890"
$env:HTTPS_PROXY = "http://127.0.0.1:7890"
$env:NO_PROXY = "localhost,127.0.0.1"
npx @agegr/pi-web@latest
```

## 注意事项

- **智能体数据**：Pi Web 默认读取 `~/.pi/agent` 下的 pi 数据，包括 `sessions/<编码后的工作目录>/<时间戳>_<uuid>.jsonl` 中的会话文件。可通过 `PI_CODING_AGENT_DIR` 指定其他 pi agent 目录。
- **文件系统访问**：Pi Web 必须能读取智能体数据目录及会话记录中的工作目录。与现有 pi 会话共用数据时，请让 Pi Web 运行在与 pi 相同的文件系统环境中。
- **共享配置**：模型面板使用 pi 的模型、设置和凭据存储，因此两种界面都能看到相关更改。
- **文件访问边界**：文件浏览器仅能访问在 Pi Web 中选择过的工作目录，以及它已识别的项目或会话根目录；它不是通用的文件系统浏览器。
- **Git worktree**：切换器何时显示、如何创建 worktree，以及删除会产生什么影响，见 [Pi Web 里的 Worktree](./docs/worktrees.zh-CN.md)。

## 开发

```bash
npm install
npm run dev
```

开发服务器运行在 [http://127.0.0.1:30141](http://127.0.0.1:30141)。常用检查命令：

```bash
npm test
node_modules/.bin/tsc --noEmit
npm run lint
```

日常开发时不要运行 `next build` 或 `npm run build`。它们会写入 `.next/`，可能干扰开发服务器；仅在发布流程中执行构建。

### 与上游同步

本仓库 fork 自 [`agegr/pi-web`](https://github.com/agegr/pi-web)。标准同步流程（4 步）：

```bash
git checkout main
git upsync              # fetch + merge + push 一行搞定
npm install             # 同步依赖（可能修改 package-lock.json，一并 commit）
# 重启 dev server（如果之前在跑）—— 老进程会因 react/react-dom 版本漂移报 500
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:30141/   # 应输出 200
```

`git upsync` 是仓库级 alias（写在 `.git/config`，不在用户全局配置里），需要在 `main`/`master` 分支上才能跑。upstream 的 push URL 已设为占位符 `no-pushing-to-upstream`，即使 alias 误拼也不会推回上游。

如果 alias 不存在（例如新克隆的仓库），重新加上：

```bash
git config alias.upsync '!f() { current=$(git rev-parse --abbrev-ref HEAD); if [ "$current" != "main" ] && [ "$current" != "master" ]; then echo "upsync: must be on main or master (currently on $current)" >&2; return 1; fi; git fetch upstream --prune --tags && git merge upstream/main --no-ff -m "Merge upstream main" && git push origin HEAD; }; f'
```

#### 已知坑

- **AGENTS.md 自动追加**：Next.js 16 每次 `next dev` 都会往 `AGENTS.md` 末尾追加一段 `<!-- BEGIN:nextjs-agent-rules -->`。那段注释里自己说了 *"committing it with your work keeps the tree clean"*，所以**要 commit 它**。删了下次还会被加回来。

- **package-lock.json 会被 `npm install` 改写**：正常，跟代码改动一起 commit。

- **约 40 个 pre-existing 测试失败**：`npm test` 的 ~40 个失败与同步无关，是项目长期累积问题，不要在同步时一并修。根因分类：模块扩展名（fork 引入的 `web-auth.ts`）、symlink 权限（Windows）、`I18nProvider` 缺失（测试 setup）等。

- **dev server 必须重启**：`npm install` 后老 `next dev` 进程内的 react 和 react-dom 可能被漂移到不同补丁版本（`react@19.2.8` vs `react-dom@19.2.4`），症状是 webui 返回 500。必须杀掉进程、清 `.next/dev` 缓存、重启：

  ```bash
  cmd //c "taskkill /F /PID <dev-server-pid>"   # git bash 下用 //c 避免路径被转义
  rm -rf .next/dev
  npm run dev:lan
  ```

- **合并冲突**：本 fork 历史上冲突主要落在 `bin/pi-web.js`（保留 HEAD）和 `package-lock.json`（接受上游）。其他文件按"fork 独立特性 → 留 HEAD、上游纯维护性改动 → 接受上游"的策略解决。

贡献者文档：[国际化](./docs/i18n.md)和[发布流程](./docs/release.md)。

## 仓库结构

```text
app/             Next.js 界面和 API 路由
components/      React 界面组件
hooks/           客户端状态和交互 hooks
lib/             会话、智能体、模型、文件、Git 和安全逻辑
public/          静态资源和 PWA 文件
bin/             npm CLI 入口及启动参数解析
docs/            面向用户和贡献者的专题文档
```

架构说明和详细文件地图见 [AGENTS.md](./AGENTS.md)。

## 许可证

[MIT](./LICENSE)
