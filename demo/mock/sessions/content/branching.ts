import { PROJECT_ROOT } from "../../paths";
import { SESSION_IDS } from "../ids";
import type { SessionScript, Step } from "../types";

const question: Step = {
  kind: "user",
  gapMinutes: 0.1,
  text: {
    en: "Suggest a name for a CLI flag that stops pi-web from opening the browser on start.",
    zh: "帮我给一个命令行参数起个名字：让 pi-web 启动时不要自动打开浏览器。",
  },
};

const firstAnswer: Step = {
  kind: "assistant",
  rounds: [
    {
      thinking: {
        en: "Common conventions: --no-open (Vite, Next), --no-browser (Jupyter), --headless. Negated long flags read best.",
        zh: "常见约定：--no-open（Vite、Next）、--no-browser（Jupyter）、--headless。否定形式的长参数最好读。",
      },
      seconds: 6,
      text: {
        en: "I'd go with **`--no-open`**. It matches Vite and Next.js, reads naturally (`pi-web --no-open`), and leaves room for a matching environment variable such as `PI_WEB_NO_OPEN=1`. Alternatives: `--no-browser` (Jupyter's name) or `--headless`, which suggests more than it does.",
        zh: "我推荐 **`--no-open`**。它和 Vite、Next.js 的写法一致，读起来很自然（`pi-web --no-open`），也方便配一个环境变量，比如 `PI_WEB_NO_OPEN=1`。备选：`--no-browser`（Jupyter 的叫法），或者 `--headless`，不过后者的含义比实际功能更大。",
      },
    },
  ],
};

/** Shared by the branching session and the session forked from it. */
export const branchingPrefix: Step[] = [
  { kind: "model", provider: "openai-codex", modelId: "gpt-5.6-terra" },
  { kind: "thinking", level: "low" },
  question,
  firstAnswer,
];

export const branchingSession: SessionScript = {
  id: SESSION_IDS.branching,
  cwd: PROJECT_ROOT,
  startedMinutesAgo: 26 * 60,
  name: { en: "Branching: edit from here vs. new session", zh: "分支：从此处编辑 vs 新会话" },
  steps: [
    ...branchingPrefix,
    { kind: "mark", name: "answer" },
    {
      kind: "user",
      gapMinutes: 1,
      text: { en: "Something shorter?", zh: "有没有更短的？" },
    },
    {
      kind: "assistant",
      rounds: [
        {
          seconds: 3,
          text: {
            en: "Shortest reasonable option: **`-n`**. But single letters are easy to collide with later flags, so I'd keep `--no-open` as the long form and add `-n` only as an alias if you really want it.",
            zh: "最短的合理选择是 **`-n`**。不过单字母参数以后很容易和其他参数冲突，我建议保留 `--no-open` 作为长参数，真的需要的话再加 `-n` 作为别名。",
          },
        },
      ],
    },
    { kind: "rewind", to: "answer", gapMinutes: 4 },
    {
      kind: "user",
      text: {
        en: "Actually — keep it consistent with the options pi-web already has, and explain how this branching works.",
        zh: "算了——还是和 pi-web 现有的参数风格保持一致吧。顺便讲讲这个分支是怎么回事。",
      },
    },
    {
      kind: "assistant",
      rounds: [
        {
          thinking: {
            en: "Check the existing option parser to match its style, then explain the two branching modes.",
            zh: "先看看现有的参数解析，保持风格一致，然后解释两种分支方式。",
          },
          seconds: 4,
          tools: [{ name: "read", args: { path: "bin/pi-web-options.js" }, result: { readFile: "bin/pi-web-options.js", limit: 50 } }],
        },
        {
          seconds: 16,
          text: {
            en: `\`bin/pi-web-options.js\` already uses \`--no-open\` together with \`PI_WEB_NO_OPEN=1\`, so the consistent answer is to keep exactly that.

**About the branching you just did.** You edited an earlier message instead of continuing the thread, so this session now has **two branches**:

\`\`\`text
Suggest a name for a CLI flag…
└─ I'd go with --no-open…
   ├─ Something shorter?                       ← branch 1
   └─ Actually — keep it consistent…           ← branch 2 (you are here)
\`\`\`

Pi Web offers two ways to branch — hover any of your messages to see them:

| | **Edit from here** | **New session** |
| --- | --- | --- |
| Where it goes | A new branch **inside this session file** | A **new session file**, copied up to that point |
| Good for | Trying another prompt without losing the old answer | Taking the conversation in a separate direction |
| How to switch | **Branches** in the top bar | Open it from the sidebar — it's listed like any other session |

Try it now: open **Branches** in the top bar and click the *Something shorter?* branch, then come back. A session forked with **New session** from this one is in the sidebar as well.`,
            zh: `\`bin/pi-web-options.js\` 里已经在用 \`--no-open\`，并配有 \`PI_WEB_NO_OPEN=1\`，所以保持一致的答案就是沿用它。

**关于你刚才创建的分支**：你编辑了之前的一条消息，而不是继续往下聊，所以这个会话现在有 **两个分支**：

\`\`\`text
帮我给一个命令行参数起个名字…
└─ 我推荐 --no-open…
   ├─ 有没有更短的？                        ← 分支 1
   └─ 算了——还是和 pi-web 现有的参数风格…   ← 分支 2（当前）
\`\`\`

Pi Web 提供两种分支方式——把鼠标悬停在你发的任意一条消息上就能看到：

| | **从此处编辑** | **新会话** |
| --- | --- | --- |
| 结果 | 在 **当前会话文件内** 创建新分支 | 复制到该位置，生成一个 **新的会话文件** |
| 适合 | 换个问法重试，又不丢掉原来的回答 | 让对话朝另一个方向发展 |
| 如何切换 | 顶部栏的 **分支** 按钮 | 在侧边栏打开——它和其他会话一样显示在列表中 |

现在就试试：打开顶部栏的 **分支**，点击「有没有更短的？」那个分支，再切换回来。侧边栏里还有一个用「新会话」从这里分出去的会话。`,
          },
        },
      ],
    },
  ],
};

export const branchingForkSession: SessionScript = {
  id: SESSION_IDS.branchingFork,
  cwd: PROJECT_ROOT,
  startedMinutesAgo: 26 * 60 - 20,
  name: { en: "Fork: add a --port flag", zh: "分叉：增加 --port 参数" },
  parentSessionId: SESSION_IDS.branching,
  relation: { kind: "fork", originSessionId: SESSION_IDS.branching },
  steps: [
    ...branchingPrefix,
    {
      kind: "user",
      gapMinutes: 20,
      text: {
        en: "Forked this into a new session. Which other startup flags would people expect next to --no-open?",
        zh: "我把对话分叉成了一个新会话。除了 --no-open，大家通常还会期待哪些启动参数？",
      },
    },
    {
      kind: "assistant",
      rounds: [
        {
          seconds: 8,
          text: {
            en: `This session was created with **New session** on the *Something shorter?* message in *Branching: edit from here vs. new session*: everything before that message was copied, and from here on the two conversations are independent files.

For a local server like pi-web, people usually expect:

- \`--port <n>\` / \`-p <n>\` — plus \`PORT\` from the environment
- \`--hostname <host>\` / \`-H <host>\` — default \`127.0.0.1\` so it isn't exposed by accident
- \`--no-open\` — what we just named
- \`--help\` / \`-h\` — print the options and exit

Command-line flags should override environment variables, and unknown flags should fail loudly instead of being ignored.`,
            zh: `这个会话是在「分支：从此处编辑 vs 新会话」里「有没有更短的？」那条消息上点 **新会话** 创建的：那条消息之前的内容都复制了过来，从这里开始，两段对话就是互相独立的文件了。

对于 pi-web 这样的本地服务，大家通常会期待：

- \`--port <n>\` / \`-p <n>\`，同时支持环境变量 \`PORT\`
- \`--hostname <host>\` / \`-H <host>\`，默认 \`127.0.0.1\`，避免意外暴露到网络
- \`--no-open\`，也就是刚才定下的名字
- \`--help\` / \`-h\`，打印参数说明后退出

命令行参数应该覆盖环境变量；遇到未知参数时应该直接报错，而不是悄悄忽略。`,
          },
        },
      ],
    },
  ],
};
