// Extension API types — the contract between pi-web and browser-side UI extensions.
//
// Extensions are trusted ES modules loaded in the browser that contribute UI:
// actions (command palette), workspacePanels (sidebar tabs), and workspaceLabels
// (inline metadata in session list). Mirrors jmfederico/pi-web's plugin model but
// adapted for React (no Lit html/svg injection — extensions use JSX via shared React).
//
// Versioning: apiVersion is a literal `1`. Breaking changes wait for `2`.

import type { ReactNode, ComponentType } from "react";
import type { AgentEventBus } from "./event-bus";

// ============================================================================
// Identifiers
// ============================================================================

/** Globally unique extension id (from package.json piWeb.extensions[].id). */
export type ExtensionId = string;
/** Local contribution id within an extension. */
export type LocalContributionId = string;
/** Qualified id: `${extensionId}:${localContributionId}` — globally unique. */
export type QualifiedContributionId = string;

/** Validation regex for both extension ids and local contribution ids. */
export const ID_PATTERN = /^[a-z][a-z0-9.-]*$/;

// ============================================================================
// Extension module shape
// ============================================================================

export interface PiWebExtension {
  /** Must be exactly 1. */
  apiVersion: 1;
  /** Human-readable name shown in config UI. */
  name: string;
  /** Called once on load; returns all contributions. Keep cheap and synchronous. */
  activate: (context: ExtensionActivationContext) => ExtensionContributions;
}

export interface ExtensionActivationContext {
  apiVersion: 1;
  extensionId: ExtensionId;
  /** Subscribe to agent lifecycle events (tool calls, messages, start/end). */
  eventBus?: AgentEventBus;
}

export interface ExtensionContributions {
  actions?: ExtensionAction[];
  workspacePanels?: WorkspacePanelContribution[];
  workspaceLabels?: WorkspaceLabelContribution[];
}

// ============================================================================
// Contexts (passed to contribution callbacks at render/query time)
// ============================================================================

/** Runtime state exposed to extensions. */
export interface ExtensionRuntimeState {
  selectedSession?: { id: string; cwd?: string; name?: string } | null;
  selectedCwd?: string | null;
  /** Whether the agent is currently running a prompt. */
  agentRunning?: boolean;
  /** Names of currently active tools. */
  activeTools?: string[];
  /** Session statistics snapshot (message/tool counts, tokens, cost). */
  sessionStats?: {
    totalMessages?: number;
    toolCalls?: number;
    tokens?: { total?: number };
    cost?: number;
  } | null;
}

/** Context for actions (command palette). */
export interface ExtensionRuntimeContext {
  state: ExtensionRuntimeState;
  /** Focus the chat prompt input. */
  focusPrompt: () => void;
  /** Open the right-side file/panel area. */
  openFilePanel: () => void;
  /** Open an extension panel tab by qualified id (e.g. "git-status:panel"). */
  openExtensionPanel: (qualifiedId: string, title?: string) => void;
}

/** Context for workspace panels and labels. */
export interface WorkspaceContext {
  session?: { id: string; cwd?: string; name?: string; worktreeBranch?: string } | null;
  cwd?: string;
  state: ExtensionRuntimeState;
}

/** Context for workspace panels (extends base with prompt access). */
export interface WorkspacePanelContext extends WorkspaceContext {
  /** Ask the host to re-evaluate badge/visible/render (escape hatch for side effects). */
  requestRender: () => void;
  /** Scroll the chat to the message matching entryId (click-to-jump from panels). */
  scrollToEntry?: (entryId: string) => void;
}

/** Context for workspace labels. Same shape as WorkspaceContext. */
export type WorkspaceLabelContext = WorkspaceContext;

// ============================================================================
// Contributions
// ============================================================================

// --- Actions (command palette items) ---

export interface ExtensionAction {
  id: LocalContributionId;
  title: string;
  description?: string;
  /** Shortcut hint, e.g. "mod+shift+p". */
  shortcut?: string;
  /** If returns false, the action shows greyed out with disabledReason. */
  enabled?: (ctx: ExtensionRuntimeContext) => boolean;
  /** Shown when enabled() returns false. */
  disabledReason?: (ctx: ExtensionRuntimeContext) => string | undefined;
  /** Execute the action. */
  run: (ctx: ExtensionRuntimeContext) => void | Promise<void>;
}

// --- Workspace panels (sidebar tabs alongside Files) ---

export interface WorkspacePanelContribution {
  id: LocalContributionId;
  title: string;
  /** React node (extension uses window.React to create it). */
  icon?: ReactNode;
  /** Sort order, default 1000. */
  order?: number;
  visible?: (ctx: WorkspacePanelContext) => boolean;
  badge?: (ctx: WorkspacePanelContext) => string | number | undefined;
  /** Render the panel content as ReactNode. */
  render: (ctx: WorkspacePanelContext) => ReactNode;
}

// --- Workspace labels (inline metadata in session list) ---

export interface WorkspaceLabelContribution {
  id: LocalContributionId;
  order?: number;
  visible?: (ctx: WorkspaceLabelContext) => boolean;
  /** Must return synchronously; empty array = render nothing. */
  items: (ctx: WorkspaceLabelContext) => WorkspaceLabelItem[];
}

export type WorkspaceLabelItem =
  | { type: "text"; text: string; title?: string; icon?: ReactNode }
  | { type: "link"; text: string; href: string; title?: string }
  // render type: host mounts the component — avoids cross-React-instance issues.
  | { type: "render"; Component: ComponentType; props?: Record<string, unknown> };

// ============================================================================
// Internal types (qualified contributions stored by registry)
// ============================================================================

export interface QualifiedAction extends Omit<
  ExtensionAction,
  "id" | "enabled" | "disabledReason" | "run"
> {
  qualifiedId: QualifiedContributionId;
  extensionId: ExtensionId;
  enabled?: (ctx: ExtensionRuntimeContext) => boolean;
  disabledReason?: (ctx: ExtensionRuntimeContext) => string | undefined;
  run: (ctx: ExtensionRuntimeContext) => void | Promise<void>;
}

export interface QualifiedPanel extends Omit<
  WorkspacePanelContribution,
  "id" | "visible" | "badge" | "render"
> {
  qualifiedId: QualifiedContributionId;
  extensionId: ExtensionId;
  visible?: (ctx: WorkspacePanelContext) => boolean;
  badge?: (ctx: WorkspacePanelContext) => string | number | undefined;
  render: (ctx: WorkspacePanelContext) => ReactNode;
}

export interface QualifiedLabelContribution {
  qualifiedId: QualifiedContributionId;
  extensionId: ExtensionId;
  order: number;
  visible?: (ctx: WorkspaceLabelContext) => boolean;
  items: (ctx: WorkspaceLabelContext) => WorkspaceLabelItem[];
}

// ============================================================================
// Manifest / discovery types
// ============================================================================

export type ExtensionSource = "bundled" | "local";

export interface ExtensionManifestEntry {
  id: ExtensionId;
  /** URL to the module JS, e.g. "/api/extensions/git-status/index.js?v=123". */
  module: string;
  source: ExtensionSource;
  /** Human-readable name (from package.json). */
  name?: string;
}

export interface ExtensionManifest {
  extensions: ExtensionManifestEntry[];
}

export interface ExtensionRecord {
  id: ExtensionId;
  /** Absolute path to the module file on disk. */
  modulePath: string;
  /** Relative module path within the extension dir (for asset URLs). */
  moduleRelative: string;
  source: ExtensionSource;
  /** Package dir on disk. */
  dir: string;
  name?: string;
  /** Math.floor(mtimeMs) for cache busting. */
  version: number;
}

/** Info for the config UI. */
export interface LoadedExtensionInfo {
  id: ExtensionId;
  name: string;
  source: ExtensionSource;
  actionCount: number;
  panelCount: number;
  labelCount: number;
}

// ============================================================================
// Type guards
// ============================================================================

export function isPiWebExtension(value: unknown): value is PiWebExtension {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as PiWebExtension).apiVersion === 1 &&
    typeof (value as PiWebExtension).name === "string" &&
    typeof (value as PiWebExtension).activate === "function"
  );
}
