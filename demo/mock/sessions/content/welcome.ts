import { PROJECT_ROOT } from "../../paths";
import { SESSION_IDS } from "../ids";
import type { SessionScript } from "../types";

export const welcomeSession: SessionScript = {
  id: SESSION_IDS.welcome,
  cwd: PROJECT_ROOT,
  startedMinutesAgo: 12,
  name: { en: "👋 Welcome to Pi Web — a quick tour", zh: "👋 欢迎使用 Pi Web：界面速览" },
  steps: [
    { kind: "model", provider: "openai-codex", modelId: "gpt-5.5" },
    { kind: "thinking", level: "medium" },
    {
      kind: "user",
      gapMinutes: 0.2,
      text: {
        en: "Hi! I just opened Pi Web for the first time. Can you give me a quick tour of this screen?",
        zh: "你好！我第一次打开 Pi Web，能带我快速认识一下这个界面吗？",
      },
    },
    {
      kind: "assistant",
      rounds: [
        {
          thinking: {
            en: "The user is new to Pi Web. Walk through the four areas of the screen from left to right, and point at the README that is already open on the right so they have something concrete to look at.",
            zh: "用户第一次使用 Pi Web。按从左到右的顺序介绍屏幕的四个区域，并提到右侧已经打开的 README，让用户有具体的东西可看。",
          },
          seconds: 9,
          text: {
            en: `Welcome! Pi Web is a browser UI for the **pi coding agent**. It reads the same \`~/.pi/agent\` sessions and settings as the pi CLI, so everything you do here also shows up in the terminal — and the other way round.

The screen has four areas:

| Area | What it's for |
| --- | --- |
| **Left sidebar** | Project picker and Git worktree switcher at the top, this **session list** in the middle, the **file explorer** at the bottom, and the **Models · Skills · Settings** buttons at the very bottom. |
| **Chat (center)** | The conversation. The composer below it picks the **model**, the **reasoning level** and the **tool preset**, and takes \`@file\` mentions, \`/\` commands, \`!\` shell commands and images. |
| **Top bar** | **Full history**, **Generate title**, **Branches**, **System** (the exact system prompt) and **Tools** (the tool definitions the model sees), plus tokens, cost and context usage for this session. |
| **Right panel** | Files and terminals in tabs. It is showing \`README.md\` right now — click any file in the explorer to open another one. |

\`\`\`mermaid
flowchart LR
  B["Browser<br/>(Pi Web UI)"] -- "HTTP + SSE" --> S["Pi Web server<br/>(Next.js)"]
  S -- "in-process" --> A["pi agent session"]
  A --> M["Model providers<br/>Codex · DeepSeek · Claude"]
  A --> F["Your project files<br/>and shell"]
  S -. "same files as the CLI" .- D[("~/.pi/agent")]
\`\`\`

Each session in the sidebar is a small hands-on tutorial. Open any of them — nothing you click here can break anything.`,
            zh: `欢迎！Pi Web 是 **pi 编程智能体（pi coding agent）** 的浏览器界面。它读写的会话和设置与 pi 命令行完全相同（都在 \`~/.pi/agent\`），所以你在这里做的一切也会出现在终端里，反之亦然。

整个界面分为四个区域：

| 区域 | 用途 |
| --- | --- |
| **左侧边栏** | 顶部是项目选择器和 Git worktree 切换器，中间是 **会话列表**，下方是 **文件浏览器**，最底部是 **模型 · 技能 · 设置** 按钮。 |
| **中间聊天区** | 对话内容。下方的输入框可以选择 **模型**、**推理强度** 和 **工具预设**，支持 \`@文件\` 引用、\`/\` 命令、\`!\` shell 命令和图片。 |
| **顶部栏** | **完整历史**、**生成标题**、**分支**、**系统**（模型实际收到的系统提示词）和 **工具**（模型看到的工具定义），以及本会话的 token、费用和上下文占用。 |
| **右侧面板** | 以标签页显示文件和终端。现在打开的是 \`README.md\`，点击文件浏览器里的任意文件即可打开其他文件。 |

\`\`\`mermaid
flowchart LR
  B["浏览器<br/>(Pi Web 界面)"] -- "HTTP + SSE" --> S["Pi Web 服务<br/>(Next.js)"]
  S -- "同进程" --> A["pi agent 会话"]
  A --> M["模型服务商<br/>Codex · DeepSeek · Claude"]
  A --> F["项目文件<br/>和 shell"]
  S -. "与命令行共用" .- D[("~/.pi/agent")]
\`\`\`

侧边栏里的每个会话都是一个小教程，随便点开看看——在这里怎么操作都不会弄坏任何东西。`,
          },
        },
      ],
    },
    {
      kind: "user",
      gapMinutes: 1.5,
      text: {
        en: "Nice. What should I try first?",
        zh: "不错。我应该先试试什么？",
      },
    },
    {
      kind: "assistant",
      rounds: [
        {
          thinking: {
            en: "Give a short, ordered checklist that touches each major feature and maps to the other tutorial sessions.",
            zh: "给出一个简短、有顺序的清单，覆盖主要功能，并对应到其他教程会话。",
          },
          seconds: 6,
          text: {
            en: `Here's a five-minute path through the demo:

1. **Browse the sessions** in the sidebar. They're sorted by activity and grouped by project — switch to the second project with the picker at the top of the sidebar.
2. **Open files.** Click \`package.json\` or \`app/page.tsx\` in the explorer. Markdown opens as a rendered preview; code opens with syntax highlighting. The **changed files** button (the small commit icon next to *Explorer*) lists what Git sees as modified.
3. **Type in the composer.** Try \`@READ\` to mention a file, \`/\` for slash commands, or \`!git log\` to run a shell command. Send any message and I'll answer with a streamed demo reply.
4. **Look behind the curtain.** Click **System** or **Tools** in the top bar to see exactly what the model receives.
5. **Check the settings.** **Models** shows a signed-in ChatGPT (Codex) account, a DeepSeek API key and a custom provider; **Settings** has themes, languages and chat preferences.

> This page is a static demo — the replies are canned. To use Pi Web with your own agent, run:
>
> \`\`\`bash
> npx @agegr/pi-web@latest
> \`\`\``,
            zh: `推荐一条五分钟的体验路线：

1. **浏览会话**：侧边栏里的会话按活跃时间排序、按项目分组。用侧边栏顶部的项目选择器切换到第二个项目看看。
2. **打开文件**：点击文件浏览器里的 \`package.json\` 或 \`app/page.tsx\`。Markdown 默认以渲染预览打开，代码带语法高亮。「文件浏览器」旁边的 **变更文件** 按钮（小小的提交图标）会列出 Git 中有改动的文件。
3. **在输入框里打字**：输入 \`@READ\` 引用文件，输入 \`/\` 查看斜杠命令，或者输入 \`!git log\` 运行 shell 命令。随便发一条消息，我会用流式输出回复一段演示内容。
4. **看看幕后**：点击顶部栏的 **系统** 或 **工具**，查看模型实际收到的内容。
5. **打开设置**：**模型** 面板里有已登录的 ChatGPT（Codex）账号、DeepSeek API Key 和一个自定义服务商；**设置** 里可以切换主题、语言和聊天偏好。

> 这是一个静态演示页面，回复都是预设的。想连接你自己的 agent 使用 Pi Web，运行：
>
> \`\`\`bash
> npx @agegr/pi-web@latest
> \`\`\``,
          },
        },
      ],
    },
  ],
};
