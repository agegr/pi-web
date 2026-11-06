/**
 * The skills a turn loaded, read from the tool calls it made.
 *
 * pi hands the model the list of skills at the start of a run, so loading one is
 * an ordinary file access — `read` on `<dir>/skills/<name>/SKILL.md`, or a
 * command whose arguments name that file (`cat …/SKILL.md`). Nothing in the
 * session file says "this was a skill", so the name is recovered from the path
 * under one rule: the segment before `SKILL.md` is the name, and the one before
 * that has to be a skills folder (`skills`, `.agents`, `.claude`, `agent`). That
 * keeps an ordinary `docs/SKILL.md` from being counted as a skill.
 *
 * A skill shows one badge per turn however many times the run looks at it.
 */

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
