# Pi Web

[English](./README.md)

[pi 编程智能体](https://github.com/earendil-works/pi)的本地浏览器工作区。项目、会话、正在运行的智能体和 Git worktree 放在同一个界面里，与 pi TUI 共用 `~/.pi/agent` 配置和 JSONL 会话文件。

```bash
npx @agegr/pi-web@latest
```

需要 Node.js 22.19.0 或更高。服务就绪后会打开浏览器，默认只监听 `127.0.0.1`。

中文微信群：[GitHub Discussions](https://github.com/agegr/pi-web/discussions/271)。

![Pi Web 桌面工作区：项目侧栏、带工具活动的对话、右侧上下文卡片](./docs/pi-web-workspace.png)

- **项目与会话** — 搜索、置顶、归档、重命名、导出或删除，都在侧栏完成。
- **实时智能体** — 流式 thinking 与工具调用；其他项目里的任务结束也会提示。
- **子代理可视化** — 顶栏的实时递归子代理会话树、同工作区的只读子会话正文，以及经由所属根会话转发的引导 / 暂停（可恢复）/ 继续控制。需要带 `runStatus` RPC 能力的 `pi-subagents` 版本；旧版本仍可浏览完整只读历史。
- **浏览器里配模型和技能** — Provider、OAuth、API Key、技能和插件都写在 pi 的本地存储里。
- **Git worktree** — 创建、切换、移除 linked checkout，同一仓库的会话仍归在一起。

## 安装

```bash
npx @agegr/pi-web@latest
```

浏览器没打开时访问 [http://127.0.0.1:30141](http://127.0.0.1:30141)。到**设置 → 模型**登录或添加 API Key。

```bash
npm install -g @agegr/pi-web@latest
pi-web
```

## 远程访问

监听非回环地址等于把能在本机跑工具的智能体暴露出去。未设置 `PI_WEB_PASSWORD` 时，Pi Web **拒绝** `--hostname 0.0.0.0`。用户名固定为 `pi`。

```bash
PI_WEB_PASSWORD='足够长的随机密码' pi-web --hostname 0.0.0.0
```

Basic Auth 不加密传输。不要用明文 HTTP 把 Pi Web 放到公网。请走可信反向代理的 HTTPS，或 VPN。额外主机名写进 `PI_WEB_ALLOWED_HOSTS`。

| 选项 | 用途 | 默认 |
| --- | --- | --- |
| `-p` / `PORT` | 端口 | `30141` |
| `-H` / `PI_WEB_HOSTNAME` | 监听地址 | `127.0.0.1` |
| `--no-open` / `PI_WEB_NO_OPEN=1` | 不自动开浏览器 | 自动打开 |
| `PI_WEB_ALLOWED_HOSTS` | 额外精确主机名 | 未设置 |
| `PI_WEB_PASSWORD` | HTTP Basic Auth（用户 `pi`） | 关闭 |
| `PI_CODING_AGENT_DIR` | Pi 数据目录 | `~/.pi/agent` |

## 数据与安全

- 与 pi 共用本地数据。模型改动两边都能看见。
- 文件访问只限已知项目和会话根目录，不是整盘浏览器。
- 需要信任的项目扩展在明确授权前保持受限。
- Worktree：[docs/worktrees.zh-CN.md](./docs/worktrees.zh-CN.md)。

## 技术栈

React 19 + Vite + [TanStack Start](https://tanstack.com/start)（Router）。界面原本基于 Next.js App Router；路由、SSR 与发布管线现已迁移到 TanStack —— 发布门禁 `pack:tanstack` 见 [docs/release.md](./docs/release.md)。

## 开发

```bash
npm install
npm run dev    # http://127.0.0.1:30141
npm test && npx tsc --noEmit && npm run lint
```

发布门禁：`npm run pack:tanstack`。说明：[docs/i18n.md](./docs/i18n.md)、[docs/release.md](./docs/release.md)、[AGENTS.md](./AGENTS.md)。

## 许可证

[MIT](./LICENSE)
