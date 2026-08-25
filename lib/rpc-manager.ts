import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { createAgentSessionFromServices, createAgentSessionServices, getAgentDir, initTheme, SessionManager, SettingsManager, Theme } from "@earendil-works/pi-coding-agent";
import { KeybindingsManager as TuiKeybindingsManager, TUI_KEYBINDINGS } from "@earendil-works/pi-tui";
import { randomUUID } from "crypto";
import { existsSync, realpathSync, writeFileSync } from "fs";
import { resolve } from "path";
import { validateAgentImages } from "./image-attachments";
import { invalidateModelsCache } from "./models-cache";
import { resolveVisibleModels, selectInitialModelScope } from "./model-scope";
import {
  createProjectCommandBashExtension,
  createProjectCommandBashOperations,
  preferUserBashExtension,
} from "./project-command-env";
import { cacheSessionPath, invalidateSessionListCache } from "./session-reader";
import { getProjectTrustStatus, projectTrustReloadOptions } from "./project-trust";
import { persistExplicitStartupPreferences } from "./startup-preferences";
import type { SlashCommandInfo } from "@earendil-works/pi-coding-agent";
import type { AgentSessionLike, ExtensionUiContextLike, ToolInfo } from "./pi-types";
import type {
  ExtensionUiRequest,
  ExtensionUiResponse,
  ExtensionWidgetItem,
  SessionInfo,
  SessionMessageEntry,
} from "./types";
import { createHeadlessCustomUiTui, DEFAULT_CUSTOM_UI_COLUMNS, type HeadlessCustomUiTui } from "./custom-ui-terminal";

// ============================================================================
// Types
// ============================================================================

export interface AgentEvent {
  type: string;
  [key: string]: unknown;
}

type EventListener = (event: AgentEvent) => void;

type PendingUiResponse = {
  resolve: (response: ExtensionUiResponse) => void;
  cancel: () => void;
};

type CustomUiComponent = {
  render: (width: number) => string[];
  handleInput?: (data: string) => void;
  dispose?: () => void;
  invalidate?: () => void;
};

type ExtensionWidgetComponent = {
  render: (width: number) => unknown;
  dispose?: () => void;
};

type ExtensionWidgetFactory = (tui: HeadlessCustomUiTui, theme: Theme) => unknown;

type ActiveExtensionWidget = {
  key: string;
  component: ExtensionWidgetComponent;
  placement: "aboveEditor" | "belowEditor";
  generation: number;
  clearEmitted: boolean;
  rendered: boolean;
};

type ActiveCustomUi = {
  component: CustomUiComponent;
  width: number;
  resolve: (value: unknown) => void;
  settled: boolean;
};

type ExtensionUiRequestBody = Record<string, unknown> & {
  method: ExtensionUiRequest["method"];
  timeout?: number;
  expiresAt?: number;
};

type ExtensionCommandContextActionsLike = {
  waitForIdle: () => Promise<void>;
  newSession: () => Promise<{ cancelled: boolean }>;
  fork: () => Promise<{ cancelled: boolean }>;
  navigateTree: (targetId: string, options?: { summarize?: boolean }) => Promise<{ cancelled: boolean }>;
  switchSession: () => Promise<{ cancelled: boolean }>;
  reload: () => Promise<void>;
};

type ExtensionBindingOptions = {
  forceEmptySystemPrompt?: boolean;
};

const RUNNING_STATE_EVENT_TYPES = new Set([
  "agent_start",
  "agent_end",
  "agent_settled",
  "auto_compaction_start",
  "auto_compaction_end",
  "compaction_start",
  "compaction_end",
]);

const IDLE_RESET_EVENT_TYPES = new Set([
  "agent_end",
  "agent_settled",
  "auto_compaction_end",
  "compaction_end",
]);

export interface RpcSessionStartOptions {
  toolNames?: string[];
  initialModel?: { provider: string; modelId: string };
  thinkingLevel?: ThinkingLevel;
}

const CODING_TOOL_NAMES = ["read", "bash", "edit", "write", "grep", "find", "ls"];

// Extensions require a complete Theme, while the web UI applies its own styling.
class PlainTextTheme extends Theme {
  constructor() {
    super(
      { thinkingXhigh: "", searchMatchText: "" } as ConstructorParameters<typeof Theme>[0],
      { selectedBg: "" } as ConstructorParameters<typeof Theme>[1],
      "truecolor",
    );
  }

  override fg(...[, text]: Parameters<Theme["fg"]>): string { return text; }
  override bg(...[, text]: Parameters<Theme["bg"]>): string { return text; }
  override bold(text: string): string { return text; }
  override italic(text: string): string { return text; }
  override underline(text: string): string { return text; }
  override inverse(text: string): string { return text; }
  override strikethrough(text: string): string { return text; }
  override getFgAnsi(): string { return ""; }
  override getBgAnsi(): string { return ""; }
  override getThinkingBorderColor(): (text: string) => string {
    return (text) => text;
  }
  override getBashModeBorderColor(): (text: string) => string { return (text) => text; }
}

const PLAIN_TEXT_THEME = new PlainTextTheme();
const CUSTOM_UI_KEYBINDINGS = new TuiKeybindingsManager(TUI_KEYBINDINGS);

function withExtensionTools(session: AgentSessionLike, toolNames: string[]): string[] {
  if (toolNames.length === 0) return [];

  const codingToolNames = new Set(CODING_TOOL_NAMES);
  const extensionToolNames = session
    .getAllTools()
    .map((t) => t.name)
    .filter((name) => !codingToolNames.has(name));

  return [...new Set([...toolNames, ...extensionToolNames])];
}

// ============================================================================
// AgentSessionWrapper
// Wraps AgentSession with the same interface the rest of the app expects
// ============================================================================

export class AgentSessionWrapper {
  private listeners: EventListener[] = [];
  private pendingUiResponses = new Map<string, PendingUiResponse>();
  private pendingUiRequests = new Map<string, AgentEvent>();
  private activeCustomUis = new Map<string, ActiveCustomUi>();
  private extensionStatuses = new Map<string, string>();
  private extensionWidgets = new Map<string, ExtensionWidgetItem>();
  private activeExtensionWidgets = new Map<string, ActiveExtensionWidget>();
  private extensionWidgetGenerations = new Map<string, number>();
  private extensionWidgetsResetting = false;
  private pendingPromptCount = 0;
  private promptAdmissionTail: Promise<void> = Promise.resolve();
  private extensionsBound = false;
  private extensionBindingPromise: Promise<void> | null = null;
  private extensionBindingError: unknown = null;
  private forceEmptySystemPrompt = false;
  private unsubscribe: (() => void) | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private onDestroyCallback: (() => void) | null = null;
  private shutdownPromise: Promise<void> | null = null;
  private _alive = true;

  constructor(public readonly inner: AgentSessionLike) {}

  get sessionId(): string {
    return this.inner.sessionId;
  }

  get sessionFile(): string {
    return this.inner.sessionFile ?? "";
  }

  get cwd(): string {
    return this.inner.sessionManager.getCwd();
  }

  get streamingMessage() {
    return this.inner.agent.state?.streamingMessage;
  }

  get isStreaming(): boolean {
    return this.inner.isStreaming;
  }

  isAlive(): boolean {
    return this._alive;
  }

  isRunning(): boolean {
    return this._alive && (this.pendingPromptCount > 0 || this.inner.isStreaming || this.inner.isCompacting || this.inner.isBashRunning);
  }

  start(): void {
    this.unsubscribe = this.inner.subscribe((event: AgentEvent) => {
      if (event.type === "agent_end") {
        invalidateSessionListCache();
      }
      if (IDLE_RESET_EVENT_TYPES.has(event.type)) this.resetIdleTimer();
      this.emit(event);
      if (RUNNING_STATE_EVENT_TYPES.has(event.type)) notifyRunningChange();
    });
    this.resetIdleTimer();
    notifyRunningChange();
  }

  setForceEmptySystemPrompt(force: boolean): void {
    this.forceEmptySystemPrompt = force;
    this.applyForcedEmptySystemPrompt();
  }

  beginExtensionBinding(options: ExtensionBindingOptions = {}): void {
    void this.ensureExtensionsBound(options).catch((err) => {
      console.error("[pi-web] failed to dispatch session_start to extensions:", err instanceof Error ? err.message : err);
    });
  }

  async waitUntilReady(): Promise<void> {
    await this.waitForExtensionsBound();
  }

  private ensureExtensionsBound(options: ExtensionBindingOptions = {}): Promise<void> {
    if (options.forceEmptySystemPrompt) this.forceEmptySystemPrompt = true;
    if (this.extensionsBound) {
      this.applyForcedEmptySystemPrompt();
      return Promise.resolve();
    }
    if (this.extensionBindingPromise) return this.extensionBindingPromise;

    this.extensionBindingError = null;
    this.extensionBindingPromise = (async () => {
      if (!this._alive) return;
      const uiContext = this.createExtensionUiContext();
      if (typeof this.inner.bindExtensions === "function") {
        const bindExtensions = this.inner.bindExtensions as (bindings: {
          uiContext?: ExtensionUiContextLike;
          mode?: "rpc";
          commandContextActions?: ExtensionCommandContextActionsLike;
          shutdownHandler?: () => void;
          onError?: (error: { extensionPath: string; event: string; error: string }) => void;
        }) => Promise<void>;
        await bindExtensions.call(this.inner, {
          uiContext,
          mode: "rpc",
          commandContextActions: this.createExtensionCommandContextActions(),
          shutdownHandler: () => this.emit({
            type: "extension_ui_request",
            id: randomUUID(),
            method: "notify",
            notifyType: "warning",
            message: "Extension requested shutdown, but shutdown is not supported in Pi Web.",
          } as ExtensionUiRequest as AgentEvent),
          onError: (error) => this.emit({
            type: "extension_error",
            extensionPath: error.extensionPath,
            event: error.event,
            error: error.error,
          }),
        });
      } else {
        this.inner.extensionRunner.setUIContext?.(uiContext, "rpc");
      }
      this.extensionsBound = true;
      this.applyForcedEmptySystemPrompt();
      console.log(`[pi-web] session_start dispatched to extensions for session ${this.inner.sessionId}`);
    })().catch((err) => {
      this.extensionBindingError = err;
      throw err;
    });

    return this.extensionBindingPromise;
  }

  private async waitForExtensionsBound(): Promise<void> {
    try {
      if (this.extensionBindingPromise) await this.extensionBindingPromise;
    } catch (err) {
      throw err instanceof Error ? err : new Error(String(err));
    }
    if (this.extensionBindingError) {
      throw this.extensionBindingError instanceof Error
        ? this.extensionBindingError
        : new Error(String(this.extensionBindingError));
    }
  }

  private shouldWaitForExtensions(type: string): boolean {
    return type === "prompt"
      || type === "steer"
      || type === "follow_up"
      || type === "get_commands"
      || type === "get_state";
  }

  private async withFinalRunningNotification<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } finally {
      this.resetIdleTimer();
      notifyRunningChange();
    }
  }

  private applyForcedEmptySystemPrompt(): void {
    if (this.forceEmptySystemPrompt && this.inner.agent.state) {
      this.inner.agent.state.systemPrompt = "";
    }
  }

  private emit(event: AgentEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error(
          `[pi-web] failed to deliver ${event.type} event:`,
          error instanceof Error ? error.message : error,
        );
      }
    }
  }

  private async acquirePromptAdmission(): Promise<() => void> {
    const previous = this.promptAdmissionTail;
    let release!: () => void;
    this.promptAdmissionTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    return release;
  }

  private resetIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      if (this.isRunning()) {
        this.resetIdleTimer();
        return;
      }
      void this.shutdown().catch((error) => {
        console.error("[pi-web] failed to shut down idle session:", error instanceof Error ? error.message : error);
      });
    }, 10 * 60 * 1000);
  }

  private persistBashOnlySession(): void {
    const manager = this.inner.sessionManager;
    const sessionFile = manager.getSessionFile();
    if (!sessionFile || existsSync(sessionFile)) return;

    const header = manager.getHeader();
    if (!header) return;

    const content = [header, ...manager.getEntries()]
      .map((entry) => JSON.stringify(entry))
      .join("\n") + "\n";
    writeFileSync(sessionFile, content, { encoding: "utf8", flag: "wx" });

    // Pi normally delays the first flush until an assistant message exists.
    // A leading shell command has no assistant message, so mark this SDK
    // manager as flushed after writing its own generated entries.
    (manager as unknown as { flushed: boolean }).flushed = true;
    cacheSessionPath(this.inner.sessionId, sessionFile);
  }

  onEvent(listener: EventListener): () => void {
    this.listeners.push(listener);
    for (const event of this.pendingUiRequests.values()) listener(event);
    return () => {
      const i = this.listeners.indexOf(listener);
      if (i !== -1) this.listeners.splice(i, 1);
    };
  }

  onDestroy(cb: () => void): void {
    this.onDestroyCallback = cb;
  }

  async send(command: Record<string, unknown>): Promise<unknown> {
    this.resetIdleTimer();
    const type = command.type as string;
    if (this.shouldWaitForExtensions(type)) await this.waitForExtensionsBound();

    if (type === "prompt" || type === "steer" || type === "follow_up") {
      const imageError = validateAgentImages(command.images);
      if (imageError) throw new Error(imageError);
    }

    switch (type) {
      case "prompt": {
        // Serialize only admission. Once the preceding prompt has either
        // passed or failed preflight, the SDK can atomically decide whether
        // this submission starts a run or joins its streaming queue.
        const releaseAdmission = await this.acquirePromptAdmission();
        try {
          if (this.inner.isBashRunning) {
            throw new Error("Cannot send a prompt while a shell command is running");
          }
          const promptImages = command.images as Array<{ type: "image"; data: string; mimeType: string }> | undefined;
          const streamingBehavior = command.streamingBehavior as "steer" | "followUp" | undefined;
          let preflightAccepted = false;
          let preflightSettled = false;
          let promptSettled = false;
          let acceptPreflight!: () => void;
          let rejectPreflight!: (error: unknown) => void;
          const preflight = new Promise<void>((resolve, reject) => {
            acceptPreflight = () => {
              preflightAccepted = true;
              if (preflightSettled) return;
              preflightSettled = true;
              resolve();
            };
            rejectPreflight = (error) => {
              if (preflightSettled) return;
              preflightSettled = true;
              reject(error);
            };
          });
          const finishPrompt = () => {
            if (promptSettled) return;
            promptSettled = true;
            this.pendingPromptCount = Math.max(0, this.pendingPromptCount - 1);
            this.resetIdleTimer();
            notifyRunningChange();
          };

          this.pendingPromptCount += 1;
          notifyRunningChange();
          let prompt: Promise<void>;
          try {
            prompt = this.inner.prompt(command.message as string, {
              ...(promptImages?.length ? { images: promptImages } : {}),
              ...(streamingBehavior ? { streamingBehavior } : {}),
              source: "rpc",
              // Match pi's RPC contract: acknowledge only after synchronous prompt
              // validation and extension preflight have accepted the submission.
              preflightResult: (success) => {
                if (success) acceptPreflight();
              },
            });
          } catch (error) {
            finishPrompt();
            throw error;
          }

          void prompt.then(() => {
            // Compatibility fallback if a future SDK resolves without invoking
            // the internal callback. This waits for the run, but never acks early.
            acceptPreflight();
            finishPrompt();
            if (!streamingBehavior) this.emit({ type: "prompt_done" });
          }, (error) => {
            rejectPreflight(error);
            finishPrompt();
            invalidateSessionListCache();
            // A preflight rejection is returned by the POST itself. Only an
            // unexpected failure after acceptance needs the asynchronous event.
            if (preflightAccepted) {
              this.emit({
                type: "prompt_error",
                errorMessage: error instanceof Error ? error.message : String(error),
              });
              if (!streamingBehavior) this.emit({ type: "prompt_done" });
            }
          }).catch((error) => {
            console.error(
              "[pi-web] prompt completion handler failed:",
              error instanceof Error ? error.message : error,
            );
          });

          await preflight;
          return null;
        } finally {
          releaseAdmission();
        }
      }

      case "abort":
        await this.withFinalRunningNotification(() => this.inner.abort());
        return null;

      case "get_state": {
        const model = this.inner.model;
        const contextUsage = this.inner.getContextUsage();
        return {
          sessionId: this.inner.sessionId,
          sessionFile: this.inner.sessionFile ?? "",
          isStreaming: this.inner.isStreaming,
          isPromptRunning: this.pendingPromptCount > 0,
          isBashRunning: this.inner.isBashRunning,
          isCompacting: this.inner.isCompacting,
          autoCompactionEnabled: this.inner.autoCompactionEnabled,
          autoRetryEnabled: this.inner.autoRetryEnabled,
          model: model ? { id: model.id, provider: model.provider } : undefined,
          messageCount: 0,
          pendingMessageCount: this.inner.pendingMessageCount,
          queuedMessages: {
            steering: [...this.inner.getSteeringMessages()],
            followUp: [...this.inner.getFollowUpMessages()],
          },
          contextUsage: contextUsage
            ? { percent: contextUsage.percent, contextWindow: contextUsage.contextWindow, tokens: contextUsage.tokens }
            : null,
          systemPrompt: this.inner.agent.state?.systemPrompt ?? "",
          thinkingLevel: this.inner.agent.state?.thinkingLevel ?? "off",
          extensionStatuses: this.getExtensionStatuses(),
          extensionWidgets: this.getExtensionWidgets(),
        };
      }

      case "set_model": {
        const { provider, modelId } = command as { provider: string; modelId: string };
        let model = this.inner.modelRuntime.getModel(provider, modelId);
        if (!model) {
          await this.inner.modelRuntime.refresh({ allowNetwork: false });
          model = this.inner.modelRuntime.getModel(provider, modelId);
        }
        if (!model) throw new Error(`Model not found: ${provider}/${modelId}`);
        await this.inner.setModel(model);
        invalidateModelsCache();
        invalidateSessionListCache();
        return { id: model.id, provider: model.provider };
      }

      case "fork": {
        if (this.inner.isBashRunning) {
          throw new Error("Cannot fork while a shell command is running");
        }
        const entryId = command.entryId as string;
        const sessionManager = this.inner.sessionManager;
        const currentSessionFile = this.inner.sessionFile;

        if (!sessionManager.isPersisted()) return { cancelled: true };
        if (!currentSessionFile) throw new Error("Persisted session is missing a session file");

        const entry = sessionManager.getEntry(entryId);
        if (!entry) throw new Error("Invalid entry ID for forking");

        const sessionDir = sessionManager.getSessionDir();
        let newSessionFile: string;

        if (!entry.parentId) {
          // Fork before the first message: create an empty session linked to this one
          const newManager = SessionManager.create(sessionManager.getCwd(), sessionDir);
          newManager.newSession({ parentSession: currentSessionFile });
          newSessionFile = newManager.getSessionFile() as string;
        } else {
          // Fork after some history: copy path up to (but not including) the fork point
          const sourceManager = SessionManager.open(currentSessionFile, sessionDir);
          const forkedPath = sourceManager.createBranchedSession(entry.parentId);
          if (!forkedPath) throw new Error("Failed to create forked session");
          newSessionFile = forkedPath;
        }

        const newSessionId = SessionManager.open(newSessionFile, sessionDir).getSessionId();
        cacheSessionPath(newSessionId, newSessionFile);
        invalidateSessionListCache();
        await this.shutdown();
        return { cancelled: false, newSessionId };
      }

      case "navigate_tree": {
        if (this.inner.isBashRunning) {
          throw new Error("Cannot navigate while a shell command is running");
        }
        const result = await this.inner.navigateTree(command.targetId as string, {});
        return { cancelled: result.cancelled };
      }

      case "set_thinking_level": {
        const level = command.level as string;
        this.inner.setThinkingLevel(level);
        // setThinkingLevel clamps xhigh→high for models where supportsXhigh()===false.
        // If the model has DeepSeek thinking compat (reasoningEffortMap maps xhigh→max),
        // force the state back so the compat layer can use it correctly.
        if (level === "xhigh" && (this.inner.model as { compat?: { thinkingFormat?: string } } | null)?.compat?.thinkingFormat === "deepseek" && this.inner.agent?.state) {
          this.inner.agent.state.thinkingLevel = "xhigh";
        }
        invalidateSessionListCache();
        return null;
      }

      case "compact": {
        try {
          return await this.withFinalRunningNotification(() =>
            this.inner.compact(command.customInstructions as string | undefined)
          );
        } finally {
          invalidateSessionListCache();
        }
      }

      case "set_session_name": {
        const name = (command.name as string | undefined)?.trim();
        if (!name) throw new Error("Session name cannot be empty");
        this.inner.setSessionName(name);
        invalidateSessionListCache();
        return null;
      }

      case "get_session_stats": {
        return {
          ...this.inner.getSessionStats(),
          sessionName: this.inner.sessionManager.getSessionName(),
        };
      }

      case "get_last_assistant_text": {
        return { text: this.inner.getLastAssistantText() ?? "" };
      }

      case "set_auto_compaction": {
        this.inner.setAutoCompactionEnabled(command.enabled as boolean);
        return null;
      }

      case "clear_queue": {
        // Full clear only: pi has no single-item dequeue, and clear+requeue
        // races against the agent loop pulling messages mid-flight.
        return this.inner.clearQueue();
      }

      case "steer": {
        const steerImages = command.images as Array<{ type: "image"; data: string; mimeType: string }> | undefined;
        await this.inner.steer(command.message as string, steerImages?.length ? steerImages : undefined);
        return null;
      }

      case "follow_up": {
        const followImages = command.images as Array<{ type: "image"; data: string; mimeType: string }> | undefined;
        await this.inner.followUp(command.message as string, followImages?.length ? followImages : undefined);
        return null;
      }

      case "get_tools": {
        const all: ToolInfo[] = this.inner.getAllTools();
        const active = new Set<string>(this.inner.getActiveToolNames());
        return all.map((t) => ({
          name: t.name,
          description: t.description,
          active: active.has(t.name),
        }));
      }

      case "get_commands": {
        const commands: SlashCommandInfo[] = [];
        for (const registered of this.inner.extensionRunner.getRegisteredCommands()) {
          commands.push({
            name: registered.invocationName,
            description: registered.description,
            source: "extension",
            sourceInfo: registered.sourceInfo,
          });
        }
        for (const template of this.inner.promptTemplates) {
          commands.push({
            name: template.name,
            description: template.description,
            source: "prompt",
            sourceInfo: template.sourceInfo,
          });
        }
        for (const skill of this.inner.resourceLoader.getSkills().skills) {
          commands.push({
            name: `skill:${skill.name}`,
            description: skill.description,
            source: "skill",
            sourceInfo: skill.sourceInfo,
          });
        }
        return { commands };
      }

      case "set_tools": {
        const toolNames = command.toolNames as string[];
        this.setForceEmptySystemPrompt(toolNames.length === 0);
        this.inner.setActiveToolsByName(withExtensionTools(this.inner, toolNames));
        this.applyForcedEmptySystemPrompt();
        return null;
      }

      case "reload": {
        await this.waitForExtensionsBound();
        this.extensionStatuses.clear();
        this.resetExtensionWidgetsForReload();
        this.syncProjectTrust();
        await this.inner.reload();
        if (typeof this.inner.bindExtensions !== "function") {
          this.inner.extensionRunner.setUIContext?.(this.createExtensionUiContext(), "rpc");
        }
        this.applyForcedEmptySystemPrompt();
        invalidateModelsCache();
        return { success: true };
      }

      case "abort_compaction": {
        this.inner.abortCompaction();
        return null;
      }

      case "extension_ui_response": {
        this.resolveExtensionUiResponse(command as ExtensionUiResponse);
        return null;
      }

      case "extension_ui_input": {
        this.handleExtensionUiInput(command.id as string, command.data as string);
        return null;
      }

      case "set_auto_retry": {
        this.inner.setAutoRetryEnabled(command.enabled as boolean);
        return null;
      }

      case "bash": {
        if (this.pendingPromptCount > 0 || this.inner.isStreaming || this.inner.isCompacting || this.inner.isBashRunning) {
          throw new Error("Cannot run a shell command while the session is busy");
        }
        const execution = this.inner.executeBash(
          command.command as string,
          undefined,
          {
            excludeFromContext: command.excludeFromContext as boolean | undefined,
            operations: createProjectCommandBashOperations({
              shellPath: this.inner.settingsManager.getShellPath(),
            }),
          },
        );
        notifyRunningChange();
        try {
          const result = await execution;
          this.persistBashOnlySession();
          return result;
        } finally {
          this.resetIdleTimer();
          invalidateSessionListCache();
          notifyRunningChange();
        }
      }

      case "abort_bash": {
        this.inner.abortBash();
        return null;
      }

      default:
        throw new Error(`Unsupported command: ${type}`);
    }
  }

  destroy(): void {
    if (!this._alive) return;
    this._alive = false;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (this.inner.isBashRunning) this.inner.abortBash();
    this.unsubscribe?.();
    for (const pending of this.pendingUiResponses.values()) pending.cancel();
    for (const id of Array.from(this.activeCustomUis.keys())) this.closeCustomUi(id, undefined);
    this.pendingUiResponses.clear();
    this.pendingUiRequests.clear();
    this.clearExtensionWidgets(false);
    try {
      this.inner.dispose();
    } finally {
      try {
        this.onDestroyCallback?.();
      } finally {
        notifyRunningChange();
      }
    }
  }

  async shutdown(): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise;
    if (!this._alive) return;

    this.shutdownPromise = (async () => {
      try {
        try {
          await this.waitForExtensionsBound();
        } catch (error) {
          console.error(
            "[pi-web] extension binding failed before session shutdown:",
            error instanceof Error ? error.message : error,
          );
        }
        await this.inner.extensionRunner.emit?.({ type: "session_shutdown", reason: "quit" });
      } finally {
        this.destroy();
      }
    })();
    return this.shutdownPromise;
  }

  private resolveExtensionUiResponse(response: ExtensionUiResponse): void {
    const pending = this.pendingUiResponses.get(response.id);
    if (!pending) return;
    pending.resolve(response);
  }

  private getExtensionStatuses(): Array<{ key: string; text: string }> {
    return Array.from(this.extensionStatuses, ([key, text]) => ({ key, text }));
  }

  private getExtensionWidgets(): ExtensionWidgetItem[] {
    return Array.from(this.extensionWidgets.values());
  }

  private nextExtensionWidgetGeneration(key: string): number {
    const generation = (this.extensionWidgetGenerations.get(key) ?? 0) + 1;
    this.extensionWidgetGenerations.set(key, generation);
    return generation;
  }

  private disposeExtensionWidgetComponent(component: unknown): void {
    if (!component || (typeof component !== "object" && typeof component !== "function")) return;
    const dispose = (component as { dispose?: unknown }).dispose;
    if (typeof dispose !== "function") return;
    try {
      dispose.call(component);
    } catch {
      // Ignore dispose errors from extension widgets.
    }
  }

  private emitExtensionWidgetClear(key: string): void {
    this.emit({
      type: "extension_ui_request",
      id: randomUUID(),
      method: "setWidget",
      widgetKey: key,
      widgetLines: undefined,
      widgetPlacement: undefined,
    } as ExtensionUiRequest as AgentEvent);
  }

  private clearExtensionWidget(key: string, emitClear = true): number {
    const generation = this.nextExtensionWidgetGeneration(key);

    const active = this.activeExtensionWidgets.get(key);
    this.activeExtensionWidgets.delete(key);
    this.extensionWidgets.delete(key);
    if (active) this.disposeExtensionWidgetComponent(active.component);
    if (this.extensionWidgetGenerations.get(key) !== generation) return generation;
    if (emitClear) this.emitExtensionWidgetClear(key);
    return generation;
  }

  private clearExtensionWidgets(emitClear: boolean): void {
    const keys = new Set([
      ...this.extensionWidgets.keys(),
      ...this.activeExtensionWidgets.keys(),
    ]);
    for (const key of keys) this.clearExtensionWidget(key, emitClear);
  }

  private resetExtensionWidgetsForReload(): void {
    this.extensionWidgetsResetting = true;
    try {
      const factoryKeys = [...this.activeExtensionWidgets.keys()];
      for (const key of factoryKeys) this.clearExtensionWidget(key);
      // Keep the existing array-widget reload behavior: snapshots are reset and
      // the next extension session_start repopulates them.
      this.extensionWidgets.clear();
    } finally {
      this.extensionWidgetsResetting = false;
    }
  }

  private emitExtensionWidgetError(key: string, error: unknown): void {
    this.emit({
      type: "extension_error",
      extensionPath: `extension-widget:${key}`,
      event: "setWidget",
      error: error instanceof Error ? error.message : String(error),
    });
  }

  private failExtensionWidget(
    key: string,
    generation: number,
    error: unknown,
    clearEmitted: boolean,
    component?: unknown,
  ): void {
    if (this.extensionWidgetGenerations.get(key) !== generation) {
      this.disposeExtensionWidgetComponent(component);
      return;
    }

    const active = this.activeExtensionWidgets.get(key);
    let shouldEmitClear = !clearEmitted;
    if (active?.generation === generation) {
      shouldEmitClear = active.rendered || !active.clearEmitted;
      this.activeExtensionWidgets.delete(key);
      this.disposeExtensionWidgetComponent(active.component);
    } else {
      this.disposeExtensionWidgetComponent(component);
    }
    if (this.extensionWidgetGenerations.get(key) !== generation) {
      this.emitExtensionWidgetError(key, error);
      return;
    }
    this.extensionWidgets.delete(key);
    if (shouldEmitClear) this.emitExtensionWidgetClear(key);
    this.emitExtensionWidgetError(key, error);
  }

  private renderExtensionWidget(active: ActiveExtensionWidget): void {
    if (
      this.activeExtensionWidgets.get(active.key) !== active
      || this.extensionWidgetGenerations.get(active.key) !== active.generation
    ) return;

    let lines: unknown;
    try {
      lines = active.component.render(DEFAULT_CUSTOM_UI_COLUMNS);
    } catch (error) {
      this.failExtensionWidget(active.key, active.generation, error, active.clearEmitted);
      return;
    }
    if (!Array.isArray(lines) || !lines.every((line) => typeof line === "string")) {
      this.failExtensionWidget(
        active.key,
        active.generation,
        new Error("Extension widget render must return string[]"),
        active.clearEmitted,
      );
      return;
    }
    if (
      this.activeExtensionWidgets.get(active.key) !== active
      || this.extensionWidgetGenerations.get(active.key) !== active.generation
    ) return;

    const widgetLines = lines as string[];
    this.extensionWidgets.set(active.key, {
      key: active.key,
      lines: widgetLines,
      placement: active.placement,
    });
    active.rendered = true;
    this.emit({
      type: "extension_ui_request",
      id: randomUUID(),
      method: "setWidget",
      widgetKey: active.key,
      widgetLines,
      widgetPlacement: active.placement,
    } as ExtensionUiRequest as AgentEvent);
  }

  private setExtensionWidgetFactory(
    key: string,
    factory: ExtensionWidgetFactory,
    options?: { placement?: "aboveEditor" | "belowEditor" },
  ): void {
    const hadPrevious = this.extensionWidgets.has(key) || this.activeExtensionWidgets.has(key);
    const generation = this.clearExtensionWidget(key, hadPrevious);
    if (this.extensionWidgetGenerations.get(key) !== generation) return;
    const tui = createHeadlessCustomUiTui(() => {
      const active = this.activeExtensionWidgets.get(key);
      if (active?.generation === generation) this.renderExtensionWidget(active);
    }, DEFAULT_CUSTOM_UI_COLUMNS);

    let component: unknown;
    try {
      component = factory(tui, PLAIN_TEXT_THEME);
    } catch (error) {
      this.failExtensionWidget(key, generation, error, hadPrevious);
      return;
    }
    if (this.extensionWidgetGenerations.get(key) !== generation) {
      this.disposeExtensionWidgetComponent(component);
      return;
    }
    if (
      !component
      || (typeof component !== "object" && typeof component !== "function")
      || typeof (component as { render?: unknown }).render !== "function"
    ) {
      this.failExtensionWidget(
        key,
        generation,
        new Error("Extension widget factory must return a component with render(width)"),
        hadPrevious,
        component,
      );
      return;
    }

    const active: ActiveExtensionWidget = {
      key,
      component: component as ExtensionWidgetComponent,
      placement: options?.placement ?? "aboveEditor",
      generation,
      clearEmitted: hadPrevious,
      rendered: false,
    };
    this.activeExtensionWidgets.set(key, active);
    this.renderExtensionWidget(active);
  }

  private getCustomUiWidth(options: unknown): number {
    if (!options || typeof options !== "object") return DEFAULT_CUSTOM_UI_COLUMNS;
    const overlayOptions = (options as { overlayOptions?: unknown }).overlayOptions;
    const resolved = typeof overlayOptions === "function" ? overlayOptions() : overlayOptions;
    if (!resolved || typeof resolved !== "object") return DEFAULT_CUSTOM_UI_COLUMNS;
    const width = (resolved as { width?: unknown }).width;
    return typeof width === "number" && Number.isFinite(width)
      ? Math.max(40, Math.min(140, Math.round(width)))
      : 92;
  }

  private emitCustomUiRender(id: string, custom: ActiveCustomUi): void {
    let lines: string[];
    try {
      lines = custom.component.render(custom.width);
    } catch (error) {
      lines = [`Extension custom UI render failed: ${error instanceof Error ? error.message : String(error)}`];
    }
    const event = {
      type: "extension_ui_request",
      id,
      method: "custom",
      lines,
    } as ExtensionUiRequest as AgentEvent;
    this.pendingUiRequests.set(id, event);
    this.emit(event);
  }

  private closeCustomUi(id: string, value: unknown): void {
    const custom = this.activeCustomUis.get(id);
    if (!custom || custom.settled) return;
    custom.settled = true;
    this.activeCustomUis.delete(id);
    this.pendingUiRequests.delete(id);
    try {
      custom.component.dispose?.();
    } catch {
      // Ignore dispose errors from extension UI components.
    }
    this.emit({
      type: "extension_ui_request",
      id,
      method: "custom",
      lines: [],
      closed: true,
    } as ExtensionUiRequest as AgentEvent);
    custom.resolve(value);
  }

  private handleExtensionUiInput(id: string, data: string): void {
    const custom = this.activeCustomUis.get(id);
    if (!custom || typeof data !== "string") return;
    try {
      custom.component.handleInput?.(data);
      if (this.activeCustomUis.has(id)) this.emitCustomUiRender(id, custom);
    } catch (error) {
      this.closeCustomUi(id, undefined);
      this.emit({
        type: "extension_error",
        extensionPath: `custom-ui:${id}`,
        event: "custom_ui_input",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private requestExtensionCustomUi<T>(
    factory: unknown,
    options?: unknown,
  ): Promise<T> {
    if (typeof factory !== "function") return Promise.resolve(undefined as T);

    const id = randomUUID();
    const width = this.getCustomUiWidth(options);

    return new Promise<T>((resolve) => {
      let completed = false;
      const tui = createHeadlessCustomUiTui(
        () => {
          const custom = this.activeCustomUis.get(id);
          if (custom) this.emitCustomUiRender(id, custom);
        },
        width,
      );
      const finish = (value: T) => {
        if (completed) return;
        completed = true;
        resolve(value);
      };
      const done = (value: T) => {
        if (this.activeCustomUis.has(id)) {
          this.closeCustomUi(id, value);
        } else {
          finish(value);
        }
      };

      Promise.resolve()
        .then(() => factory(tui, PLAIN_TEXT_THEME, CUSTOM_UI_KEYBINDINGS, done))
        .then((component) => {
          if (completed) {
            try {
              (component as CustomUiComponent | undefined)?.dispose?.();
            } catch {
              // Ignore dispose errors from a component completed before mounting.
            }
            return;
          }
          if (!component || typeof component !== "object" || typeof (component as CustomUiComponent).render !== "function") {
            finish(undefined as T);
            return;
          }
          const custom: ActiveCustomUi = {
            component: component as CustomUiComponent,
            width,
            resolve: (value) => finish(value as T),
            settled: false,
          };
          this.activeCustomUis.set(id, custom);
          this.emitCustomUiRender(id, custom);
        })
        .catch((error) => {
          if (completed) return;
          this.emit({
            type: "extension_error",
            extensionPath: `custom-ui:${id}`,
            event: "custom_ui",
            error: error instanceof Error ? error.message : String(error),
          });
          finish(undefined as T);
        });
    });
  }

  private requestExtensionUi<T>(
    request: ExtensionUiRequestBody,
    defaultValue: T,
    parseResponse: (response: ExtensionUiResponse) => T,
    timeout?: number,
    signal?: AbortSignal,
  ): Promise<T> {
    if (signal?.aborted) return Promise.resolve(defaultValue);

    const id = randomUUID();
    const fullRequest = {
      type: "extension_ui_request",
      id,
      ...request,
      ...(timeout ? { timeout, expiresAt: Date.now() + timeout } : {}),
    };

    return new Promise((resolve) => {
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const cleanup = () => {
        if (timeoutId) clearTimeout(timeoutId);
        signal?.removeEventListener("abort", onAbort);
        this.pendingUiRequests.delete(id);
        this.pendingUiResponses.delete(id);
      };
      const settle = (value: T) => {
        cleanup();
        resolve(value);
      };
      const onAbort = () => settle(defaultValue);

      if (timeout) timeoutId = setTimeout(() => settle(defaultValue), timeout);
      signal?.addEventListener("abort", onAbort, { once: true });

      this.pendingUiRequests.set(id, fullRequest as AgentEvent);
      this.pendingUiResponses.set(id, {
        resolve: (response) => settle(parseResponse(response)),
        cancel: () => settle(defaultValue),
      });
      this.emit(fullRequest as AgentEvent);
    });
  }

  private createExtensionUiContext(): ExtensionUiContextLike {
    return {
      select: (title, options, opts) => this.requestExtensionUi(
        { method: "select", title, options, ...(opts?.timeout ? { timeout: opts.timeout } : {}) },
        undefined,
        (response) => "value" in response ? response.value : undefined,
        opts?.timeout,
        opts?.signal,
      ),
      confirm: (title, message, opts) => this.requestExtensionUi(
        { method: "confirm", title, message, ...(opts?.timeout ? { timeout: opts.timeout } : {}) },
        false,
        (response) => "confirmed" in response ? response.confirmed : false,
        opts?.timeout,
        opts?.signal,
      ),
      input: (title, placeholder, opts) => this.requestExtensionUi(
        { method: "input", title, ...(placeholder !== undefined ? { placeholder } : {}), ...(opts?.timeout ? { timeout: opts.timeout } : {}) },
        undefined,
        (response) => "value" in response ? response.value : undefined,
        opts?.timeout,
        opts?.signal,
      ),
      editor: (title, prefill, opts) => this.requestExtensionUi(
        { method: "editor", title, ...(prefill !== undefined ? { prefill } : {}), ...(opts?.timeout ? { timeout: opts.timeout } : {}) },
        undefined,
        (response) => "value" in response ? response.value : undefined,
        opts?.timeout,
        opts?.signal,
      ),
      notify: (message, type) => {
        this.emit({
          type: "extension_ui_request",
          id: randomUUID(),
          method: "notify",
          message,
          notifyType: type,
        } as ExtensionUiRequest as AgentEvent);
      },
      onTerminalInput: () => () => {},
      setStatus: (key, text) => {
        if (text === undefined) this.extensionStatuses.delete(key);
        else this.extensionStatuses.set(key, text);
        this.emit({
          type: "extension_ui_request",
          id: randomUUID(),
          method: "setStatus",
          statusKey: key,
          statusText: text,
        } as ExtensionUiRequest as AgentEvent);
      },
      setWorkingMessage: () => {},
      setWorkingVisible: () => {},
      setWorkingIndicator: () => {},
      setHiddenThinkingLabel: () => {},
      setWidget: (key, content, options) => {
        if (!this._alive || this.extensionWidgetsResetting) return;
        if (typeof content === "function") {
          this.setExtensionWidgetFactory(
            key,
            content as unknown as ExtensionWidgetFactory,
            options,
          );
          return;
        }
        if (content !== undefined && !Array.isArray(content)) return;
        if (content === undefined) {
          this.clearExtensionWidget(key);
          return;
        }
        const generation = this.activeExtensionWidgets.has(key)
          ? this.clearExtensionWidget(key)
          : this.nextExtensionWidgetGeneration(key);
        if (this.extensionWidgetGenerations.get(key) !== generation) return;
        this.extensionWidgets.set(key, {
          key,
          lines: content,
          placement: options?.placement ?? "aboveEditor",
        });
        this.emit({
          type: "extension_ui_request",
          id: randomUUID(),
          method: "setWidget",
          widgetKey: key,
          widgetLines: content,
          widgetPlacement: options?.placement,
        } as ExtensionUiRequest as AgentEvent);
      },
      setFooter: () => {},
      setHeader: () => {},
      setTitle: (title) => {
        this.emit({
          type: "extension_ui_request",
          id: randomUUID(),
          method: "setTitle",
          title,
        } as ExtensionUiRequest as AgentEvent);
      },
      custom: <T = unknown>(factory: unknown, options?: unknown) => this.requestExtensionCustomUi<T>(factory, options),
      pasteToEditor: (text) => {
        this.emit({
          type: "extension_ui_request",
          id: randomUUID(),
          method: "set_editor_text",
          text,
        } as ExtensionUiRequest as AgentEvent);
      },
      setEditorText: (text) => {
        this.emit({
          type: "extension_ui_request",
          id: randomUUID(),
          method: "set_editor_text",
          text,
        } as ExtensionUiRequest as AgentEvent);
      },
      getEditorText: () => "",
      addAutocompleteProvider: () => {},
      setEditorComponent: () => {},
      getEditorComponent: () => undefined,
      get theme() { return PLAIN_TEXT_THEME; },
      getAllThemes: () => [],
      getTheme: () => undefined,
      setTheme: () => ({ success: false, error: "Theme switching is not supported in Pi Web extension UI yet" }),
      getToolsExpanded: () => false,
      setToolsExpanded: () => {},
    };
  }

  private createExtensionCommandContextActions(): ExtensionCommandContextActionsLike {
    return {
      waitForIdle: async () => {
        const agent = this.inner.agent as { waitForIdle?: () => Promise<void> };
        await agent.waitForIdle?.();
      },
      newSession: async () => ({ cancelled: true }),
      fork: async () => ({ cancelled: true }),
      navigateTree: async (targetId, options) => {
        const result = await this.inner.navigateTree(targetId, { summarize: options?.summarize });
        return { cancelled: result.cancelled };
      },
      switchSession: async () => ({ cancelled: true }),
      reload: async () => {
        this.extensionStatuses.clear();
        this.resetExtensionWidgetsForReload();
        this.syncProjectTrust();
        await this.inner.reload({
          beforeSessionStart: () => {
            this.inner.extensionRunner.setUIContext?.(this.createExtensionUiContext(), "rpc");
          },
        });
        this.applyForcedEmptySystemPrompt();
      },
    };
  }

  private syncProjectTrust(): void {
    const status = getProjectTrustStatus(this.cwd, getAgentDir());
    this.inner.settingsManager.setProjectTrusted(status.trusted);
  }
}

// ============================================================================
// Session registry
// ============================================================================

declare global {
  var __piSessions: Map<string, AgentSessionWrapper> | undefined;
  var __piStartLocks: Map<string, Promise<{ session: AgentSessionWrapper; realSessionId: string }>> | undefined;
  var __piStartingSessionCwds: Map<string, number> | undefined;
  var __piRunningListeners: Set<(ids: string[]) => void> | undefined;
}

function getRegistry(): Map<string, AgentSessionWrapper> {
  if (!globalThis.__piSessions) {
    globalThis.__piSessions = new Map();
    const cleanup = () => globalThis.__piSessions?.forEach((s) => s.destroy());
    process.once("exit", cleanup);
    process.once("SIGINT", cleanup);
    process.once("SIGTERM", cleanup);
  }
  return globalThis.__piSessions;
}

function getLocks(): Map<string, Promise<{ session: AgentSessionWrapper; realSessionId: string }>> {
  if (!globalThis.__piStartLocks) globalThis.__piStartLocks = new Map();
  return globalThis.__piStartLocks;
}

function normalizeRpcCwd(cwd: string): string {
  const resolvedCwd = resolve(cwd);
  try {
    return realpathSync(resolvedCwd);
  } catch {
    return resolvedCwd;
  }
}

function getStartingSessionCwds(): Map<string, number> {
  if (!globalThis.__piStartingSessionCwds) globalThis.__piStartingSessionCwds = new Map();
  return globalThis.__piStartingSessionCwds;
}

function trackStartingSession(cwd: string): () => void {
  const startingCwds = getStartingSessionCwds();
  const key = normalizeRpcCwd(cwd);
  startingCwds.set(key, (startingCwds.get(key) ?? 0) + 1);
  return () => {
    const remaining = (startingCwds.get(key) ?? 1) - 1;
    if (remaining > 0) startingCwds.set(key, remaining);
    else startingCwds.delete(key);
  };
}

export function getRpcSession(sessionId: string): AgentSessionWrapper | undefined {
  return getRegistry().get(sessionId);
}

function runtimeMessageText(entry: SessionMessageEntry): string {
  if (entry.message.role === "bashExecution") return "";
  const content = entry.message.content;
  if (typeof content === "string") return content;
  return content
    .map((block) => block.type === "text" ? block.text : "")
    .filter(Boolean)
    .join(" ");
}

function runtimeMessageActivityMs(entry: SessionMessageEntry): number | undefined {
  if (entry.message.role !== "user" && entry.message.role !== "assistant") return undefined;
  if (typeof entry.message.timestamp === "number") return entry.message.timestamp;
  const timestamp = new Date(entry.timestamp).getTime();
  return Number.isNaN(timestamp) ? undefined : timestamp;
}

/**
 * Return live sessions that should be visible in the session list. Pi delays
 * the first JSONL flush until an assistant message exists, so an accepted new
 * prompt must temporarily be described from its in-memory SessionManager.
 */
export function getRpcSessionInfos(): SessionInfo[] {
  const sessions: SessionInfo[] = [];
  for (const session of getRegistry().values()) {
    if (!session.isAlive()) continue;

    const manager = session.inner.sessionManager;
    const header = manager.getHeader();
    const entries = manager.getEntries() as unknown as Array<
      { type: string; timestamp: string } | SessionMessageEntry
    >;
    const messages = entries.filter((entry): entry is SessionMessageEntry => entry.type === "message");
    const firstUserMessage = messages.find((entry) => entry.message.role === "user");
    const sessionFile = manager.getSessionFile() ?? session.sessionFile;
    const persisted = Boolean(sessionFile && existsSync(sessionFile));

    // An ensure_session call creates an idle, empty runtime while the composer
    // loads commands. Do not leak it into history before a prompt is accepted.
    if (!persisted && (!session.isRunning() || !firstUserMessage)) continue;

    const created = header?.timestamp
      ?? entries[0]?.timestamp
      ?? new Date().toISOString();
    const headerTimestamp = new Date(created).getTime();
    let lastActivityMs = Number.isNaN(headerTimestamp) ? Date.now() : headerTimestamp;
    for (const message of messages) {
      const activityMs = runtimeMessageActivityMs(message);
      if (activityMs !== undefined) lastActivityMs = Math.max(lastActivityMs, activityMs);
    }

    sessions.push({
      path: sessionFile ?? "",
      id: header?.id ?? session.sessionId,
      cwd: header?.cwd ?? session.cwd,
      name: manager.getSessionName(),
      created,
      modified: new Date(lastActivityMs).toISOString(),
      messageCount: messages.length,
      firstMessage: firstUserMessage ? runtimeMessageText(firstUserMessage) || "(no messages)" : "(no messages)",
      transient: !persisted,
    });
  }
  return sessions;
}

export function hasBusyRpcSessionForCwd(cwd: string): boolean {
  const targetCwd = normalizeRpcCwd(cwd);
  if (getStartingSessionCwds().has(targetCwd)) return true;
  return Array.from(getRegistry().values()).some(
    (session) => normalizeRpcCwd(session.cwd) === targetCwd && session.isRunning(),
  );
}

export async function destroyRpcSessionsForCwd(cwd: string): Promise<number> {
  const targetCwd = normalizeRpcCwd(cwd);
  const sessions = Array.from(getRegistry().values()).filter(
    (session) => normalizeRpcCwd(session.cwd) === targetCwd,
  );
  await Promise.all(sessions.map((session) => session.shutdown()));
  return sessions.length;
}

export function getRunningRpcSessionIds(): string[] {
  const ids = new Set<string>();
  for (const [sessionId, session] of getRegistry()) {
    if (session.isRunning()) ids.add(session.sessionId || sessionId);
  }
  return [...ids];
}

// ----------------------------------------------------------------------------
// Running-status broadcaster
//
// Pushes the current set of running session ids to subscribers whenever any
// session's running state may have changed. This lets the sidebar receive live
// updates over SSE instead of polling. Listeners live on globalThis so they
// survive Next.js hot-reload.
// ----------------------------------------------------------------------------

function getRunningListeners(): Set<(ids: string[]) => void> {
  if (!globalThis.__piRunningListeners) globalThis.__piRunningListeners = new Set();
  return globalThis.__piRunningListeners;
}

/** Subscribe to running-session-id changes. Returns an unsubscribe function. */
export function subscribeRunningSessions(listener: (ids: string[]) => void): () => void {
  const listeners = getRunningListeners();
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

let lastRunningSnapshot = "";

/**
 * Recompute the running-session-id set and, if it changed since the last
 * notification, broadcast it to subscribers.
 */
export function notifyRunningChange(): void {
  const listeners = getRunningListeners();
  if (listeners.size === 0) {
    // A future subscriber receives its own initial snapshot. Clear this one so
    // its first state transition cannot match stale state from an old listener.
    lastRunningSnapshot = "";
    return;
  }
  const ids = getRunningRpcSessionIds();
  const snapshot = JSON.stringify([...ids].sort());
  if (snapshot === lastRunningSnapshot) return;
  lastRunningSnapshot = snapshot;
  for (const listener of listeners) {
    try { listener(ids); } catch { /* ignore listener errors */ }
  }
}

/**
 * Get or create an AgentSession for the given session.
 * For new sessions (sessionFile === ""), pi generates its own id.
 * New sessions resolve enabledModels before construction so the initial model,
 * thinking pin, and SDK scopedModels share one settings snapshot.
 * Pass options.toolNames to pre-configure active tools (empty = all disabled).
 */
export async function startRpcSession(
  sessionId: string,
  sessionFile: string,
  cwd: string | undefined,
  options: RpcSessionStartOptions = {},
): Promise<{ session: AgentSessionWrapper; realSessionId: string }> {
  const { toolNames, initialModel, thinkingLevel } = options;
  const registry = getRegistry();
  const locks = getLocks();

  const existing = registry.get(sessionId);
  if (existing?.isAlive()) return { session: existing, realSessionId: sessionId };

  const inflight = locks.get(sessionId);
  if (inflight) return inflight;

  let sessionManager: SessionManager;
  if (sessionFile) {
    sessionManager = SessionManager.open(sessionFile, undefined);
  } else {
    if (!cwd) throw new Error("cwd is required for a new session");
    sessionManager = SessionManager.create(cwd, undefined);
  }
  const sessionCwd = sessionManager.getCwd();
  const finishStartingSession = trackStartingSession(sessionCwd);
  const starting = (async () => {
    // Some extensions access the SDK's global theme even outside the terminal UI.
    initTheme();
    const agentDir = getAgentDir();

    // Determine which tools to pass based on requested toolNames.
    // Since v0.68.0, session creation expects string[] tool names instead of Tool[] instances.
    let toolsOption: string[] | undefined;
    if (toolNames !== undefined) {
      // toolNames === [] -> "all off" (an empty allow-list disables every tool).
      // Otherwise DO NOT pass a builtin-only allow-list: passing CODING_TOOL_NAMES
      // set allowedToolNames to coding builtins only, which filtered every
      // extension/package-provided tool (e.g. subagents, web access) out of the
      // tool registry — so they were unavailable in Pi Web sessions even though the
      // `pi` CLI keeps them. Leaving the allow-list unset lets the SDK register all
      // tools (and activate extension tools); we narrow the ACTIVE set below.
      toolsOption = toolNames.length === 0 ? [] : undefined;
    }

    // Build services first so extension-registered providers are available
    // before the SDK restores the saved model from the session file.
    // Gate untrusted project extensions so opening a repository does not run
    // its .pi/extensions code automatically (see lib/project-trust.ts, #236).
    const trustReloadOptions = projectTrustReloadOptions(sessionCwd, agentDir);
    const settingsManager = SettingsManager.create(sessionCwd, agentDir);
    const services = await createAgentSessionServices({
      cwd: sessionCwd,
      agentDir,
      settingsManager,
      resourceLoaderOptions: {
        extensionFactories: [
          createProjectCommandBashExtension({
            cwd: sessionCwd,
            settings: settingsManager,
          }),
        ],
        extensionsOverride: preferUserBashExtension,
      },
      ...(trustReloadOptions ? { resourceLoaderReloadOptions: trustReloadOptions } : {}),
    });
    const scope = await resolveVisibleModels(
      services.modelRuntime,
      services.settingsManager.getEnabledModels(),
    );
    const defaultProvider = services.settingsManager.getDefaultProvider();
    const defaultModelId = services.settingsManager.getDefaultModel();
    const hasExistingMessages = sessionManager.getBranch().some((entry) => entry.type === "message");
    const initial = hasExistingMessages
      ? { scopedModels: [...scope.scopedModels] }
      : selectInitialModelScope(scope, {
        ...(initialModel ? { requestedModel: initialModel } : {}),
        ...(defaultProvider && defaultModelId
          ? { defaultModel: { provider: defaultProvider, modelId: defaultModelId } }
          : {}),
        ...(thinkingLevel ? { thinkingLevel } : {}),
      });
    const { session: inner } = await createAgentSessionFromServices({
      services,
      sessionManager,
      ...(initial.model ? { model: initial.model } : {}),
      ...(initial.thinkingLevel ? { thinkingLevel: initial.thinkingLevel } : {}),
      ...(initial.scopedModels.length > 0 ? { scopedModels: initial.scopedModels } : {}),
      ...(toolsOption !== undefined ? { tools: toolsOption } : {}),
    });

    const persistedPreferences = await persistExplicitStartupPreferences(
      services.settingsManager,
      {
        ...(initialModel ? { model: initialModel } : {}),
        ...(thinkingLevel ? { thinkingLevel } : {}),
      },
      {
        ...(inner.model
          ? { model: { provider: inner.model.provider, modelId: inner.model.id } }
          : {}),
        thinkingLevel: inner.thinkingLevel,
        supportsThinking: inner.supportsThinking(),
      },
    );
    if (persistedPreferences.modelDefaultChanged) invalidateModelsCache();

    // If specific tool names were requested (non-empty), set the active tools to the
    // requested builtin coding tools PLUS all extension/package tools, so installed
    // extensions stay usable in Pi Web just like in the `pi` CLI.
    if (toolNames && toolNames.length > 0) {
      inner.setActiveToolsByName(withExtensionTools(inner, toolNames));
    }

    const wrapper = new AgentSessionWrapper(inner);
    // When all tools are disabled, clear the system prompt entirely.
    // pi's buildSystemPrompt always produces a non-empty prompt even with no tools;
    // keep this forced after extension resource discovery and reloads as well.
    if (toolNames?.length === 0) {
      wrapper.setForceEmptySystemPrompt(true);
    }
    wrapper.start();

    const realSessionId = inner.sessionId as string;
    const realSessionFile = inner.sessionFile as string | undefined;
    if (realSessionFile) cacheSessionPath(realSessionId, realSessionFile);

    wrapper.onDestroy(() => registry.delete(realSessionId));
    registry.set(realSessionId, wrapper);
    wrapper.beginExtensionBinding({ forceEmptySystemPrompt: toolNames?.length === 0 });

    return { session: wrapper, realSessionId };
  })().finally(() => {
    locks.delete(sessionId);
    finishStartingSession();
  });

  locks.set(sessionId, starting);
  return starting;
}
