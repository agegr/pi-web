import type {
  AgentSessionEvent,
  SessionManager,
  Settings,
  SlashCommandInfo as OmpSlashCommandInfo,
  Theme,
} from "@oh-my-pi/pi-coding-agent";

export interface ContextUsage {
  percent: number | null;
  contextWindow: number;
  tokens: number | null;
}

export type SlashCommandSource = "builtin" | "extension" | "prompt" | "skill" | "custom" | "mcp_prompt" | "file";

export interface SlashCommandInfo {
  name: string;
  aliases?: string[];
  description?: string;
  input?: { hint: string };
  subcommands?: Array<{ name: string; description?: string; usage?: string }>;
  source: SlashCommandSource;
  location?: "user" | "project" | "path";
  path?: string;
}

export interface ModelLike {
  id: string;
  provider: string;
}

export interface ToolInfo {
  name: string;
  description: string;
}

export interface NavigateTreeResult {
  editorText?: string;
  cancelled: boolean;
  aborted?: boolean;
}

export interface SessionStatsInfo {
  sessionFile?: string;
  sessionId: string;
  sessionName?: string;
  userMessages: number;
  assistantMessages: number;
  toolCalls: number;
  toolResults: number;
  totalMessages: number;
  tokens: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
  cost: number;
  contextUsage?: ContextUsage;
}

/** Where a slash command came from, in the shape the browser consumes. */
export type SlashCommandOrigin = Pick<OmpSlashCommandInfo, "location" | "path">;

interface PromptTemplateLike {
  name: string;
  description?: string;
  source?: string;
}

interface SkillLike {
  name: string;
  description?: string;
  source?: string;
  filePath?: string;
}

interface ExtensionRunnerLike {
  getRegisteredCommands(reserved?: ReadonlySet<string>): Array<{
    name: string;
    description?: string;
  }>;
  getExtensionPaths?(): string[];
}

type DialogOptionsLike = {
  signal?: AbortSignal;
  timeout?: number;
};

type WidgetOptionsLike = {
  placement?: "aboveEditor" | "belowEditor";
};

export interface ExtensionUiContextLike {
  select(title: string, options: string[], opts?: DialogOptionsLike): Promise<string | undefined>;
  confirm(title: string, message: string, opts?: DialogOptionsLike): Promise<boolean>;
  input(title: string, placeholder?: string, opts?: DialogOptionsLike): Promise<string | undefined>;
  editor(title: string, prefill?: string, opts?: DialogOptionsLike): Promise<string | undefined>;
  notify(message: string, type?: "info" | "warning" | "error"): void;
  onTerminalInput(): () => void;
  setStatus(key: string, text: string | undefined): void;
  setWorkingMessage(message?: string): void;
  setWorkingVisible(visible: boolean): void;
  setWorkingIndicator(options?: { frames?: string[]; intervalMs?: number }): void;
  setHiddenThinkingLabel(label?: string): void;
  setWidget(key: string, content: string[] | ((...args: never[]) => unknown) | undefined, options?: WidgetOptionsLike): void;
  setFooter(factory: unknown): void;
  setHeader(factory: unknown): void;
  setTitle(title: string): void;
  custom<T = unknown>(...args: unknown[]): Promise<T>;
  pasteToEditor(text: string): void;
  setEditorText(text: string): void;
  getEditorText(): string;
  addAutocompleteProvider(): void;
  setEditorComponent(): void;
  getEditorComponent(): undefined;
  readonly theme: Theme;
  getAllThemes(): unknown[];
  getTheme(name: string): undefined;
  setTheme(theme: unknown): { success: boolean; error?: string };
  getToolsExpanded(): boolean;
  setToolsExpanded(expanded: boolean): void;
}

/**
 * Structural view of omp's `AgentSession`, narrowed to what omp-web drives.
 *
 * Keeping this structural (rather than importing the class) means an SDK bump
 * that widens an unrelated signature does not ripple through the app; only the
 * members listed here are contractual.
 */
export interface AgentSessionLike {
  readonly sessionId: string;
  readonly sessionFile: string | undefined;
  readonly isStreaming: boolean;
  readonly isCompacting: boolean;
  readonly autoCompactionEnabled: boolean;
  readonly autoRetryEnabled: boolean;
  readonly model: ModelLike | undefined;
  readonly modelRegistry: {
    find: (selector: string) => ModelLike | undefined;
    getAll: () => ModelLike[];
    getAvailable: () => ModelLike[];
    refresh: (strategy?: string) => Promise<unknown>;
  };
  readonly sessionManager: SessionManager;
  readonly settings: Settings;
  readonly agent: { state?: { systemPrompt?: string | string[]; thinkingLevel?: string } };
  readonly extensionRunner: ExtensionRunnerLike | undefined;
  readonly promptTemplates: readonly PromptTemplateLike[];
  readonly skills: readonly SkillLike[];

  reload(): Promise<void>;
  refreshSkills?(): Promise<void>;
  subscribe(listener: (event: AgentSessionEvent) => void): () => void;
  prompt(text: string, options?: {
    images?: Array<{ type: "image"; data: string; mimeType: string }>;
    streamingBehavior?: "steer" | "followUp";
    userInitiated?: boolean;
  }): Promise<boolean>;
  abort(options?: { reason?: string }): Promise<void>;
  executeBash(command: string, onChunk?: (chunk: string) => void, options?: { excludeFromContext?: boolean }): Promise<{ output: string; exitCode?: number; cancelled?: boolean; truncated?: boolean; fullOutputPath?: string }>;
  abortBash(): void;
  readonly isBashRunning: boolean;
  setModel(model: ModelLike, role?: string, options?: { selector?: string; thinkingLevel?: string; persist?: boolean }): Promise<{ switched: boolean }>;
  resolveRoleModel(role: string): ModelLike | undefined;
  navigateTree(targetId: string, options?: { summarize?: boolean }): Promise<NavigateTreeResult>;
  branch(entryId: string): Promise<{ cancelled: boolean }>;
  setThinkingLevel(level: string | undefined, persist?: boolean): void;
  compact(customInstructions?: string): Promise<unknown>;
  getSessionStats(): Omit<SessionStatsInfo, "sessionName">;
  getLastAssistantText(): string | undefined;
  setAutoCompactionEnabled(enabled: boolean): void;
  setAutoRetryEnabled(enabled: boolean): void;
  steer(text: string, images?: Array<{ type: "image"; data: string; mimeType: string }>): Promise<void>;
  followUp(text: string, images?: Array<{ type: "image"; data: string; mimeType: string }>): Promise<void>;
  readonly queuedMessageCount: number;
  getQueuedMessages(): { steering: readonly string[]; followUp: readonly string[] };
  clearQueue(): { steering: unknown[]; followUp: unknown[] };
  getAllToolNames(): string[];
  getToolByName(name: string): { name: string; description?: string } | undefined;
  getActiveToolNames(): string[];
  getEnabledToolNames(): string[];
  setActiveToolsByName(names: string[]): Promise<void>;
  abortCompaction(): void;
  getContextUsage(): { tokens: number; contextWindow: number; percent: number } | undefined;
  dispose?(options?: { keepAlive?: boolean }): Promise<void>;
}
