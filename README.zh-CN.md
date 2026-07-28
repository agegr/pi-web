# Pi Web

[English](./README.md) | [日本語](./README.ja.md)

[pi 编程智能体](https://github.com/badlogic/pi-mono) 的本地网页界面。它会读取本机的 pi 会话文件，在浏览器里提供会话管理、实时对话、模型配置、技能管理和项目文件预览。

中文微信群：请查看 [GitHub Discussions 帖子](https://github.com/agegr/pi-web/discussions/271)。

## 快速开始

Pi Web 要求 Node.js 22.19.0 或更高版本。可通过 `node --version` 检查当前版本。

**无需安装，直接运行：**

```bash
npx @agegr/pi-web@latest
```

**或全局安装 npm 包后使用：**

```bash
npm install -g @agegr/pi-web
pi-web
```

如果只想在项目内安装，可运行 `npm install @agegr/pi-web`，然后使用 `npx pi-web`。

启动后打开 [http://127.0.0.1:30141](http://127.0.0.1:30141)。命令行版本会在服务就绪后尝试自动打开浏览器。Pi Web 默认仅监听 `127.0.0.1`。

**可选参数：**

```bash
pi-web --port 8080              # 自定义端口
pi-web --hostname 0.0.0.0       # 在可信网络中开放访问
pi-web -p 8080 -H 0.0.0.0       # 组合使用
pi-web --no-open                # 不自动打开浏览器

PORT=8080 pi-web                # 也支持环境变量
PI_WEB_HOSTNAME=0.0.0.0 pi-web  # 显式开放网络访问
PI_WEB_ALLOWED_HOSTS=pi-web.internal pi-web  # 允许指定的代理或自定义主机名
PI_WEB_NO_OPEN=1 pi-web         # 适用于后台服务或开机自启
```

API 请求仅接受 loopback 名称、IP 字面量、当前监听主机名，以及 `PI_WEB_ALLOWED_HOSTS` 中以逗号分隔的精确主机名。可信反向代理使用不同的外部主机名时，请配置该变量。

## 公网部署与认证

Pi Web 现在默认要求认证。首次启动时，初始化 token 只会在服务端终端输出一次；打开网页后，在初始化页面输入该 token，并设置密码。token 不是密码，不能从浏览器或配置文件中恢复。

登录限速默认使用固定匿名来源桶，不信任客户端提交的代理请求头。如果 Pi Web 位于可信反向代理之后，且代理会覆盖并清理这些请求头，可设置 `PI_WEB_TRUSTED_PROXY=true`，启用 `X-Forwarded-For`/`X-Real-IP` 来源。只有在所有直连客户端都无法访问 Pi Web、且代理会清理伪造头时才应启用。

- 认证配置默认保存于 `~/.pi/agent/pi-web-auth.json`，也可以用 `PI_WEB_AUTH_CONFIG_PATH` 指定路径。
- pi Agent 的会话、模型和其他配置默认仍在 `~/.pi/agent/`；`PI_CODING_AGENT_DIR` 可以切换整个 pi Agent 目录。
- 忘记初始化 token 时，在本机停止 Pi Web、删除认证配置文件后重新启动，再从终端获取新的 token。只有能控制运行 Pi Web 的本机账户时才应执行此恢复操作；这会清除现有认证配置，随后必须重新设置密码。
- 如果服务端报告认证配置损坏，Pi Web 不会把它当作未初始化，也不会静默覆盖配置。请停止服务，先备份 stderr 输出的路径，再由本机操作者有意修复或删除该配置后重新初始化。
- 登录 session 有效期为 24 小时。修改密码会立即吊销已有 session，需要使用新密码重新登录。
- 认证 session 过期、浏览器断开连接或修改密码不会停止、销毁或中止后台 AgentSession；后台任务会继续运行，重新登录后可以查看结果。

### HTTPS 与反向代理

公网访问必须放在 HTTPS 反向代理之后，并让 Pi Web 只监听本机回环地址。启用 `PI_WEB_TRUSTED_PROXY=true` 时，必须阻断客户端直连 Pi Web，并由可信代理覆盖而不是追加客户端提交的 `X-Forwarded-For` header。下面的 Nginx 示例假定 TLS 证书已由你的证书管理工具配置：

```nginx
server {
    listen 443 ssl;
    server_name pi.example.com;

    ssl_certificate     /path/to/fullchain.pem;
    ssl_certificate_key /path/to/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:30141;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 1h;
    }
}
```

启动时使用 `--hostname 127.0.0.1`，允许代理使用的外部主机名，并启用可信代理来源识别，不要直接把 Pi Web 的 HTTP 端口暴露到公网：

```bash
PI_WEB_ALLOWED_HOSTS=pi.example.com PI_WEB_TRUSTED_PROXY=true pi-web --hostname 127.0.0.1 --port 30141 --no-open
```

Pi Web 依赖 SSE 推送 Agent 状态，因此反向代理必须支持长连接，并且不能缓冲响应。请同时限制防火墙入口、使用有效 TLS 证书，并避免把 `pi-web-auth.json`、Pi session 文件或模型 API key 暴露给 Web 服务器之外的用户。初始化 token 只会在服务端终端 stderr（或服务端日志）输出一次；不会出现在 HTTP response、浏览器、cookie 或配置文件中。

当前仓库没有内置 `Dockerfile`。如果自行制作容器镜像，必须把 Pi Agent 配置目录挂载到容器内，并通过 `PI_CODING_AGENT_DIR` 指向该挂载目录；认证配置也应使用持久化卷或显式设置 `PI_WEB_AUTH_CONFIG_PATH`，否则重建容器会丢失认证状态。不要把密码、初始化 token、session cookie 或 API key 写进镜像、Dockerfile、compose 文件或日志。

## HTTP 代理

Pi Web 的服务端模型请求和 API 请求会读取标准的 `HTTP_PROXY`、`HTTPS_PROXY` 和 `NO_PROXY` 环境变量。

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

## 功能介绍

- **把历史工作接回来**：打开网页就能按项目找到以前的 pi 对话，不必在终端里翻文件或记住会话路径。
- **放心试不同方向**：可以从某条历史消息重新开始，也可以复制出一条独立的新路线，探索方案时不怕弄乱原来的对话。
- **跨分支工作**：在侧边栏切换 Git worktree，让新会话和 Explorer 跟随你选择的 checkout。
- **边聊边看项目文件**：左侧浏览项目文件，右侧打开源码、文档、图片、音频和 PDF；文件变化会自动刷新，适合边让 agent 改边检查结果。
- **随时掌握会话状态**：在顶部就能看到上下文占用、花费、压缩结果和系统提示，长会话不再像黑箱。
- **少离开当前界面**：模型、登录/API key、模型测试和技能开关都能在网页里处理，配置 agent 时不用在多个工具之间来回切换。

## 注意事项

- **数据目录**：默认读取 `~/.pi/agent/sessions` 下的会话文件。可通过环境变量 `PI_CODING_AGENT_DIR` 指定其他 pi agent 目录。
- **会话文件**：路径形如 `~/.pi/agent/sessions/<编码后的工作目录>/<时间戳>_<uuid>.jsonl`。
- **模型配置**：Models 面板读写 pi agent 目录下的 `models.json`，模型列表和默认模型由 pi 的配置解析得到。
- **文件访问**：文件浏览和预览面向当前选择的项目目录，以及会话中已出现过的工作目录。
- **Git worktree**：什么时候显示切换器、新建目录在哪里、删除会影响什么，见 [Pi Web 里的 Worktree](./docs/worktrees.zh-CN.md)。
- **Fork 与会话内分支不同**：Fork 会创建新的 `.jsonl` 文件；“Edit from here” 是同一会话文件里的分支。

## 开发

```bash
npm install
npm run dev
```

本地开发端口为 [http://127.0.0.1:30141](http://127.0.0.1:30141)。

常用检查：

```bash
node_modules/.bin/tsc --noEmit
npm run lint
```

开发时不要运行 `next build` / `npm run build`，它会写入 `.next/`，容易影响正在运行的 dev server。发布流程再执行构建。

## 项目结构

```
app/
  api/
    agent/          # 创建/驱动 AgentSession，提供 SSE 事件流
    auth/           # OAuth 和 API key 管理
    cwd/browse/     # 服务端目录浏览
    cwd/validate/   # 自定义工作目录校验
    default-cwd/    # 获取 pi 默认工作目录
    files/          # 文件列表、读取、预览、watch
    home/           # 当前用户 home 目录
    models/         # 可用模型、默认模型、thinking levels
    models-config/  # 读写 models.json、测试模型
    sessions/       # 会话读取、重命名、删除、上下文、HTML 导出
    skills/         # skills 列表、搜索、安装、启停
components/
  AppShell.tsx        # 主布局、URL 状态、顶部面板、文件标签
  SessionSidebar.tsx  # 项目选择、会话树、Explorer
  DirectoryPicker.tsx # 支持浏览和路径输入的工作目录选择器
  ChatWindow.tsx      # 消息区、SSE、拖拽图片、minimap
  ChatInput.tsx       # 输入栏、模型/工具/thinking/compact/slash controls
  MessageView.tsx     # 消息、thinking、tool call/result 渲染
  ModelsConfig.tsx    # 模型和认证配置面板
  SkillsConfig.tsx    # 技能管理面板
  FileExplorer.tsx    # 文件树
  FileViewer.tsx      # 源码、diff、图片、音频、PDF、DOCX 预览
lib/
  directory-browser.ts # 目录规范化和安全枚举工具
  http-dispatcher.ts  # 服务端 fetch 的 HTTP(S) 代理配置
  rpc-manager.ts      # AgentSessionWrapper 生命周期和全局 registry
  session-reader.ts   # 解析 .jsonl 会话文件和分支上下文
  normalize.ts        # 规范化 toolCall 字段名
  file-access.ts      # 文件读取安全边界
  file-paths.ts       # 文件路径编码/相对路径工具
  markdown.ts         # Markdown/Mermaid/KaTeX 插件配置
  pi-types.ts         # pi 相关类型
hooks/
  useAgentSession.ts  # 会话加载、发送命令、SSE 状态机
  useAudio.ts         # 完成提示音
  useDragDrop.ts      # 图片拖拽
  useTheme.ts         # 主题切换
bin/
  pi-web.js           # npm CLI 入口
instrumentation.ts    # 初始化服务端 HTTP dispatcher
```
