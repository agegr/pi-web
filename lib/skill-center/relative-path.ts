import { requireValue } from "./errors";

export function safeRelative(value: unknown): string {
  requireValue(typeof value === "string" && value && !/[\\%:\x00-\x1f]/.test(value) && !value.startsWith("/") && value.split("/").every(p => p && p !== "." && p !== ".."), "FORBIDDEN_PATH", "文件路径必须在技能目录内。", 403);
  return value;
}
