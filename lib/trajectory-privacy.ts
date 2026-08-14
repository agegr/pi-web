// Privacy boundaries for trajectory payloads: summary never carries raw
// values; full keeps non-sensitive fields bounded and redacted.

export const TRAJECTORY_MAX_DETAIL_CHARS = 12_000;
const MAX_ARRAY_ITEMS = 2_000;
const MAX_DEPTH = 6;
const SUMMARY_PREVIEW_LEN = 160;
const TRUNCATED_MARK = "...[truncated]";

const SENSITIVE_KEY_RE =
  /\b(api[_-]?key|authorization|cookie|password|passwd|secret|credential|env|token)\b/i;
const SENSITIVE_HEADER_RE =
  /^(authorization|proxy-authorization|cookie|set-cookie|api[-_]?key|x[-_]?api[-_]?key|x[-_]?auth[-_]?(token|key)|authentication|credentials?|password|secret|token)$/i;
const SESSION_LOG_PATH_KEY_RE = /(session|log)/i;

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function truncateString(value: string, state: { truncated: boolean }): string {
  if (value.length <= TRAJECTORY_MAX_DETAIL_CHARS) return value;
  state.truncated = true;
  return value.slice(0, TRAJECTORY_MAX_DETAIL_CHARS) + TRUNCATED_MARK;
}

/** Keep only non-sensitive keys from an object. */
export function redactRequestContext(value: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!isObject(value)) return out;
  for (const [key, val] of Object.entries(value)) {
    if (SENSITIVE_KEY_RE.test(key)) continue;
    if (SESSION_LOG_PATH_KEY_RE.test(key) && typeof val === "string" && val.startsWith("/")) {
      continue;
    }
    if (typeof val === "object" && val !== null) {
      out[key] = redactRequestContext(val);
    } else {
      out[key] = val;
    }
  }
  return out;
}

function sanitizeHeaders(value: unknown, state: { truncated: boolean }): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!isObject(value)) return out;
  for (const [key, val] of Object.entries(value)) {
    if (SENSITIVE_HEADER_RE.test(key)) continue;
    if (typeof val === "string") {
      out[key] = truncateString(val, state);
    } else {
      out[key] = val;
    }
  }
  return out;
}

function sanitize(
  value: unknown,
  depth: number,
  state: { truncated: boolean },
): unknown {
  if (typeof value === "string") return truncateString(value, state);
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    let items: unknown[] = value;
    if (items.length > MAX_ARRAY_ITEMS) {
      state.truncated = true;
      items = items.slice(0, MAX_ARRAY_ITEMS);
    }
    if (depth >= MAX_DEPTH) {
      if (items.length > 0) state.truncated = true;
      return items.slice(0, 0);
    }
    return items.map((item) => sanitize(item, depth + 1, state));
  }
  if (depth >= MAX_DEPTH) {
    state.truncated = true;
    return {};
  }
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEY_RE.test(key)) continue;
    if (key.toLowerCase() === "headers") {
      out[key] = sanitizeHeaders(val, state);
    } else if (SESSION_LOG_PATH_KEY_RE.test(key) && typeof val === "string" && val.startsWith("/")) {
      state.truncated = true;
    } else {
      out[key] = sanitize(val, depth + 1, state);
    }
  }
  return out;
}

/** Full detail: sanitized, bounded copy of a payload. */
export function fullPayload(value: unknown): Record<string, unknown> {
  const state = { truncated: false };
  const out = sanitize(value, 0, state);
  const result = isObject(out) ? out : { value: out };
  if (state.truncated) result.truncated = true;
  return result;
}

function summarize(value: unknown, depth: number): Record<string, unknown> {
  if (typeof value === "string") {
    const truncated = value.length > SUMMARY_PREVIEW_LEN;
    return {
      type: "string",
      preview: truncated ? value.slice(0, SUMMARY_PREVIEW_LEN) + TRUNCATED_MARK : value,
      truncated,
      length: value.length,
    };
  }
  if (value === null) return { type: "null", preview: "null", truncated: false };
  if (typeof value === "number" || typeof value === "boolean") {
    return { type: typeof value, preview: String(value), truncated: false };
  }
  if (Array.isArray(value)) {
    return {
      type: "array",
      preview: `[${value.length} items]`,
      truncated: value.length > MAX_ARRAY_ITEMS,
      length: value.length,
    };
  }
  if (isObject(value)) {
    if (depth >= MAX_DEPTH) return { type: "object", preview: "[object]", truncated: false, keys: 0 };
    const entries = Object.entries(value);
    const firstString = entries.find(([, v]) => typeof v === "string");
    const preview = firstString ? summarize(firstString[1], depth + 1).preview : "[object]";
    const truncated = entries.some(([, v]) => summarize(v, depth + 1).truncated);
    return { type: "object", preview: String(preview), truncated, keys: entries.length };
  }
  return { type: "unknown", preview: String(value), truncated: false };
}

/**
 * Safe summary of a payload: type, short preview and shape only. Never
 * includes raw tool input/output, headers or sensitive fields.
 */
export function summarizePayload(value: unknown): Record<string, unknown> {
  return summarize(value, 0);
}
