import { SCRATCH_ROOT } from "../../paths";
import { SESSION_IDS } from "../ids";
import type { SessionScript } from "../types";

export const scratchSession: SessionScript = {
  id: SESSION_IDS.scratch,
  cwd: SCRATCH_ROOT,
  startedMinutesAgo: 5 * 24 * 60 + 300,
  name: { en: "Quick question: SSE vs WebSocket", zh: "随手一问：SSE 还是 WebSocket" },
  steps: [
    { kind: "model", provider: "deepseek", modelId: "deepseek-v4-pro" },
    { kind: "thinking", level: "off" },
    { kind: "tools", tools: [] },
    {
      kind: "user",
      gapMinutes: 0.1,
      text: {
        en: "Quick one: when should a web app use Server-Sent Events instead of WebSockets?",
        zh: "问个小问题：Web 应用什么时候该用 Server-Sent Events，而不是 WebSocket？",
      },
    },
    {
      kind: "assistant",
      rounds: [
        {
          seconds: 9,
          text: {
            en: `Use **SSE** when data mostly flows **server → client** and the client talks back with ordinary requests:

- It's plain HTTP: works through proxies, load balancers and HTTP/2 without special configuration.
- \`EventSource\` reconnects automatically and can resume with \`Last-Event-ID\`.
- It's text-only and one-directional — that's the trade-off.

Use **WebSockets** when both sides send frequent messages (collaborative editing, games, terminals), or you need binary frames.

Pi Web is a good example of the SSE pattern: agent events stream to the browser over SSE, and prompts and commands go back as normal \`POST\` requests.

*This project uses the **Chat only** tool preset — no file or shell tools, just conversation. It lives in a dated scratch folder created with **Use default directory** in the project picker.*`,
            zh: `当数据主要是 **服务端 → 客户端** 单向流动、客户端用普通请求回传时，用 **SSE**：

- 它就是普通 HTTP：无需特殊配置就能穿过代理、负载均衡，也支持 HTTP/2。
- \`EventSource\` 会自动重连，并能通过 \`Last-Event-ID\` 断点续传。
- 只能传文本、只能单向——这是它的代价。

当双方都要频繁发消息（协同编辑、游戏、终端）或者需要二进制帧时，用 **WebSocket**。

Pi Web 本身就是 SSE 模式的例子：agent 事件通过 SSE 推送到浏览器，而提示词和命令则通过普通的 \`POST\` 请求发回去。

*这个项目使用 **仅聊天** 工具预设——没有文件和 shell 工具，只用来对话。它位于项目选择器中 **使用默认目录** 创建的带日期的临时文件夹里。*`,
          },
        },
      ],
    },
  ],
};
