export const AVATAR_CONFIG_ROLES = ["user", "assistant", "tool"] as const;

export type AvatarConfigRole = (typeof AVATAR_CONFIG_ROLES)[number];
export type AvatarConfig = Record<AvatarConfigRole, string | null>;

export function createEmptyAvatarConfig(): AvatarConfig {
  return {
    user: null,
    assistant: null,
    tool: null,
  };
}

/**
 * Keep only supported role values while always returning a complete record.
 * Image-format and payload validation belongs to the upload boundary; loading
 * only needs to tolerate absent keys and unexpected persisted values safely.
 */
export function normalizeAvatarConfig(value: unknown): AvatarConfig {
  const normalized = createEmptyAvatarConfig();
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return normalized;
  }

  const candidate = value as Record<string, unknown>;
  for (const role of AVATAR_CONFIG_ROLES) {
    const roleValue = candidate[role];
    if (typeof roleValue === "string" || roleValue === null) {
      normalized[role] = roleValue;
    }
  }
  return normalized;
}

export function parseAvatarConfig(source: string | null | undefined): AvatarConfig {
  if (source === null || source === undefined) return createEmptyAvatarConfig();
  try {
    return normalizeAvatarConfig(JSON.parse(source) as unknown);
  } catch {
    return createEmptyAvatarConfig();
  }
}
