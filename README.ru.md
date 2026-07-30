# Pi Web

[English](./README.md) | [中文文档](./README.zh-CN.md) | [日本語](./README.ja.md) | [Русский](./README.ru.md)

Локальный web UI для [pi coding agent](https://github.com/badlogic/pi-mono). Pi Web читает локальные session-файлы pi и даёт браузерный workspace: просмотр сессий, real-time chat, настройка моделей, skills и preview файлов проекта.

![Pi Web shows the same pi session with structured Markdown, tool calls, and project navigation beside the CLI](https://raw.githubusercontent.com/agegr/pi-web/main/docs/screenshot2.png)

Та же pi-сессия в CLI и Pi Web: structured tool calls, читаемый Markdown, session browsing и более удобные результаты.

## Быстрый старт

Нужен Node.js **22.19.0** или новее. Проверка: `node --version`.

**Без установки:**

```bash
npx @agegr/pi-web@latest
```

**Глобально:**

```bash
npm install -g @agegr/pi-web
pi-web
```

Откройте [http://127.0.0.1:30141](http://127.0.0.1:30141). CLI попытается открыть браузер после старта сервера. По умолчанию слушаем `127.0.0.1`.

**Опции:**

```bash
pi-web --port 8080              # custom port
pi-web --hostname 0.0.0.0       # expose on a trusted network
pi-web -p 8080 -H 0.0.0.0       # combine options
pi-web --no-open                # do not open the browser automatically

PORT=8080 pi-web                # environment variable is also supported
PI_WEB_HOSTNAME=0.0.0.0 pi-web  # explicit network exposure
PI_WEB_ALLOWED_HOSTS=pi-web.internal pi-web  # allow an exact proxy/custom hostname
PI_WEB_NO_OPEN=1 pi-web         # useful when running as a background service
```

У Pi Web **нет** application-level auth, при этом он может вызывать high-privilege agent. **Не** выставляйте в интернет; non-loopback bindings — только в trusted network.  
API принимает loopback names, IP literals, bind hostname и exact names из `PI_WEB_ALLOWED_HOSTS` (через запятую). Нужно, если reverse proxy с другим external hostname.

## HTTP Proxy

Серверные model/API-запросы уважают `HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY`.

macOS / Linux:

```bash
HTTP_PROXY=http://127.0.0.1:7890 \
HTTPS_PROXY=http://127.0.0.1:7890 \
NO_PROXY=localhost,127.0.0.1 \
npx @agegr/pi-web@latest
```

Windows PowerShell:

```powershell
$env:HTTP_PROXY = "http://127.0.0.1:7890"
$env:HTTPS_PROXY = "http://127.0.0.1:7890"
$env:NO_PROXY = "localhost,127.0.0.1"
npx @agegr/pi-web@latest
```

## Возможности

- **Продолжить работу**: предыдущие pi-разговоры по проектам без поиска в terminal history
- **Безопасные ветки**: continue с сообщения или fork сессии в отдельный route
- **Git worktrees**: переключение worktrees в sidebar — новые sessions и Explorer следуют checkout
- **Chat рядом с проектом**: файлы слева; preview source/docs/images/audio/PDF справа, пока агент работает
- **Состояние сессии**: context usage, cost, compaction, system prompt — в top bar
- **Меньше терминала**: models, login/API keys, model tests, skills — из web UI
- **Язык UI**: переключение supported languages в top bar

## Notes

- **Data directory**: по умолчанию `~/.pi/agent/sessions`. Другой каталог: `PI_CODING_AGENT_DIR`
- **Session files**: `~/.pi/agent/sessions/<encoded-cwd>/<timestamp>_<uuid>.jsonl`
- **Model config**: панель Models читает/пишет `models.json` в pi agent directory
- **File access**: browsing/preview ограничены selected project и working dirs из sessions
- **Git worktrees**: [Worktrees in Pi Web](./docs/worktrees.md)
- **Forks vs in-session branches**: Fork = новый `.jsonl`; «Edit from here» = ветка внутри того же session file
- **i18n**: [Internationalization](./docs/i18n.md)

## Development

```bash
npm install
npm run dev
```

Dev server: [http://127.0.0.1:30141](http://127.0.0.1:30141).

```bash
node_modules/.bin/tsc --noEmit
npm run lint
```

Не гоняйте `next build` / `npm run build` во время local dev — пишет в `.next/` и мешает dev server; builds — для release.

## Структура проекта

```text
app/
  api/
    agent/          # creates/drives AgentSession and exposes SSE events
    auth/           # OAuth and API key management
    cwd/browse/     # browsable server directory listing
    cwd/validate/   # custom working directory validation
    default-cwd/    # pi default working directory lookup
    files/          # file listing, reading, preview, and watching
    home/           # current user home directory
    models/         # available models, default model, thinking levels
    models-config/  # read/write models.json and test models
    sessions/       # session reads, rename, delete, context, HTML export
    skills/         # skill listing, search, install, enable/disable
components/
  AppShell.tsx        # main layout, URL state, top panels, file tabs
  SessionSidebar.tsx  # project selector, session tree, Explorer
  DirectoryPicker.tsx # browsable and editable working-directory picker
  ChatWindow.tsx      # messages, SSE, image drag/drop, minimap
  ChatInput.tsx       # input bar, model/tools/thinking/compact/slash controls
  MessageView.tsx     # message, thinking, tool call/result rendering
  ModelsConfig.tsx    # model and auth configuration panel
  SkillsConfig.tsx    # skill management panel
  FileExplorer.tsx    # file tree
  FileViewer.tsx      # source, diff, image, audio, PDF, DOCX preview
lib/
  directory-browser.ts # directory normalization and safe listing helpers
  http-dispatcher.ts  # HTTP(S) proxy setup for server-side fetch
  rpc-manager.ts      # AgentSessionWrapper lifecycle and global registry
  session-reader.ts   # parses .jsonl session files and branch contexts
  normalize.ts        # normalizes toolCall field names
  file-access.ts      # file read safety boundary
  file-paths.ts       # path encoding and relative path helpers
  markdown.ts         # Markdown/Mermaid/KaTeX plugin configuration
  pi-types.ts         # pi-related types
hooks/
  useAgentSession.ts  # session loading, command sending, SSE state machine
  useAudio.ts         # completion sound
  useDragDrop.ts      # image drag/drop
  useTheme.ts         # theme switching
bin/
  pi-web.js           # npm CLI entrypoint
instrumentation.ts    # initializes the server HTTP dispatcher
```
