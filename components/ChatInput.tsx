"use client";

import React, { useRef, useState, useCallback, useEffect, useLayoutEffect, useImperativeHandle, forwardRef, KeyboardEvent } from "react";
import {
  AlertTriangle,
  ArrowRight,
  ArrowUp,
  Brain,
  Check,
  ChevronDown,
  ChevronUp,
  Cpu,
  Folder,
  History,
  List,
  LoaderCircle,
  Minimize2,
  Pencil,
  Plus,
  Shield,
  RotateCw,
  Square,
  Trash2,
  X,
} from "lucide-react";
import type { BuiltinSlashCommandResult, CompactResultInfo, QueuedMessages, SlashCommandInfo } from "@/hooks/useAgentSession";
import type { SkillsResponse } from "@/lib/api-types";
import type { TextContent, UserMessage } from "@/lib/types";
import {
  clearDraft,
  getDraft,
  mergeRestoredSubmissionDraft,
  mergeRestoredSubmissionText,
  rekeyDraft as rekeyStoredDraft,
  setDraft,
  type ChatDraftImage,
} from "@/lib/draft-store";
import {
  MAX_ATTACHED_IMAGE_BYTES,
  MAX_ATTACHED_IMAGES,
  isBase64ImageWithinLimits,
} from "@/lib/image-attachments";
import {
  buildEntriesFromFiles, buildAtInsertText, extractAtQuery, filterFileEntries,
  type AtQueryMatch, type FileIndexEntry,
} from "@/lib/file-fuzzy";
import { FolderIcon, getFileIcon } from "./FileIcons";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useI18n } from "@/hooks/useI18n";
import type { ToolPreset } from "@/lib/tool-presets";

export interface AttachedImage {
  data: string;   // base64, no prefix
  mimeType: string;
  previewUrl: string; // object URL for display
}

interface ModelOption {
  provider: string;
  modelId: string;
  name: string;
}

interface Props {
  onSend: (message: string, images?: AttachedImage[]) => void;
  onAbort: () => void;
  onSteer?: (message: string, images?: AttachedImage[]) => void;
  onFollowUp?: (message: string, images?: AttachedImage[]) => void;
  onPromptWithStreamingBehavior?: (message: string, behavior: "steer" | "followUp", images?: AttachedImage[]) => void;
  /** Empty-draft Cmd/Ctrl+Enter: steer every queued message into the running turn (DSH 插话). */
  onSteerAllQueued?: () => void;
  /** Remove one queued message by kind + text. */
  onQueueRemoveItem?: (kind: "steering" | "followUp", text: string) => void;
  /** Replace one queued message by kind + text. */
  onQueueEditItem?: (kind: "steering" | "followUp", text: string, replacement: string) => void;
  /** Deliver one queued message into the running turn now. */
  onQueueSteerItem?: (kind: "steering" | "followUp", text: string) => void;
  isStreaming: boolean;
  model?: { provider: string; modelId: string } | null;
  isAutoModelSelection?: boolean;
  modelNames?: Record<string, string>;
  modelList?: { id: string; name: string; provider: string }[];
  modelError?: string | null;
  /** Diagnostics from resolving `enabledModels`, e.g. a pattern that matched nothing. */
  modelScopeWarnings?: string[];
  onModelChange?: (provider: string, modelId: string) => void;
  modelSwitching?: boolean;
  onCompact?: () => void;
  onAbortCompaction?: () => void;
  onClearCompactFeedback?: () => void;
  isCompacting?: boolean;
  compactError?: string | null;
  compactResult?: CompactResultInfo | null;
  toolPreset?: ToolPreset;
  onToolPresetChange?: (preset: ToolPreset) => void;
  thinkingLevel?: "auto" | "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
  onThinkingLevelChange?: (level: "auto" | "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max") => void;
  availableThinkingLevels?: string[] | null;
  thinkingLevelMap?: Record<string, string | null> | null;
  retryInfo?: { attempt: number; maxAttempts: number; errorMessage?: string } | null;
  queuedMessages?: QueuedMessages | null;
  inputHistory?: string[];
  slashCommands?: SlashCommandInfo[];
  slashCommandsLoading?: boolean;
  onLoadSlashCommands?: () => Promise<SlashCommandInfo[]> | SlashCommandInfo[];
  onBuiltinCommand?: (message: string) => Promise<BuiltinSlashCommandResult>;
  onAudioUnlock?: () => void;
  draftKey?: string;
  /** Session working directory — enables the @ file autocomplete menu */
  cwd?: string | null;
  /** Basename shown inside the composer on the empty new-session home. */
  workspaceHint?: string | null;
}

export interface ChatInputHandle {
  insertText: (text: string) => void;
  insertIfEmpty: (text: string) => void;
  replaceMessage: (message: UserMessage) => void;
  prependText: (text: string) => void;
  addImages: (files: File[]) => void;
  rekeyDraft: (previousKey: string, nextKey: string) => void;
  restoreSubmission: (text: string, images?: ChatDraftImage[], targetDraftKey?: string) => void;
}

const TOOL_PRESETS = ["off", "read-only", "default", "full"] as const;
type ToolPresetLabel = typeof TOOL_PRESETS[number];
const TOOL_PRESET_MAP: Record<ToolPresetLabel, ToolPreset> = {
  off: "none",
  "read-only": "read-only",
  default: "default",
  full: "full",
};
const TOOL_PRESET_LABEL_KEYS: Record<ToolPresetLabel, string> = {
  off: "chat.presetOff",
  "read-only": "chat.presetReadOnly",
  default: "chat.presetDefault",
  full: "chat.presetFull",
};
const COMPOSITION_END_ENTER_GRACE_MS = 100;
const MODEL_FILTER_THRESHOLD = 8;
const MODEL_OPTION_COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
const ANCHORED_MENU_GAP = 8;

export function getUpwardMenuMaxHeight(menuBottom: number, visibleTop: number, gap = ANCHORED_MENU_GAP): number {
  return Math.max(0, Math.floor(menuBottom - visibleTop - gap));
}

function getVisibleTopBoundary(element: HTMLElement): number {
  let visibleTop = window.visualViewport?.offsetTop ?? 0;

  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const overflowY = window.getComputedStyle(parent).overflowY;
    if (overflowY === "auto" || overflowY === "scroll" || overflowY === "hidden" || overflowY === "clip") {
      visibleTop = Math.max(visibleTop, parent.getBoundingClientRect().top + parent.clientTop);
    }
  }

  return visibleTop;
}

function compareModelOptions(a: ModelOption, b: ModelOption): number {
  return MODEL_OPTION_COLLATOR.compare(a.name || a.modelId, b.name || b.modelId)
    || MODEL_OPTION_COLLATOR.compare(a.provider, b.provider)
    || MODEL_OPTION_COLLATOR.compare(a.modelId, b.modelId);
}

export function filterModelOptions(options: ModelOption[], query: string): ModelOption[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return options;

  return options.filter((option) => (
    `${option.name} ${option.modelId}`
      .toLocaleLowerCase()
      .includes(normalizedQuery)
  ));
}

const THINKING_LEVELS = ["auto", "off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
const THINKING_LEVEL_DESC_KEYS: Record<typeof THINKING_LEVELS[number], string> = {
  auto: "chat.thinkingUseDefault", off: "chat.thinkingOff", minimal: "chat.thinkingMinimal", low: "chat.thinkingLow",
  medium: "chat.thinkingMedium", high: "chat.thinkingHigh", xhigh: "chat.thinkingXhigh", max: "chat.thinkingMax",
};
const THINKING_SHORT_KEYS: Record<typeof THINKING_LEVELS[number], string> = {
  auto: "chat.thinkingShortAuto", off: "chat.thinkingShortOff", minimal: "chat.thinkingShortMinimal", low: "chat.thinkingShortLow",
  medium: "chat.thinkingShortMedium", high: "chat.thinkingShortHigh", xhigh: "chat.thinkingShortXhigh", max: "chat.thinkingShortMax",
};

export function composerThinkingBadgeLevel(level?: string | null): string | null {
  if (!level || level === "auto") return null;
  return level;
}

function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k`;
  return tokens.toLocaleString();
}

type SlashCommandPaletteItem = SlashCommandInfo | {
  name: string;
  description: string;
  source: "builtin";
};

type SlashCommandSource = SlashCommandPaletteItem["source"];

const BUILTIN_SLASH_COMMANDS: SlashCommandPaletteItem[] = [
  { name: "compact", description: "chat.commandCompact", source: "builtin" },
  { name: "reload", description: "chat.commandReload", source: "builtin" },
  { name: "name", description: "chat.commandName", source: "builtin" },
  { name: "session", description: "chat.commandSession", source: "builtin" },
  { name: "copy", description: "chat.commandCopy", source: "builtin" },
];

const SLASH_SOURCES: SlashCommandSource[] = ["builtin", "extension", "prompt", "skill"];

const SLASH_SOURCE_GROUP_LABEL_KEYS: Record<SlashCommandSource, string> = {
  builtin: "chat.builtIn",
  extension: "chat.extensions",
  prompt: "chat.prompts",
  skill: "chat.skills",
};

const SLASH_SOURCE_ORDER: Record<SlashCommandSource, number> = {
  builtin: 0,
  extension: 1,
  prompt: 2,
  skill: 3,
};

function slashMatchRank(command: SlashCommandPaletteItem, query: string, t: (key: string) => string): number {
  const name = command.name.toLowerCase();
  const description = getSlashDescription(command, t).toLowerCase();
  if (name === query) return 0;
  if (name.startsWith(query)) return 1;
  if (name.includes(query)) return 2;
  if (description.includes(query)) return 3;
  return 4;
}

function getSlashDescription(command: SlashCommandPaletteItem, t: (key: string) => string): string {
  return command.source === "builtin" ? t(command.description) : command.description ?? "";
}

// Skill slash commands are named "skill:<skillName>"; look the skill up in the
// dormancy map fetched from /api/skills. Unknown skills are treated as active.
function isDormantSkillCommand(command: SlashCommandPaletteItem, dormancy: Record<string, boolean>): boolean {
  if (command.source !== "skill" || !command.name.startsWith("skill:")) return false;
  return dormancy[command.name.slice("skill:".length)] === true;
}

export function buildSlashCommandLayout(
  commands: SlashCommandPaletteItem[],
  dormancy: Record<string, boolean>,
) {
  let index = 0;
  const groups = SLASH_SOURCES
    .map((source) => {
      const sourceCommands = commands.filter((command) => command.source === source);
      const orderedCommands = source === "skill"
        ? [
            ...sourceCommands.filter((command) => !isDormantSkillCommand(command, dormancy)),
            ...sourceCommands.filter((command) => isDormantSkillCommand(command, dormancy)),
          ]
        : sourceCommands;
      return {
        source,
        items: orderedCommands.map((command) => ({ command, index: index++ })),
      };
    })
    .filter((group) => group.items.length > 0);

  return {
    commands: groups.flatMap((group) => group.items.map(({ command }) => command)),
    groups,
  };
}

function imageToDraftImage(image: AttachedImage): ChatDraftImage {
  return { data: image.data, mimeType: image.mimeType };
}

function draftImageToAttachedImage(image: ChatDraftImage): AttachedImage {
  return {
    ...image,
    previewUrl: `data:${image.mimeType};base64,${image.data}`,
  };
}

function draftImagesToAttachedImages(images: ChatDraftImage[] | undefined): AttachedImage[] {
  return (images ?? [])
    .filter(isBase64ImageWithinLimits)
    .slice(0, MAX_ATTACHED_IMAGES)
    .map(draftImageToAttachedImage);
}

export function canRestoreUserMessage(
  value: string,
  attachedImageCount: number,
  pendingImageCount: number,
): boolean {
  return !value.trim() && attachedImageCount === 0 && pendingImageCount === 0;
}

export function getUserMessageText(message: UserMessage): string {
  if (typeof message.content === "string") return message.content;
  return message.content
    .filter((block): block is TextContent => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

export function getUserMessageDraftImages(message: UserMessage): ChatDraftImage[] {
  if (typeof message.content === "string") return [];
  return message.content.flatMap((block) => {
    if (block.type !== "image") return [];

    // Support both the current nested image format and older flat pi-ai entries.
    const flat = block as unknown as { data?: unknown; mimeType?: unknown };
    const data = block.source?.type === "base64" ? block.source.data : flat.data;
    const mimeType = block.source?.type === "base64" ? block.source.media_type : flat.mimeType;
    if (typeof data !== "string" || typeof mimeType !== "string") return [];

    const image = { data, mimeType };
    return isBase64ImageWithinLimits(image) ? [image] : [];
  });
}

function revokeImagePreview(image: AttachedImage): void {
  if (image.previewUrl.startsWith("blob:")) {
    URL.revokeObjectURL(image.previewUrl);
  }
}

const roundComposerButton: React.CSSProperties = {
  flexShrink: 0,
  display: "flex", alignItems: "center", justifyContent: "center",
  width: 28, height: 28,
  padding: 0,
  background: "var(--text)",
  border: "none",
  borderRadius: 999,
  color: "var(--bg)",
  cursor: "pointer",
  transition: "background 0.15s, color 0.15s, opacity 0.15s",
};

export type QueueItemKind = "steering" | "followUp";

interface QueueDockItem {
  key: string;
  kind: QueueItemKind;
  text: string;
}

/**
 * DSH-style queue strip above the composer: one queued message renders as a
 * single row; several collapse into a count header. Rows offer per-item
 * edit / remove / steer-now (插话发送) actions while the agent is running.
 */
function QueueDock({
  items,
  running,
  editing,
  editingText,
  busyKey,
  collapsed,
  onToggle,
  onStartEdit,
  onEditTextChange,
  onSaveEdit,
  onCancelEdit,
  onRemove,
  onSteer,
  t,
}: {
  items: QueueDockItem[];
  running: boolean;
  editing: QueueDockItem | null;
  editingText: string;
  busyKey: string | null;
  collapsed: boolean;
  onToggle: () => void;
  onStartEdit: (item: QueueDockItem) => void;
  onEditTextChange: (text: string) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onRemove: (item: QueueDockItem) => void;
  onSteer: (item: QueueDockItem) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}) {
  if (items.length === 0) return null;
  const interactionActive = editing !== null || busyKey !== null;
  const expanded = !collapsed || interactionActive;
  const listVisible = items.length === 1 || expanded;
  const editingRow = editing?.key ?? null;

  const actionStyle = (disabled: boolean): React.CSSProperties => ({
    width: 28, height: 28, flexShrink: 0,
    display: "grid", placeItems: "center",
    padding: 0,
    background: "none",
    border: "none",
    borderRadius: 999,
    color: "var(--text-dim)",
    cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.45 : 1,
  });

  const runAction = (item: QueueDockItem, action: (item: QueueDockItem) => void) => {
    if (interactionActive) return;
    action(item);
  };

  return (
    <div
      data-queue-dock=""
      style={{ width: "100%", marginBottom: -7 }}
    >
      <div
        style={{
          position: "relative",
          width: "100%",
          boxSizing: "border-box",
          background: "var(--bg-panel)",
          borderRadius: "12px 12px 0 0",
          border: "1px solid var(--border)",
          borderBottom: "none",
          padding: "2px 0",
          overflow: "hidden",
        }}
      >
        {items.length > 1 && (
          <button
            type="button"
            aria-expanded={expanded}
            disabled={interactionActive}
            onClick={onToggle}
            style={{
              boxSizing: "border-box",
              width: "100%",
              height: 36,
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "4px 12px",
              background: "none",
              border: "none",
              borderRadius: 8,
              color: "var(--text)",
              cursor: interactionActive ? "default" : "pointer",
              textAlign: "left",
            }}
          >
            <span style={{ flexShrink: 0, display: "grid", placeItems: "center", color: "var(--text-dim)" }}>
              <List size={14} strokeWidth={1.8} aria-hidden="true" />
            </span>
            <span style={{ minWidth: 0, flex: "1 1 auto", fontSize: "var(--text-ui)", fontWeight: 500, lineHeight: "24px" }}>
              {t("chat.queueCount", { n: items.length })}
            </span>
            <span style={{ flexShrink: 0, display: "grid", placeItems: "center", color: "var(--text-dim)" }}>
              {expanded
                ? <ChevronUp size={14} strokeWidth={1.8} aria-hidden="true" />
                : <ChevronDown size={14} strokeWidth={1.8} aria-hidden="true" />}
            </span>
          </button>
        )}
        <ul
          hidden={!listVisible}
          style={{
            maxHeight: 180,
            margin: 0,
            padding: 0,
            listStyle: "none",
            overflowY: "auto",
          }}
        >
          {listVisible && items.map((item, index) => (
            <li
              key={item.key}
              style={{
                boxSizing: "border-box",
                display: "flex",
                alignItems: "center",
                gap: 10,
                width: "100%",
                height: 36,
                padding: "4px 5px 4px 12px",
                borderRadius: 8,
                ...(index > 0 ? { boxShadow: "inset 0 1px 0 var(--border)" } : null),
              }}
            >
              {items.length === 1 && (
                <span style={{ flexShrink: 0, display: "grid", placeItems: "center", color: "var(--text-dim)" }}>
                  <List size={14} strokeWidth={1.8} aria-hidden="true" />
                </span>
              )}
              {editingRow === item.key ? (
                <input
                  autoFocus
                  aria-label={t("chat.queueEdit")}
                  value={editingText}
                  onChange={(e) => onEditTextChange(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      e.preventDefault();
                      onCancelEdit();
                      return;
                    }
                    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      onSaveEdit();
                    }
                  }}
                  style={{
                    minWidth: 0,
                    flex: "1 1 auto",
                    boxSizing: "border-box",
                    height: 28,
                    padding: "0 8px",
                    border: "1px solid var(--border)",
                    borderRadius: 6,
                    outline: "none",
                    background: "var(--bg)",
                    color: "var(--text)",
                    fontSize: "var(--text-ui)",
                    fontFamily: "inherit",
                  }}
                />
              ) : (
                <>
                <span
                  style={{
                    flexShrink: 0,
                    fontSize: "var(--text-meta)",
                    fontFamily: "var(--font-mono)",
                    padding: "1px 7px",
                    borderRadius: 999,
                    border: `1px solid ${item.kind === "steering" ? "color-mix(in srgb, var(--accent) 45%, transparent)" : "var(--border)"}`,
                    color: item.kind === "steering" ? "var(--accent)" : "var(--text-dim)",
                  }}
                >
                  {item.kind === "steering" ? t("chat.queueKindSteer") : t("chat.queueKindFollowUp")}
                </span>
                <span
                  title={item.text}
                  style={{
                    minWidth: 0,
                    flex: "1 1 auto",
                    color: "var(--text-muted)",
                    fontSize: "var(--text-ui)",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    wordBreak: "break-word",
                    overflow: "hidden",
                  }}
                >
                  {item.text}
                </span>
                </>
              )}
              <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 6 }}>
                {editingRow === item.key ? (
                  <>
                    <button
                      type="button"
                      aria-label={t("chat.queueSave")}
                      disabled={busyKey !== null || editingText.trim() === ""}
                      onClick={onSaveEdit}
                      style={actionStyle(busyKey !== null || editingText.trim() === "")}
                    >
                      <Check size={14} strokeWidth={2} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      aria-label={t("chat.queueCancelEdit")}
                      disabled={busyKey !== null}
                      onClick={onCancelEdit}
                      style={actionStyle(busyKey !== null)}
                    >
                      <X size={14} strokeWidth={2} aria-hidden="true" />
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      aria-label={t("chat.queueEdit")}
                      title={t("chat.queueEdit")}
                      disabled={interactionActive}
                      onClick={() => runAction(item, onStartEdit)}
                      style={actionStyle(interactionActive)}
                    >
                      <Pencil size={13} strokeWidth={1.8} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      aria-label={t("chat.queueRemove")}
                      title={t("chat.queueRemove")}
                      disabled={interactionActive}
                      onClick={() => runAction(item, onRemove)}
                      style={actionStyle(interactionActive)}
                    >
                      <Trash2 size={13} strokeWidth={1.8} aria-hidden="true" />
                    </button>
                    {item.kind === "followUp" ? (
                    <button
                      type="button"
                      aria-label={t("chat.queueSteer")}
                      title={running ? t("chat.queueSteer") : t("chat.queueSteerUnavailable")}
                      disabled={interactionActive || !running}
                      onClick={() => runAction(item, onSteer)}
                      style={actionStyle(interactionActive || !running)}
                    >
                      <ArrowUp size={13} strokeWidth={2} aria-hidden="true" />
                    </button>
                    ) : null}
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function ModelNoticeBanner({ tone, title, body }: { tone: "error" | "warning"; title: string; body: string }) {
  const color = tone === "error" ? "239,68,68" : "234,179,8";
  return (
    <div
      role="alert"
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 8,
        maxHeight: 120,
        marginBottom: 8,
        padding: "7px 10px",
        overflowY: "auto",
        border: `1px solid rgba(${color},0.3)`,
        borderRadius: 6,
        background: `rgba(${color},0.07)`,
        color: `rgb(${color})`,
        fontSize: "var(--text-meta)",
        lineHeight: "var(--leading-prose)",
      }}
    >
      <AlertTriangle size={13} strokeWidth={2} style={{ flexShrink: 0, marginTop: 1 }} aria-hidden="true" />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 600 }}>{title}</div>
        <div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{body}</div>
      </div>
    </div>
  );
}

export function ModelErrorBanner({ error }: { error?: string | null }) {
  const { t } = useI18n();
  if (!error) return null;
  return <ModelNoticeBanner tone="error" title={t("chat.modelError")} body={error} />;
}

/** Surfaces `enabledModels` patterns that matched nothing, so a typo is visible (#307). */
export function ModelScopeWarningBanner({ warnings }: { warnings?: string[] }) {
  const { t } = useI18n();
  if (!warnings || warnings.length === 0) return null;
  return (
    <ModelNoticeBanner
      tone="warning"
      title={t(warnings.length > 1 ? "chat.modelScopeWarnings" : "chat.modelScopeWarning")}
      body={warnings.join("\n")}
    />
  );
}

export const ChatInput = forwardRef<ChatInputHandle, Props>(function ChatInput({
  onSend, onAbort, onSteer, onFollowUp, isStreaming, model, isAutoModelSelection, modelNames, modelList, modelError, modelScopeWarnings, onModelChange, modelSwitching,
  onCompact, onAbortCompaction, onClearCompactFeedback, isCompacting, compactError, compactResult, toolPreset, onToolPresetChange,
  thinkingLevel, onThinkingLevelChange, availableThinkingLevels, thinkingLevelMap: _thinkingLevelMap,
  retryInfo, queuedMessages, inputHistory = [],
  onSteerAllQueued, onQueueRemoveItem, onQueueEditItem, onQueueSteerItem,
  slashCommands, slashCommandsLoading, onLoadSlashCommands,
  onBuiltinCommand,
  onAudioUnlock,
  onPromptWithStreamingBehavior,
  draftKey,
  cwd,
  workspaceHint,
}: Props, ref) {
  const { t } = useI18n();
  const isMobile = useIsMobile();
  const [value, setValue] = useState(() => (draftKey ? getDraft(draftKey)?.value ?? "" : ""));
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const [modelDropdownRect, setModelDropdownRect] = useState<{ top: number; left: number; width: number } | null>(null);
  const [modelFilter, setModelFilter] = useState("");
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [thinkingMenuOpen, setThinkingMenuOpen] = useState(false);
  const [queueDockCollapsed, setQueueDockCollapsed] = useState(true);
  const [queueEditing, setQueueEditing] = useState<QueueDockItem | null>(null);
  const [queueEditingText, setQueueEditingText] = useState("");
  const [queueBusyKey, setQueueBusyKey] = useState<string | null>(null);
  const [attachedImages, setAttachedImages] = useState<AttachedImage[]>(() => (
    draftKey ? draftImagesToAttachedImages(getDraft(draftKey)?.images) : []
  ));
  const trimmedValue = value.trimStart();
  const bashMode = attachedImages.length === 0 && trimmedValue.startsWith("!");
  const bashExcluded = bashMode && trimmedValue.startsWith("!!");
  const [slashMenuOpen, setSlashMenuOpen] = useState(false);
  const [slashActiveIndex, setSlashActiveIndex] = useState(0);
  const [slashMenuMaxHeight, setSlashMenuMaxHeight] = useState<number | null>(null);
  const [atQuery, setAtQuery] = useState<AtQueryMatch | null>(null);
  const [atMenuOpen, setAtMenuOpen] = useState(false);
  const [atActiveIndex, setAtActiveIndex] = useState(0);
  const [historyMenuOpen, setHistoryMenuOpen] = useState(false);
  const [aborting, setAborting] = useState(false);
  const [historyActiveIndex, setHistoryActiveIndex] = useState(0);
  const [fileIndex, setFileIndex] = useState<{ cwd: string; entries: FileIndexEntry[]; truncated: boolean } | null>(null);
  const [fileIndexLoading, setFileIndexLoading] = useState(false);
  const [atServerResult, setAtServerResult] = useState<{ cwd: string; query: string; matches: FileIndexEntry[] } | null>(null);
  const [skillDormancyState, setSkillDormancyState] = useState<{
    cwd: string;
    values: Record<string, boolean>;
  } | null>(null);
  const skillDormancy = cwd && skillDormancyState?.cwd === cwd
    ? skillDormancyState.values
    : {};

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const modelDropdownPanelRef = useRef<HTMLDivElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const thinkingMenuRef = useRef<HTMLDivElement>(null);
  const historyMenuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isComposingRef = useRef(false);
  const lastCompositionEndAtRef = useRef(0);
  const slashCommandsRequestedRef = useRef(false);
  const slashMenuRef = useRef<HTMLDivElement>(null);
  const slashItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const atItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const historyItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const fileIndexMetaRef = useRef<{ cwd: string; fetchedAt: number } | null>(null);
  const fileIndexFetchingRef = useRef<string | null>(null);
  const draftKeyRef = useRef(draftKey);
  const valueRef = useRef(value);
  const attachedImagesRef = useRef(attachedImages);
  const pendingImageCountRef = useRef(0);
  valueRef.current = value;
  attachedImagesRef.current = attachedImages;

  useImperativeHandle(ref, () => ({
    insertIfEmpty(text: string) {
      const ta = textareaRef.current;
      const current = ta ? ta.value : value;
      if (current.trim()) return;
      valueRef.current = text;
      setValue(text);
      setAtQuery(null);
      requestAnimationFrame(() => {
        if (!ta) return;
        ta.focus();
        ta.style.height = "auto";
        ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
      });
    },
    replaceMessage(message: UserMessage) {
      const ta = textareaRef.current;
      const current = ta ? ta.value : value;
      if (!canRestoreUserMessage(current, attachedImagesRef.current.length, pendingImageCountRef.current)) return;

      const restoredText = getUserMessageText(message);
      const restoredImages = draftImagesToAttachedImages(getUserMessageDraftImages(message));
      valueRef.current = restoredText;
      attachedImagesRef.current = restoredImages;
      setValue(restoredText);
      setAtQuery(null);
      setHistoryMenuOpen(false);
      setAttachedImages((prev) => {
        prev.forEach(revokeImagePreview);
        return restoredImages;
      });
      requestAnimationFrame(() => {
        if (!ta) return;
        ta.focus();
        ta.style.height = "auto";
        ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
      });
    },
    prependText(text: string) {
      if (!text.trim()) return;
      const ta = textareaRef.current;
      const current = ta ? ta.value : value;
      // Mirrors the TUI's queue restore: queued text first, then whatever
      // the user already typed, separated by a blank line.
      const combined = [text, current].filter((t) => t.trim()).join("\n\n");
      valueRef.current = combined;
      setValue(combined);
      setAtQuery(null);
      requestAnimationFrame(() => {
        if (!ta) return;
        ta.focus();
        ta.setSelectionRange(combined.length, combined.length);
        ta.style.height = "auto";
        ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
      });
    },
    rekeyDraft(previousKey: string, nextKey: string) {
      if (previousKey === nextKey) return;
      if (draftKeyRef.current !== previousKey) {
        rekeyStoredDraft(previousKey, nextKey);
        return;
      }

      const currentDraft = {
        value: valueRef.current,
        images: attachedImagesRef.current.map(imageToDraftImage),
      };
      const moved = rekeyStoredDraft(previousKey, nextKey, currentDraft) ?? { value: "", images: [] };
      const unchanged = moved.value === currentDraft.value
        && moved.images.length === currentDraft.images.length
        && moved.images.every((image, index) => (
          image.data === currentDraft.images[index]?.data
          && image.mimeType === currentDraft.images[index]?.mimeType
        ));
      draftKeyRef.current = nextKey;
      if (unchanged) return;

      const movedImages = draftImagesToAttachedImages(moved.images);
      valueRef.current = moved.value;
      attachedImagesRef.current = movedImages;
      setValue(moved.value);
      setAttachedImages((current) => {
        current.forEach(revokeImagePreview);
        return movedImages;
      });
      setAtQuery(null);
      setHistoryMenuOpen(false);
    },
    restoreSubmission(text: string, images?: ChatDraftImage[], targetDraftKey?: string) {
      if (!text.trim() && !images?.length) return;

      // clearInput is queued before the submission handler runs. Compose with
      // that queued state so a fast rejection cannot observe stale DOM text and
      // then get overwritten by the clear.
      const currentDraftKey = draftKeyRef.current;
      const destinationDraftKey = targetDraftKey ?? currentDraftKey;
      const targetsCurrentComposer = destinationDraftKey === currentDraftKey;
      const storedDraft = !targetsCurrentComposer && destinationDraftKey
        ? getDraft(destinationDraftKey)
        : null;
      const restoredDraft = mergeRestoredSubmissionDraft(
        text,
        images,
        targetsCurrentComposer ? valueRef.current : (storedDraft?.value ?? ""),
        targetsCurrentComposer
          ? attachedImagesRef.current.map(imageToDraftImage)
          : (storedDraft?.images ?? []),
      );
      // The first optimistic message switches ChatWindow out of its empty-state
      // layout and remounts this component. Persist synchronously so recovery is
      // not lost if this instance is the one being unmounted.
      if (destinationDraftKey) setDraft(destinationDraftKey, restoredDraft);
      if (!targetsCurrentComposer) return;
      const restoredImages = images?.length
        ? [
            ...draftImagesToAttachedImages(images).slice(
              0,
              Math.max(0, MAX_ATTACHED_IMAGES - attachedImagesRef.current.length),
            ),
            ...attachedImagesRef.current,
          ].slice(0, MAX_ATTACHED_IMAGES)
        : attachedImagesRef.current;
      // Session promotion can rekey this composer before React flushes the
      // functional updates below, so update the imperative snapshot first.
      valueRef.current = restoredDraft.value;
      attachedImagesRef.current = restoredImages;
      setValue((current) => {
        const restored = mergeRestoredSubmissionText(text, current);
        valueRef.current = restored;
        return restored;
      });
      setAtQuery(null);
      setHistoryMenuOpen(false);
      if (images?.length) {
        setAttachedImages((current) => {
          const available = Math.max(0, MAX_ATTACHED_IMAGES - current.length);
          const restored = draftImagesToAttachedImages(images)
            .slice(0, available);
          const next = restored.length > 0 ? [...restored, ...current] : current;
          attachedImagesRef.current = next;
          return next;
        });
      }
      requestAnimationFrame(() => {
        const ta = textareaRef.current;
        if (!ta) return;
        ta.focus();
        ta.setSelectionRange(ta.value.length, ta.value.length);
        ta.style.height = "auto";
        ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
      });
    },
    insertText(text: string) {
      const ta = textareaRef.current;
      if (!ta) {
        setValue((v) => v + (v ? " " : "") + text);
        return;
      }
      const start = ta.selectionStart ?? ta.value.length;
      const end = ta.selectionEnd ?? ta.value.length;
      const before = ta.value.slice(0, start);
      const after = ta.value.slice(end);
      const sep = before.length > 0 && !before.endsWith(" ") ? " " : "";
      const newVal = before + sep + text + after;
      valueRef.current = newVal;
      setValue(newVal);
      setAtQuery(null);
      requestAnimationFrame(() => {
        if (!ta) return;
        const pos = start + sep.length + text.length;
        ta.setSelectionRange(pos, pos);
        ta.focus();
        ta.style.height = "auto";
        ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
      });
    },
    addImages(files: File[]) {
      processImageFiles(files);
    },
  }));

  const processImageFiles = useCallback(async (files: File[]) => {
    const remaining = Math.max(
      0,
      MAX_ATTACHED_IMAGES - attachedImagesRef.current.length - pendingImageCountRef.current,
    );
    const imageFiles = files
      .filter((f) => f.type.startsWith("image/") && f.size <= MAX_ATTACHED_IMAGE_BYTES)
      .slice(0, remaining);
    if (!imageFiles.length) return;
    pendingImageCountRef.current += imageFiles.length;
    try {
      const newImages = await Promise.all(
        imageFiles.map(
          (file) =>
            new Promise<AttachedImage>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => {
                const result = reader.result as string;
                // result is "data:<mime>;base64,<data>"
                const base64 = result.split(",")[1];
                resolve({ data: base64, mimeType: file.type, previewUrl: URL.createObjectURL(file) });
              };
              reader.onerror = reject;
              reader.readAsDataURL(file);
            })
        )
      );
      setAttachedImages((prev) => {
        const accepted = newImages.slice(0, Math.max(0, MAX_ATTACHED_IMAGES - prev.length));
        newImages.slice(accepted.length).forEach(revokeImagePreview);
        const next = [...prev, ...accepted];
        attachedImagesRef.current = next;
        return next;
      });
    } finally {
      pendingImageCountRef.current -= imageFiles.length;
    }
  }, []);

  const removeImage = useCallback((index: number) => {
    setAttachedImages((prev) => {
      const next = [...prev];
      const [removed] = next.splice(index, 1);
      if (removed) revokeImagePreview(removed);
      attachedImagesRef.current = next;
      return next;
    });
  }, []);

  const clearImages = useCallback(() => {
    attachedImagesRef.current = [];
    setAttachedImages((prev) => {
      prev.forEach(revokeImagePreview);
      return [];
    });
  }, []);

  const clearInput = useCallback(() => {
    valueRef.current = "";
    setValue("");
    setAtQuery(null);
    setHistoryMenuOpen(false);
    if (draftKey) clearDraft(draftKey);
    if (draftKeyRef.current && draftKeyRef.current !== draftKey) clearDraft(draftKeyRef.current);
    clearImages();
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [clearImages, draftKey]);

  useEffect(() => {
    if (!draftKey || draftKeyRef.current !== draftKey) return;
    setDraft(draftKey, {
      value,
      images: attachedImages.map(imageToDraftImage),
    });
  }, [attachedImages, draftKey, value]);

  useEffect(() => {
    const previousDraftKey = draftKeyRef.current;
    if (previousDraftKey === draftKey) return;

    if (previousDraftKey) {
      setDraft(previousDraftKey, {
        value: valueRef.current,
        images: attachedImagesRef.current.map(imageToDraftImage),
      });
    }

    const draft = draftKey ? getDraft(draftKey) : null;
    draftKeyRef.current = draftKey;
    const nextValue = draft?.value ?? "";
    const nextImages = draftImagesToAttachedImages(draft?.images);
    valueRef.current = nextValue;
    attachedImagesRef.current = nextImages;
    setValue(nextValue);
    setAtQuery(null);
    setHistoryMenuOpen(false);
    setAttachedImages((prev) => {
      prev.forEach(revokeImagePreview);
      return nextImages;
    });
  }, [draftKey]);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    if (value) ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
  }, [value]);

  useEffect(() => {
    return () => {
      attachedImagesRef.current.forEach(revokeImagePreview);
    };
  }, []);

  useEffect(() => {
    if (!isStreaming) setAborting(false);
  }, [isStreaming]);

  const handleSend = useCallback(async () => {
    const msg = value.trim();
    if (!msg && !attachedImages.length) return;
    if (isStreaming) return;
    onAudioUnlock?.();
    if (!attachedImages.length && msg.startsWith("/") && onBuiltinCommand) {
      clearInput();
      const result = await onBuiltinCommand(msg);
      if (result.handled) {
        if (result.error && valueRef.current === "") {
          valueRef.current = msg;
          setValue(msg);
        }
        return;
      }
      onSend(msg);
      return;
    }
    clearInput();
    onSend(msg, attachedImages.length ? attachedImages : undefined);
  }, [value, attachedImages, isStreaming, onBuiltinCommand, onSend, clearInput, onAudioUnlock]);

  const slashQuery = value.startsWith("/") && !/\s/.test(value.slice(1))
    ? value.slice(1).toLowerCase()
    : null;

  const filteredSlashCommands = (() => {
    if (slashQuery === null) return [];
    const commands = [...(isStreaming ? [] : BUILTIN_SLASH_COMMANDS), ...(slashCommands ?? [])];
    return [...commands]
      .filter((command) => {
        const name = command.name.toLowerCase();
        const description = getSlashDescription(command, t).toLowerCase();
        return name.includes(slashQuery) || description.includes(slashQuery);
      })
      .sort((a, b) => {
        const rankDelta = slashMatchRank(a, slashQuery, t) - slashMatchRank(b, slashQuery, t);
        if (rankDelta !== 0) return rankDelta;
        return SLASH_SOURCE_ORDER[a.source] - SLASH_SOURCE_ORDER[b.source]
          || MODEL_OPTION_COLLATOR.compare(a.name, b.name);
      });
  })();

  const {
    commands: displayedSlashCommands,
    groups: groupedSlashCommands,
  } = buildSlashCommandLayout(filteredSlashCommands, skillDormancy);

  const slashCommandCountLabel = filteredSlashCommands.length === 1
    ? t(slashQuery ? "chat.match" : "chat.command")
    : t(slashQuery ? "chat.matches" : "chat.commands", { count: filteredSlashCommands.length });

  // ── @ file autocomplete ──────────────────────────────────────────────────
  // Recomputed from the text before the caret on every change/caret move.
  // Disabled entirely when there is no cwd (new session without a directory).
  const updateAtQuery = useCallback((text: string, cursor: number | null) => {
    if (!cwd) {
      setAtQuery(null);
      return;
    }
    const pos = cursor ?? text.length;
    setAtQuery(extractAtQuery(text.slice(0, pos)));
  }, [cwd]);

  const atQueryText = atQuery?.query ?? null;
  const atLocalMatches: FileIndexEntry[] = React.useMemo(() => (
    atQueryText !== null && fileIndex && fileIndex.cwd === cwd
      ? filterFileEntries(fileIndex.entries, atQueryText)
      : []
  ), [atQueryText, fileIndex, cwd]);

  // When the client index is truncated (repo larger than the index cap),
  // local filtering cannot see deep files, so queries are also ranked
  // server-side against the full listing. Local matches render immediately
  // and are replaced when the (debounced) server result for the current
  // query arrives; stale responses are ignored via the query/cwd tag.
  const needsServerSearch = Boolean(atQueryText && fileIndex?.truncated && fileIndex.cwd === cwd);
  useEffect(() => {
    if (!needsServerSearch || !cwd || !atQueryText) return;
    const fetchCwd = cwd;
    const query = atQueryText;
    const timer = setTimeout(() => {
      fetch(`/api/file-index?cwd=${encodeURIComponent(fetchCwd)}&q=${encodeURIComponent(query)}`)
        .then((res) => {
          if (!res.ok) throw new Error(`file search failed: ${res.status}`);
          return res.json() as Promise<{ matches?: FileIndexEntry[] }>;
        })
        .then((data) => setAtServerResult({ cwd: fetchCwd, query, matches: data.matches ?? [] }))
        .catch(() => {
          // Keep showing local matches; the next keystroke retries.
        });
    }, 150);
    return () => clearTimeout(timer);
  }, [needsServerSearch, atQueryText, cwd]);

  const serverResultInUse = needsServerSearch
    && atServerResult !== null
    && atServerResult.cwd === cwd
    && atServerResult.query === atQueryText;
  const atMatches: FileIndexEntry[] = serverResultInUse ? atServerResult.matches : atLocalMatches;

  // Open/reset the menu whenever the @token appears or changes (mirrors the
  // slash menu: Escape closes it, the next keystroke re-opens it).
  const atTokenKey = atQuery === null ? null : `${atQuery.start}:${atQuery.quoted ? 1 : 0}:${atQuery.query}`;
  useEffect(() => {
    if (atTokenKey === null) {
      setAtMenuOpen(false);
      setAtActiveIndex(0);
      return;
    }
    setAtMenuOpen(true);
    setAtActiveIndex(0);
  }, [atTokenKey]);

  // Fetch the file index when the menu opens. The server caches per cwd for
  // ~10s, so re-opening refreshes cheaply; while typing nothing refetches.
  const atTokenActive = atQuery !== null;
  useEffect(() => {
    if (!atTokenActive || !cwd) return;
    const meta = fileIndexMetaRef.current;
    if (meta && meta.cwd === cwd && Date.now() - meta.fetchedAt < 10_000) return;
    if (fileIndexFetchingRef.current === cwd) return;
    fileIndexFetchingRef.current = cwd;
    const fetchCwd = cwd;
    setFileIndexLoading(true);
    fetch(`/api/file-index?cwd=${encodeURIComponent(fetchCwd)}`)
      .then((res) => {
        if (!res.ok) throw new Error(`file index failed: ${res.status}`);
        return res.json() as Promise<{ files?: string[]; truncated?: boolean }>;
      })
      .then((data) => {
        setFileIndex({ cwd: fetchCwd, entries: buildEntriesFromFiles(data.files ?? []), truncated: !!data.truncated });
        fileIndexMetaRef.current = { cwd: fetchCwd, fetchedAt: Date.now() };
      })
      .catch(() => {
        // Leave any previous index in place; next open retries.
        fileIndexMetaRef.current = null;
      })
      .finally(() => {
        fileIndexFetchingRef.current = null;
        setFileIndexLoading(false);
      });
  }, [atTokenActive, cwd]);

  const applyAtCompletion = useCallback((entry: FileIndexEntry) => {
    if (!atQuery) return;
    const ta = textareaRef.current;
    const cursor = ta?.selectionStart ?? value.length;
    const before = value.slice(0, atQuery.start);
    let after = value.slice(cursor);
    // Completing inside a quoted token (@"my dir/… with the caret before the
    // closing quote): the replacement carries its own closing quote, so drop
    // the old one right after the caret (mirrors the TUI's applyCompletion).
    if (atQuery.quoted && after.startsWith('"')) {
      after = after.slice(1);
    }
    const insert = buildAtInsertText(entry.path, entry.isDir, atQuery.quoted);
    const newValue = before + insert.text + after;
    const newPos = before.length + insert.cursorOffset;
    setValue(newValue);
    // setValue alone does not fire onChange — re-derive the token here. Files
    // end with a space (token closes, menu hides); directories end with "/"
    // before the caret (token stays open for drill-down into the directory).
    setAtQuery(extractAtQuery(newValue.slice(0, newPos)));
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(newPos, newPos);
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
    });
  }, [atQuery, value]);

  useEffect(() => {
    if (atActiveIndex >= atMatches.length) {
      setAtActiveIndex(Math.max(0, atMatches.length - 1));
    }
  }, [atMatches.length, atActiveIndex]);

  useEffect(() => {
    atItemRefs.current.length = atMatches.length;
  }, [atMatches.length]);

  useEffect(() => {
    if (!atMenuOpen) return;
    atItemRefs.current[atActiveIndex]?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [atActiveIndex, atMenuOpen]);

  useEffect(() => {
    if (historyActiveIndex >= inputHistory.length) {
      setHistoryActiveIndex(Math.max(0, inputHistory.length - 1));
    }
  }, [inputHistory.length, historyActiveIndex]);

  useEffect(() => {
    historyItemRefs.current.length = inputHistory.length;
  }, [inputHistory.length]);

  useEffect(() => {
    if (!historyMenuOpen) return;
    historyItemRefs.current[historyActiveIndex]?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [historyActiveIndex, historyMenuOpen]);

  const applyHistoryInput = useCallback((text: string) => {
    setValue(text);
    setHistoryMenuOpen(false);
    setHistoryActiveIndex(0);
    setAtQuery(null);
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (!ta) return;
      ta.focus();
      ta.setSelectionRange(text.length, text.length);
      ta.style.height = "auto";
      ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
    });
  }, []);

  const applySlashCommand = useCallback((command: SlashCommandPaletteItem) => {
    const nextValue = `/${command.name} `;
    setValue(nextValue);
    setSlashMenuOpen(false);
    setSlashActiveIndex(0);
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (!ta) return;
      ta.focus();
      ta.setSelectionRange(nextValue.length, nextValue.length);
      ta.style.height = "auto";
      ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
    });
  }, []);

  /**
   * Busy-state delivery, resolved like DSH: plain Enter queues the draft
   * (follow-up), Cmd/Ctrl+Enter interjects it (steer). "/" drafts always
   * interject — pi executes extension commands immediately and cannot queue them.
   */
  const sendQueued = useCallback((accelerated: boolean) => {
    const msg = value.trim();
    if (!msg && !attachedImages.length) return;
    onAudioUnlock?.();
    const images = attachedImages.length ? attachedImages : undefined;
    if (msg.startsWith("/") && onPromptWithStreamingBehavior) {
      clearInput();
      onPromptWithStreamingBehavior(msg, "steer", images);
      return;
    }
    const steer = accelerated || !onFollowUp;
    if (steer && onSteer) {
      clearInput();
      onSteer(msg, images);
    } else if (onFollowUp) {
      clearInput();
      onFollowUp(msg, images);
    }
  }, [value, attachedImages, onPromptWithStreamingBehavior, onSteer, onFollowUp, clearInput, onAudioUnlock]);

  // DSH queue strip data: steering items first (pi drains them first), then follow-ups.
  const queueItems: QueueDockItem[] = React.useMemo(() => [
    ...(queuedMessages?.steering ?? []).map((text, i) => ({ key: `steering:${i}`, kind: "steering" as const, text })),
    ...(queuedMessages?.followUp ?? []).map((text, i) => ({ key: `followUp:${i}`, kind: "followUp" as const, text })),
  ], [queuedMessages]);

  // Empty-draft Cmd/Ctrl+Enter flushes the whole queue into the running turn.
  const canSteerQueue = isStreaming && (onSteer || onFollowUp)
    && value.trim() === "" && attachedImages.length === 0
    && queueItems.length > 0 && onSteerAllQueued !== undefined;

  const handleQueueRemove = useCallback((item: QueueDockItem) => {
    setQueueBusyKey(item.key);
    const finish = () => setQueueBusyKey((current) => current === item.key ? null : current);
    Promise.resolve(onQueueRemoveItem?.(item.kind, item.text)).finally(finish);
  }, [onQueueRemoveItem]);

  const handleQueueSteer = useCallback((item: QueueDockItem) => {
    setQueueBusyKey(item.key);
    const finish = () => setQueueBusyKey((current) => current === item.key ? null : current);
    Promise.resolve(onQueueSteerItem?.(item.kind, item.text)).finally(finish);
  }, [onQueueSteerItem]);

  const handleQueueSaveEdit = useCallback(() => {
    if (!queueEditing || queueEditingText.trim() === "") return;
    const item = queueEditing;
    const text = queueEditingText;
    setQueueBusyKey(item.key);
    const finish = () => {
      setQueueBusyKey((current) => current === item.key ? null : current);
      setQueueEditing(null);
      setQueueEditingText("");
    };
    Promise.resolve(onQueueEditItem?.(item.kind, item.text, text)).finally(finish);
  }, [queueEditing, queueEditingText, onQueueEditItem]);

  const handleQueueStartEdit = useCallback((item: QueueDockItem) => {
    setQueueEditing(item);
    setQueueEditingText(item.text);
  }, []);

  const handleQueueCancelEdit = useCallback(() => {
    setQueueEditing(null);
    setQueueEditingText("");
  }, []);

  // Auto-collapse once the queue empties; drop an edit whose row vanished.
  useEffect(() => {
    if (queueItems.length === 0 && !queueDockCollapsed) setQueueDockCollapsed(true);
    if (queueEditing && !queueItems.some((item) => item.key === queueEditing.key)) {
      setQueueEditing(null);
      setQueueEditingText("");
    }
  }, [queueItems, queueDockCollapsed, queueEditing]);

  const getNextSlashIndex = useCallback((direction: "up" | "down" | "left" | "right") => {
    const lastIndex = displayedSlashCommands.length - 1;
    if (lastIndex < 0) return 0;

    if (direction === "left") return Math.max(0, slashActiveIndex - 1);
    if (direction === "right") return Math.min(lastIndex, slashActiveIndex + 1);

    const currentNode = slashItemRefs.current[slashActiveIndex];
    if (!currentNode) {
      return direction === "down"
        ? Math.min(lastIndex, slashActiveIndex + 1)
        : Math.max(0, slashActiveIndex - 1);
    }

    const currentRect = currentNode.getBoundingClientRect();
    const currentX = currentRect.left + currentRect.width / 2;
    const currentY = currentRect.top + currentRect.height / 2;
    let bestIndex = -1;
    let bestScore = Number.POSITIVE_INFINITY;

    for (let index = 0; index <= lastIndex; index += 1) {
      if (index === slashActiveIndex) continue;
      const node = slashItemRefs.current[index];
      if (!node) continue;
      const rect = node.getBoundingClientRect();
      const candidateY = rect.top + rect.height / 2;
      const verticalDelta = candidateY - currentY;
      if (direction === "down" ? verticalDelta <= 4 : verticalDelta >= -4) continue;

      const candidateX = rect.left + rect.width / 2;
      const score = Math.abs(verticalDelta) * 1000 + Math.abs(candidateX - currentX);
      if (score < bestScore) {
        bestIndex = index;
        bestScore = score;
      }
    }

    if (bestIndex >= 0) return bestIndex;
    return direction === "down"
      ? Math.min(lastIndex, slashActiveIndex + 1)
      : Math.max(0, slashActiveIndex - 1);
  }, [displayedSlashCommands.length, slashActiveIndex]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      const nativeEvent = e.nativeEvent;
      const sendShortcut = e.key === "Enter" && !e.shiftKey && (!isMobile || e.ctrlKey || e.metaKey);
      const recentlyComposed = Date.now() - lastCompositionEndAtRef.current < COMPOSITION_END_ENTER_GRACE_MS;
      const isComposing =
        isComposingRef.current ||
        nativeEvent.isComposing ||
        nativeEvent.keyCode === 229;

      if (sendShortcut && (isComposing || recentlyComposed)) {
        // Plain Enter confirms IME; Cmd/Ctrl+Enter is 插话 and must not be eaten
        // by the composition-end grace after Chinese input.
        const accelerated = e.ctrlKey || e.metaKey;
        if (isComposing || !accelerated) {
          if (recentlyComposed) e.preventDefault();
          return;
        }
      }

      if (historyMenuOpen && !isComposing) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setHistoryActiveIndex((i) => Math.min(Math.max(0, inputHistory.length - 1), i + 1));
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setHistoryActiveIndex((i) => Math.max(0, i - 1));
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setHistoryMenuOpen(false);
          return;
        }
        if ((e.key === "Tab" || sendShortcut) && inputHistory[historyActiveIndex]) {
          e.preventDefault();
          applyHistoryInput(inputHistory[historyActiveIndex]);
          return;
        }
      }

      if (slashMenuOpen && slashQuery !== null) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setSlashActiveIndex(getNextSlashIndex("down"));
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setSlashActiveIndex(getNextSlashIndex("up"));
          return;
        }
        if (e.key === "ArrowRight") {
          e.preventDefault();
          setSlashActiveIndex(getNextSlashIndex("right"));
          return;
        }
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          setSlashActiveIndex(getNextSlashIndex("left"));
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setSlashMenuOpen(false);
          return;
        }
        if ((e.key === "Tab" || sendShortcut) && displayedSlashCommands[slashActiveIndex]) {
          e.preventDefault();
          applySlashCommand(displayedSlashCommands[slashActiveIndex]);
          return;
        }
      }

      // @ file menu — skip while composing so IME candidate navigation
      // (arrows/Enter/Tab) is never intercepted.
      if (atMenuOpen && atQuery !== null && !isComposing) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setAtActiveIndex((i) => Math.min(Math.max(0, atMatches.length - 1), i + 1));
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setAtActiveIndex((i) => Math.max(0, i - 1));
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setAtMenuOpen(false);
          return;
        }
        if ((e.key === "Tab" || sendShortcut) && atMatches[atActiveIndex]) {
          e.preventDefault();
          applyAtCompletion(atMatches[atActiveIndex]);
          return;
        }
      }

      if (e.key === "ArrowUp" && !isComposing && !isStreaming && inputHistory.length > 0 && value.trim().length === 0) {
        e.preventDefault();
        setSlashMenuOpen(false);
        setAtMenuOpen(false);
        setHistoryActiveIndex(inputHistory.length - 1);
        setHistoryMenuOpen(true);
        return;
      }

      // Esc stops the agent when no slash/@/history menu or IME composition is active.
      if (e.key === "Escape" && !isComposing && isStreaming && onAbort) {
        e.preventDefault();
        onAbort();
        return;
      }

      if (sendShortcut) {
        e.preventDefault();
        if (isStreaming && (onSteer || onFollowUp)) {
          // DSH busy gestures: Cmd/Ctrl+Enter interjects (steer), plain Enter
          // queues (follow-up). An empty draft + Cmd/Ctrl+Enter steers every
          // queued message into the running turn; empty draft + Enter is a no-op.
          const accelerated = e.ctrlKey || e.metaKey;
          if (accelerated && canSteerQueue) {
            onSteerAllQueued?.();
            return;
          }
          sendQueued(accelerated);
        } else {
          handleSend();
        }
      }
    },
    [isMobile, isStreaming, onSteer, onFollowUp, onAbort, slashMenuOpen, slashQuery, displayedSlashCommands, slashActiveIndex, applySlashCommand, sendQueued, handleSend, getNextSlashIndex, atMenuOpen, atQuery, atMatches, atActiveIndex, applyAtCompletion, historyMenuOpen, inputHistory, historyActiveIndex, applyHistoryInput, value, canSteerQueue, onSteerAllQueued]
  );

  const handleInput = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
  }, []);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = Array.from(e.clipboardData?.items ?? []);
    const imageItems = items.filter((item) => item.type.startsWith("image/"));
    if (!imageItems.length) return;
    e.preventDefault();
    const files = imageItems.map((item) => item.getAsFile()).filter((f): f is File => f !== null);
    processImageFiles(files);
  }, [processImageFiles]);

  useEffect(() => {
    if (slashQuery === null) {
      setSlashMenuOpen(false);
      setSlashActiveIndex(0);
      slashCommandsRequestedRef.current = false;
      return;
    }
    setSlashMenuOpen(true);
    setSlashActiveIndex(0);
    if (!slashCommandsRequestedRef.current && onLoadSlashCommands) {
      slashCommandsRequestedRef.current = true;
      Promise.resolve(onLoadSlashCommands()).catch(() => {
        slashCommandsRequestedRef.current = false;
      });
    }
  }, [slashQuery, onLoadSlashCommands]);

  // Lazy-load skill dormancy (disable-model-invocation) each time the slash
  // palette opens, so toggles made in the skills panel are reflected on the
  // next open. Failures degrade silently to the unannotated palette.
  useEffect(() => {
    if (!slashMenuOpen || !cwd) return;
    const requestCwd = cwd;
    let cancelled = false;
    setSkillDormancyState({ cwd: requestCwd, values: {} });
    fetch(`/api/skills?cwd=${encodeURIComponent(requestCwd)}`)
      .then((res) => {
        if (!res.ok) throw new Error(`skills fetch failed: ${res.status}`);
        return res.json() as Promise<Partial<SkillsResponse>>;
      })
      .then((data) => {
        if (cancelled) return;
        const dormancy: Record<string, boolean> = {};
        for (const skill of data.skills ?? []) dormancy[skill.name] = skill.disableModelInvocation;
        setSkillDormancyState({ cwd: requestCwd, values: dormancy });
      })
      .catch(() => {
        if (!cancelled) setSkillDormancyState({ cwd: requestCwd, values: {} });
      });
    return () => {
      cancelled = true;
    };
  }, [slashMenuOpen, cwd]);

  useEffect(() => {
    if (slashActiveIndex >= displayedSlashCommands.length) {
      setSlashActiveIndex(Math.max(0, displayedSlashCommands.length - 1));
    }
  }, [displayedSlashCommands.length, slashActiveIndex]);

  useEffect(() => {
    slashItemRefs.current.length = displayedSlashCommands.length;
  }, [displayedSlashCommands.length]);

  useEffect(() => {
    if (!slashMenuOpen) return;
    slashItemRefs.current[slashActiveIndex]?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [slashActiveIndex, slashMenuOpen]);

  useLayoutEffect(() => {
    if (!slashMenuOpen || slashQuery === null) {
      setSlashMenuMaxHeight(null);
      return;
    }

    const menu = slashMenuRef.current;
    if (!menu) return;

    let frameId: number | null = null;
    const update = () => {
      frameId = null;
      const nextHeight = getUpwardMenuMaxHeight(
        menu.getBoundingClientRect().bottom,
        getVisibleTopBoundary(menu),
      );
      setSlashMenuMaxHeight((current) => current === nextHeight ? current : nextHeight);
    };
    const scheduleUpdate = () => {
      if (frameId !== null) cancelAnimationFrame(frameId);
      frameId = requestAnimationFrame(update);
    };

    update();
    const anchorObserver = typeof ResizeObserver === "undefined" || !menu.parentElement
      ? null
      : new ResizeObserver(scheduleUpdate);
    if (menu.parentElement) anchorObserver?.observe(menu.parentElement);
    const viewport = window.visualViewport;
    viewport?.addEventListener("resize", scheduleUpdate);
    viewport?.addEventListener("scroll", scheduleUpdate);
    window.addEventListener("resize", scheduleUpdate);
    window.addEventListener("scroll", scheduleUpdate, true);

    return () => {
      anchorObserver?.disconnect();
      viewport?.removeEventListener("resize", scheduleUpdate);
      viewport?.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
      window.removeEventListener("scroll", scheduleUpdate, true);
      if (frameId !== null) cancelAnimationFrame(frameId);
    };
  }, [slashMenuOpen, slashQuery]);

  // Build model options: prefer modelList (has provider info), fallback to modelNames
  const modelOptions: ModelOption[] = (() => {
    if (modelList && modelList.length > 0) {
      return modelList.map((m) => ({ provider: m.provider, modelId: m.id, name: m.name })).sort(compareModelOptions);
    }
    return Object.entries(modelNames ?? {}).map(([modelId, name]) => ({
      provider: model?.provider ?? "unknown",
      modelId,
      name,
    })).sort(compareModelOptions);
  })();
  const filteredModelOptions = filterModelOptions(modelOptions, modelFilter);
  const showModelFilter = modelOptions.length > MODEL_FILTER_THRESHOLD;

  // Group options by provider, preserving insertion order
  const modelsByProvider: { provider: string; options: ModelOption[] }[] = [];
  for (const opt of filteredModelOptions) {
    const group = modelsByProvider.find((g) => g.provider === opt.provider);
    if (group) group.options.push(opt);
    else modelsByProvider.push({ provider: opt.provider, options: [opt] });
  }

  const displayModelName = model
    ? (modelOptions.find((o) => o.modelId === model.modelId && o.provider === model.provider)?.name ?? model.modelId)
    : null;
  const currentName = displayModelName;

  const compactSavedTokens = compactResult
    ? Math.max(0, compactResult.tokensBefore - compactResult.estimatedTokensAfter)
    : 0;
  const compactResultText = compactResult
    ? t("chat.tokensFreed", {
        before: formatTokenCount(compactResult.tokensBefore),
        after: formatTokenCount(compactResult.estimatedTokensAfter),
        saved: formatTokenCount(compactSavedTokens),
      })
    : null;
  const visibleThinkingLevels = THINKING_LEVELS.filter((lvl) => {
    if (!availableThinkingLevels) return true;
    if (lvl === "auto") return true;
    return availableThinkingLevels.includes(lvl);
  });

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
        modelDropdownPanelRef.current && !modelDropdownPanelRef.current.contains(e.target as Node)
      ) {
        setModelDropdownOpen(false);
        setModelFilter("");
      }
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) {
        setMoreMenuOpen(false);
      }
      if (thinkingMenuRef.current && !thinkingMenuRef.current.contains(e.target as Node)) {
        setThinkingMenuOpen(false);
      }
      if (historyMenuRef.current && !historyMenuRef.current.contains(e.target as Node) && !textareaRef.current?.contains(e.target as Node)) {
        setHistoryMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);




  return (
    <div
      style={{
        flexShrink: 0,
        background: "transparent",
        padding: "0 16px 8px",
      }}
    >
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        style={{ display: "none" }}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          processImageFiles(files);
          e.target.value = "";
        }}
      />
      <div style={{ maxWidth: isMobile ? undefined : 780, margin: "0 auto" }}>
        <ModelErrorBanner error={modelError} />
        <ModelScopeWarningBanner warnings={modelScopeWarnings} />
        {/* Retry banner */}
        {retryInfo && (
          <div style={{
            marginBottom: 8, padding: "5px 10px",
            background: "rgba(234,179,8,0.08)", border: "1px solid rgba(234,179,8,0.25)",
            borderRadius: 6, fontSize: "var(--text-meta)", color: "rgba(180,130,0,0.9)",
            display: "flex", alignItems: "center", gap: 6,
          }}>
            <RotateCw size={11} strokeWidth={2} style={{ flexShrink: 0 }} aria-hidden="true" />
             {t("chat.retrying", { attempt: retryInfo.attempt, max: retryInfo.maxAttempts })}{retryInfo.errorMessage && <span style={{ opacity: 0.7, marginLeft: 4 }}>— {retryInfo.errorMessage}</span>}
          </div>
        )}
        {isCompacting && (
          <div className="compaction-feedback" role="status" aria-live="polite">
            <LoaderCircle size={11} strokeWidth={2} className="compaction-feedback-spinner" aria-hidden="true" />
            <span>{t("chat.compactingContext")}</span>
            {onAbortCompaction && (
              <button type="button" className="compaction-feedback-action" onClick={onAbortCompaction}>
                {t("chat.stop")}
              </button>
            )}
          </div>
        )}
        {!isCompacting && compactResultText && (
          <div className="compaction-feedback is-success" role="status" aria-live="polite">
            <Check size={11} strokeWidth={2} aria-hidden="true" />
            <span>{t("chat.contextCompacted")} {compactResultText}</span>
          </div>
        )}
        {!isCompacting && compactError && (
          <div className="compaction-feedback is-error" role="alert">
            <span>{compactError}</span>
            {onClearCompactFeedback && (
              <button
                type="button"
                className="compaction-feedback-action"
                onClick={onClearCompactFeedback}
                aria-label={t("chat.dismissCompaction")}
              >
                <X size={11} strokeWidth={2} aria-hidden="true" />
              </button>
            )}
          </div>
        )}
        {/* Image previews */}
        {attachedImages.length > 0 && (
          <div style={{ display: "flex", gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
            {attachedImages.map((img, i) => (
              <div key={i} style={{ position: "relative", flexShrink: 0 }}>
                <img
                  src={img.previewUrl}
                  alt=""
                  style={{ width: 56, height: 56, objectFit: "cover", borderRadius: 6, border: "1px solid var(--border)", display: "block" }}
                />
                <button
                  onClick={() => removeImage(i)}
                  style={{
                    position: "absolute", top: -4, right: -4,
                    width: 16, height: 16, borderRadius: "50%",
                    background: "var(--bg-panel)", border: "1px solid var(--border)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    cursor: "pointer", padding: 0, color: "var(--text-muted)",
                  }}
                >
                  <X size={8} strokeWidth={1.5} aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* DSH-style queue strip: queued messages with per-item edit/remove/steer-now */}
        {(onQueueRemoveItem || onQueueEditItem || onQueueSteerItem) && (
          <QueueDock
            items={queueItems}
            running={isStreaming}
            editing={queueEditing}
            editingText={queueEditingText}
            busyKey={queueBusyKey}
            collapsed={queueDockCollapsed}
            onToggle={() => setQueueDockCollapsed((v) => !v)}
            onStartEdit={handleQueueStartEdit}
            onEditTextChange={setQueueEditingText}
            onSaveEdit={handleQueueSaveEdit}
            onCancelEdit={handleQueueCancelEdit}
            onRemove={handleQueueRemove}
            onSteer={handleQueueSteer}
            t={t}
          />
        )}

        {/* Main input */}
        <div style={{ position: "relative", minWidth: 0 }}>
          {historyMenuOpen && inputHistory.length > 0 && (
            <div
              ref={historyMenuRef}
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                bottom: "calc(100% + 8px)",
                zIndex: 120,
                background: "var(--bg)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                boxShadow: "0 -6px 20px rgba(0,0,0,0.12)",
                overflow: "hidden",
                maxHeight: "min(44vh, 360px)",
              }}
            >
              <div
                title="Input history"
                style={{
                  height: 30,
                  padding: "0 10px",
                  borderBottom: "1px solid var(--border)",
                  display: "flex",
                  alignItems: "center",
                  color: "var(--text-dim)",
                }}
              >
                <History size={14} strokeWidth={1.8} aria-hidden="true" />
              </div>
              <div style={{ maxHeight: "calc(min(44vh, 360px) - 31px)", overflowY: "auto", padding: 4 }}>
                {inputHistory.map((item, index) => {
                  const active = index === historyActiveIndex;
                  return (
                    <button
                      key={`${index}:${item}`}
                      ref={(node) => {
                        historyItemRefs.current[index] = node;
                      }}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        applyHistoryInput(item);
                      }}
                      onMouseEnter={() => setHistoryActiveIndex(index)}
                      style={{
                        width: "100%",
                        display: "flex",
                        alignItems: "flex-start",
                        gap: 8,
                        padding: "7px 8px",
                        border: "none",
                        borderRadius: 6,
                        background: active ? "var(--bg-selected)" : "none",
                        color: "var(--text)",
                        cursor: "pointer",
                        textAlign: "left",
                        fontSize: "var(--text-ui)",
                        lineHeight: "var(--leading-ui)",
                      }}
                    >
                      <span style={{ flexShrink: 0, fontFamily: "var(--font-mono)", fontSize: "var(--text-meta)", color: "var(--text-dim)", paddingTop: 1 }}>
                        {index + 1}
                      </span>
                      <span style={{ minWidth: 0, display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: 2, overflow: "hidden", overflowWrap: "anywhere" }}>
                        {item}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {slashMenuOpen && slashQuery !== null && (
            <div
              ref={slashMenuRef}
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                bottom: "calc(100% + 8px)",
                zIndex: 120,
                background: "var(--bg)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                boxShadow: "0 -6px 20px rgba(0,0,0,0.12)",
                overflow: "hidden",
                boxSizing: "border-box",
                display: "flex",
                flexDirection: "column",
                maxHeight: slashMenuMaxHeight === null
                  ? "min(72.8vh, 598px)"
                  : `min(72.8vh, 598px, ${slashMenuMaxHeight}px)`,
              }}
            >
              <div
                style={{
                  padding: "8px 10px",
                  borderBottom: "1px solid var(--border)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                  fontSize: "var(--text-meta)",
                  color: "var(--text-dim)",
                  flexShrink: 0,
                }}
              >
                 <span>{slashCommandsLoading ? t("chat.loadingCommands") : t("chat.slashCommands", { label: slashCommandCountLabel })}</span>
                 <span style={{ fontFamily: "var(--font-mono)" }}>{t("chat.tabEnter")}</span>
              </div>
              <div style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto", padding: 10 }}>
                {!slashCommandsLoading && filteredSlashCommands.length === 0 ? (
                  <div style={{ padding: "2px 2px 4px", fontSize: "var(--text-meta)", color: "var(--text-dim)" }}>
                     {t("chat.noCommands")}
                  </div>
                ) : (
                  groupedSlashCommands.map((group) => (
                    <section key={group.source} style={{ marginBottom: 12 }}>
                      <div
                        style={{
                          position: "sticky",
                          top: -10,
                          zIndex: 1,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 8,
                          padding: "4px 0 6px",
                          background: "var(--bg)",
                          color: "var(--text-dim)",
                          fontSize: "var(--text-meta)",
                          fontWeight: 600,
                          textTransform: "uppercase",
                        }}
                      >
                           <span>{t(SLASH_SOURCE_GROUP_LABEL_KEYS[group.source])}</span>
                        <span style={{ fontFamily: "var(--font-mono)", fontWeight: 500 }}>{group.items.length}</span>
                      </div>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                          gap: 8,
                        }}
                      >
                        {group.items.map(({ command, index }) => {
                          const active = index === slashActiveIndex;
                          const dormant = isDormantSkillCommand(command, skillDormancy);
                          return (
                            <button
                              key={`${command.source}:${command.name}`}
                              ref={(node) => {
                                slashItemRefs.current[index] = node;
                              }}
                              type="button"
                              onMouseDown={(e) => {
                                e.preventDefault();
                                applySlashCommand(command);
                              }}
                              onMouseEnter={() => setSlashActiveIndex(index)}
                              style={{
                                width: "100%",
                                minWidth: 0,
                                minHeight: 58,
                                display: "flex",
                                flexDirection: "column",
                                gap: 4,
                                justifyContent: "center",
                                padding: "9px 10px",
                                border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
                                borderRadius: 7,
                                background: active ? "var(--bg-selected)" : "var(--bg-panel)",
                                color: "var(--text)",
                                cursor: "pointer",
                                textAlign: "left",
                                boxShadow: active ? "0 0 0 1px color-mix(in srgb, var(--accent) 28%, transparent)" : "none",
                              }}
                            >
                              <span style={{
                                fontSize: "var(--text-ui)",
                                fontFamily: "var(--font-mono)",
                                overflowWrap: "anywhere",
                                wordBreak: "break-word",
                                color: dormant ? "var(--text-dim)" : undefined,
                              }}>
                                /{command.name}
                                {dormant && (
                                  <span style={{
                                    marginLeft: 6,
                                    padding: "0 4px",
                                    border: "1px solid var(--border)",
                                    borderRadius: 3,
                                    fontSize: "var(--text-meta)",
                                    color: "var(--text-dim)",
                                    whiteSpace: "nowrap",
                                  }}>
                                    {t("chat.dormant")}
                                  </span>
                                )}
                              </span>
                               {command.description && (
                                <span style={{
                                  display: "-webkit-box",
                                  WebkitBoxOrient: "vertical",
                                  WebkitLineClamp: 2,
                                  overflow: "hidden",
                                  fontSize: "var(--text-meta)",
                                  lineHeight: "var(--leading-ui)",
                                  color: "var(--text-dim)",
                                }}>
                                   {getSlashDescription(command, t)}
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </section>
                  ))
                )}
              </div>
            </div>
          )}
          {atMenuOpen && atQuery !== null && (() => {
            const indexLoading = fileIndexLoading && (!fileIndex || fileIndex.cwd !== cwd);
             const matchCountLabel = atMatches.length === 1 ? t("chat.match") : t("chat.matches", { count: atMatches.length });
            // With a truncated index, local results are provisional — the
            // debounced server search over the full listing replaces them.
            const truncatedHint = fileIndex?.truncated && !serverResultInUse
               ? (atQuery.query ? t("chat.searchingAll") : t("chat.indexTruncated"))
              : "";
            return (
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  bottom: "calc(100% + 8px)",
                  zIndex: 120,
                  background: "var(--bg)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  boxShadow: "0 -6px 20px rgba(0,0,0,0.12)",
                  overflow: "hidden",
                  maxHeight: "min(48vh, 400px)",
                }}
              >
                <div
                  style={{
                    padding: "8px 10px",
                    borderBottom: "1px solid var(--border)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                    fontSize: "var(--text-meta)",
                    color: "var(--text-dim)",
                  }}
                >
                  <span>
                    {indexLoading
                       ? t("chat.loadingFiles")
                       : t("chat.files", { label: matchCountLabel, hint: truncatedHint })}
                  </span>
                   <span style={{ fontFamily: "var(--font-mono)" }}>{t("chat.tabEnter")}</span>
                </div>
                <div style={{ maxHeight: "calc(min(48vh, 400px) - 34px)", overflowY: "auto", padding: 4 }}>
                  {!indexLoading && atMatches.length === 0 ? (
                    <div style={{ padding: "6px 8px", fontSize: "var(--text-meta)", color: "var(--text-dim)" }}>
                       {needsServerSearch && !serverResultInUse ? t("chat.searching") : t("chat.noMatchingFiles")}
                    </div>
                  ) : (
                    atMatches.map((entry, index) => {
                      const active = index === atActiveIndex;
                      const name = entry.path.split("/").pop() ?? entry.path;
                      const dirPrefix = entry.path.slice(0, entry.path.length - name.length);
                      return (
                        <button
                          key={`${entry.isDir ? "d" : "f"}:${entry.path}`}
                          ref={(node) => {
                            atItemRefs.current[index] = node;
                          }}
                          type="button"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            applyAtCompletion(entry);
                          }}
                          onMouseEnter={() => setAtActiveIndex(index)}
                          style={{
                            width: "100%",
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            padding: "6px 8px",
                            border: "none",
                            borderRadius: 6,
                            background: active ? "var(--bg-selected)" : "none",
                            color: "var(--text)",
                            cursor: "pointer",
                            textAlign: "left",
                            fontSize: "var(--text-ui)",
                            fontFamily: "var(--font-mono)",
                          }}
                        >
                          <span style={{ flexShrink: 0, display: "flex", alignItems: "center" }}>
                            {entry.isDir ? <FolderIcon size={14} /> : getFileIcon(name, 14)}
                          </span>
                          <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {dirPrefix && <span style={{ color: "var(--text-dim)" }}>{dirPrefix}</span>}
                            {name}
                            {entry.isDir && <span style={{ color: "var(--text-dim)" }}>/</span>}
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })()}
          <div
            className={`composer-shell${isStreaming ? " is-streaming" : ""}`}
            style={{
              minWidth: 0,
              display: "flex",
              flexDirection: "column",
              gap: isMobile ? 8 : 10,
              background: "var(--bg)",
              border: `1px solid ${bashMode ? "var(--tool-bg)" : "color-mix(in srgb, var(--border) 80%, transparent)"}`,
              borderRadius: isMobile ? 20 : 12,
              padding: isMobile ? "10px 12px 8px" : "12px 14px 9px",
              boxShadow: isMobile
                ? "0 2px 12px rgba(0,0,0,0.06)"
                : "0 2px 8px rgba(0,0,0,0.05)",
              transition: "border-color 0.15s, background 0.15s",
            } as React.CSSProperties}
          >
          {workspaceHint ? (
            <div
              className="composer-workspace-hint"
              title={cwd ?? workspaceHint}
              aria-label={t("chat.workingIn", { cwd: workspaceHint })}
            >
              <Folder size={12} strokeWidth={1.8} aria-hidden="true" />
              <span className="composer-workspace-hint-label">{workspaceHint}</span>
            </div>
          ) : null}
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => {
              valueRef.current = e.target.value;
              setValue(e.target.value);
              setHistoryMenuOpen(false);
              updateAtQuery(e.target.value, e.target.selectionStart);
            }}
            onSelect={(e) => {
              const el = e.currentTarget;
              updateAtQuery(el.value, el.selectionStart);
            }}
            onKeyDown={handleKeyDown}
            onCompositionStart={() => {
              isComposingRef.current = true;
            }}
            onCompositionEnd={(e) => {
              isComposingRef.current = false;
              lastCompositionEndAtRef.current = Date.now();
              const el = e.currentTarget;
              updateAtQuery(el.value, el.selectionStart);
            }}
            onInput={handleInput}
            onPaste={handlePaste}
            aria-label={t("chat.composerLabel")}
            placeholder={
              isStreaming && (onSteer || onFollowUp)
                ? ((value.trim() || attachedImages.length)
                  ? t(isMobile ? "chat.runningDraftPlaceholderMobile" : "chat.runningDraftPlaceholder")
                  : queueItems.length > 0
                    ? t("chat.interjectAllPlaceholder")
                    : t(isMobile ? "chat.agentPlaceholderMobile" : "chat.agentPlaceholder"))
                : isStreaming ? t(isMobile ? "chat.agentPlaceholderMobile" : "chat.agentPlaceholder")
                : t("chat.messagePlaceholder")
            }
            rows={1}
            style={{
              flex: 1,
              minWidth: 0,
              width: "100%",
              background: "none",
              border: "none",
              outline: "none",
              resize: "none",
              color: "var(--text)",
              fontSize: "var(--text-chat)",
              lineHeight: "var(--leading-prose)",
              fontFamily: "inherit",
              minHeight: isMobile ? 24 : 28,
              maxHeight: 200,
              overflow: "auto",
            }}
          />


        {/* Bash mode status label */}
        {bashMode && (
          <div className="text-xs px-2 py-1" style={{ color: bashExcluded ? "var(--text-muted)" : "var(--accent)", marginTop: 4 }}>
             {t("chat.shell")} · {bashExcluded ? t("chat.outputLocal") : t("chat.outputModel")}
          </div>
        )}

        {/* Toolbar: + | model | chips | send */}
        <div style={{
          display: isMobile ? "grid" : "flex",
          gridTemplateColumns: isMobile ? "auto minmax(0, 1fr) auto" : undefined,
          alignItems: "center",
          gap: 4,
        }}>
          <button
            type="button"
            className="composer-icon-hit"
            onClick={() => fileInputRef.current?.click()}
            title={t("chat.attachImage")}
            aria-label={t("chat.attachImage")}
            style={{
              flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
              width: 28, height: 28, padding: 0,
              background: "none", border: "none",
              borderRadius: 999,
              color: attachedImages.length ? "var(--text)" : "var(--text-dim)",
              cursor: "pointer",
              transition: "background 0.12s, color 0.12s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "var(--bg-hover)";
              e.currentTarget.style.color = "var(--text)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "none";
              e.currentTarget.style.color = attachedImages.length ? "var(--text)" : "var(--text-dim)";
            }}
          >
            <Plus size={16} strokeWidth={1.8} aria-hidden="true" />
          </button>

          {/* Middle cell: access preset + model share one grid cell on mobile so
              the right group stays in column three instead of wrapping to row two. */}
          <div className="composer-middle" style={{ display: "flex", alignItems: "center", gap: 4, minWidth: 0, flex: "1 1 auto" }}>

          {onToolPresetChange && (
            <div
              ref={moreMenuRef}
              className="composer-access"
              style={{ position: "relative", flex: isMobile && isStreaming ? "0 1 auto" : "0 0 auto", minWidth: 0 }}
            >
              <button
                type="button"
                className={`composer-chip${(toolPreset ?? "default") === "full" ? " is-full-access" : ""}`}
                onClick={() => {
                  setModelDropdownOpen(false);
                  setThinkingMenuOpen(false);
                  setMoreMenuOpen((open) => !open);
                }}
                title={t("chat.changeToolPreset")}
                aria-label={t("chat.changeToolPreset")}
                aria-expanded={moreMenuOpen}
                style={{
                  minWidth: 0,
                  width: "100%",
                  maxWidth: "100%",
                  boxSizing: "border-box",
                  overflow: "hidden",
                }}
              >
                <Shield size={13} strokeWidth={2} aria-hidden="true" />
                <span className="composer-access-label" style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {t(TOOL_PRESET_LABEL_KEYS[(Object.entries(TOOL_PRESET_MAP).find(([, v]) => v === (toolPreset ?? "default"))?.[0] ?? "default") as typeof TOOL_PRESETS[number]])}
                </span>
                <ChevronDown className="composer-access-chevron" size={12} strokeWidth={2} aria-hidden="true" style={{ opacity: 0.7 }} />
              </button>
              {moreMenuOpen && (
                <div className="composer-menu" style={{ left: 0 }}>
                  {TOOL_PRESETS.map((lvl) => {
                    const preset = TOOL_PRESET_MAP[lvl];
                    const isActive = (toolPreset ?? "default") === preset;
                    return (
                      <button
                        key={lvl}
                        type="button"
                        onClick={() => {
                          setMoreMenuOpen(false);
                          if (!isActive) onToolPresetChange(preset);
                        }}
                        style={{
                          display: "flex", alignItems: "center", gap: 8,
                          width: "100%", padding: "7px 12px",
                          background: isActive ? "var(--bg-selected)" : "none",
                          border: "none",
                          color: isActive ? "var(--text)" : "var(--text-muted)",
                          cursor: "pointer", fontSize: "var(--text-ui)", textAlign: "left",
                          fontWeight: isActive ? 600 : 400,
                        }}
                      >
                        {isActive
                          ? <Check size={10} strokeWidth={2} aria-hidden="true" style={{ color: "var(--accent)", flexShrink: 0 }} />
                          : <span style={{ width: 10, flexShrink: 0 }} />}
                        <span>{t(TOOL_PRESET_LABEL_KEYS[lvl])}</span>
                      </button>
                    );
                  })}
                  {onCompact && (
                    <>
                      <div style={{ height: 1, background: "var(--border)" }} />
                      <button
                        type="button"
                        onClick={() => {
                          setMoreMenuOpen(false);
                          if (isCompacting) onAbortCompaction?.();
                          else onCompact();
                        }}
                        style={{
                          display: "flex", alignItems: "center", gap: 8,
                          width: "100%", padding: "7px 12px",
                          background: "none",
                          border: "none",
                          color: isCompacting ? "#ef4444" : "var(--text-muted)",
                          cursor: "pointer", fontSize: "var(--text-ui)", textAlign: "left",
                        }}
                      >
                        {isCompacting ? <Square size={10} fill="currentColor" aria-hidden="true" /> : <Minimize2 size={12} strokeWidth={2} aria-hidden="true" />}
                        <span>{isCompacting ? t("chat.stopCompaction") : t("chat.compactContext")}</span>
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          )}


          {/* spacer */}
          {!isMobile && <div style={{ flex: 1 }} />}

          {/* Model selector */}
          <div className="composer-model-selector" style={{ flex: isMobile ? "1 1 auto" : "0 0 auto", minWidth: 0, display: isMobile && isStreaming ? "none" : "flex", alignItems: "center", gap: 2 }}>
            {/* Model selector is disabled during a run; mobile hides it then to preserve toolbar space. */}
            {(modelOptions.length > 0 || currentName || modelError) && onModelChange && (
                <div ref={dropdownRef} style={{ position: "relative", flex: isMobile ? "1 1 auto" : undefined, minWidth: 0 }}>
                  <button
                    type="button"
                    className="composer-chip"
                    onClick={(e) => {
                      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                      setModelDropdownRect({ top: rect.top, left: rect.left, width: rect.width });
                      setModelDropdownOpen((open) => {
                        if (open) setModelFilter("");
                        return !open;
                      });
                    }}
                    disabled={isStreaming || modelSwitching}
                    aria-busy={modelSwitching || undefined}
                    aria-expanded={modelDropdownOpen}
                    style={{ maxWidth: isMobile ? "100%" : 240, width: isMobile ? "100%" : undefined, overflow: "hidden" }}
                    title={modelSwitching ? t("chat.switchingModel") : modelOptions.length > 0 ? t("chat.changeModel") : t("chat.noAvailableModels")}
                  >
                    {modelSwitching ? (
                      <LoaderCircle size={11} strokeWidth={2.4} style={{ animation: "spin 0.8s linear infinite", flexShrink: 0 }} aria-hidden="true" />
                    ) : (
                      <Cpu size={11} strokeWidth={2} aria-hidden="true" />
                    )}
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>
                      {currentName ?? (modelOptions.length > 0 ? t("chat.selectModel") : t("chat.noModels"))}
                    </span>
                    <ChevronDown size={12} strokeWidth={2} aria-hidden="true" style={{ flexShrink: 0, opacity: 0.7 }} />
                  </button>
                  {modelDropdownOpen && modelDropdownRect && (() => {
                    const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
                    const bottom = viewportHeight - modelDropdownRect.top + 6;
                    const maxH = Math.max(120, Math.min(modelDropdownRect.top - 8, viewportHeight * 0.6));
                    // On mobile, pin to a small left margin and cap width to the
                    // viewport so long model names never push the panel off-screen.
                    const panelPos: React.CSSProperties = isMobile
                      ? { left: 8, right: 8, maxWidth: "calc(100vw - 16px)" }
                      : { left: modelDropdownRect.left, width: "max-content", minWidth: modelDropdownRect.width };
                    return (
                      <div ref={modelDropdownPanelRef} style={{
                      position: "fixed",
                      bottom,
                      ...panelPos,
                      zIndex: 500, background: "var(--bg)", border: "1px solid var(--border)",
                      borderRadius: 8, boxShadow: "0 4px 8px rgba(0,0,0,0.12)",
                      overflow: "hidden", maxHeight: maxH, display: "flex", flexDirection: "column",
                      }}>
                      {showModelFilter && (
                        <div style={{ padding: "6px 8px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
                          <input
                            value={modelFilter}
                            onChange={(e) => setModelFilter(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Escape") {
                                setModelFilter("");
                                setModelDropdownOpen(false);
                              }
                            }}
                            placeholder={t("chat.filterModels")}
                            aria-label={t("chat.filterModels")}
                            autoFocus
                            autoComplete="off"
                            spellCheck={false}
                            style={{
                              width: "100%",
                              minWidth: isMobile ? 0 : 220,
                              fontSize: "var(--text-meta)",
                              fontFamily: "var(--font-mono)",
                              padding: "5px 8px",
                              border: "1px solid var(--border)",
                              borderRadius: 5,
                              outline: "none",
                              background: "var(--bg)",
                              color: "var(--text)",
                              boxSizing: "border-box",
                            }}
                          />
                        </div>
                      )}
                      <div style={{ minHeight: 0, overflowY: "auto" }}>
                        {modelsByProvider.length === 0 ? (
                          <div style={{ padding: "8px 12px", color: "var(--text-dim)", fontSize: "var(--text-meta)", whiteSpace: "nowrap" }}>
                            {modelFilter.trim() ? t("chat.noMatchingModels") : t("chat.noAvailableModels")}
                          </div>
                        ) : modelsByProvider.map((group, gi) => (
                          <div key={group.provider}>
                            {(modelsByProvider.length > 1) && (
                              <div style={{
                                padding: "6px 12px 4px",
                                fontSize: "var(--text-meta)", fontWeight: 600, color: "var(--text-dim)",
                                textTransform: "uppercase", letterSpacing: "0.07em",
                                borderTop: gi > 0 ? "1px solid var(--border)" : "none",
                              }}>
                                {group.provider}
                              </div>
                            )}
                            {group.options.map((opt) => {
                              const isActive = opt.modelId === model?.modelId && opt.provider === model?.provider;
                              return (
                                <button
                                  key={`${opt.provider}:${opt.modelId}`}
                                  onClick={() => {
                                    setModelDropdownOpen(false);
                                    setModelFilter("");
                                    if (!isActive || isAutoModelSelection) onModelChange(opt.provider, opt.modelId);
                                  }}
                                  style={{
                                    display: "flex", alignItems: "center", gap: 8,
                                    width: "100%", padding: "7px 12px",
                                    background: isActive ? "var(--bg-selected)" : "none",
                                    border: "none",
                                    color: isActive ? "var(--text)" : "var(--text-muted)",
                                    cursor: "pointer", fontSize: "var(--text-ui)", textAlign: "left",
                                    fontWeight: isActive ? 600 : 400,
                                    whiteSpace: "nowrap",
                                  }}
                                  onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = "var(--bg-hover)"; }}
                                  onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = "none"; }}
                                >
                                  {isActive
                                    ? <Check size={10} strokeWidth={2} aria-hidden="true" style={{ color: "var(--accent)", flexShrink: 0 }} />
                                    : <span style={{ width: 10, flexShrink: 0 }} />}
                                  {opt.name}
                                </button>
                              );
                            })}
                          </div>
                        ))}
                      </div>
                    </div>
                    );
                  })()}
                </div>
            )}
          </div>
          </div>


          {/* RIGHT: thinking + send */}
          <div style={{
            flex: "0 0 auto",
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            position: "relative",
            gap: 2,
          }}>
            {onThinkingLevelChange && (
              <div ref={thinkingMenuRef} style={{ position: "relative" }}>
                <button
                  type="button"
                  className="composer-chip composer-thinking-chip"
                  onClick={() => {
                    setModelDropdownOpen(false);
                    setMoreMenuOpen(false);
                    setThinkingMenuOpen((open) => !open);
                  }}
                  title={t("chat.changeReasoning", { level: t(THINKING_SHORT_KEYS[(thinkingLevel ?? "auto") as typeof THINKING_LEVELS[number]]) })}
                  aria-label={t("chat.changeReasoningLabel")}
                  aria-expanded={thinkingMenuOpen}
                >
                  <Brain size={13} strokeWidth={2} aria-hidden="true" />
                  <span className="composer-thinking-label" data-thinking-badge={thinkingLevel ?? "auto"}>{t(THINKING_SHORT_KEYS[(thinkingLevel ?? "auto") as typeof THINKING_LEVELS[number]])}</span>
                  <ChevronDown className="composer-thinking-chevron" size={12} strokeWidth={2} aria-hidden="true" style={{ opacity: 0.7 }} />
                </button>
                {thinkingMenuOpen && (
                  <div className="composer-menu" style={{ right: 0, minWidth: 180 }}>
                    {visibleThinkingLevels.map((lvl) => {
                      const isActive = (thinkingLevel ?? "auto") === lvl;
                      return (
                        <button
                          key={lvl}
                          type="button"
                          onClick={() => {
                            setThinkingMenuOpen(false);
                            if (!isActive) onThinkingLevelChange(lvl);
                          }}
                          style={{
                            display: "flex", alignItems: "center", gap: 8,
                            width: "100%", padding: "7px 12px",
                            background: isActive ? "var(--bg-selected)" : "none",
                            border: "none",
                            color: isActive ? "var(--text)" : "var(--text-muted)",
                            cursor: "pointer", fontSize: "var(--text-ui)", textAlign: "left",
                            fontWeight: isActive ? 600 : 400,
                          }}
                        >
                          {isActive
                            ? <Check size={10} strokeWidth={2} aria-hidden="true" style={{ color: "var(--accent)", flexShrink: 0 }} />
                            : <span style={{ width: 10, flexShrink: 0 }} />}
                          <span>{t(THINKING_SHORT_KEYS[lvl])}</span>
                          <span style={{ marginLeft: "auto", fontSize: "var(--text-meta)", color: "var(--text-dim)" }}>{t(THINKING_LEVEL_DESC_KEYS[lvl])}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          {isStreaming ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
              {/* Running + draft: click 插话 to steer now. Enter still queues. */}
              {(value.trim() || attachedImages.length) && onSteer ? (
                <button
                  className="composer-icon-hit"
                  onClick={() => sendQueued(true)}
                  title={t(isMobile ? "chat.interjectTitleMobile" : "chat.interjectTitle")}
                  aria-label={t("chat.interject")}
                  style={roundComposerButton}
                >
                  <ArrowUp size={14} strokeWidth={2.2} aria-hidden="true" />
                </button>
              ) : null}
              <button
                className="composer-icon-hit"
                onClick={() => {
                  if (aborting) return;
                  setAborting(true);
                  onAbort();
                }}
                disabled={aborting}
                aria-busy={aborting}
                title={aborting ? t("chat.stopping") : t("chat.stopAgent")}
                aria-label={aborting ? t("chat.stopping") : t("chat.stop")}
                style={{
                  ...roundComposerButton,
                  background: "transparent",
                  border: "1px solid var(--border)",
                  color: "var(--text)",
                  cursor: aborting ? "wait" : "pointer",
                  opacity: aborting ? 0.55 : 1,
                }}
              >
                <Square size={10} fill="currentColor" aria-hidden="true" />
              </button>
            </div>
          ) : (
            <button
              className="composer-icon-hit"
              onClick={handleSend}
              disabled={!value.trim() && !attachedImages.length}
              style={{
                flexShrink: 0,
                display: "flex", alignItems: "center", justifyContent: "center",
                width: 28, height: 28,
                padding: 0,
                background: (value.trim() || attachedImages.length) ? "var(--text)" : "var(--bg-panel)",
                border: "none",
                borderRadius: 999,
                color: (value.trim() || attachedImages.length) ? "var(--bg)" : "var(--text-dim)",
                cursor: (value.trim() || attachedImages.length) ? "pointer" : "not-allowed",
                transition: "background 0.15s, color 0.15s",
              }}
              title={t("chat.send")}
              aria-label={t("chat.send")}
            >
              <ArrowUp size={14} strokeWidth={2.2} aria-hidden="true" />
            </button>
          )}
          </div>
        </div>
        </div>
        </div>
      </div>
    </div>
  );
});
