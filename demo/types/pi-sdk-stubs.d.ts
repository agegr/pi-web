// The demo only ships Pi Web's browser code. A few copied modules keep
// type-only (or server-only) imports from the pi SDK; declare the
// names they use loosely so the demo typechecks without the agent runtime.
/* eslint-disable @typescript-eslint/no-explicit-any */
declare module "@earendil-works/pi-coding-agent" {
  export type AgentSessionEvent = any;
  export type BashOperations = any;
  export type JsonAgentSessionEvent = any;
  export type ResourceDiagnostic = any;
  export type McpExposure = "codemode" | "codemode-deferred" | "deferred" | "direct" | "hidden";
  export type SessionManager = any;
  export type SlashCommandInfo = any;
  export type Theme = any;
  export const CONFIG_DIR_NAME: string;
  export function getAgentDir(): string;
  // `lib/pi-subagents-catalog.ts` is a server module the demo copies verbatim;
  // the mock API answers /api/subagents/catalog from captured data instead.
  export interface ConfiguredPackage {
    source: string;
    scope: "user" | "project";
    filtered: boolean;
    installedPath?: string;
  }
  export class SettingsManager {
    static create(cwd: string, agentDir?: string, options?: { projectTrusted?: boolean }): SettingsManager;
  }
  export class DefaultPackageManager {
    constructor(options: { cwd: string; agentDir: string; settingsManager: SettingsManager });
    listConfiguredPackages(): ConfiguredPackage[];
  }
}
declare module "@earendil-works/pi-agent-core" {
  export type AgentMessage = any;
  export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
}
declare module "@earendil-works/pi-ai" {
  export type ImageContent = any;
  export type TextContent = any;
}
