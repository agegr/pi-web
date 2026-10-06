import type { ExtensionAPI, ExtensionFactory, ResourceLoader } from "@earendil-works/pi-coding-agent";
import { isSubagentToolPolicy, selectSubagentExtensionTools, SUBAGENT_BUILTIN_TOOL_NAMES, SUBAGENT_BUILTIN_TOOLS, SUBAGENT_CONTROL_TOOL_NAMES, SUBAGENT_CONTROL_TOOLS, type SubagentToolPolicy } from "./subagents";

// Compatibility exports; the persisted configuration contract owns these definitions.
export { isSubagentToolPolicy, SUBAGENT_BUILTIN_TOOL_NAMES, type SubagentToolPolicy } from "./subagents";

export function subagentToolPolicy(profile: { loadExtensions: boolean; extensionTools?: string[]; disallowedExtensionTools?: string[] }): SubagentToolPolicy {
  return {
    mode: !profile.loadExtensions || profile.extensionTools?.length === 0 ? "none" : profile.extensionTools !== undefined ? "selectors" : "implicitAll",
    selectors: profile.loadExtensions ? [...profile.extensionTools ?? []] : [],
    deny: [...profile.disallowedExtensionTools ?? []],
  };
}

export function subagentToolExclusions(builtinTools: readonly string[]): string[] {
  return [...SUBAGENT_BUILTIN_TOOL_NAMES.filter((name) => !builtinTools.includes(name)), ...SUBAGENT_CONTROL_TOOL_NAMES];
}

type Tool = Pick<ReturnType<ExtensionAPI["getAllTools"]>[number], "name" | "sourceInfo">;
type Extension = ReturnType<ResourceLoader["getExtensions"]>["extensions"][number];

/** Resolve selectors against the approved roster, but grant only the actual registry winner. */
export function allowedSubagentTools(builtinTools: readonly string[], policy: SubagentToolPolicy, tools: readonly Tool[], extensions: readonly Extension[]): Set<string> {
  if (!isSubagentToolPolicy(policy)) return new Set();
  const roster = extensions.map((extension) => ({ ...extension, tools: new Map<string, unknown>() }));
  const allowed = new Set<string>();
  for (const tool of tools) {
    if (SUBAGENT_CONTROL_TOOLS.has(tool.name)) continue;
    const builtin = SUBAGENT_BUILTIN_TOOLS.has(tool.name);
    if (builtin && !builtinTools.includes(tool.name)) continue;
    const source = tool.sourceInfo;
    if (!source) continue;
    if (builtin && source.path === `builtin:${tool.name}` && source.source === "builtin") {
      allowed.add(tool.name);
      continue;
    }
    const owners = roster.filter((extension) => extension.path === source.path
      && extension.sourceInfo?.source === source.source
      && extension.sourceInfo?.origin === source.origin
      && extension.sourceInfo?.scope === source.scope);
    if (owners.length === 1) owners[0].tools.set(tool.name, undefined);
  }
  const selectors = policy.mode === "implicitAll" ? ["ext:*"] : policy.mode === "selectors" ? policy.selectors : [];
  for (const name of selectSubagentExtensionTools(roster, selectors, policy.deny)) allowed.add(name);
  return allowed;
}

/** Public-API reconciliation shared by lifecycle handlers and completed wrapper boundaries. */
export function reconcileSubagentActiveTools(
  api: Pick<ExtensionAPI, "getActiveTools" | "getAllTools" | "setActiveTools">,
  builtinTools: readonly string[],
  policy: SubagentToolPolicy,
  getExtensions: () => readonly Extension[],
): void {
  let allowed: Set<string>;
  try { allowed = allowedSubagentTools(builtinTools, policy, api.getAllTools(), getExtensions()); }
  catch { allowed = new Set(); }
  const active = api.getActiveTools();
  const next = active.filter((name) => allowed.has(name));
  if (next.length !== active.length) api.setActiveTools(next);
}

/** No registration-policy hook exists in SDK 1.0: active pruning is not registry filtering. */
export function createSubagentToolPolicyExtension(builtinTools: readonly string[], policy: SubagentToolPolicy, getExtensions: () => readonly Extension[]): ExtensionFactory {
  // Freeze creation authority, including against later mutations of the caller's profile.
  const base = [...builtinTools];
  const frozen = structuredClone(policy);
  return (pi) => {
    const permitted = () => allowedSubagentTools(base, frozen, pi.getAllTools(), getExtensions());
    const prune = () => reconcileSubagentActiveTools(pi, base, frozen, getExtensions);
    pi.on("session_start", prune);
    pi.on("before_agent_start", prune);
    pi.on("turn_start", prune);
    pi.on("turn_end", prune);
    pi.on("tool_call", (event) => {
      try {
        if (permitted().has(event.toolName)) return;
      } catch { /* Policy/source errors block execution, including nested calls. */ }
      return { block: true, reason: `Subagent tool policy denied ${event.toolName}` };
    });
  };
}
