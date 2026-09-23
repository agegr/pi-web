/**
 * Canned answers for prompts typed into the demo. They pick a topic from the
 * prompt, optionally run one read-only tool so the stream shows a tool call,
 * and always explain that this is a static demo.
 */
import type { DemoLocale } from "./locale";
import { MODELS_RESPONSE } from "./data/models";
import { buildContext, type MockSession } from "./sessions/store";

export interface ReplyPlan {
  thinking?: string;
  /** Text streamed before the tool call. */
  preface?: string;
  text: string;
  tool?: {
    name: string;
    args: Record<string, unknown>;
    readFile?: string;
    limit?: number;
    result?: string;
  };
}

const INSTALL = "npx @agegr/pi-web@latest";

function modelName(session: MockSession): string {
  const model = session.live?.model;
  if (!model) return "the selected model";
  return MODELS_RESPONSE.modelList.find((item) => item.provider === model.provider && item.id === model.modelId)?.name ?? model.modelId;
}

function footer(locale: DemoLocale): string {
  return locale === "zh"
    ? `\n\n---\n*这是 Pi Web 的静态演示，回复是预设的，没有连接真实模型。想用你自己的模型完整体验，运行 \`${INSTALL}\`。*`
    : `\n\n---\n*This is a static Pi Web demo: replies are canned and no model is called. To try it with your own models, run \`${INSTALL}\`.*`;
}

function mentionedPath(prompt: string): string | null {
  const match = /@("([^"]+)"|[^\s]+)/.exec(prompt);
  if (!match) return null;
  const raw = (match[2] ?? match[1]).replace(/[),.;!?，。！？]+$/, "");
  return raw.replace(/:\d+(-\d+)?$/, "").replace(/\/$/, "") || null;
}

/** Latin keywords match whole words ("ls" must not match "models"); CJK ones match anywhere. */
function has(prompt: string, words: string[]): boolean {
  const lower = prompt.toLowerCase();
  return words.some((word) => (/^[a-z -]+$/.test(word)
    ? new RegExp(`(^|[^a-z])${word}([^a-z]|$)`).test(lower)
    : lower.includes(word)));
}

export function composeReply(prompt: string, locale: DemoLocale, session: MockSession): ReplyPlan {
  const zh = locale === "zh";
  const model = modelName(session);
  const path = mentionedPath(prompt);

  if (path) {
    return {
      thinking: zh ? `用户引用了 ${path}，先读一下开头部分。` : `The user mentioned ${path}; read the beginning of it first.`,
      tool: { name: "read", args: { path, limit: 40 }, readFile: path, limit: 40 },
      text: zh
        ? `我读取了 \`${path}\` 的前 40 行（展开上面的 **read** 卡片可以看到原始输出）。\n\n在真实的 Pi Web 里，${model} 接下来会根据你的问题分析这个文件，必要时继续读取、搜索、编辑或运行命令，每一步都会像上面这样显示为可展开的工具调用。\n\n小提示：在文件查看器里用 **源代码** 模式选中几行，再点工具栏上的 **@** 按钮，就能引用 \`${path}:12-20\` 这样的行范围。${footer(locale)}`
        : `I read the first 40 lines of \`${path}\` — expand the **read** card above to see the raw tool output.\n\nIn a real Pi Web session, ${model} would now work through your question: reading more, searching, editing or running commands, each step shown as an expandable tool call like the one above.\n\nTip: select lines in the file viewer's **Source** mode and click **@** in its toolbar to mention a range like \`${path}:12-20\`.${footer(locale)}`,
    };
  }

  if (has(prompt, ["ls", "list", "files", "folder", "folders", "directory", "structure", "文件", "目录", "结构"])) {
    return {
      thinking: zh ? "列出项目根目录，让用户看到工具调用的样子。" : "List the project root so the user can see what a tool call looks like.",
      tool: { name: "bash", args: { command: "ls" } },
      text: zh
        ? `这是项目根目录的内容（展开上面的 **bash** 卡片查看原始输出）。左下角的 **文件浏览器** 里可以浏览同样的文件，点击即可在右侧打开，或者在输入框里用 \`@\` 引用它们。${footer(locale)}`
        : `That's the project root — expand the **bash** card above for the raw output. The **Explorer** at the bottom-left shows the same files: click one to open it on the right, or mention it with \`@\` in the composer.${footer(locale)}`,
    };
  }

  if (has(prompt, ["model", "models", "provider", "providers", "codex", "claude", "deepseek", "gpt", "reasoning", "thinking", "模型", "服务商", "推理", "思考"])) {
    return {
      thinking: zh ? "介绍模型选择和推理强度。" : "Explain model selection and reasoning levels.",
      text: zh
        ? `这条回复来自 **${model}**（演示中是模拟的）。\n\n- 点击输入框里的模型按钮可以切换模型，下一条消息就会生效。\n- 旁边的推理强度按钮决定模型回答前「思考」多少，只显示当前模型支持的档位。\n- 侧边栏底部的 **模型** 面板里有已登录的 ChatGPT（Codex）、DeepSeek API Key 和自定义的 Claude Gateway；可以在那里开关要显示的模型、查看用量、测试连接。\n\n「模型、服务商与推理强度」这个会话里有更详细的介绍。${footer(locale)}`
        : `This reply "comes from" **${model}** (simulated in the demo).\n\n- Switch models with the model button in the composer; the next message uses the new one.\n- The reasoning button next to it sets how much the model thinks before answering, and only offers levels the model supports.\n- **Models** at the bottom of the sidebar has the signed-in ChatGPT (Codex) account, the DeepSeek API key and the custom Claude Gateway — toggle which models appear, check usage, and test connections there.\n\nThe *Models, providers and reasoning levels* session goes into more detail.${footer(locale)}`,
    };
  }

  if (has(prompt, ["branch", "branches", "fork", "edit from", "clone", "分支", "分叉", "编辑", "克隆"])) {
    return {
      thinking: zh ? "解释两种分支方式。" : "Explain the two ways to branch.",
      text: zh
        ? `把鼠标悬停在你的消息上：\n\n- **从此处编辑**：在同一个会话里创建新分支，旧的回答仍然保留，可以通过顶部栏的 **分支** 切换。\n- **新会话**：把对话复制到一个新的会话文件，之后两边互不影响。\n\n\`/clone\` 可以把当前分支整个复制成新会话。去「分支：从此处编辑 vs 新会话」看看实际效果吧。${footer(locale)}`
        : `Hover one of your messages:\n\n- **Edit from here** creates a new branch in this same session. The old answer stays; switch with **Branches** in the top bar.\n- **New session** copies the conversation into a new session file, and the two go their own ways.\n\n\`/clone\` copies the whole current branch into a new session. See *Branching: edit from here vs. new session* for a worked example.${footer(locale)}`,
    };
  }

  if (has(prompt, ["hi", "hello", "hey", "你好", "您好", "嗨", "哈喽"])) {
    return {
      thinking: zh ? "打个招呼，并建议可以尝试的东西。" : "Say hello and suggest things to try.",
      text: zh
        ? `你好！👋 我是演示里的 ${model}。可以试试：\n\n- 发送 \`@README.md 总结一下\`，看看工具调用是怎么显示的；\n- 输入 \`!git status\` 运行（模拟的）shell 命令；\n- 点开侧边栏里的其他会话，每个都是一个小教程。${footer(locale)}`
        : `Hi! 👋 I'm the demo's ${model}. A few things to try:\n\n- Send \`@README.md summarize this\` to see how tool calls render.\n- Type \`!git status\` to run a (simulated) shell command.\n- Open the other sessions in the sidebar — each one is a short tutorial.${footer(locale)}`,
    };
  }

  return {
    thinking: zh ? "这是演示环境，说明情况并给出可以尝试的操作。" : "This is the demo; explain that and suggest what to explore.",
    text: zh
      ? `收到！在真实的 Pi Web 中，${model} 会在这里流式输出回答，并在需要时读取文件、运行命令、修改代码——每一步都会显示为可展开的工具调用，完成后还会在顶部栏更新 token 和费用。\n\n在这个演示里，你还可以：\n\n- 用 \`@\` 引用一个文件（比如 \`@package.json\`），我会真的读一下它；\n- 输入 \`/\` 查看斜杠命令，或用 \`!ls\` 运行模拟的 shell 命令；\n- 悬停在你的消息上，试试 **从此处编辑** 和 **新会话**。${footer(locale)}`
      : `Got it! In a real Pi Web session, ${model} would stream its answer here and read files, run commands or edit code as needed — each step shown as an expandable tool call, with tokens and cost updating in the top bar.\n\nIn this demo you can also:\n\n- Mention a file with \`@\` (for example \`@package.json\`) and I'll actually read it.\n- Type \`/\` for slash commands, or \`!ls\` for a simulated shell command.\n- Hover your message and try **Edit from here** or **New session**.${footer(locale)}`,
  };
}

/** Title for "Generate title": the first user message, trimmed to a short line. */
export function autoTitle(session: MockSession): string {
  const context = buildContext(session, session.leafId, { tail: 0 });
  const first = context.messages.find((message) => message.role === "user");
  const content = first && "content" in first ? first.content : "";
  const text = typeof content === "string"
    ? content
    : (content as { type: string; text?: string }[]).find((block) => block.type === "text")?.text ?? "";
  const clean = text.replace(/@\S+\s*/g, "").replace(/[`*_#>]/g, "").replace(/\s+/g, " ").trim();
  const sentence = clean.split(/(?<=[.?!。？！])\s*/)[0] || clean || "Untitled session";
  return sentence.length > 48 ? `${sentence.slice(0, 47).trimEnd()}…` : sentence.replace(/[.。]$/, "");
}
