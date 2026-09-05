import { parseFrontmatter } from "@earendil-works/pi-coding-agent";

const KEY = "disable-model-invocation";
const KEY_LINE = `[ \\t]*(?:${KEY}|"${KEY}"|'${KEY}')[ \\t]*:`;
const NEWLINE = "\\r\\n|\\n|\\r";

interface FrontmatterBlock {
  openingEnd: number;
  closingStart: number;
  newline: string;
}

function findFrontmatterBlock(content: string): FrontmatterBlock | undefined {
  const opening = new RegExp(`^\\uFEFF?---[ \\t]*(${NEWLINE})`).exec(content);
  if (!opening) return undefined;

  const rest = content.slice(opening[0].length);
  // Pi SDK closes frontmatter at the first line starting with ---.
  const closing = new RegExp(`(^|${NEWLINE})---`).exec(rest);
  if (!closing) return undefined;

  return {
    openingEnd: opening[0].length,
    closingStart: opening[0].length + closing.index + closing[1].length,
    newline: opening[1],
  };
}

function startsWithFrontmatterFence(content: string): boolean {
  const start = content.startsWith("\uFEFF") ? 1 : 0;
  return content.startsWith("---", start);
}

/**
 * Toggle the `disable-model-invocation` frontmatter key with a surgical line
 * edit that preserves the original YAML formatting of every other field.
 *
 * The key is detected by presence rather than truthiness: an explicit
 * `disable-model-invocation: false` must be updated in place. Prepending a
 * second key (as a truthiness check would) creates a duplicate YAML key that
 * makes the whole file unparseable, and the skill loader then drops the skill.
 */
export function setDisableModelInvocation(content: string, disable: boolean): string {
  const { frontmatter } = parseFrontmatter<Record<string, unknown>>(content);
  const hasKey = Object.prototype.hasOwnProperty.call(frontmatter, KEY);
  if (!disable && !hasKey) return content;

  // Only edit inside the frontmatter block, so a body line that happens to
  // document the key is never touched.
  const block = findFrontmatterBlock(content);

  if (disable) {
    if (hasKey) {
      if (!block) throw new Error(`Cannot edit ${KEY}: unsupported frontmatter formatting`);
      const head = content.slice(block.openingEnd, block.closingStart);
      const keyLine = new RegExp(`(^|${NEWLINE})(${KEY_LINE})[^\\r\\n]*`);
      if (!keyLine.test(head)) throw new Error(`Cannot edit ${KEY}: unsupported frontmatter formatting`);
      const updated = head.replace(keyLine, "$1$2 true");
      return content.slice(0, block.openingEnd) + updated + content.slice(block.closingStart);
    }
    if (!block) {
      if (startsWithFrontmatterFence(content)) {
        throw new Error(`Cannot edit ${KEY}: unsupported frontmatter formatting`);
      }
      // No frontmatter block at all — create one.
      const bom = content.startsWith("\uFEFF") ? "\uFEFF" : "";
      const body = bom ? content.slice(1) : content;
      return `${bom}---\n${KEY}: true\n---\n${body}`;
    }
    return (
      content.slice(0, block.openingEnd) +
      `${KEY}: true${block.newline}` +
      content.slice(block.openingEnd)
    );
  }

  if (!block) throw new Error(`Cannot edit ${KEY}: unsupported frontmatter formatting`);
  const head = content.slice(block.openingEnd, block.closingStart);
  // Keep the preceding newline, when present, and consume the key line's own
  // newline so the surrounding frontmatter retains exactly one line break.
  const keyLine = new RegExp(`(^|${NEWLINE})${KEY_LINE}[^\\r\\n]*(?:${NEWLINE}|$)`);
  if (!keyLine.test(head)) throw new Error(`Cannot edit ${KEY}: unsupported frontmatter formatting`);
  const updated = head.replace(keyLine, "$1");
  return content.slice(0, block.openingEnd) + updated + content.slice(block.closingStart);
}
