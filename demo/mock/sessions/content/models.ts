import { PROJECT_ROOT } from "../../paths";
import { SESSION_IDS } from "../ids";
import type { SessionScript } from "../types";

export const modelsSession: SessionScript = {
  id: SESSION_IDS.models,
  cwd: PROJECT_ROOT,
  startedMinutesAgo: 190,
  name: { en: "Models, providers and reasoning levels", zh: "模型、服务商与推理强度" },
  steps: [
    { kind: "model", provider: "deepseek", modelId: "deepseek-v4-pro" },
    { kind: "thinking", level: "high" },
    {
      kind: "user",
      gapMinutes: 0.1,
      text: {
        en: "Which models can I use in this Pi Web?",
        zh: "这个 Pi Web 里能用哪些模型？",
      },
    },
    {
      kind: "assistant",
      rounds: [
        {
          thinking: {
            en: "Three providers are configured: an OAuth login (ChatGPT/Codex), an API key (DeepSeek) and a custom models.json provider (Claude Gateway). Explain each and where it lives, then how to pick and filter models.",
            zh: "这里配置了三个服务商：OAuth 登录（ChatGPT/Codex）、API Key（DeepSeek）以及 models.json 中的自定义服务商（Claude Gateway）。逐个说明它们存在哪里，再讲怎么选择和筛选模型。",
          },
          seconds: 12,
          text: {
            en: `This demo has three providers set up, one of each kind Pi Web supports. Open **Models** at the bottom of the sidebar to see them:

| Provider | How it's connected | Models |
| --- | --- | --- |
| **ChatGPT Plus/Pro (Codex)** | Signed in with **OAuth** — no key to copy | GPT-5.5, GPT-5.6 Sol · Terra · Luna, GPT-6 Astra, GPT-5.3 Codex Spark |
| **DeepSeek** | **API key**, stored in \`~/.pi/agent/auth.json\` | DeepSeek V4 Pro *(answering you now)*, DeepSeek V4.1 Flash |
| **Claude Gateway** | **Custom provider** in \`~/.pi/agent/models.json\`, an Anthropic-compatible endpoint | Claude Opus 5, Claude Sonnet 5, Claude Haiku 4.5 |

A few things worth knowing:

- **Switch models** from the model button in the composer. The choice belongs to this session, and the model name under each reply shows who wrote it.
- **Keep the picker short** with the switches under **Available models**. They edit \`enabledModels\` in \`settings.json\` — the same list \`pi --models\` and \`/scoped-models\` use in the terminal.
- **Usage**: Codex and DeepSeek show quota or balance right in the panel — 5-hour and weekly limits for Codex, account balance for DeepSeek.
- **New releases**: **Refresh catalog** fetches a provider's latest model list, so a model released after your pi version still shows up.`,
            zh: `这个演示配置了三个服务商，正好是 Pi Web 支持的三种接入方式。点击侧边栏底部的 **模型** 就能看到：

| 服务商 | 接入方式 | 模型 |
| --- | --- | --- |
| **ChatGPT Plus/Pro（Codex）** | 通过 **OAuth** 登录，不用复制任何 Key | GPT-5.5、GPT-5.6 Sol · Terra · Luna、GPT-6 Astra、GPT-5.3 Codex Spark |
| **DeepSeek** | **API Key**，保存在 \`~/.pi/agent/auth.json\` | DeepSeek V4 Pro（*正在回答你的就是它*）、DeepSeek V4.1 Flash |
| **Claude Gateway** | \`~/.pi/agent/models.json\` 中的 **自定义服务商**，一个兼容 Anthropic 的接口 | Claude Opus 5、Claude Sonnet 5、Claude Haiku 4.5 |

还有几点值得了解：

- **切换模型**：点击输入框里的模型按钮。选择只对当前会话生效，每条回复下方会显示是哪个模型写的。
- **精简模型列表**：用 **可用模型** 下的开关控制显示哪些模型。它修改的是 \`settings.json\` 里的 \`enabledModels\`，和终端里 \`pi --models\`、\`/scoped-models\` 用的是同一份列表。
- **用量**：Codex 和 DeepSeek 可以直接在面板里查看额度或余额——Codex 显示 5 小时和每周限额，DeepSeek 显示账户余额。
- **新模型**：**刷新模型目录** 会拉取服务商最新的模型列表，即使模型比你的 pi 版本发布得更晚也能用上。`,
          },
        },
      ],
    },
    { kind: "model", provider: "openai-codex", modelId: "gpt-5.6-sol" },
    { kind: "thinking", level: "xhigh" },
    {
      kind: "user",
      gapMinutes: 2.5,
      text: {
        en: "I switched to GPT-5.6 Sol with extra-high reasoning. What do the reasoning levels actually change?",
        zh: "我切换到了 GPT-5.6 Sol，并选了「超高强度推理」。不同的推理强度到底有什么区别？",
      },
    },
    {
      kind: "assistant",
      rounds: [
        {
          thinking: {
            en: `The user just switched model mid-session, which is a good moment to show that the switch is recorded in the session and that the next reply comes from the new model.

Reasoning levels map to the provider's own effort / budget parameter. Pi exposes up to seven levels: off, minimal, low, medium, high, xhigh, max. Each model only supports a subset — the selector hides the rest. DeepSeek V4 Pro, for example, only has off/high/max; GPT-5.5 stops at xhigh; GPT-5.6 models go up to max.

Trade-off: higher levels mean more hidden reasoning tokens → better on hard multi-step problems, slower and more expensive. Point at the top bar for the cost and the thinking block itself for what the model was "thinking".`,
            zh: `用户刚在会话中途切换了模型，正好可以说明：切换会记录在会话里，下一条回复就来自新模型。

推理强度对应服务商自己的 effort / 预算参数。pi 最多提供七档：off、minimal、low、medium、high、xhigh、max。每个模型只支持其中一部分，选择器会隐藏不支持的档位。比如 DeepSeek V4 Pro 只有 off/high/max；GPT-5.5 最高到 xhigh；GPT-5.6 系列可以到 max。

权衡：档位越高，模型内部推理的 token 越多，复杂多步骤问题效果更好，但更慢也更贵。可以提示用户看顶部栏的费用，以及思考块里模型的推理过程。`,
          },
          seconds: 21,
          text: {
            en: `The reasoning level is how much the model is allowed to "think" before it answers. Pi maps it to each provider's own setting (reasoning effort, thinking budget, …):

| Level | Good for |
| --- | --- |
| **Off** | Quick answers, renames, formatting — no hidden reasoning at all |
| **Minimal / Low** | Small, well-specified edits |
| **Medium** | Everyday coding — the default in this demo |
| **High / Extra-high** | Multi-file changes, debugging, planning |
| **Max** | The hardest problems, when you don't mind waiting |

- **Only supported levels are offered.** DeepSeek V4 Pro has *off / high / max*; GPT-5.5 stops at *extra-high*; the GPT-5.6 models go up to *max*.
- **You can see the thinking.** The collapsed *Thinking* line above this reply expands to show my reasoning. **Settings → Thinking display** decides whether those blocks start expanded.
- **It costs tokens.** Reasoning tokens are billed as output. The top bar shows this session's tokens, cost and context usage — click it for a breakdown.
- **Defaults and pins.** New sessions start with the default from \`settings.json\`. A pattern like \`openai-codex/gpt-5.5:high\` in \`enabledModels\` pins a model to one level.

Notice the model switch is recorded in the session too — scroll up and you'll see the earlier reply came from DeepSeek V4 Pro.`,
            zh: `推理强度决定了模型在回答前可以「思考」多少。pi 会把它映射到各家服务商自己的参数（reasoning effort、thinking budget 等）：

| 档位 | 适用场景 |
| --- | --- |
| **关闭推理** | 快速问答、重命名、格式调整——完全不做隐藏推理 |
| **最低限度 / 低强度** | 需求明确的小改动 |
| **中等强度** | 日常编程——本演示的默认档位 |
| **高强度 / 超高强度** | 跨文件修改、调试、制定计划 |
| **最高强度** | 最难的问题，愿意多等一会儿的时候 |

- **只显示模型支持的档位**：DeepSeek V4 Pro 只有 *关闭 / 高强度 / 最高强度*；GPT-5.5 最高到 *超高强度*；GPT-5.6 系列可以到 *最高强度*。
- **可以查看思考过程**：这条回复上方折叠的「思考」行展开后就是我的推理过程。**设置 → 思考过程显示** 可以决定思考块默认是否展开。
- **会消耗 token**：推理 token 按输出计费。顶部栏会显示本会话的 token、费用和上下文占用，点击可以看明细。
- **默认值与固定档位**：新会话使用 \`settings.json\` 中的默认档位；在 \`enabledModels\` 里写 \`openai-codex/gpt-5.5:high\` 这样的规则，可以把某个模型固定在一个档位。

注意模型切换也记录在会话里了——往上翻，上一条回复来自 DeepSeek V4 Pro。`,
          },
        },
      ],
    },
    {
      kind: "user",
      gapMinutes: 3,
      text: {
        en: "How do I add my own OpenAI- or Anthropic-compatible provider, like that Claude Gateway?",
        zh: "怎么添加我自己的 OpenAI 或 Anthropic 兼容服务商，比如这个 Claude Gateway？",
      },
    },
    {
      kind: "assistant",
      rounds: [
        {
          thinking: {
            en: "Walk through the Add provider flow in the Models panel and show the resulting models.json entry.",
            zh: "按模型面板里「添加 Provider」的流程说明，并展示最终写入 models.json 的配置。",
          },
          seconds: 9,
          text: {
            en: `In **Models**, click **Add provider** and fill in the form:

1. **Name, base URL and API type** — \`openai-completions\`, \`openai-responses\`, \`anthropic-messages\` and more.
2. **API key** — paste it, or give an environment variable name or a \`!command\` (for example \`!op read op://dev/gateway/key\`) so the key never sits in the file.
3. **Import models…** reads the endpoint's model list so you can tick the ones you want.
4. **Fill model details** looks the model up on models.dev and fills in the context window, max output tokens, capabilities and prices.
5. **Test** sends a tiny request and shows the latency and the reply.

Saving writes \`~/.pi/agent/models.json\`, which pi in the terminal reads as well. The Claude Gateway in this demo looks like this:

\`\`\`json
{
  "providers": {
    "claude-gateway": {
      "name": "Claude Gateway",
      "baseUrl": "https://llm-gateway.example.com",
      "api": "anthropic-messages",
      "apiKey": "CLAUDE_GATEWAY_KEY",
      "models": [
        {
          "id": "claude-sonnet-5",
          "name": "Claude Sonnet 5",
          "reasoning": true,
          "input": ["text", "image"],
          "contextWindow": 1000000,
          "maxTokens": 128000,
          "cost": { "input": 2, "output": 10, "cacheRead": 0.2, "cacheWrite": 2.5 }
        }
      ]
    }
  }
}
\`\`\`

Try **Test** on one of its models in the panel — in this demo the gateway answers with a canned "hello".`,
            zh: `在 **模型** 面板中点击 **添加 Provider**，然后填写表单：

1. **名称、Base URL 和 API 类型**——可选 \`openai-completions\`、\`openai-responses\`、\`anthropic-messages\` 等。
2. **API Key**——可以直接粘贴，也可以填环境变量名或 \`!命令\`（例如 \`!op read op://dev/gateway/key\`），这样 Key 就不会明文写在文件里。
3. **导入模型…** 会读取接口的模型列表，勾选需要的即可。
4. **填入模型信息** 会在 models.dev 上查找该模型，自动填好上下文窗口、最大输出 token、能力和价格。
5. **测试** 会发送一个很小的请求，显示延迟和回复内容。

保存后会写入 \`~/.pi/agent/models.json\`，终端里的 pi 也会读取它。本演示中的 Claude Gateway 配置如下：

\`\`\`json
{
  "providers": {
    "claude-gateway": {
      "name": "Claude Gateway",
      "baseUrl": "https://llm-gateway.example.com",
      "api": "anthropic-messages",
      "apiKey": "CLAUDE_GATEWAY_KEY",
      "models": [
        {
          "id": "claude-sonnet-5",
          "name": "Claude Sonnet 5",
          "reasoning": true,
          "input": ["text", "image"],
          "contextWindow": 1000000,
          "maxTokens": 128000,
          "cost": { "input": 2, "output": 10, "cacheRead": 0.2, "cacheWrite": 2.5 }
        }
      ]
    }
  }
}
\`\`\`

可以在面板里对它的某个模型点一下 **测试**——在演示中，网关会回复一句预设的「你好」。`,
          },
        },
      ],
    },
  ],
};
