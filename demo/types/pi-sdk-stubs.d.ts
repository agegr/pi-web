// The demo only ships Pi Web's browser code. A few copied modules keep
// type-only (or server-only) imports from the pi SDK; declare the
// names they use loosely so the demo typechecks without the agent runtime.
/* eslint-disable @typescript-eslint/no-explicit-any */
declare module "@earendil-works/pi-coding-agent" {
  export type AgentSessionEvent = any;
  export type BashOperations = any;
  export type JsonAgentSessionEvent = any;
  export type ResourceDiagnostic = any;
  export type SessionManager = any;
  export type SettingsManager = any;
  export type SlashCommandInfo = any;
  export type Theme = any;
  export function getAgentDir(): string;
}
declare module "@earendil-works/pi-agent-core" {
  export type AgentMessage = any;
  export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
}
declare module "@earendil-works/pi-ai" {
  export type ImageContent = any;
  export type TextContent = any;
}
