/**
 * Structured-ask adapter layer.
 *
 * Pi has no first-class "ask the user a question" wire protocol. Extensions
 * such as `pi-ask-user` build a terminal component and hand it to
 * `ctx.ui.custom()`. Pi Web runs that component headless and streams its
 * rendered text lines to the browser, which is correct but unusable on a
 * touch screen.
 *
 * This module maps a known question-asking tool call onto a structured
 * description (`StructuredAskSpec`) that the browser can render as a real
 * form, and maps the submitted answer back onto the value the extension
 * expects from its custom UI promise.
 *
 * Adding a new question-asking extension means adding one adapter entry.
 * When no adapter matches, Pi Web keeps the generic terminal panel.
 */

export interface StructuredAskOption {
  title: string;
  description?: string;
}

export interface StructuredAskSpec {
  /** Tool call that produced this question. */
  toolName: string;
  toolCallId?: string;
  question: string;
  context?: string;
  options: StructuredAskOption[];
  allowMultiple: boolean;
  allowFreeform: boolean;
  allowComment: boolean;
}

export type StructuredAskAnswer =
  | { kind: "selection"; selections: string[]; comment?: string }
  | { kind: "freeform"; text: string };

/** What the browser sends back: an answer, or an explicit cancel. */
export type StructuredAskSubmission =
  | { answer: StructuredAskAnswer }
  | { cancelled: true };

interface StructuredAskAdapter {
  /** Reads the tool arguments. Returns null when the shape does not match. */
  parse: (args: Record<string, unknown>) => Omit<StructuredAskSpec, "toolName" | "toolCallId"> | null;
  /** Builds the value the extension's `ctx.ui.custom()` promise resolves with. */
  toCustomUiValue: (answer: StructuredAskAnswer) => unknown;
  /** Value used when the user dismisses the question. */
  cancelValue: unknown;
  /** Reads a finished tool result's details for the transcript card. */
  parseDetails: (details: Record<string, unknown>) => StructuredAskRecord | null;
}

/** A finished question, rebuilt from a tool result for the transcript. */
export interface StructuredAskRecord {
  question: string;
  context?: string;
  options: StructuredAskOption[];
  answer: StructuredAskAnswer | null;
  cancelled: boolean;
}

const MAX_OPTIONS = 64;
const MAX_TEXT = 4000;

/** Key aliases models fall back to when a proxy mangles the option schema. */
const OPTION_TITLE_KEYS = ["title", "label", "text", "value", "name", "option"] as const;
const OPTION_DESCRIPTION_KEYS = ["description", "detail", "details", "subtitle"] as const;

function readString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.length > MAX_TEXT ? trimmed.slice(0, MAX_TEXT) : trimmed;
}

function readBoolean(value: unknown): boolean {
  return value === true;
}

function readOption(raw: unknown): StructuredAskOption | null {
  const direct = readString(raw);
  if (direct) return { title: direct };
  if (!raw || typeof raw !== "object") return null;

  const record = raw as Record<string, unknown>;
  let title: string | undefined;
  for (const key of OPTION_TITLE_KEYS) {
    title = readString(record[key]);
    if (title) break;
  }
  if (!title) return null;

  let description: string | undefined;
  for (const key of OPTION_DESCRIPTION_KEYS) {
    description = readString(record[key]);
    if (description) break;
  }
  return description ? { title, description } : { title };
}

function readOptions(raw: unknown): StructuredAskOption[] {
  if (!Array.isArray(raw)) return [];
  const options: StructuredAskOption[] = [];
  const seen = new Set<string>();
  for (const entry of raw.slice(0, MAX_OPTIONS)) {
    const option = readOption(entry);
    // Duplicate titles cannot be told apart in the answer, so keep the first.
    if (!option || seen.has(option.title)) continue;
    seen.add(option.title);
    options.push(option);
  }
  return options;
}

function readAnswer(raw: unknown, options: StructuredAskOption[]): StructuredAskAnswer | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;

  if (record.kind === "freeform") {
    const text = readString(record.text);
    return text ? { kind: "freeform", text } : null;
  }
  if (record.kind !== "selection") return null;

  const selections = Array.isArray(record.selections)
    ? record.selections.map(readString).filter((entry): entry is string => Boolean(entry))
    : [];
  if (selections.length === 0) return null;
  // Historical answers may reference options that are no longer listed; keep
  // them so the transcript still shows what the user picked.
  void options;

  const comment = readString(record.comment);
  return comment
    ? { kind: "selection", selections, comment }
    : { kind: "selection", selections };
}

/**
 * `pi-ask-user` — the ask_user tool shipped by the pi-ask-user package.
 * Its custom UI promise resolves with `AskResponse | null`, which is exactly
 * the `StructuredAskAnswer` shape, so the answer passes straight through.
 */
const askUserAdapter: StructuredAskAdapter = {
  parse: (args) => {
    const question = readString(args.question);
    if (!question) return null;
    const options = readOptions(args.options);
    // With no options the extension uses ctx.ui.input(), which Pi Web already
    // renders as a native dialog. Only the option list needs this adapter.
    if (options.length === 0) return null;
    return {
      question,
      context: readString(args.context),
      options,
      allowMultiple: readBoolean(args.allowMultiple),
      allowFreeform: args.allowFreeform !== false,
      allowComment: readBoolean(args.allowComment),
    };
  },
  toCustomUiValue: (answer) => answer,
  cancelValue: null,
  parseDetails: (details) => {
    const question = readString(details.question);
    if (!question) return null;
    const context = readString(details.context);
    const options = readOptions(details.options);
    return {
      question,
      ...(context ? { context } : {}),
      options,
      answer: readAnswer(details.response, options),
      cancelled: details.cancelled === true,
    };
  },
};

const STRUCTURED_ASK_ADAPTERS = new Map<string, StructuredAskAdapter>([
  ["ask_user", askUserAdapter],
]);

export function isStructuredAskToolName(toolName: string): boolean {
  return STRUCTURED_ASK_ADAPTERS.has(toolName);
}

/**
 * Builds a structured question from a tool call. Returns null when the tool is
 * unknown or its arguments do not match the adapter, which keeps the generic
 * terminal panel as the fallback.
 */
export function parseStructuredAsk(
  toolName: unknown,
  args: unknown,
  toolCallId?: string,
): StructuredAskSpec | null {
  if (typeof toolName !== "string") return null;
  const adapter = STRUCTURED_ASK_ADAPTERS.get(toolName);
  if (!adapter || !args || typeof args !== "object" || Array.isArray(args)) return null;

  const parsed = adapter.parse(args as Record<string, unknown>);
  if (!parsed) return null;
  return toolCallId ? { ...parsed, toolName, toolCallId } : { ...parsed, toolName };
}

/**
 * Validates a browser submission against the question it answers and returns
 * the value to resolve the extension's custom UI promise with.
 *
 * Returns `{ ok: false }` when the submission does not fit the question, so the
 * caller can leave the question open instead of resolving it with junk.
 */
export function resolveStructuredAskSubmission(
  spec: StructuredAskSpec,
  submission: unknown,
): { ok: true; value: unknown } | { ok: false } {
  const adapter = STRUCTURED_ASK_ADAPTERS.get(spec.toolName);
  if (!adapter || !submission || typeof submission !== "object") return { ok: false };

  const record = submission as Record<string, unknown>;
  if (record.cancelled === true) return { ok: true, value: adapter.cancelValue };

  const answer = normalizeStructuredAskAnswer(spec, record.answer);
  if (!answer) return { ok: false };
  return { ok: true, value: adapter.toCustomUiValue(answer) };
}

/**
 * Checks an answer against the question: freeform only when allowed, selected
 * titles must exist, one selection unless multi-select is on, comment only
 * when allowed.
 */
export function normalizeStructuredAskAnswer(
  spec: StructuredAskSpec,
  raw: unknown,
): StructuredAskAnswer | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;

  if (record.kind === "freeform") {
    if (!spec.allowFreeform) return null;
    const text = readString(record.text);
    return text ? { kind: "freeform", text } : null;
  }

  if (record.kind !== "selection") return null;
  const titles = new Set(spec.options.map((option) => option.title));
  const selections: string[] = [];
  let customEntries = 0;
  const rawSelections = Array.isArray(record.selections) ? record.selections : [];
  for (const entry of rawSelections) {
    const title = readString(entry);
    if (!title || selections.includes(title)) continue;
    if (!titles.has(title)) {
      // A multi-select answer may carry one typed entry beside the offered
      // options, so a custom answer does not cost the user their checks.
      if (!spec.allowFreeform || customEntries > 0) continue;
      customEntries += 1;
    }
    selections.push(title);
  }
  if (selections.length === 0) return null;
  if (!spec.allowMultiple && selections.length > 1) return null;
  if (!spec.allowMultiple && customEntries > 0) return null;

  const comment = spec.allowComment ? readString(record.comment) : undefined;
  return comment
    ? { kind: "selection", selections, comment }
    : { kind: "selection", selections };
}

/** Rebuilds a finished question from a tool result, for the transcript card. */
export function parseStructuredAskResult(
  toolName: string | undefined,
  details: unknown,
): StructuredAskRecord | null {
  if (!toolName) return null;
  const adapter = STRUCTURED_ASK_ADAPTERS.get(toolName);
  if (!adapter || !details || typeof details !== "object" || Array.isArray(details)) return null;
  return adapter.parseDetails(details as Record<string, unknown>);
}

/** One-line summary of an answer, for collapsed views. */
export function summarizeStructuredAskAnswer(answer: StructuredAskAnswer): string {
  if (answer.kind === "freeform") return answer.text;
  const selections = answer.selections.join(", ");
  return answer.comment ? `${selections} - ${answer.comment}` : selections;
}
