/** Defaults are the engineering limits specified in api-spec.md §2. */
export function getSkillCenterConfig(env: NodeJS.ProcessEnv = process.env) {
  function integer(key: string, fallback: number) {
    const raw = env[`PI_SKILL_CENTER_${key}`];
    const value = raw === undefined ? fallback : Number(raw);
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`Invalid PI_SKILL_CENTER_${key}`);
    return value;
  }
  const maxLimit = integer("MAX_LIMIT", 50);
  const defaultLimit = integer("DEFAULT_LIMIT", 50);
  if (defaultLimit > maxLimit) throw new Error("DEFAULT_LIMIT exceeds MAX_LIMIT");
  return {
    maxLimit, defaultLimit, maxQueryLength: integer("MAX_QUERY_LENGTH", 200),
    searchTimeoutMs: integer("SEARCH_TIMEOUT_MS", 20000),
    cliTimeoutMs: integer("CLI_TIMEOUT_MS", 60000),
    maxTextBytes: integer("MAX_TEXT_BYTES", 524288),
    maxTreeEntries: integer("MAX_TREE_ENTRIES", 1000),
    cacheTtlMs: integer("CACHE_TTL_MS", 300000),
    planTtlMs: integer("PLAN_TTL_MS", 300000),
    pollAfterMs: integer("POLL_AFTER_MS", 1500),
    retentionDays: integer("RETENTION_DAYS", 30),
    maxOutputBytes: integer("MAX_OUTPUT_BYTES", 65536),
    indexPath: env.PI_SKILL_CENTER_INDEX_PATH,
    skillsApiBase: env.SKILLS_API_URL || "https://skills.sh",
    skillsmpApiBase: env.PI_SKILL_CENTER_SKILLSMP_API_URL || "https://skillsmp.com",
    agentSkillApiBase: env.PI_SKILL_CENTER_AGENTSKILL_API_URL || "https://agentskill.sh",
    maxBundleBytes: integer("MAX_BUNDLE_BYTES", 16777216),
  };
}
