/**
 * Splits one pasted shell command into words, the way a POSIX shell would
 * before running it, without expanding anything. Runs in the browser and on
 * the server, so a preview and the server's re-parse agree.
 *
 * pi starts MCP servers through cross-spawn with no shell, so a line that
 * needs one (a pipe, `&&`, a redirect, `$(…)`) cannot work as written and is
 * refused with a typed error instead of being run half-way. Variables are not
 * expanded either: a `$NAME` outside single quotes is returned as its own
 * part, so the caller decides what it means (pi reads `${NAME}` only in env and
 * header values; in a command or an argument nothing would replace it).
 *
 * Differences from a POSIX shell, all in favour of what was pasted:
 * - A backslash before an ordinary character (a letter, a digit, `.`, `-`) is
 *   kept, as cmd and PowerShell keep it, and a word that starts like a Windows
 *   path (`C:\…`, `\\host\…`) keeps every backslash, so `C:\Users\me` is not
 *   read as `C:Usersme`. A backslash before whitespace, a quote, `$`, another
 *   backslash or a shell operator still escapes it.
 * - A line ending in `\`, `^` (cmd) or `` ` `` (PowerShell) continues on the
 *   next line, even with spaces after it.
 * - A newline that does not continue the command and is followed by another
 *   word is refused (`multiple-commands`); blank lines and `#` comments are not.
 */

export type ShellQuote = "none" | "single" | "double" | "ansi";

/** Literal text, after the shell's quote removal. */
export interface ShellTextPart {
  type: "text";
  value: string;
  quote: ShellQuote;
}

/** A `$NAME`, `${NAME}` or `${NAME:-fallback}` the shell would have expanded. */
export interface ShellVariablePart {
  type: "variable";
  name: string;
  /** As written, for example `${HOME}`. */
  raw: string;
  quote: "none" | "double";
  /** The literal word of `${NAME:-word}` / `${NAME-word}`. */
  fallback?: string;
}

export type ShellWordPart = ShellTextPart | ShellVariablePart;

export interface ShellWord {
  parts: ShellWordPart[];
  /** Text parts as their values, variables as written. */
  text: string;
}

export type ShellWordsError =
  | { code: "unterminated-quote"; quote: "'" | '"' }
  | { code: "shell-operator"; operator: string }
  | { code: "command-substitution"; syntax: string }
  | { code: "multiple-commands" }
  | { code: "shell-parameter"; parameter: string }
  | { code: "unsupported-expansion"; expansion: string };

export type ShellWordsResult =
  | { ok: true; words: ShellWord[] }
  | { ok: false; error: ShellWordsError };

const NAME_START = /[A-Za-z_]/;
const NAME_CHAR = /[A-Za-z0-9_]/;
const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** Characters an unquoted backslash escapes; before anything else it is kept. */
const ESCAPABLE = new Set([..." \t\n'\"\\$`|&;<>()#*?[]{}!~="]);
const OPERATOR_START = new Set([..."|&;<>()"]);
const SPECIAL_PARAMETER = /[0-9@*#?$!-]/;
const ANSI_ESCAPES: Record<string, string> = {
  n: "\n", t: "\t", r: "\r", a: "\x07", b: "\b", e: "\x1b", E: "\x1b", f: "\f", v: "\v",
  "\\": "\\", "'": "'", '"': '"', "?": "?",
};

/** `^` or `` ` `` (or `\`) with only spaces before the end of the line. */
function continuationLength(input: string, index: number): number {
  let end = index + 1;
  while (input[end] === " " || input[end] === "\t") end++;
  if (input[end] === "\r" && input[end + 1] === "\n") return end + 2 - index;
  if (input[end] === "\n") return end + 1 - index;
  return 0;
}

/** Whether the word starting here looks like a Windows path, whose backslashes are not escapes. */
function startsWindowsPath(input: string, index: number): boolean {
  return /^(?:[A-Za-z]:\\|\\\\[A-Za-z0-9.$_-])/.test(input.slice(index, index + 4));
}

function operatorAt(input: string, index: number): string {
  const two = input.slice(index, index + 2);
  if (["||", "&&", ";;", ">>", "<<", ">&", "<&", ">|", "<(", ">(", "&>"].includes(two)) return two;
  return input[index];
}

class Splitter {
  private index = 0;
  private readonly words: ShellWord[] = [];
  private parts: ShellWordPart[] | undefined;
  private windowsWord = false;
  private lineBreak = false;

  constructor(private readonly input: string) {}

  run(): ShellWordsResult {
    try {
      this.scan();
    } catch (error) {
      if (error instanceof SplitError) return { ok: false, error: error.detail };
      throw error;
    }
    return { ok: true, words: this.words };
  }

  private fail(detail: ShellWordsError): never {
    throw new SplitError(detail);
  }

  private startWord(): ShellWordPart[] {
    if (this.parts) return this.parts;
    if (this.lineBreak) this.fail({ code: "multiple-commands" });
    this.parts = [];
    this.windowsWord = startsWindowsPath(this.input, this.index);
    return this.parts;
  }

  private endWord(): void {
    if (!this.parts) return;
    // `""` and `''` leave empty text parts; drop them unless the word is empty.
    const nonEmpty = this.parts.filter((part) => part.type !== "text" || part.value !== "");
    const parts = nonEmpty.length > 0 ? nonEmpty : this.parts.slice(0, 1);
    this.words.push({
      parts,
      text: parts.map((part) => (part.type === "text" ? part.value : part.raw)).join(""),
    });
    this.parts = undefined;
    this.windowsWord = false;
  }

  private appendText(value: string, quote: ShellQuote): void {
    const parts = this.startWord();
    const last = parts[parts.length - 1];
    if (last?.type === "text" && last.quote === quote) last.value += value;
    else parts.push({ type: "text", value, quote });
  }

  private scan(): void {
    const { input } = this;
    while (this.index < input.length) {
      const char = input[this.index];
      if (char === " " || char === "\t") {
        this.endWord();
        this.index++;
      } else if (char === "\r" && input[this.index + 1] === "\n") {
        this.index++;
      } else if (char === "\n") {
        this.endWord();
        if (this.words.length > 0) this.lineBreak = true;
        this.index++;
      } else if ((char === "\\" || char === "^" || char === "`") && continuationLength(input, this.index) > 0) {
        this.index += continuationLength(input, this.index);
      } else if (char === "#" && !this.parts) {
        while (this.index < input.length && input[this.index] !== "\n") this.index++;
      } else if (char === "'") {
        this.startWord();
        this.singleQuoted();
      } else if (char === '"') {
        this.startWord();
        this.doubleQuoted();
      } else if (char === "$") {
        this.dollar("none");
      } else if (char === "`") {
        this.fail({ code: "command-substitution", syntax: "`" });
      } else if (OPERATOR_START.has(char)) {
        this.fail({ code: "shell-operator", operator: operatorAt(input, this.index) });
      } else if (char === "\\") {
        this.backslash();
      } else {
        this.appendText(char, "none");
        this.index++;
      }
    }
    this.endWord();
  }

  private backslash(): void {
    const next = this.input[this.index + 1];
    this.startWord();
    if (next === undefined || this.windowsWord || !ESCAPABLE.has(next)) {
      this.appendText("\\", "none");
      this.index++;
      return;
    }
    this.appendText(next, "none");
    this.index += 2;
  }

  private singleQuoted(): void {
    const end = this.input.indexOf("'", this.index + 1);
    if (end < 0) this.fail({ code: "unterminated-quote", quote: "'" });
    this.appendText(this.input.slice(this.index + 1, end), "single");
    this.index = end + 1;
  }

  private doubleQuoted(): void {
    const { input } = this;
    const windowsPath = startsWindowsPath(input, this.index + 1);
    this.index++;
    // An empty "" still makes a word.
    this.appendText("", "double");
    while (this.index < input.length) {
      const char = input[this.index];
      if (char === '"') {
        this.index++;
        return;
      }
      if (char === "\\") {
        const next = input[this.index + 1];
        if (next === "\n") {
          this.index += 2;
        } else if (next === "\r" && input[this.index + 2] === "\n") {
          this.index += 3;
        } else if (next === '"' || (!windowsPath && (next === "$" || next === "`" || next === "\\"))) {
          this.appendText(next, "double");
          this.index += 2;
        } else {
          this.appendText("\\", "double");
          this.index++;
        }
      } else if (char === "$") {
        this.dollar("double");
      } else if (char === "`") {
        this.fail({ code: "command-substitution", syntax: "`" });
      } else {
        this.appendText(char, "double");
        this.index++;
      }
    }
    this.fail({ code: "unterminated-quote", quote: '"' });
  }

  private ansiQuoted(): void {
    const { input } = this;
    this.index += 2;
    let value = "";
    while (this.index < input.length) {
      const char = input[this.index];
      if (char === "'") {
        this.appendText(value, "ansi");
        this.index++;
        return;
      }
      if (char !== "\\") {
        value += char;
        this.index++;
        continue;
      }
      const next = input[this.index + 1];
      if (next === "x" && /^[0-9A-Fa-f]{1,2}/.test(input.slice(this.index + 2))) {
        const hex = /^[0-9A-Fa-f]{1,2}/.exec(input.slice(this.index + 2))![0];
        value += String.fromCharCode(parseInt(hex, 16));
        this.index += 2 + hex.length;
      } else if ((next === "u" || next === "U") && /^[0-9A-Fa-f]{1,8}/.test(input.slice(this.index + 2))) {
        const hex = new RegExp(`^[0-9A-Fa-f]{1,${next === "u" ? 4 : 8}}`).exec(input.slice(this.index + 2))![0];
        const codePoint = parseInt(hex, 16);
        // Past U+10FFFF or a lone surrogate is no character; bash then prints the escape as text.
        value += codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)
          ? input.slice(this.index, this.index + 2 + hex.length)
          : String.fromCodePoint(codePoint);
        this.index += 2 + hex.length;
      } else if (next !== undefined && next in ANSI_ESCAPES) {
        value += ANSI_ESCAPES[next];
        this.index += 2;
      } else {
        value += "\\";
        this.index++;
      }
    }
    this.fail({ code: "unterminated-quote", quote: "'" });
  }

  private dollar(quote: "none" | "double"): void {
    const { input } = this;
    const next = input[this.index + 1];
    if (next === "(") this.fail({ code: "command-substitution", syntax: input[this.index + 2] === "(" ? "$((" : "$(" });
    if (quote === "none" && next === "'") {
      this.startWord();
      this.ansiQuoted();
      return;
    }
    if (quote === "none" && next === '"') {
      // $"…" is a locale-translated string; it reads like "…".
      this.startWord();
      this.index++;
      this.doubleQuoted();
      return;
    }
    if (next === "{") {
      this.braced(quote);
      return;
    }
    if (next !== undefined && NAME_START.test(next)) {
      let end = this.index + 1;
      while (end < input.length && NAME_CHAR.test(input[end])) end++;
      const name = input.slice(this.index + 1, end);
      this.startWord().push({ type: "variable", name, raw: `$${name}`, quote });
      this.index = end;
      return;
    }
    if (next !== undefined && SPECIAL_PARAMETER.test(next)) {
      this.fail({ code: "shell-parameter", parameter: `$${next}` });
    }
    // A `$` before a space, a quote or the end is a literal dollar sign.
    this.appendText("$", quote);
    this.index++;
  }

  private braced(quote: "none" | "double"): void {
    const { input } = this;
    const end = input.indexOf("}", this.index + 2);
    if (end < 0) this.fail({ code: "unsupported-expansion", expansion: input.slice(this.index) });
    const raw = input.slice(this.index, end + 1);
    const body = raw.slice(2, -1);
    if (/^[0-9@*#?$!-]$/.test(body)) this.fail({ code: "shell-parameter", parameter: raw });
    if (VARIABLE_NAME.test(body)) {
      this.startWord().push({ type: "variable", name: body, raw, quote });
      this.index = end + 1;
      return;
    }
    const fallback = /^([A-Za-z_][A-Za-z0-9_]*):?-([\s\S]*)$/.exec(body);
    if (fallback && !/[$`{}\\'"]/.test(fallback[2])) {
      this.startWord().push({ type: "variable", name: fallback[1], raw, quote, fallback: fallback[2] });
      this.index = end + 1;
      return;
    }
    this.fail({ code: "unsupported-expansion", expansion: raw });
  }
}

class SplitError extends Error {
  constructor(readonly detail: ShellWordsError) {
    super(detail.code);
  }
}

/** Split `input` into shell words; see the module comment for what is refused. */
export function splitShellWords(input: string): ShellWordsResult {
  return new Splitter(input).run();
}

/** The word's value when it holds no variable, else undefined. */
export function literalWord(word: ShellWord): string | undefined {
  return word.parts.every((part) => part.type === "text") ? word.text : undefined;
}

/**
 * `NAME=value` as the shell reads an assignment: the name and the `=` are
 * unquoted. Returns the value's parts, or undefined for any other word.
 */
export function shellAssignment(word: ShellWord): { name: string; value: ShellWordPart[] } | undefined {
  const [first, ...rest] = word.parts;
  if (first?.type !== "text" || first.quote !== "none") return undefined;
  const match = /^([A-Za-z_][A-Za-z0-9_]*)=/.exec(first.value);
  if (!match) return undefined;
  const remainder = first.value.slice(match[0].length);
  return {
    name: match[1],
    value: [...(remainder ? [{ ...first, value: remainder }] : []), ...rest],
  };
}

/** A word a POSIX shell reads back unchanged: as is when safe, else single-quoted. */
export function quoteShellWord(word: string): string {
  if (word !== "" && /^[A-Za-z0-9_@%+=:,./~-]+$/.test(word)) return word;
  return `'${word.replace(/'/g, `'\\''`)}'`;
}

/** Words joined into one display line that `splitShellWords` splits back into the same words. */
export function formatShellCommand(words: readonly string[]): string {
  return words.map(quoteShellWord).join(" ");
}
