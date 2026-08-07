/**
 * File attachments sent alongside a chat message. Files are uploaded to a
 * persistent local directory on selection; the message text sent to the agent
 * carries each file as an "[附件] <path>" line, which the UI renders as a
 * downloadable file card (mirroring how images are attached).
 */

export interface AttachedFile {
  path: string;
  size: number;
}

export interface AttachmentTextSegment {
  type: "text";
  text: string;
}

export interface AttachmentFileSegment {
  type: "attachment";
  path: string;
}

export type AttachmentSegment = AttachmentTextSegment | AttachmentFileSegment;

export const ATTACHMENT_LINE_PREFIX = "[附件]";

const ATTACHMENT_LINE_RE = /^\[附件\]\s+(.+)$/gm;

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function fileBaseName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

/** Appends each attached file as an "[附件] <path>" line to the message text. */
export function appendAttachmentPaths(message: string, files: AttachedFile[]): string {
  if (files.length === 0) return message;
  return message.trim() + files.map((f) => `\n\n${ATTACHMENT_LINE_PREFIX} ${f.path}`).join("");
}

/**
 * Splits message text into plain segments and "[附件] <path>" attachment
 * lines so the UI can render attachments as file cards instead of raw paths.
 */
export function splitAttachmentLinks(text: string): AttachmentSegment[] {
  if (!text.includes(ATTACHMENT_LINE_PREFIX)) {
    return [{ type: "text", text }];
  }

  const segments: AttachmentSegment[] = [];
  let lastIndex = 0;
  ATTACHMENT_LINE_RE.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = ATTACHMENT_LINE_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: "text", text: text.slice(lastIndex, match.index) });
    }
    segments.push({ type: "attachment", path: match[1].trim() });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    segments.push({ type: "text", text: text.slice(lastIndex) });
  }

  return segments;
}
