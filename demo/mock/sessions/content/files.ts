import { PROJECT_ROOT } from "../../paths";
import { SESSION_IDS } from "../ids";
import type { SessionScript } from "../types";

export const filesSession: SessionScript = {
  id: SESSION_IDS.files,
  cwd: PROJECT_ROOT,
  startedMinutesAgo: 95,
  name: { en: "Files, @mentions and diffs", zh: "文件浏览、@ 引用与 Diff" },
  steps: [
    { kind: "model", provider: "claude-gateway", modelId: "claude-sonnet-5" },
    { kind: "thinking", level: "high" },
    {
      kind: "user",
      gapMinutes: 0.1,
      text: {
        en: "@README.md What does this project do? Keep it short.",
        zh: "@README.md 这个项目是做什么的？简短说说。",
      },
    },
    {
      kind: "assistant",
      rounds: [
        {
          thinking: {
            en: "The user mentioned README.md with an @-mention, so read it first and summarize the main points in a few bullets.",
            zh: "用户用 @ 引用了 README.md，先读取它，再用几条要点总结。",
          },
          seconds: 4,
          tools: [{ name: "read", args: { path: "README.md" }, result: { readFile: "README.md" } }],
        },
        {
          seconds: 11,
          text: {
            en: `**Pi Web** is a local browser UI for the [pi coding agent](https://github.com/earendil-works/pi). In short:

- **Same data as the CLI** — it reads and writes \`~/.pi/agent\`, so sessions, models and credentials are shared with \`pi\` in your terminal.
- **Session workspace** — browse, resume, rename, export and delete conversations grouped by project, with cost and context usage.
- **Branching** — *New session* forks into a new file; *Edit from here* branches inside the same session.
- **Project tools** — file explorer, uploads, Git diffs, previews (Markdown, images, PDF, DOCX…) and Git worktrees.
- **Web configuration** — provider login, API keys, models, skills and plugins without leaving the browser.

Start it with \`npx @agegr/pi-web@latest\`; it listens on \`127.0.0.1:30141\` by default.`,
            zh: `**Pi Web** 是 [pi 编程智能体](https://github.com/earendil-works/pi) 的本地浏览器界面。简单来说：

- **与命令行共享数据**：读写 \`~/.pi/agent\`，会话、模型和凭据都和终端里的 \`pi\` 通用。
- **会话工作区**：按项目分组浏览、继续、重命名、导出和删除对话，并显示费用和上下文占用。
- **分支**：「新会话」会复制出一个新的会话文件；「从此处编辑」则在同一个会话内创建分支。
- **项目工具**：文件浏览器、上传、Git diff、各种预览（Markdown、图片、PDF、DOCX 等）以及 Git worktree。
- **网页配置**：登录服务商、填写 API Key、管理模型、技能和插件，都不用离开浏览器。

用 \`npx @agegr/pi-web@latest\` 启动，默认监听 \`127.0.0.1:30141\`。`,
          },
        },
      ],
    },
    {
      kind: "user",
      gapMinutes: 2,
      text: {
        en: "Add a tip under **Quick Start** that points people to `pi-web --help`.",
        zh: "在 **Quick Start** 下面加一条提示，告诉大家可以用 `pi-web --help` 查看启动参数。",
      },
    },
    {
      kind: "assistant",
      rounds: [
        {
          thinking: {
            en: "A one-line blockquote right under the Quick Start heading keeps the steps below it intact. Use a single targeted edit.",
            zh: "在 Quick Start 标题下面加一行引用块，不影响后面的步骤。用一次精确替换即可。",
          },
          seconds: 5,
          tools: [{ name: "edit", args: {}, result: { editKey: "readme-help-tip" } }],
        },
        {
          seconds: 4,
          text: {
            en: `Done — added a tip under **Quick Start** in \`README.md\`.

You can check it three ways:

- Expand the **edit** card above to see the diff of this change.
- Click the **changed files** button next to *Explorer* in the sidebar: \`README.md\` is listed as modified, and clicking it opens a side-by-side **Diff**.
- The \`README.md\` tab on the right already shows the new line — open files refresh automatically when the agent changes them.`,
            zh: `完成——已在 \`README.md\` 的 **Quick Start** 下方加了一条提示。

可以通过三种方式查看：

- 展开上面的 **edit** 卡片，查看这次修改的 diff。
- 点击侧边栏「文件浏览器」旁边的 **变更文件** 按钮：\`README.md\` 会显示为已修改，点击即可以 **Diff** 方式查看。
- 右侧的 \`README.md\` 标签页已经显示了新内容——agent 修改文件后，打开的文件会自动刷新。`,
          },
        },
      ],
    },
    {
      kind: "user",
      gapMinutes: 3,
      text: {
        en: "How do I open files and point you at specific lines?",
        zh: "怎么打开文件，又怎么让你看某几行代码？",
      },
    },
    {
      kind: "assistant",
      rounds: [
        {
          seconds: 14,
          text: {
            en: `A few ways, from quickest to most precise:

**Open and browse**
- Click a file in the **Explorer** (bottom-left) to open it in a tab on the right. Folders expand in place; the 🔍 button searches every file in the project.
- Markdown opens as a rendered **Preview**; switch to **Source** in the viewer toolbar. Images, audio, video, PDF and DOCX get native previews.
- The ⤢ button in the tab bar expands the file panel to full width; drag its left edge to resize.

**Point me at files**
- Type \`@\` in the composer and start typing a path — for example \`@lib/tool\` — then pick a match. Folders work too.
- Hover a file in the explorer and click **mention** to insert it, or drag files into the composer.

**Point me at lines**
- Open a file in **Source** mode, select the lines you care about, and click the **@** button in the viewer toolbar. It inserts a reference like \`@components/ChatInput.tsx:224-232\`, and I'll read exactly that range.

**Upload**
- Drop files on the explorer (or use the upload button) to copy them into the project, then mention them like any other file.`,
            zh: `有几种方式，从快捷到精确：

**打开和浏览**
- 点击左下角 **文件浏览器** 中的文件，它会在右侧以标签页打开。文件夹可以原地展开；🔍 按钮可以搜索整个项目的文件。
- Markdown 默认以渲染后的 **预览** 打开，可在查看器工具栏切换到 **源代码**。图片、音频、视频、PDF 和 DOCX 都有原生预览。
- 标签栏上的 ⤢ 按钮可以把文件面板展开到全宽；拖动面板左边缘可以调整宽度。

**让我看某个文件**
- 在输入框输入 \`@\` 再输入路径，比如 \`@lib/tool\`，然后选择匹配项。文件夹也可以引用。
- 在文件浏览器中悬停文件并点击 **mention**，或者直接把文件拖进输入框。

**让我看某几行**
- 用 **源代码** 模式打开文件，选中你关心的行，然后点击查看器工具栏上的 **@** 按钮。它会插入类似 \`@components/ChatInput.tsx:224-232\` 的引用，我就只读取这一段。

**上传**
- 把文件拖到文件浏览器上（或点击上传按钮）即可复制到项目中，之后像其他文件一样引用。`,
          },
        },
      ],
    },
  ],
};
