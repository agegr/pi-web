export function responseError(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null;
  const error = (value as { error?: unknown }).error;
  return typeof error === "string" ? error : null;
}
