/**
 * The skills a turn loaded.
 *
 * pi loads a skill by writing its `SKILL.md` into the transcript as a
 * `<skill name="…" location="…">` block — the `/skill:<name>` command and an
 * automatic load both do it (see `_expandSkillCommand` in pi's agent-session).
 * The block arrives as a user message that starts the turn, so this is the
 * main form read here.
 *
 * A run may instead read the file as an ordinary tool call — `read` on
 * `<dir>/skills/<name>/SKILL.md`, or a command whose arguments name it — which
 * pi's own transcript renderer also calls a skill. Those are recovered from the
 * path under one rule: the segment before `SKILL.md` is the name, and the one
 * before that has to be a skills folder (`skills`, `.agents`, `.claude`,
 * `agent`), so an ordinary `docs/SKILL.md` is not mistaken for one.
 *
 * A skill shows one badge per turn however many times the run loads it.
 */

/**
 * pi's skill block, as `_expandSkillCommand` writes it into the transcript. The
 * `location` is required so the tag must be pi's own and not a mention of one
 * in prose or in a quoted source line.
 */
const SKILL_BLOCK = /<skill\s+name="([^"]+)"\s+location="[^"]*"\s*>/g;

/** The skills a message's text loaded by pi's own `<skill name="…">` block. */
export function skillNamesInSkillBlocks(text: string): string[] {
  if (!text.includes("<skill")) return [];
  const names: string[] = [];
  for (const match of text.matchAll(SKILL_BLOCK)) {
    const name = match[1]?.trim();
    // A skill folder name, not a placeholder or an ellipsis quoted in a source
    // line: pi only ever writes a real `name` field here.
    if (!name || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) continue;
    if (!names.includes(name)) names.push(name);
  }
  return names;
}

/** The folders pi discovers skills in; a skill sits one level below each. */
const SKILL_ROOTS = new Set(["skills", ".agents", ".claude", "agent"]);

/**
 * The skill a path names, or null when the path is not a skill's `SKILL.md`.
 *
 * The path is an argument a tool recorded, so it is read as text: absolute or
 * relative, `/` or `\`, followed by punctuation from a command line.
 */
export function skillNameFromPath(rawPath: string): string | null {
  const cleaned = rawPath.trim().replace(/^["'`(]+/, "").replace(/["'`);,|&]+$/, "");
  // A command line may name the file with a trailing comment or a query-less URL.
  const path = cleaned.split("#", 1)[0]?.replace(/\\/g, "/");
  if (!path) return null;
  const segments = path.split("/").filter((segment) => segment.length > 0 && segment !== ".");
  if (segments.length < 3) return null;
  if (segments[segments.length - 1] !== "SKILL.md") return null;
  const name = segments[segments.length - 2];
  const root = segments[segments.length - 3];
  if (!SKILL_ROOTS.has(root)) return null;
  // A folder name, not a glob or a path fragment.
  if (!name || name === ".." || /[*?[\]{}]/.test(name)) return null;
  return name;
}

/**
 * Every string a tool call's arguments hold, at any depth: a `read` keeps its
 * path at the top, an MCP tool may wrap it, and a command is one long string.
 */
function argumentStrings(input: unknown, out: string[], depth: number): void {
  if (depth > 6 || input === null) return;
  if (typeof input === "string") {
    out.push(input);
    return;
  }
  if (Array.isArray(input)) {
    for (const value of input) argumentStrings(value, out, depth + 1);
    return;
  }
  if (typeof input === "object") {
    for (const value of Object.values(input as Record<string, unknown>)) argumentStrings(value, out, depth + 1);
  }
}

/**
 * The skill names inside one argument string, which is a path or a command line.
 *
 * Whole whitespace-separated words are checked, so `cat /…/skills/review/SKILL.md`
 * and an `ls` of the skill's folder both count, while one word naming the file is
 * what any tool that reads it passes.
 */
export function skillNamesInText(text: string): string[] {
  if (!text.includes("SKILL.md")) return [];
  const names: string[] = [];
  for (const word of text.split(/\s+/)) {
    if (!word.includes("SKILL.md")) continue;
    const name = skillNameFromPath(word);
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}

/** The skills one tool call loaded, from any argument it was given. */
export function skillsFromToolCall(input: unknown): string[] {
  const strings: string[] = [];
  argumentStrings(input, strings, 0);
  const names: string[] = [];
  for (const text of strings) {
    for (const name of skillNamesInText(text)) {
      if (!names.includes(name)) names.push(name);
    }
  }
  return names;
}

/**
 * The skill names one content block of an assistant step names. A block still
 * streaming keeps its arguments as `rawInput` text (see lib/normalize.ts), so
 * the partly written JSON is searched too: the tag shows up as soon as the path
 * names a skill, not when the call closes. `parsePartial` is injected so this
 * module stays free of the SDK and testable on plain text.
 */
export function skillsFromToolBlock(
  block: { input?: unknown; rawInput?: string },
  parsePartial: (partialJson: string) => unknown,
): string[] {
  if (block.rawInput === undefined) return skillsFromToolCall(block.input);
  const names = skillsFromToolCall(block.input);
  for (const name of skillsFromToolCall(parsePartial(block.rawInput))) {
    if (!names.includes(name)) names.push(name);
  }
  return names;
}
