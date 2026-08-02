/**
 * Splits message text into <skill>...</skill> blocks (produced by the pi agent
 * core when a `/skill:name` command is expanded) and plain text segments, so
 * the UI can collapse the verbose skill content into a single header line.
 */

export interface SkillBlockSegment {
  type: "skill";
  name: string;
  location: string;
  /** Full block including the <skill>...</skill> wrapper. */
  body: string;
  /** Inner content (without the wrapper tags). */
  content: string;
}

export interface TextSegment {
  type: "text";
  text: string;
}

export type MessageSegment = SkillBlockSegment | TextSegment;

const SKILL_BLOCK_RE = /<skill\b([^>]*)>([\s\S]*?)<\/skill>/g;

function parseSkillAttributes(attrs: string): { name: string; location: string } {
  const name = /name="([^"]*)"/.exec(attrs)?.[1] ?? "";
  const location = /location="([^"]*)"/.exec(attrs)?.[1] ?? "";
  return { name, location };
}

export function splitSkillBlocks(text: string): MessageSegment[] {
  if (!text.includes("<skill")) {
    return [{ type: "text", text }];
  }

  const segments: MessageSegment[] = [];
  let lastIndex = 0;
  SKILL_BLOCK_RE.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = SKILL_BLOCK_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: "text", text: text.slice(lastIndex, match.index) });
    }
    const { name, location } = parseSkillAttributes(match[1]);
    const body = match[0];
    segments.push({ type: "skill", name, location, body, content: match[2] });
    lastIndex = match.index + body.length;
  }

  if (lastIndex < text.length) {
    segments.push({ type: "text", text: text.slice(lastIndex) });
  }

  return segments;
}
