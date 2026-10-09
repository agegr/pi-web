/**
 * Shell-command highlighting for the chat tool cards.
 *
 * A scanner, not a shell grammar: it recognizes only what reads at a glance —
 * the command word, flags, quoted spans, expansions, operators and comments —
 * so a card can highlight its command on every render. The result is plain
 * tokens rather than markup, which keeps highlighting independent of the
 * element it renders into (a one-line card header as much as a `pre`).
 */

export type BashTokenKind =
  | "plain"
  | "command"
  | "flag"
  | "string"
  | "variable"
  | "operator"
  | "comment";

export interface BashToken {
  kind: BashTokenKind;
  text: string;
}

const WHITESPACE = new Set([" ", "\t", "\r", "\n"]);
const OPERATOR_CHARS = "|&;<>{}()";
const DELIMITERS = new Set([...WHITESPACE, "'", '"', "`", "$", "\\", ...OPERATOR_CHARS]);
/** Characters a `$` may expand. */
const EXPANSION_START = /[A-Za-z0-9_?!@*$#]/;
/** Reserved words after which the next word runs a command, not an argument. */
const COMMAND_KEYWORDS = new Set(["then", "do", "else", "elif", "!"]);
const FLAG = /^-{1,2}[^\d\s]/;

function findLineEnd(text: string, start: number): number {
  const newline = text.indexOf("\n", start);
  return newline === -1 ? text.length : newline;
}

function findClosingParen(text: string, openIndex: number): number {
  let depth = 0;
  for (let index = openIndex; index < text.length; index += 1) {
    if (text[index] === "(") {
      depth += 1;
    } else if (text[index] === ")") {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  return text.length;
}

function isNameChar(char: string | undefined): boolean {
  return char !== undefined && /[\w]/.test(char);
}

/** The end of the `$…` expansion at `start`, or -1 when there is none. */
function expansionEnd(text: string, start: number): number {
  const next = text[start + 1];
  if (next === "{") {
    const end = text.indexOf("}", start + 2);
    return end === -1 ? text.length : end + 1;
  }
  if (next === "(") return findClosingParen(text, start + 1);
  if (next === undefined || !EXPANSION_START.test(next)) return -1;
  let end = start + 2;
  while (isNameChar(text[end])) end += 1;
  return end;
}

/**
 * A quoted span, up to and including the closing quote (or the end of the
 * command). Inside `"…"` an expansion is pushed separately so it keeps its own
 * colour; a backtick span is one substitution.
 */
function scanQuotes(
  text: string,
  start: number,
  quote: '"' | "`",
  push: (kind: BashTokenKind, value: string) => void,
): number {
  const kind: BashTokenKind = quote === '"' ? "string" : "variable";
  let index = start + 1;
  let chunk = start;
  while (index < text.length && text[index] !== quote) {
    if (text[index] === "\\") {
      index += quote === '"' ? 2 : 1;
    } else if (quote === '"' && text[index] === "$" && expansionEnd(text, index) !== -1) {
      push("string", text.slice(chunk, index));
      const end = expansionEnd(text, index);
      push("variable", text.slice(index, end));
      index = end;
      chunk = index;
    } else {
      index += 1;
    }
  }
  const stop = Math.min(index + 1, text.length);
  push(kind, text.slice(chunk, stop));
  return stop;
}

/**
 * `command` split into tokens, cut at `limit` characters for a one-line
 * preview. The kept pieces concatenate back to the command.
 */
export function tokenizeBash(command: string, limit = Number.POSITIVE_INFINITY): BashToken[] {
  const tokens: BashToken[] = [];
  let length = 0;
  let index = 0;
  // The first word of a line, and of a `|`, `&&`, `;` or subshell group, runs a
  // command; every other word is an argument.
  let expectCommand = true;
  let atWordStart = true;

  function push(kind: BashTokenKind, text: string): void {
    const kept = text.slice(0, Math.max(0, limit - length));
    if (!kept) return;
    length += kept.length;
    tokens.push({ kind, text: kept });
  }

  while (index < command.length && length < limit) {
    const char = command[index];

    if (WHITESPACE.has(char)) {
      const start = index;
      while (index < command.length && WHITESPACE.has(command[index])) index += 1;
      const run = command.slice(start, index);
      push("plain", run);
      atWordStart = true;
      if (run.includes("\n")) expectCommand = true;
      continue;
    }

    if (char === "\\") {
      const stop = Math.min(index + 2, command.length);
      push("plain", command.slice(index, stop));
      index = stop;
      atWordStart = false;
      continue;
    }

    // `#` starts a comment only at the start of a word; the word scan never
    // breaks on it, as in the shell itself.
    if (char === "#" && atWordStart) {
      const end = findLineEnd(command, index);
      push("comment", command.slice(index, end));
      index = end;
      continue;
    }

    if (char === "'") {
      const end = command.indexOf("'", index + 1);
      const stop = end === -1 ? command.length : end + 1;
      push("string", command.slice(index, stop));
      index = stop;
      atWordStart = false;
      continue;
    }

    if (char === '"' || char === "`") {
      const stop = scanQuotes(command, index, char, push);
      index = stop;
      atWordStart = false;
      continue;
    }

    if (char === "$") {
      const end = expansionEnd(command, index);
      push(end === -1 ? "plain" : "variable", end === -1 ? "$" : command.slice(index, end));
      index = end === -1 ? index + 1 : end;
      atWordStart = false;
      continue;
    }

    if (OPERATOR_CHARS.includes(char)) {
      const start = index;
      while (index < command.length && OPERATOR_CHARS.includes(command[index])) index += 1;
      const run = command.slice(start, index);
      push("operator", run);
      // A redirection is followed by a file or a descriptor (`2>&1`), not by
      // another command; a subshell group (`<(`, `{`) starts one.
      expectCommand = run.includes("(") || run.includes("{")
        || (!run.includes(">") && !run.includes("<"));
      atWordStart = true;
      continue;
    }

    const start = index;
    while (index < command.length && !DELIMITERS.has(command[index])) index += 1;
    const word = command.slice(start, index);
    // A leading `NAME=value` assignment configures the command that follows;
    // it does not take the command slot itself. Only the name gets a colour;
    // the value keeps the surrounding text colour so long paths stay readable.
    const assignment = /^([A-Za-z_][A-Za-z0-9_]*=)(.*)$/.exec(word);
    if (assignment) {
      push("variable", assignment[1]);
      if (assignment[2]) push("plain", assignment[2]);
      atWordStart = false;
      continue;
    }
    const kind: BashTokenKind = FLAG.test(word)
      ? "flag"
      : expectCommand
        ? "command"
        : "plain";
    push(kind, word);
    atWordStart = false;
    expectCommand = kind === "command" && COMMAND_KEYWORDS.has(word);
  }

  return tokens;
}