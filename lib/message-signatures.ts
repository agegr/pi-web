const SIGNATURE_FIELDS = ["thinkingSignature", "textSignature", "thoughtSignature"] as const;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Provider signatures belong to model context, not browser display copies. */
export function withoutContentSignatures<T>(block: T): T {
  if (!isObject(block) || !SIGNATURE_FIELDS.some((field) => Object.hasOwn(block, field))) return block;
  const content = { ...block };
  for (const field of SIGNATURE_FIELDS) delete content[field];
  return content as T;
}

export function withoutMessageSignatures<T>(message: T): T {
  if (!isObject(message) || message.role !== "assistant" || !Array.isArray(message.content)) return message;
  let changed = false;
  const content = message.content.map((block: unknown) => {
    const projected = withoutContentSignatures(block);
    changed ||= projected !== block;
    return projected;
  });
  return changed ? { ...message, content } as T : message;
}
