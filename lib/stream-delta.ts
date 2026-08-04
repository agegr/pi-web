// 流式消息增量拼接的纯函数模块。
//
// 服务端把 SDK 的 `message_update` 事件投影为轻量 `message_delta`（剥离
// `partial`——每个 delta 事件都携带的完整累积消息），浏览器端用本模块把
// delta 追加到本地流式消息上。这样传输量 = 内容本身（O(n)），而不是每个
// 更新块都重发此前生成的全部内容（O(n²)）。

/** 服务端转发的轻量 delta（`assistantMessageEvent` 剥离 `partial` 后）。结构
 *  对齐 `@earendil-works/pi-ai` 的 `AssistantMessageEvent`。 */
export interface AssistantStreamDelta {
  type: string;
  contentIndex?: number;
  delta?: string;
  content?: string;
  /** toolcall_start 时服务端从 partial 提取注入（SDK 事件本身不带 id/name）。 */
  id?: string;
  name?: string;
  toolCall?: Record<string, unknown>;
}

/** 流式拼接过程中的 content block。拼接发生在 SDK 结构上（toolCall 扁平：
 *  `id`/`name`/`arguments`），最终经 `normalizeToolCalls` 转换为渲染格式。 */
interface StreamContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  arguments?: unknown;
}

/** 流式消息（宽松结构：不绑定具体消息类型）。 */
export interface StreamMessage {
  role?: string;
  content?: unknown;
  [key: string]: unknown;
}

/**
 * 把一条 `assistantMessageEvent` delta 应用到当前流式消息上（追加式拼接）。
 * 返回新消息对象；若该 delta 不改变消息内容（start/done/error/未知类型）
 * 则返回原对象（引用相等，调用方可跳过渲染）。
 */
export function applyAssistantDelta(prev: StreamMessage | null, delta: AssistantStreamDelta): StreamMessage {
  const msg: StreamMessage = prev ?? { role: "assistant", content: [] };
  const content = Array.isArray(msg.content) ? [...msg.content] : [];
  const idx = delta.contentIndex ?? 0;
  switch (delta.type) {
    case "text_start":
      content[idx] = { type: "text", text: "" };
      break;
    case "text_delta": {
      const block = content[idx] as StreamContentBlock | undefined;
      const text = block?.type === "text" && typeof block.text === "string" ? block.text : "";
      content[idx] = { type: "text", text: text + (delta.delta ?? "") };
      break;
    }
    case "text_end":
      content[idx] = { type: "text", text: delta.content ?? "" };
      break;
    case "thinking_start":
      content[idx] = { type: "thinking", thinking: "" };
      break;
    case "thinking_delta": {
      const block = content[idx] as StreamContentBlock | undefined;
      const thinking = block?.type === "thinking" && typeof block.thinking === "string" ? block.thinking : "";
      content[idx] = { type: "thinking", thinking: thinking + (delta.delta ?? "") };
      break;
    }
    case "thinking_end":
      content[idx] = { type: "thinking", thinking: delta.content ?? "" };
      break;
    case "toolcall_start":
      content[idx] = { type: "toolCall", id: delta.id ?? "", name: delta.name ?? "", arguments: "" };
      break;
    case "toolcall_delta": {
      const block = content[idx] as StreamContentBlock | undefined;
      const id = block?.type === "toolCall" && typeof block.id === "string" ? block.id : "";
      const name = block?.type === "toolCall" && typeof block.name === "string" ? block.name : "";
      const args = block?.type === "toolCall" && typeof block.arguments === "string" ? block.arguments : "";
      content[idx] = { type: "toolCall", id, name, arguments: args + (delta.delta ?? "") };
      break;
    }
    case "toolcall_end":
      // toolCall 自带 type: "toolCall"，可直接作为 content block；arguments 为完整对象。
      content[idx] = (delta.toolCall as StreamContentBlock | undefined) ?? { type: "toolCall", id: "", name: "", arguments: {} };
      break;
    default:
      // start / done / error / 未知类型：内容无变化，保留当前状态。
      return msg;
  }
  return { ...msg, content };
}
