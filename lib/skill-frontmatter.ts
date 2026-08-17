import { parseFrontmatter } from "@earendil-works/pi-coding-agent";

const KEY = "disable-model-invocation";

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
  const closing = content.startsWith("---") ? content.indexOf("\n---", 3) : -1;
  const head = closing === -1 ? content : content.slice(0, closing);
  const tail = closing === -1 ? "" : content.slice(closing);

  if (disable) {
    if (hasKey) {
      return head.replace(new RegExp(`^${KEY}[ \\t]*:[^\\n]*`, "m"), `${KEY}: true`) + tail;
    }
    const withKey = head.replace(/^---\r?\n/, `---\n${KEY}: true\n`);
    if (withKey === head) {
      // No frontmatter block at all — create one.
      return `---\n${KEY}: true\n---\n${content}`;
    }
    return withKey + tail;
  }

  // Drop the line together with its preceding newline so no blank line is
  // left behind; the key is never the first line of the frontmatter block.
  return head.replace(new RegExp(`\\n${KEY}[ \\t]*:[^\\n]*`), "") + tail;
}
