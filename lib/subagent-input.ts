import { readFileSync, realpathSync, statSync } from "fs";
import { relative, resolve } from "path";
import { isPathWithinRoots } from "./path-security";
import { toSlashPath } from "./paths";

export const MAX_SUBAGENT_INPUT_FILES = 8;
export const MAX_SUBAGENT_INPUT_BYTES = 512 * 1024;
/** pi's own estimate (`estimateTokens()` in its compaction module): about four characters a token. */
const CHARS_PER_TOKEN = 4;
/** The inlined copy may take about a tenth of the child's context window. */
const CONTEXT_WINDOW_SHARE = 10;

export interface SubagentInputFile {
  path: string;
  content: string;
}

export interface SubagentInputLimits {
  /** Total bytes the files may hold; `MAX_SUBAGENT_INPUT_BYTES` when absent. */
  maxBytes?: number;
  /** The child's model, named in the refusal when its context window set `maxBytes`. */
  model?: string;
}

/**
 * The files arrive inside the child's first user message, so a copy at the flat limit (about 131k
 * tokens by pi's chars/4) could fill most of a child's window and make it compact before its first
 * tool call (#1199). The limit counts bytes: chars/4 for ASCII, fewer characters for multi-byte
 * text. A model whose window is unknown (0) keeps the flat limit.
 */
export function subagentInputLimits(
  model: { provider: string; id: string; contextWindow?: number } | undefined,
): SubagentInputLimits {
  const contextWindow = model?.contextWindow;
  if (!model || !contextWindow || contextWindow < 0) return {};
  const maxBytes = Math.floor((contextWindow * CHARS_PER_TOKEN) / CONTEXT_WINDOW_SHARE);
  return maxBytes < MAX_SUBAGENT_INPUT_BYTES ? { maxBytes, model: `${model.provider}/${model.id}` } : {};
}

function formatInputLimit(bytes: number): string {
  return bytes < 1024 ? `${bytes}-byte` : `${Math.floor(bytes / 1024)} KB`;
}

export function loadSubagentInputFiles(
  cwd: string,
  requestedPaths: readonly string[],
  limits: SubagentInputLimits = {},
): SubagentInputFile[] {
  const maxBytes = limits.maxBytes ?? MAX_SUBAGENT_INPUT_BYTES;
  if (requestedPaths.length > MAX_SUBAGENT_INPUT_FILES) {
    throw new Error(`Agent input_files accepts at most ${MAX_SUBAGENT_INPUT_FILES} files`);
  }

  const realCwd = realpathSync(cwd);
  const allowedRoots = new Set([realCwd]);
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const seen = new Set<string>();
  const files: SubagentInputFile[] = [];
  let totalBytes = 0;

  for (const requestedPath of requestedPaths) {
    if (!requestedPath.trim()) throw new Error("Agent input_files paths must not be empty");

    let filePath: string;
    try {
      filePath = realpathSync(resolve(cwd, requestedPath));
    } catch {
      throw new Error(`Agent input file does not exist: ${requestedPath}`);
    }
    if (!isPathWithinRoots(filePath, allowedRoots)) {
      throw new Error(`Agent input file is outside the session cwd: ${requestedPath}`);
    }
    const fileInfo = statSync(filePath);
    if (!fileInfo.isFile()) {
      throw new Error(`Agent input path is not a file: ${requestedPath}`);
    }
    if (seen.has(filePath)) continue;
    seen.add(filePath);

    const checkSize = (bytes: number) => {
      if (totalBytes + bytes <= maxBytes) return;
      const scope = limits.model ? ` for ${limits.model}, about a tenth of its context window` : "";
      throw new Error(
        `Agent input_files exceeds the ${formatInputLimit(maxBytes)} total limit${scope}. `
        + "Pass fewer or smaller files, or name the paths in prompt if the subagent can read them.",
      );
    };
    checkSize(fileInfo.size);
    const buffer = readFileSync(filePath);
    checkSize(buffer.byteLength);
    totalBytes += buffer.byteLength;

    let content: string;
    try {
      content = decoder.decode(buffer);
    } catch {
      throw new Error(`Agent input file is not valid UTF-8 text: ${requestedPath}`);
    }
    files.push({
      path: toSlashPath(relative(realCwd, filePath)),
      content,
    });
  }

  return files;
}

export function appendSubagentInputFiles(task: string, files: readonly SubagentInputFile[]): string {
  if (files.length === 0) return task;
  const documents = files.map((file) =>
    `<document path=${JSON.stringify(file.path)}>\n${file.content}\n</document>`
  ).join("\n\n");
  return `${task}\n\n<documents>\n${documents}\n</documents>`;
}
