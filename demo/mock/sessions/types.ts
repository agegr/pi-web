import type { Localized } from "../locale";
import type { SessionInfo } from "@/lib/types";

export type Text = Localized | string;

/** One tool invocation inside an assistant round, with its (authored) result. */
export interface ToolUse {
  name: string;
  args: Record<string, unknown>;
  /**
   * Tool output: literal text, a project file to read (pi's read output; an
   * `anchor` line sets the offset), or an edit/write from data/project-files.
   */
  result:
    | Text
    | { readFile: string; offset?: number; limit?: number; anchor?: string; anchorLinesBefore?: number }
    | { editKey: string }
    | { writePath: string };
  details?: unknown;
  isError?: boolean;
  /** Seconds the tool took. */
  seconds?: number;
}

/** One assistant message: optional thinking, text and tool calls. */
export interface Round {
  thinking?: Text;
  text?: Text;
  tools?: ToolUse[];
  /** Seconds spent generating this message. */
  seconds?: number;
  /** Override token accounting for flavour. */
  outputTokens?: number;
}

export type Step =
  | { kind: "model"; provider: string; modelId: string }
  | { kind: "thinking"; level: string }
  | { kind: "tools"; tools: string[] }
  | { kind: "user"; text: Text; gapMinutes?: number }
  | { kind: "assistant"; rounds: Round[] }
  | { kind: "bash"; command: string; output: string; exitCode?: number; excludeFromContext?: boolean; gapMinutes?: number }
  | { kind: "compaction"; summary: Text; tokensBefore: number }
  | { kind: "custom"; customType: string; content: Text; details?: unknown }
  | { kind: "mark"; name: string }
  | { kind: "rewind"; to: string; gapMinutes?: number };

export interface SessionScript {
  id: string;
  cwd: string;
  /** Minutes before page load when the session started. */
  startedMinutesAgo: number;
  name?: Text;
  relation?: SessionInfo["relation"];
  /** Session the fork was created from (display only). */
  parentSessionId?: string;
  steps: Step[];
  /** Mark name of the entry that should be the active leaf (default: last). */
  leaf?: string;
}
