// Chained slash-command expansion.
//
// The Pi SDK expands only the first `/command` in a prompt and treats the
// rest of the line as that command's arguments (`expandPromptTemplate` in
// core/prompt-templates.ts). So a message like
//
//     /ref <url> /fuse <task>
//
// runs /ref with args "<url> /fuse <task>" and never runs /fuse.
//
// This module restores the intended behavior for prompt templates: when a
// prompt starts with one known template and later contains further known
// `/template` tokens, each is expanded with its own arguments and the results
// are concatenated into one prompt, in order.
//
// Only names that match a loaded prompt template trigger a split, so URLs,
// absolute paths, and prose containing slashes are left alone. A prompt with a
// single command is returned unchanged so the SDK keeps handling it (extension
// commands, skills, and diagnostics included).

export interface ChainableTemplate {
  name: string;
  content: string;
}

export interface ChainedCommandSegment {
  name: string;
  args: string;
}

interface CommandToken {
  name: string;
  start: number;
  end: number;
}

// `(^|\s)\/name` — a slash command must start the string or follow whitespace.
const COMMAND_TOKEN = /(^|\s)\/([A-Za-z0-9_][A-Za-z0-9_.-]*)/g;

// Editor file references, e.g. `@file` or `@"some dir/"`, may precede a
// command. They are not part of the prompt's leading command position but
// should not stop a `/command` right after them from running.
const LEADING_FILE_REFS = /^(?:\s*@(?:"[^"]*"|'[^']*'|\S+))+\s*/;

/**
 * Appended to every expansion so the instructions of one `/command` do not
 * leak into the following turns. Without it a template body that says "run
 * ask-dual.sh and present the three sections" stays in context forever, and the
 * model re-runs the workflow on the next unrelated message.
 */
const ONE_SHOT_SCOPE = [
  "---",
  "**【一次性指令，仅对本次回复生效】**",
  "上面的命令内容只约束你处理这一条消息。完成并回复之后，这条指令立即失效：后续对话默认按普通单模型对话处理，不要自动重跑本命令的流程、不要再次调用其中的脚本。",
  "只有我在新消息里重新输入该 `/命令` 时，才再次按它执行。若未重新输入，我需要双模型或引用其他会话时，我自己会说。",
].join("\n");

function withOneShotScope(expanded: string): string {
  return `${expanded}\n\n${ONE_SHOT_SCOPE}`;
}

/** Parse command arguments respecting quoted strings (bash-style). Mirrors the SDK. */
export function parseCommandArgs(argsString: string): string[] {
  const args: string[] = [];
  let current = "";
  let inQuote: string | null = null;

  for (let i = 0; i < argsString.length; i++) {
    const char = argsString[i];
    if (inQuote) {
      if (char === inQuote) inQuote = null;
      else current += char;
    } else if (char === '"' || char === "'") {
      inQuote = char;
    } else if (/\s/.test(char)) {
      if (current) {
        args.push(current);
        current = "";
      }
    } else {
      current += char;
    }
  }
  if (current) args.push(current);
  return args;
}

/** Substitute `$1`, `$@`, `${N:-default}`, `${@:N}` ... in a template body. Mirrors the SDK. */
export function substituteArgs(content: string, args: string[]): string {
  const allArgs = args.join(" ");

  return content.replace(
    /\$\{(\d+|ARGUMENTS|@):-([^}]*)\}|\$\{@:(\d+)(?::(\d+))?\}|\$(ARGUMENTS|@|\d+)/g,
    (_match, defaultTarget, defaultValue, sliceStart, sliceLength, simple) => {
      if (defaultTarget) {
        const value =
          defaultTarget === "@" || defaultTarget === "ARGUMENTS"
            ? allArgs
            : args[parseInt(defaultTarget, 10) - 1];
        return value ? value : defaultValue;
      }

      if (sliceStart) {
        let start = parseInt(sliceStart, 10) - 1; // 1-indexed, bash style
        if (start < 0) start = 0;
        if (sliceLength) {
          const length = parseInt(sliceLength, 10);
          return args.slice(start, start + length).join(" ");
        }
        return args.slice(start).join(" ");
      }

      if (simple === "ARGUMENTS" || simple === "@") return allArgs;

      const index = parseInt(simple, 10) - 1;
      return args[index] ?? "";
    },
  );
}

function tokenizeCommands(text: string, names: ReadonlySet<string>): CommandToken[] {
  const tokens: CommandToken[] = [];
  COMMAND_TOKEN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = COMMAND_TOKEN.exec(text)) !== null) {
    const name = match[2];
    if (!names.has(name)) continue;
    const start = match.index + match[1].length;
    tokens.push({ name, start, end: start + 1 + name.length });
  }
  return tokens;
}

/**
 * Split `text` into consecutive `/template` invocations. Returns null unless
 * the text starts with a known template and at least one later known template
 * follows. Command names not present in `names` are ignored entirely, so they
 * stay inside the surrounding command's arguments.
 */
export function splitChainedCommands(
  text: string,
  names: ReadonlySet<string>,
): ChainedCommandSegment[] | null {
  if (!text.startsWith("/") || names.size === 0) return null;

  const tokens = tokenizeCommands(text, names);
  if (tokens.length < 2) return null;
  // The first token must be the prompt's opening command, not something buried
  // in another command's arguments.
  if (tokens[0].start !== 0) return null;

  return segmentsFromTokens(text, tokens);
}

function segmentsFromTokens(text: string, tokens: CommandToken[]): ChainedCommandSegment[] {
  const segments: ChainedCommandSegment[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const current = tokens[i];
    const next = tokens[i + 1];
    const argsEnd = next ? next.start : text.length;
    segments.push({ name: current.name, args: text.slice(current.end, argsEnd).trim() });
  }
  return segments;
}

/**
 * Expand every chained template in `text`, or return `text` unchanged when it
 * holds nothing to expand.
 *
 * A single command that opens the prompt is left untouched so the SDK keeps
 * handling it. A command that appears after leading `@file` references is
 * expanded here, because the SDK only looks at the first character.
 */
export function expandChainedCommands(
  text: string,
  templates: readonly ChainableTemplate[],
): string {
  const usable = templates.filter((t) => typeof t.content === "string");
  if (usable.length === 0) return text;

  const byName = new Map(usable.map((t) => [t.name, t]));
  const names = new Set(byName.keys());
  const startsWithCommand = text.startsWith("/");

  let body = text;
  let preface = "";
  if (!startsWithCommand) {
    const refs = text.match(LEADING_FILE_REFS);
    if (!refs) return text;
    body = text.slice(refs[0].length);
    preface = refs[0].trim();
    if (!body.startsWith("/")) return text;
  }

  const tokens = tokenizeCommands(body, names);
  // Nothing known, or the first known command is not at the body's start.
  if (tokens.length === 0 || tokens[0].start !== 0) return text;

  const segments = segmentsFromTokens(body, tokens);
  if (preface) {
    segments[0].args = segments[0].args ? `${preface} ${segments[0].args}` : preface;
  }

  // A lone command that already opens the prompt: expand it here after all,
  // so it gets the one-shot scope rule. The SDK would otherwise expand it
  // without that rule and the instructions would leak into later turns.
  if (segments.length === 1) {
    const template = byName.get(segments[0].name);
    if (!template) return text;
    return withOneShotScope(
      substituteArgs(template.content, parseCommandArgs(segments[0].args)),
    );
  }

  const parts = segments.map((segment, index) => {
    const template = byName.get(segment.name);
    if (!template) return null;
    const expanded = substituteArgs(template.content, parseCommandArgs(segment.args));
    return `===== 命令 ${index + 1}：/${segment.name} =====\n\n${expanded}`;
  });
  if (parts.some((part) => part === null)) return text;

  const header =
    `（本条消息里连用了 ${segments.length} 个命令，仅对本次回复生效。请按顺序依次完成；` +
    `后面的命令可以直接使用前面命令的产出。）`;

  return withOneShotScope(`${header}\n\n${parts.join("\n\n")}`);
}
