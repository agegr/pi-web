import type {
  BeforeAgentStartEvent,
  BeforeAgentStartEventResult,
  ExtensionCommandContext,
  InlineExtension,
} from "@earendil-works/pi-coding-agent";

export type RouterMode = "spec" | "weak" | "react";
export type RouterSetting = "off" | "auto" | RouterMode;

const SETTING_ENTRY = "pi-web-router-setting";
const RESOLVED_ENTRY = "pi-web-router-resolved";

const BUILD_RE = /(开发|创建|写一个|生成|从零|做一个|构建|搭建|实现|上线|脚本|工具|应用|build|create|develop|generate|implement|new project)/gi;
const FIX_RE = /(修复|调试|重构|维护|排查|报错|崩溃|优化|审查|迁移|升级|兼容|review|fix|debug|refactor|maintain|repair|broken|failure)/gi;
const COMPLEX_RE = /(重构|架构|全面|详细|设计|系统|优化|分析|迁移|architecture|refactor|comprehensive|design|system|optimize|analyze|migration)/i;
const EXPLICIT_FIX_RE = /(修复|调试|排查|报错|崩溃|有\s*bug|故障|fix|debug|broken|failure)/i;

const PERSONAS: Record<RouterMode, string> = {
  spec: "Inspect the existing system and gather enough evidence before editing. Form a concise plan, preserve existing behavior, and verify the root cause.",
  weak: "Before acting, classify the task as build or fix. For builds, work directly toward a usable result. For fixes, inspect the existing behavior before changing it.",
  react: "Work directly toward a usable result. Edit, run, and verify in tight loops. Avoid unrequested scaffolding and finish with the working deliverable.",
};

const FLASH_WEAK_PERSONA = `${PERSONAS.weak} Review what is already complete before continuing, avoid repeated environment checks, and think through integration risks before producing.`;

interface RouterState {
  setting: RouterSetting;
  resolved?: RouterMode;
}

interface RouterEntry {
  type?: unknown;
  customType?: unknown;
  data?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isRouterMode(value: unknown): value is RouterMode {
  return value === "spec" || value === "weak" || value === "react";
}

function isRouterSetting(value: unknown): value is RouterSetting {
  return value === "off" || value === "auto" || isRouterMode(value);
}

function countMatches(text: string, pattern: RegExp): number {
  return [...text.matchAll(pattern)].length;
}

function classificationText(text: string): string {
  // Do not classify "不要调用工具" as a build task merely because it contains
  // the word "工具".
  return text.replace(/(?:不要|请勿|无需|不必)\s*(?:调用|使用|执行)\s*(?:任何)?\s*工具(?:调用)?/gi, "");
}

export function classifyRouterMode(text: string): RouterMode {
  const task = classificationText(text);
  if (EXPLICIT_FIX_RE.test(task)) return "spec";
  const build = countMatches(task, BUILD_RE);
  const fix = countMatches(task, FIX_RE);
  if (build > fix) return "react";
  if (fix > build) return "spec";
  return "weak";
}

export function parseRouterSetting(input: string): RouterSetting | null {
  const value = input.trim().toLowerCase();
  if (value === "on") return "auto";
  return isRouterSetting(value) ? value : null;
}

export function readRouterState(entries: readonly RouterEntry[]): RouterState {
  const state: RouterState = { setting: "off" };
  for (const entry of entries) {
    if (entry.type !== "custom" || !isRecord(entry.data)) continue;
    if (entry.customType === SETTING_ENTRY && isRouterSetting(entry.data.mode)) {
      state.setting = entry.data.mode;
      state.resolved = undefined;
    } else if (
      entry.customType === RESOLVED_ENTRY
      && state.setting === "auto"
      && isRouterMode(entry.data.mode)
    ) {
      state.resolved = entry.data.mode;
    }
  }
  return state;
}

export function personaForRouterMode(mode: RouterMode, modelId?: string): string {
  return mode === "weak" && /flash/i.test(modelId ?? "") ? FLASH_WEAK_PERSONA : PERSONAS[mode];
}

function routingGuide(prompt: string): string {
  if (prompt.length > 120 || COMPLEX_RE.test(prompt)) {
    return "Router guidance: decide whether this is a build or a fix, then reason about architecture, edge cases, and integration points. Produce once the needed information is complete.";
  }
  return "Router guidance: decide whether this is a build or a fix, adopt the matching style, and complete the task without unnecessary setup.";
}

function formatStatus(state: RouterState): string {
  const effective = state.setting === "auto" ? (state.resolved ?? "pending") : state.setting;
  return `Router: ${state.setting} (effective: ${effective})`;
}

function commandCompletions(prefix: string): Array<{ value: string; label: string }> {
  return ["off", "auto", "spec", "weak", "react"]
    .filter((value) => value.startsWith(prefix.trim().toLowerCase()))
    .map((value) => ({ value, label: value }));
}

export function createReasoningRouterExtension(): InlineExtension {
  return {
    name: "pi-web-reasoning-router",
    hidden: true,
    factory(pi) {
      pi.registerCommand("router", {
        description: "Set task routing: off, auto, spec, weak, or react",
        getArgumentCompletions: commandCompletions,
        handler: async (args: string, ctx: ExtensionCommandContext) => {
          const current = readRouterState(ctx.sessionManager.getBranch());
          if (!args.trim()) {
            const status = formatStatus(current);
            ctx.ui.setStatus("router", status);
            ctx.ui.notify(status, "info");
            return;
          }

          const setting = parseRouterSetting(args);
          if (!setting) {
            ctx.ui.notify("Usage: /router off|auto|spec|weak|react", "error");
            return;
          }

          pi.appendEntry(SETTING_ENTRY, { mode: setting });
          ctx.ui.setStatus("router", `Router: ${setting}`);
          ctx.ui.notify(`Router set to ${setting}; the next prompt will use it.`, "info");
        },
      });

      pi.on("before_agent_start", (
        event: BeforeAgentStartEvent,
        ctx,
      ): BeforeAgentStartEventResult | undefined => {
        const state = readRouterState(ctx.sessionManager.getBranch());
        if (state.setting === "off" || pi.getActiveTools().length === 0) {
          ctx.ui.setStatus("router", undefined);
          return undefined;
        }

        let mode: RouterMode;
        if (state.setting === "auto") {
          mode = state.resolved ?? classifyRouterMode(event.prompt);
          if (!state.resolved) pi.appendEntry(RESOLVED_ENTRY, { mode });
        } else {
          mode = state.setting;
        }

        const persona = personaForRouterMode(mode, ctx.model?.id);
        ctx.ui.setStatus("router", `Router: ${state.setting} -> ${mode}`);
        return {
          systemPrompt: `<pi_web_router mode="${mode}">\n${persona}\n</pi_web_router>\n\n${event.systemPrompt}`,
          ...(mode === "weak"
            ? {
                message: {
                  customType: "pi-web-router-guide",
                  content: routingGuide(event.prompt),
                  display: false,
                  details: { mode },
                },
              }
            : {}),
        };
      });
    },
  };
}
