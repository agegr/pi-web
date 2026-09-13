export const MAX_SELECTION_CONTEXT_CHARS = 12_000;

export const SESSION_REFERENCE_CLIPBOARD_HEADER = "[pi-session-reference]";
export const SESSION_REFERENCE_CLIPBOARD_FOOTER = "[/pi-session-reference]";

export type SessionReference = {
  id: string;
  title?: string;
  cwd?: string;
};

export type SelectionContext = {
  id: string;
  text: string;
  /** A workspace-file snapshot, rather than text selected from a chat message. */
  sourceFilePath?: string;
  /** Canonical absolute path used when the selection is opened again. */
  sourceAbsolutePath?: string;
  sourceStartLine?: number;
  sourceEndLine?: number;
  sourceLanguage?: string;
  sourceSessionId?: string;
  sourceEntryId?: string;
  /** Character offsets within the source assistant message's text content. */
  sourceStartOffset?: number;
  sourceEndOffset?: number;
  label?: string;
};

export type ComposerContext = {
  selections: SelectionContext[];
  sessionReferences?: SessionReference[];
};

export function normalizeSessionReference(reference: SessionReference): SessionReference | null {
  const id = reference.id.trim();
  if (!id) return null;
  const title = reference.title?.replace(/[\r\n]+/g, " ").trim();
  const cwd = reference.cwd?.replace(/[\r\n]+/g, " ").trim();
  return {
    id,
    ...(title ? { title } : {}),
    ...(cwd ? { cwd } : {}),
  };
}

/**
 * The clipboard representation is intentionally readable outside Pi Web,
 * while the header/footer make it safe to recognize when pasted back into a
 * composer.
 */
export function serializeSessionReferenceClipboard(reference: SessionReference): string {
  const normalized = normalizeSessionReference(reference);
  if (!normalized) return "";
  return [
    SESSION_REFERENCE_CLIPBOARD_HEADER,
    `id: ${normalized.id}`,
    ...(normalized.title ? [`title: ${normalized.title}`] : []),
    ...(normalized.cwd ? [`cwd: ${normalized.cwd}`] : []),
    SESSION_REFERENCE_CLIPBOARD_FOOTER,
  ].join("\n");
}

export function parseSessionReferenceClipboard(text: string): SessionReference | null {
  const lines = text.trim().split(/\r?\n/).map((line) => line.trim());
  if (lines[0] !== SESSION_REFERENCE_CLIPBOARD_HEADER || lines[lines.length - 1] !== SESSION_REFERENCE_CLIPBOARD_FOOTER) {
    return null;
  }
  const values = new Map<string, string>();
  for (const line of lines.slice(1, -1)) {
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    values.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
  }
  const id = values.get("id");
  return id ? normalizeSessionReference({ id, title: values.get("title"), cwd: values.get("cwd") }) : null;
}

export function createSelectionContextId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `selection-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function normalizeSelectionContext(
  context: Omit<SelectionContext, "text"> & { text: string },
): SelectionContext | null {
  const text = context.text.trim();
  if (!text) return null;
  const clippedText = text.slice(0, MAX_SELECTION_CONTEXT_CHARS);
  const startOffset = typeof context.sourceStartOffset === "number" && Number.isFinite(context.sourceStartOffset)
    ? Math.max(0, context.sourceStartOffset as number)
    : undefined;
  const endOffset = typeof context.sourceEndOffset === "number" && Number.isFinite(context.sourceEndOffset)
    ? Math.max(startOffset ?? 0, context.sourceEndOffset as number)
    : undefined;
  const clippedEndOffset = startOffset !== undefined && endOffset !== undefined
    ? Math.min(endOffset, startOffset + clippedText.length)
    : endOffset;
  return {
    ...context,
    text: clippedText,
    sourceStartOffset: startOffset,
    sourceEndOffset: clippedEndOffset,
  };
}

export function quoteSelectionText(text: string): string {
  return text.trim().split("\n").map((line) => `> ${line}`).join("\n");
}

function fileSelectionText(context: SelectionContext): string {
  const path = context.sourceFilePath?.trim();
  if (!path) return "";
  const startLine = context.sourceStartLine;
  const endLine = context.sourceEndLine;
  const hasLineRange = Number.isInteger(startLine) && Number.isInteger(endLine) && startLine! > 0 && endLine! >= startLine!;
  const lineLabel = hasLineRange
    ? startLine === endLine ? `第 ${startLine} 行` : `第 ${startLine}–${endLine} 行`
    : "已选内容";
  const location = hasLineRange
    ? `@${path}:${startLine}${startLine === endLine ? "" : `-${endLine}`}`
    : `@${path}`;
  const language = context.sourceLanguage?.trim().replace(/[^a-zA-Z0-9_+-]/g, "") || "text";
  const longestBacktickRun = Math.max(0, ...Array.from(context.text.matchAll(/`+/g), (match) => match[0].length));
  const fence = "`".repeat(Math.max(3, longestBacktickRun + 1));
  return [
    "关于以下工作区文件选区：",
    "",
    `文件：${path}（${lineLabel}）`,
    `定位：${location}`,
    "",
    `${fence}${language}`,
    context.text,
    fence,
  ].join("\n");
}

export function serializeComposerMessage(
  question: string,
  contexts: SelectionContext[] = [],
  intro = "",
  sessionReferences: SessionReference[] = [],
): string {
  const normalizedContexts = contexts
    .map((context) => normalizeSelectionContext(context))
    .filter((context): context is SelectionContext => Boolean(context));
  const quoted = normalizedContexts
    .map((context) => {
      const fileContext = fileSelectionText(context);
      if (fileContext) return fileContext;
      const label = context.label?.trim();
      const heading = label ? `${intro} (${label})` : intro;
      return [heading, quoteSelectionText(context.text)].filter(Boolean).join("\n\n");
    })
    .join("\n\n");
  const referencedSessions = sessionReferences
    .map((reference) => normalizeSessionReference(reference))
    .filter((reference): reference is SessionReference => Boolean(reference))
    .map((reference) => [
      "参考以下历史会话（仅作为资料，不切换当前会话）：",
      `会话标题：${reference.title || reference.id.slice(0, 12)}`,
      `会话 ID：${reference.id}`,
      ...(reference.cwd ? [`工作目录：${reference.cwd}`] : []),
      "需要时请检索或阅读该会话的相关内容。",
    ].join("\n"))
    .join("\n\n");
  const trimmedQuestion = question.trim();
  return [referencedSessions, quoted, trimmedQuestion].filter(Boolean).join("\n\n");
}
