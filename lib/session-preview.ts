import { skillExpansionToCommand } from "./slash-display";

/** A short, single-line catalogue preview, not the full message or thinking. */
export const SESSION_PREVIEW_MAX_LENGTH = 240;

export function sessionMessagePreview(message: { role?: unknown; content?: unknown }): string | undefined {
  if (message.role !== "user" && message.role !== "assistant") return undefined;
  const content = message.content;
  const text = typeof content === "string" ? content : Array.isArray(content)
    ? content.flatMap((block: unknown) => {
      if (!block || typeof block !== "object") return [];
      const item = block as { type?: unknown; text?: unknown };
      return item.type === "text" && typeof item.text === "string" ? [item.text] : [];
    }).join(" ")
    : "";
  const display = message.role === "user" ? (skillExpansionToCommand(text) ?? text) : text;
  const compact = display.replace(/\s+/g, " ").trim();
  if (!compact) return undefined;
  if (compact.length <= SESSION_PREVIEW_MAX_LENGTH) return compact;
  const last = compact.charCodeAt(SESSION_PREVIEW_MAX_LENGTH - 1);
  return compact.slice(0, last >= 0xd800 && last <= 0xdbff ? SESSION_PREVIEW_MAX_LENGTH - 1 : SESSION_PREVIEW_MAX_LENGTH);
}
