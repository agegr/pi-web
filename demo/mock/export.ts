/**
 * "Full history" normally opens pi's HTML export from the server. The demo
 * renders a simple standalone transcript of the active branch instead.
 */
import type { AgentMessage } from "@/lib/types";
import { currentDemoLocale } from "./locale";
import { buildContext, ensureSessions, getSession } from "./sessions/store";

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

function blockText(message: AgentMessage): string {
  if (message.role === "bashExecution") return `$ ${message.command}\n${message.output}`;
  const content = "content" in message ? message.content : "";
  if (typeof content === "string") return content;
  return (content as unknown as Array<Record<string, unknown>>).map((block) => {
    if (block.type === "text") return String(block.text ?? "");
    if (block.type === "thinking") return `💭 ${String(block.thinking ?? "")}`;
    if (block.type === "toolCall") return `🔧 ${String(block.toolName ?? block.name)} ${JSON.stringify(block.input ?? block.arguments ?? {})}`;
    return "";
  }).filter(Boolean).join("\n\n");
}

export async function renderHistoryHtml(sessionId: string): Promise<string> {
  await ensureSessions();
  const session = getSession(sessionId);
  const zh = currentDemoLocale() === "zh";
  if (!session) return "<p>Session not found</p>";
  const context = buildContext(session, session.leafId, { tail: 0 });
  const title = session.name ?? (zh ? "会话" : "Session");
  const rows = context.messages.map((message) => {
    const role = message.role === "custom" ? (zh ? "摘要" : "summary") : message.role;
    const model = message.role === "assistant" ? ` · ${escapeHtml(message.model)}` : "";
    return `<section class="msg ${escapeHtml(message.role)}"><header>${escapeHtml(role)}${model}</header><pre>${escapeHtml(blockText(message))}</pre></section>`;
  }).join("\n");
  return `<!doctype html><html lang="${zh ? "zh-CN" : "en"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title>
<style>
:root{color-scheme:light dark;--bg:#fff;--fg:#1a1a1a;--muted:#5e6673;--line:#e0e0e0;--user:#eff6ff;--tool:#f9fafb}
@media (prefers-color-scheme:dark){:root{--bg:#1a1a1a;--fg:#e8e8e8;--muted:#a4a4a4;--line:#454545;--user:#292929;--tool:#222}}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.6 system-ui,sans-serif}
main{max-width:820px;margin:0 auto;padding:24px 16px}
h1{font-size:20px;margin:0 0 4px}.meta{color:var(--muted);font-size:12px;margin-bottom:20px}
.msg{border:1px solid var(--line);border-radius:10px;margin:12px 0;overflow:hidden}
.msg header{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);padding:6px 12px;border-bottom:1px solid var(--line)}
.msg.user{background:var(--user)}.msg.toolResult,.msg.bashExecution{background:var(--tool)}
pre{margin:0;padding:10px 12px;white-space:pre-wrap;word-break:break-word;font:13px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace}
</style></head><body><main><h1>${escapeHtml(title)}</h1>
<div class="meta">${escapeHtml(session.cwd)} · ${context.messages.length} ${zh ? "条消息 · Pi Web 演示导出" : "messages · Pi Web demo export"}</div>
${rows}</main></body></html>`;
}

export function openDemoHistory(sessionId: string): void {
  const win = window.open("", "_blank");
  void renderHistoryHtml(sessionId).then((html) => {
    const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    if (win) win.location.href = url;
    else window.open(url, "_blank", "noopener,noreferrer");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  });
}
