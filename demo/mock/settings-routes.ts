/**
 * Models, providers, skills, plugins, subagents and other settings panels.
 * Toggles and edits update in-memory state so the panels stay interactive;
 * anything that would install software or contact a provider is refused with
 * a demo notice.
 */
import skillsResponse from "./captured/skills.json";
import subagentCatalogResponse from "./captured/subagent-catalog.json";
import subagentProfilesResponse from "./captured/subagent-profiles.json";
import toolsResponse from "./captured/tools.json";
import type { MockRequest } from "./http";
import { delay, error, json } from "./http";
import { currentDemoLocale } from "./locale";
import { AUTH_PROVIDERS_RESPONSE, ENABLED_MODELS_RESPONSE, MODELS_CONFIG, MODELS_RESPONSE, MODEL_PRICING } from "./data/models";
import { PLUGINS_RESPONSE, SKILL_SEARCH_RESULTS } from "./data/extensions";
import { settings } from "./settings-state";
import { demoOnlyMessage } from "./unavailable";

type EnabledView = typeof ENABLED_MODELS_RESPONSE;
type EnabledProvider = EnabledView["providers"][number];

// Matches lib/default-preferences.ts (root-only module); the mock validates the
// same set so 400s behave like the real route.
const THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

const enabledView: EnabledView = structuredClone(ENABLED_MODELS_RESPONSE);
const authState = structuredClone(AUTH_PROVIDERS_RESPONSE);
let modelsConfig = structuredClone(MODELS_CONFIG);
// Defaults the star in the model / reasoning menus writes, mirroring PUT
// /api/models/default in memory so the refetch keeps the marker.
const defaultsState = {
  model: MODELS_RESPONSE.defaultModel as { provider: string; modelId: string } | null,
  thinkingLevel: MODELS_RESPONSE.defaultThinkingLevel as string | null,
};
const skillsState = structuredClone(skillsResponse);
const profilesState = structuredClone(subagentProfilesResponse) as { profiles: Array<Record<string, unknown> & { name: string; scope: string }> };
// The catalog is mutable in the demo so the disable toggle's refetch shows its
// effect; the mock answers /api/subagents/overrides by editing these rows.
const catalogState = structuredClone(subagentCatalogResponse) as {
  agents: Array<Record<string, unknown> & {
    name: string;
    source: string;
    filePath: string;
    disabled?: boolean;
    disabledSource?: { scope: "user" | "project"; via: "override" | "bulk" };
  }>;
};

/**
 * Mirrors GET /api/subagents/tools: the builtin 8 plus the `subagent` tool the
 * installed pi-subagents package registers. Descriptions reuse the captured
 * tool metadata.
 */
function subagentTools(): Array<{ name: string; description?: string; source: "builtin" | "extension" }> {
  const captured = toolsResponse as Array<{ name: string; description?: string }>;
  const describe = (name: string) => captured.find((tool) => tool.name === name)?.description;
  const builtin = ["read", "bash", "powershell", "edit", "write", "grep", "find", "ls"];
  const extension = ["subagent"];
  return [
    ...builtin.map((name) => ({ name, ...(describe(name) ? { description: describe(name) } : {}), source: "builtin" as const })),
    ...extension.map((name) => ({ name, ...(describe(name) ? { description: describe(name) } : {}), source: "extension" as const })),
  ];
}
const SUBAGENT_TOOL_LIST = subagentTools();

function isProviderLoggedIn(providerId: string): boolean {
  const oauth = authState.oauthProviders.find((provider) => provider.id === providerId);
  if (oauth) return oauth.loggedIn;
  const apiKey = authState.apiKeyProviders.find((provider) => provider.id === providerId);
  if (apiKey) return apiKey.configured;
  return Boolean(modelsConfig.providers[providerId]);
}

function recomputeEnabledView(): EnabledView {
  let enabledTotal = 0;
  let availableTotal = 0;
  const providers: EnabledProvider[] = [];
  for (const provider of enabledView.providers) {
    if (!isProviderLoggedIn(provider.id)) continue;
    const enabledCount = provider.models.filter((model) => model.enabled).length;
    enabledTotal += enabledCount;
    availableTotal += provider.models.length;
    providers.push({ ...provider, enabledCount });
  }
  return {
    ...enabledView,
    providers,
    enabledTotal,
    availableTotal,
    allEnabled: enabledTotal === availableTotal,
    patterns: enabledTotal === availableTotal ? null : providers.flatMap((provider) => provider.models.filter((model) => model.enabled).map((model) => model.ref)) as never,
  };
}

/** GET /api/models for the chat model picker, honouring the switches. */
export function visibleModels() {
  const enabled = new Set(recomputeEnabledView().providers.flatMap((provider) => provider.models.filter((model) => model.enabled).map((model) => model.ref)));
  const modelList = MODELS_RESPONSE.modelList.filter((model) => enabled.has(`${model.provider}/${model.id}`));
  return {
    ...MODELS_RESPONSE,
    defaultModel: defaultsState.model,
    savedDefaultThinkingLevel: defaultsState.thinkingLevel,
    modelList,
    models: Object.fromEntries(Object.entries(MODELS_RESPONSE.models).filter(([key]) => enabled.has(key.replace(":", "/")))),
  };
}

function setEnabled(refs: Set<string>, enabled: boolean): Response | null {
  const current = recomputeEnabledView();
  const remaining = current.enabledTotal - (enabled ? 0 : current.providers.flatMap((provider) => provider.models).filter((model) => model.enabled && refs.has(model.ref)).length);
  if (!enabled && remaining <= 0) return json({ error: "Keep at least one model enabled", reason: "last-model" }, 409);
  for (const provider of enabledView.providers) {
    for (const model of provider.models) {
      if (refs.has(model.ref)) model.enabled = enabled;
    }
  }
  return null;
}

async function modelsRoute(request: MockRequest): Promise<Response> {
  const sub = request.segments[2];
  if (!sub) return json(visibleModels());
  if (sub === "refresh") {
    await delay(1200);
    return json({ completed: true, changed: false });
  }
  if (sub === "default") {
    if (request.method !== "PUT") return error("Not found", 404);
    const body = await request.json<{ provider?: string; modelId?: string; thinkingLevel?: string }>();
    if (typeof body.provider === "string" && body.provider && typeof body.modelId === "string" && body.modelId) {
      defaultsState.model = { provider: body.provider, modelId: body.modelId };
      return json({ ok: true, defaultModel: defaultsState.model });
    }
    if (typeof body.thinkingLevel === "string" && THINKING_LEVELS.has(body.thinkingLevel)) {
      defaultsState.thinkingLevel = body.thinkingLevel;
      return json({ ok: true, defaultThinkingLevel: body.thinkingLevel });
    }
    return error("Expected provider and modelId, or a valid thinkingLevel", 400);
  }
  if (sub === "enabled") {
    if (request.method === "GET") return json(recomputeEnabledView());
    const body = await request.json<{ op?: string; refs?: string[]; provider?: string; enabled?: boolean }>();
    if (body.op === "models" && Array.isArray(body.refs)) {
      const refused = setEnabled(new Set(body.refs), Boolean(body.enabled));
      if (refused) return refused;
    } else if (body.op === "provider" && body.provider) {
      const provider = enabledView.providers.find((candidate) => candidate.id === body.provider);
      const refused = setEnabled(new Set(provider?.models.map((model) => model.ref) ?? []), Boolean(body.enabled));
      if (refused) return refused;
    } else if (body.op === "clear") {
      setEnabled(new Set(enabledView.providers.flatMap((provider) => provider.models.map((model) => model.ref))), true);
    }
    return json(recomputeEnabledView());
  }
  return error("Not found", 404);
}

async function authRoute(request: MockRequest): Promise<Response> {
  const [, , kind, providerId] = request.segments;
  if (kind === "providers") {
    return json({ providers: authState.oauthProviders, oauthProviders: authState.oauthProviders, apiKeyProviders: authState.apiKeyProviders });
  }
  if (kind === "api-key") {
    const provider = authState.apiKeyProviders.find((candidate) => candidate.id === providerId);
    if (!provider) return error(`Unknown provider: ${providerId}`, 400);
    if (request.method === "DELETE") {
      provider.configured = false;
      delete (provider as { source?: string }).source;
      return json({ success: true });
    }
    const body = await request.json<{ apiKey?: string }>();
    if (!body.apiKey?.trim()) return error("apiKey is required", 400);
    provider.configured = true;
    (provider as { source?: string }).source = "stored";
    return json({ success: true });
  }
  if (kind === "logout") {
    const provider = authState.oauthProviders.find((candidate) => candidate.id === providerId);
    if (!provider) return error(`Unknown provider: ${providerId}`, 400);
    provider.loggedIn = false;
    return json({ ok: true });
  }
  if (kind === "login") return error(demoOnlyMessage(), 501);
  return error("Not found", 404);
}

async function modelsConfigRoute(request: MockRequest): Promise<Response> {
  const sub = request.segments[2];
  if (!sub) {
    if (request.method === "PUT") {
      modelsConfig = await request.json();
      return json({ success: true });
    }
    return json(modelsConfig);
  }
  if (sub === "test") {
    const body = await request.json<{ providerName?: string; model?: { id?: string } }>();
    await delay(900 + Math.random() * 600);
    const known = body.providerName && modelsConfig.providers[body.providerName];
    if (!known) return json({ ok: false, error: demoOnlyMessage() });
    return json({ ok: true, latencyMs: 640 + Math.round(Math.random() * 500), status: 200, responseText: currentDemoLocale() === "zh" ? "你好！连接正常。" : "Hello! The connection works." });
  }
  if (sub === "discover") {
    await delay(900);
    const body = await request.json<{ providerName?: string }>();
    if (body.providerName !== "claude-gateway") return json({ error: demoOnlyMessage() }, 502);
    return json({
      endpoint: "https://llm-gateway.example.com/v1/models",
      models: [
        { id: "claude-opus-5", name: "Claude Opus 5" },
        { id: "claude-sonnet-5", name: "Claude Sonnet 5" },
        { id: "claude-haiku-4-5", name: "Claude Haiku 4.5" },
        { id: "claude-fable-5-1", name: "Claude Fable 5.1" },
        { id: "claude-opus-4-8", name: "Claude Opus 4.8" },
      ],
    });
  }
  if (sub === "catalog") {
    await delay(500);
    const query = (request.query("q") ?? "").trim();
    const match = Object.entries(MODEL_PRICING).find(([ref]) => ref.split("/")[1] === query);
    if (!match) return json({ error: demoOnlyMessage() }, 502);
    const [, price] = match;
    return json({
      recommendation: {
        exactMatches: 3,
        metadataMethod: "consensus",
        preset: { reasoning: true, input: ["text", "image"], contextWindow: 1_000_000, maxTokens: 128_000, cost: price },
        price: { status: "reliable", method: "consensus", cost: price },
      },
    });
  }
  return error("Not found", 404);
}

export function usageReport(providerId: string) {
  const capturedAt = Date.now();
  if (providerId === "openai-codex") {
    return {
      providerId,
      status: "ready",
      report: {
        providerId,
        providerName: "OpenAI Codex",
        capturedAt,
        buckets: [
          { id: "codex:primary", label: "5h", used: 23, remaining: 77, limit: 100, unit: "percent", windowMinutes: 300, resetsAt: Math.floor((capturedAt + 2.4 * 3600_000) / 1000) },
          { id: "codex:secondary", label: "7d", used: 41, remaining: 59, limit: 100, unit: "percent", windowMinutes: 10080, resetsAt: Math.floor((capturedAt + 3.2 * 86400_000) / 1000) },
        ],
        metrics: [],
      },
    };
  }
  if (providerId === "deepseek") {
    return {
      providerId,
      status: "ready",
      report: {
        providerId,
        providerName: "DeepSeek",
        capturedAt,
        buckets: [],
        metrics: [
          { id: "availability", label: "API calls", value: "Available" },
          { id: "cny-total", label: "Total balance", value: 86.42, unit: "currency", currency: "CNY" },
          { id: "cny-granted", label: "Granted balance", value: 10, unit: "currency", currency: "CNY" },
          { id: "cny-topped-up", label: "Topped-up balance", value: 76.42, unit: "currency", currency: "CNY" },
        ],
      },
    };
  }
  return { providerId, status: "auth-unavailable", message: demoOnlyMessage() };
}

async function skillsRoute(request: MockRequest): Promise<Response> {
  const sub = request.segments[2];
  if (!sub) {
    if (request.method === "PATCH") {
      const body = await request.json<{ filePath?: string; disableModelInvocation?: boolean }>();
      const skill = skillsState.skills.find((candidate) => candidate.filePath === body.filePath);
      if (!skill) return error("file not found", 404);
      skill.disableModelInvocation = Boolean(body.disableModelInvocation);
      return json({ success: true });
    }
    return json(skillsState);
  }
  if (sub === "search") {
    await delay(700);
    const body = await request.json<{ query?: string }>();
    const query = (body.query ?? "").toLowerCase();
    const results = SKILL_SEARCH_RESULTS.filter((result) => !query || result.package.toLowerCase().includes(query) || query.split(/\s+/).some((word) => result.package.toLowerCase().includes(word)));
    return json({ results: results.length ? results : SKILL_SEARCH_RESULTS.slice(0, 4) });
  }
  if (sub === "check") return json({ results: [] });
  return error(demoOnlyMessage(), 501);
}

async function pluginsRoute(request: MockRequest): Promise<Response> {
  if (request.segments[2] === "check") {
    await delay(800);
    return json({ results: PLUGINS_RESPONSE.packages.map((pkg) => ({ source: pkg.source, scope: pkg.scope, displayName: pkg.packageName ?? pkg.source, type: "npm", state: "up-to-date" })) });
  }
  if (request.method === "GET") return json(PLUGINS_RESPONSE);
  await delay(500);
  return error(demoOnlyMessage(), 501);
}

async function subagentsRoute(request: MockRequest): Promise<Response> {
  if (request.segments[2] === "catalog") {
    if (request.method === "GET") return json(catalogState);
    return error("Method not allowed", 405);
  }
  if (request.segments[2] === "tools") {
    if (request.method === "GET") return json({ tools: SUBAGENT_TOOL_LIST });
    return error("Method not allowed", 405);
  }
  if (request.segments[2] === "overrides") {
    if (request.method !== "PUT") return error("Method not allowed", 405);
    const body = await request.json<{ name?: string; disabled?: boolean }>();
    const row = catalogState.agents.find((agent) => agent.name === body.name);
    if (row && typeof body.disabled === "boolean") {
      if (body.disabled) {
        row.disabled = true;
        // The toggle only ever writes a user-scope named override.
        row.disabledSource = { scope: "user", via: "override" };
      } else {
        delete row.disabled;
        delete row.disabledSource;
      }
    }
    return json({ ok: true });
  }
  if (request.segments[2] === "eject") {
    if (request.method !== "POST") return error("Method not allowed", 405);
    const body = await request.json<{ scope?: string; sourcePath?: string; name?: string }>();
    const source = catalogState.agents.find((agent) => agent.filePath === body.sourcePath);
    const name = body.name ?? source?.name ?? "agent-copy";
    const scope = body.scope ?? "global";
    const profile = {
      name,
      displayName: name,
      description: source?.description ?? "Ejected agent copy",
      systemPrompt: "Ejected from a built-in agent.",
      toolsInherited: true,
      scope,
      filePath: scope === "project"
        ? `/Users/demo/project/.pi/agents/${name}.md`
        : `/Users/demo/.pi/agent/agents/${name}.md`,
    };
    profilesState.profiles = [
      ...profilesState.profiles.filter((candidate) => !(candidate.name === name && candidate.scope === scope)),
      profile as (typeof profilesState.profiles)[number],
    ];
    return json({ profile });
  }
  if (request.segments[2] !== "profiles") return error("Not found", 404);
  if (request.method === "GET") return json(profilesState);
  const body = await request.json<{ scope?: string; name?: string; profile?: Record<string, unknown> & { name: string } }>();
  if (request.method === "PUT" && body.profile) {
    const incoming = body.profile;
    const replaced = profilesState.profiles.find((candidate) => candidate.name === incoming.name && candidate.scope === (body.scope ?? "global"));
    const saved = { ...body.profile, scope: body.scope ?? "global", ...(replaced?.filePath ? { filePath: replaced.filePath } : {}) } as (typeof profilesState.profiles)[number];
    profilesState.profiles = [...profilesState.profiles.filter((candidate) => !(candidate.name === saved.name && candidate.scope === saved.scope)), saved];
    return json({ profile: saved });
  }
  if (request.method === "DELETE") {
    profilesState.profiles = profilesState.profiles.filter((candidate) => !(candidate.name === body.name && candidate.scope === body.scope));
    return json({ ok: true });
  }
  return error("Not found", 404);
}

export async function settingsRoutes(request: MockRequest): Promise<Response> {
  switch (request.segments[1]) {
    case "models": return modelsRoute(request);
    case "auth": return authRoute(request);
    case "models-config": return modelsConfigRoute(request);
    case "provider-usage": {
      await delay(900);
      const body = await request.json<{ providerId?: string }>();
      return json(usageReport(body.providerId ?? ""));
    }
    case "skills": return skillsRoute(request);
    case "plugins": return pluginsRoute(request);
    case "subagents": return subagentsRoute(request);
    case "tools": {
      if (request.method === "PUT") return error("PowerShell tool settings are only available on Windows", 404);
      return json({ isWindows: false, powerShellEnabled: settings.powerShellEnabled });
    }
    case "web-auth":
      return request.method === "GET" ? json({ enabled: false, authenticated: true }) : json({ ok: true });
    default:
      return error(`Not found: ${request.path}`, 404);
  }
}
