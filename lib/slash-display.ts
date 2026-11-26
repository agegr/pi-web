/**
 * Display-only restoration for the exact envelope emitted by pi's
 * `_expandSkillCommand`. The expanded text remains the stored session input.
 */
const SKILL_EXPANSION_RE = /^<skill name="([^"\n]+)" location="([^"\n]+)">\nReferences are relative to [^\n]+\.\n\n([\s\S]*)\n<\/skill>(?:\n\n([\s\S]+))?$/;

/**
 * Restore a complete SDK skill expansion to its compact command form.
 *
 * The expression intentionally requires the opening envelope, matching
 * base-directory reference, final closing tag, and an optional two-newline args
 * suffix. This avoids collapsing ordinary text that merely starts with a
 * skill-looking tag. The greedy body capture makes the final closing tag win
 * when a skill body contains an example `</skill>` tag.
 */
export function skillExpansionToCommand(text: string): string | null {
  const match = text.match(SKILL_EXPANSION_RE);
  if (!match) return null;

  const [, name, , , args] = match;
  return args ? `/skill:${name} ${args}` : `/skill:${name}`;
}

/** A complete SDK skill expansion read apart, as pi's TUI shows it: the
 *  skill's name, the text inside the envelope (the reference line and the
 *  skill body, what `SkillInvocationMessageComponent` expands to) and the
 *  arguments after it, which are the user's own message (empty when none). */
export interface SkillExpansion {
  name: string;
  content: string;
  args: string;
}

export function parseSkillExpansion(text: string): SkillExpansion | null {
  const match = text.match(SKILL_EXPANSION_RE);
  if (!match) return null;
  const args = match[4];
  const tail = args === undefined ? "\n</skill>".length : "\n</skill>\n\n".length + args.length;
  return {
    name: match[1],
    content: text.slice(text.indexOf("\n") + 1, text.length - tail),
    args: args ?? "",
  };
}
