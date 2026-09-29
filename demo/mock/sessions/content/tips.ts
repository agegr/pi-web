import { PROJECT_ROOT } from "../../paths";
import { SESSION_IDS } from "../ids";
import type { SessionScript } from "../types";

const GIT_LOG_OUTPUT = `79c2a44 chore(deps): trim the production install and bump next, semver, undici (#948)
040fadd Release v0.9.2
234e19e perf(session): #928 + #912 rebased onto main, with fixes (#940)
1bd40e4 feat(minimap): show a per-turn tool-call count in the hover preview (#939)
058341d feat(models): add a manual "Refresh catalog" button to the Models panel (#914) (#938)`;

const GIT_STATUS_OUTPUT = `On branch main
Your branch is up to date with 'origin/main'.

Changes not staged for commit:
  (use "git add <file>..." to update what will be committed)
	modified:   README.md
	modified:   components/AppShell.tsx

Untracked files:
  (use "git add <file>..." to include in what will be committed)
	lib/format-duration.test.mjs
	lib/format-duration.ts

no changes added to commit (use "git add" and/or "git commit -a")`;

export const tipsSession: SessionScript = {
  id: SESSION_IDS.tips,
  cwd: PROJECT_ROOT,
  startedMinutesAgo: 5 * 24 * 60 + 30,
  name: { en: "Composer tips: /commands, !shell, shortcuts", zh: "输入框技巧：/ 命令、! shell 与快捷键" },
  steps: [
    { kind: "model", provider: "deepseek", modelId: "deepseek-flash" },
    { kind: "thinking", level: "low" },
    {
      kind: "user",
      gapMinutes: 0.1,
      text: {
        en: "What landed in the last few commits?",
        zh: "最近几次提交都改了什么？",
      },
    },
    {
      kind: "assistant",
      rounds: [
        {
          seconds: 3,
          tools: [{ name: "bash", args: { command: "git log --oneline -5" }, result: GIT_LOG_OUTPUT }],
        },
        {
          seconds: 7,
          text: {
            en: "The latest release is **v0.9.2**. Since then: a leaner production install with dependency bumps (#948). Before the release: faster session loading (#940), per-turn tool-call counts in the minimap preview (#939), and a **Refresh catalog** button in the Models panel (#938).",
            zh: "最新版本是 **v0.9.2**。发布之后：精简了生产环境安装并升级依赖（#948）。发布之前：会话加载提速（#940）、小地图预览中显示每轮的工具调用次数（#939），以及模型面板新增 **刷新模型目录** 按钮（#938）。",
          },
        },
      ],
    },
    {
      kind: "compaction",
      tokensBefore: 186_420,
      summary: {
        en: `## Goal
Get familiar with the pi-web repository and its recent history.

## Progress
- Reviewed the last five commits: v0.9.2 release, faster session loading (#940), minimap tool-call counts (#939), "Refresh catalog" in the Models panel (#938), leaner production install (#948).
- Walked through \`components/\`, \`lib/\` and \`app/api/\` to map UI components to their API routes.

## Next steps
- Learn the composer shortcuts and commands.`,
        zh: `## 目标
熟悉 pi-web 仓库及其最近的提交历史。

## 进展
- 回顾了最近五次提交：v0.9.2 发布、会话加载提速（#940）、小地图工具调用计数（#939）、模型面板「刷新模型目录」（#938）、精简生产环境安装（#948）。
- 浏览了 \`components/\`、\`lib/\` 和 \`app/api/\`，理清了界面组件与 API 路由的对应关系。

## 下一步
- 学习输入框的快捷键和命令。`,
      },
    },
    { kind: "bash", command: "git status", output: GIT_STATUS_OUTPUT, gapMinutes: 40 },
    {
      kind: "user",
      gapMinutes: 1,
      text: {
        en: "I just ran `!git status` from the composer — neat. What other composer tricks should I know?",
        zh: "我刚在输入框里用 `!git status` 跑了一下命令，挺方便。输入框还有哪些技巧？",
      },
    },
    {
      kind: "assistant",
      rounds: [
        {
          seconds: 12,
          text: {
            en: `Here's the cheat sheet:

| Type | What happens |
| --- | --- |
| \`/\` | Command menu: \`/compact\`, \`/auto-compact\`, \`/name\`, \`/session\`, \`/copy\`, \`/clone\`, \`/reload\`, plus \`/skill:…\` and your prompt templates |
| \`@\` | Mention a file or folder; \`@path:12-20\` points at a line range |
| \`!cmd\` | Run a shell command in the project; the output joins the conversation (like the \`git status\` above) |
| \`!!cmd\` | Same, but the output stays **out** of the model's context |
| Paste or drop an image | Attach it to the message |

**Keys:** Enter sends, Shift+Enter adds a line, Esc stops a running agent, Ctrl+Alt+N starts a new session in the current project.

**While the agent is running** you can keep typing: **Steer** interrupts and injects your message now, **Follow-up** (Alt+Enter) queues it for after the current run.

**Also worth knowing**
- The tool preset button switches between *Chat only*, read-only tools, the default four (\`read\`, \`bash\`, \`edit\`, \`write\`) and the full set.
- The divider above marks a **compaction**: older turns were summarized to free up context. \`/compact\` does it on demand; expand the divider to read the summary.
- **Settings → General → Chat** can show *Ask here* / *Ask in new chat* actions when you select text in a reply.
- **Settings → General** has themes (Light, Dark, Mist, Rose, Pine or System), languages, chat width and font size.
- The search button above the session list searches **all** conversations; the strip on the right of the chat is a minimap for long sessions.
- On a phone, add Pi Web to the home screen and turn on push notifications to hear when a long run finishes.`,
            zh: `速查表：

| 输入 | 效果 |
| --- | --- |
| \`/\` | 命令菜单：\`/compact\`、\`/auto-compact\`、\`/name\`、\`/session\`、\`/copy\`、\`/clone\`、\`/reload\`，以及 \`/skill:…\` 和你的提示词模板 |
| \`@\` | 引用文件或文件夹；\`@路径:12-20\` 可以指定行范围 |
| \`!命令\` | 在项目目录运行 shell 命令，输出会加入对话（就像上面的 \`git status\`） |
| \`!!命令\` | 同上，但输出 **不会** 进入模型上下文 |
| 粘贴或拖入图片 | 作为附件随消息发送 |

**快捷键**：Enter 发送，Shift+Enter 换行，Esc 停止正在运行的 agent，Ctrl+Alt+N 在当前项目中新建会话。

**agent 运行时** 也可以继续输入：**引导** 会立即打断并插入你的消息，**后续消息**（Alt+Enter）则排队到当前任务完成之后。

**其他值得了解的**
- 工具预设按钮可以在「仅聊天」、只读工具、默认四件套（\`read\`、\`bash\`、\`edit\`、\`write\`）和全部工具之间切换。
- 上方的分隔线表示发生过一次 **上下文压缩**：较早的对话被总结以腾出上下文空间。\`/compact\` 可以手动触发，展开分隔线可以阅读摘要。
- **设置 → 常规 → 对话** 中可以开启选中文字后的「在当前对话询问 / 在新对话询问」操作。
- **设置 → 常规** 中可以切换主题（浅色、深色、雾青、蔷薇、松夜或跟随系统）、语言、聊天宽度和字号。
- 会话列表上方的搜索按钮可以搜索 **所有** 对话；聊天区右侧的细条是长会话的小地图。
- 在手机上可以把 Pi Web 添加到主屏幕并开启推送通知，长任务完成时就会收到提醒。`,
          },
        },
      ],
    },
  ],
};
