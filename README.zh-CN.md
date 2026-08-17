# Pi Web

[English](./README.md) · [日本語](https://github.com/agegr/pi-web/blob/main/README.ja.md) · [Русский](https://github.com/agegr/pi-web/blob/main/README.ru.md)

[pi 编程智能体](https://github.com/earendil-works/pi)的本地浏览器工作区。项目、会话、正在运行的智能体、文件和 Git worktree 放在同一个界面里，与 pi TUI 共用 `~/.pi/agent` 配置和 JSONL 会话文件。

对外安装包是 [`@agegr/pi-web`](https://www.npmjs.com/package/@agegr/pi-web)。本仓库跟随 [agegr/pi-web](https://github.com/agegr/pi-web)。

```bash
npx @agegr/pi-web@latest
```

需要 Node.js 22.19.0 或更高。服务就绪后会打开浏览器，默认只监听 `127.0.0.1`。

中文微信群：[GitHub Discussions](https://github.com/agegr/pi-web/discussions/271)。

![Pi Web 桌面工作区：项目侧栏、带工具活动的对话、右侧上下文卡片](./docs/pi-web-workspace.png)

## 功能

- **项目与会话** — 搜索、置顶、归档、重命名、导出或删除，都在侧栏完成。存储仍是 `~/.pi/agent` 下与 pi 兼容的 JSONL。
- **实时智能体** — 流式 thinking 与工具调用、折叠的回合过程、停转后仍保留的对话计划；其他项目里的任务结束也会提示。
- **排队与插话** — 智能体运行时，Enter 把后续消息排队；实心发送钮插话当前回合。停止是单独的线框按钮。
- **两种分支** — **分叉**从某条消息写出独立会话文件；**从此处编辑**在当前会话内建分支。
- **子代理可视化** — 顶栏的实时递归子代理树、同工作区的只读子会话正文，以及经由所属根会话转发的引导 / 暂停（可恢复）/ 继续。需要带 `runStatus` 的 `pi-subagents`；旧版本仍可浏览完整只读历史。
- **对话旁的文件** — 浏览和上传、查看 Git Diff，预览源码、Markdown、图片、音频、PDF 和 DOCX，文件变化后自动刷新。
- **Git worktree** — 创建、切换、移除 linked checkout，同一仓库的会话仍归在一起。
- **浏览器里配置** — Provider、OAuth、API Key、模型、技能、插件、外观、项目信任，以及**远程访问**。改动写在 pi 的本地存储里，两边 UI 都能看见。

## 安装

```bash
npx @agegr/pi-web@latest
```

浏览器没打开时访问 [http://127.0.0.1:30141](http://127.0.0.1:30141)。到**设置 → 模型**登录或添加 API Key。

```bash
npm install -g @agegr/pi-web@latest
pi-web
```

更新前先用 `Ctrl+C` 停掉进程，再跑同一条安装命令。卸载：`npm uninstall -g @agegr/pi-web`。

## 配置

命令行选项优先于对应的环境变量。

| 选项或环境变量 | 用途 | 默认 |
| --- | --- | --- |
| `--port` / `-p` / `PORT` | 端口 | `30141` |
| `--hostname` / `-H` / `PI_WEB_HOSTNAME` | 监听地址 | `127.0.0.1` |
| `--no-open` / `PI_WEB_NO_OPEN=1` | 不自动开浏览器 | 自动打开 |
| `PI_WEB_ALLOWED_HOSTS` | 额外精确主机名 | 未设置 |
| `PI_WEB_PASSWORD` | HTTP Basic Auth（用户 `pi`） | 关闭 |
| `PI_CODING_AGENT_DIR` | Pi 数据目录 | `~/.pi/agent` |

```bash
pi-web -p 8080 -H 0.0.0.0 --no-open
```

### 远程访问

先在本机打开 [http://127.0.0.1:30141](http://127.0.0.1:30141)，到**设置 → 远程访问**填写反向代理会放进 `Host` 头的域名，并设置至少 12 位密码。Pi Web 继续只听回环地址，HTTPS 由反代终止。请保留 `Host`，并关闭响应缓冲，以免事件流被卡住。

监听非回环地址等于把能在本机跑工具的智能体暴露出去。未配置密码时，Pi Web **拒绝** `--hostname 0.0.0.0`。用户名固定为 `pi`。

```bash
PI_WEB_PASSWORD='足够长的随机密码' pi-web --hostname 0.0.0.0
```

Basic Auth 不加密传输。不要用明文 HTTP 把 Pi Web 放到公网。请走可信反向代理的 HTTPS，或 VPN。`PI_WEB_PASSWORD` 会覆盖设置里保存的密码。`PI_WEB_ALLOWED_HOSTS` 里的额外主机名会与设置列表合并。

### HTTP 代理

服务端的模型和 API 请求遵守 `HTTP_PROXY`、`HTTPS_PROXY`、`NO_PROXY`。

```bash
HTTP_PROXY=http://127.0.0.1:7890 \
HTTPS_PROXY=http://127.0.0.1:7890 \
NO_PROXY=localhost,127.0.0.1 \
npx @agegr/pi-web@latest
```

```powershell
$env:HTTP_PROXY = "http://127.0.0.1:7890"
$env:HTTPS_PROXY = "http://127.0.0.1:7890"
$env:NO_PROXY = "localhost,127.0.0.1"
npx @agegr/pi-web@latest
```

## 数据与安全

- 与 pi 共用本地数据。模型改动两边都能看见。
- 文件访问只限已知项目和会话根目录，不是整盘浏览器。
- 需要信任的项目扩展在明确授权前保持受限。
- Worktree：[docs/worktrees.zh-CN.md](./docs/worktrees.zh-CN.md)。

### 下游会话右键菜单

桌面壳可以替换会话行的原生右键菜单，不必改侧栏。监听可取消的 `pi-web:session-row-contextmenu`，若由你处理则同步调用 `preventDefault()`：

```js
window.addEventListener("pi-web:session-row-contextmenu", (event) => {
  event.preventDefault();
  const { id, path, cwd, name, clientX, clientY, refresh } = event.detail;
  void openSessionMenu({ id, path, cwd, name, clientX, clientY }).then((changed) => {
    if (changed) refresh();
  });
});
```

没有监听器取消时，Pi Web 保留浏览器原生菜单。

## 技术栈

React 19 + Vite + [TanStack Start](https://tanstack.com/start)（Router + Nitro Node server）。界面原本基于 Next.js App Router；路由、SSR 与发布管线现已迁到 TanStack。发布门禁 `pack:tanstack` 见 [docs/release.md](./docs/release.md)。

## 开发

```bash
npm install
npm run dev    # http://127.0.0.1:30141
npm test && npx tsc --noEmit && npm run lint
```

日常开发不要跑 `npm run build` 或 `npm run pack:tanstack` —— 生产输出写在仓库外，会干扰 `npm run dev`。发布门禁：`npm run pack:tanstack`。

说明：[docs/i18n.md](./docs/i18n.md)、[docs/release.md](./docs/release.md)、[AGENTS.md](./AGENTS.md)。

```text
app/api/         框架中立的 API handler（Request / Response）
src/routes/      TanStack 页面与薄 API 适配
components/      工作区、对话、设置、文件
hooks/           客户端会话与 UI 状态
lib/             会话、agent RPC、模型、Git、安全
bin/             CLI 入口
docs/            用户与贡献者说明
```

## 许可证

[MIT](./LICENSE)
