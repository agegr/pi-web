/** Versioned, framework-independent contracts. Plugins ship browser/Node ESM, not host React internals. */
export const WEB_PLUGIN_API_VERSION = 1;
export const WEB_PLUGIN_ID = /^[a-z][a-z0-9-]{0,63}$/;

export interface WebPluginHint {
  plugin: string;
  view: string;
}

export function validWebPluginHint(value: unknown): WebPluginHint | undefined {
  if (!value || typeof value !== "object") return undefined;
  const hint = value as WebPluginHint;
  return typeof hint.plugin === "string" && WEB_PLUGIN_ID.test(hint.plugin)
    && typeof hint.view === "string" && WEB_PLUGIN_ID.test(hint.view)
    ? { plugin: hint.plugin, view: hint.view } : undefined;
}

/** Optional pi-web-only addition to ctx.ui; feature-detect, keep a standard editor fallback. */
export interface WebPluginPiUi {
  version: 1;
  supportsEditorData: true;
  editor(request: WebPluginHint & { title: string; prefill: string; data?: unknown }): Promise<string | undefined>;
}

export interface WebPluginDescriptor {
  id: string;
  name: string;
  apiVersion: 1;
  clientUrl?: string;
}

export type WebPluginSlotName = "chat-toolbar" | "extension-dialog";
export type WebPluginDialogResponse = { value: string } | { confirmed: boolean } | { cancelled: true };
export interface WebPluginSlotContext {
  sessionId: string | null;
  busy: boolean;
  request?: {
    id: string;
    method: string;
    title?: string;
    prefill?: string;
    web?: WebPluginHint & { data?: unknown };
    [key: string]: unknown;
  };
  respond?: (response: WebPluginDialogResponse) => void;
  /** Runs through the existing composer/SSE path, not a second agent connection. */
  sendPrompt?: (text: string) => Promise<void>;
}
export interface WebPluginMountContext extends WebPluginSlotContext {
  /** Aborted on session/request replacement, plugin error, or unmount. */
  signal: AbortSignal;
}
export interface WebPluginRenderer {
  matches?(context: WebPluginSlotContext): boolean;
  mount(root: HTMLElement, context: WebPluginMountContext): void | (() => void);
}
export interface WebPluginClientApi {
  version: 1;
  id: string;
  registerSlot(slot: WebPluginSlotName, renderer: WebPluginRenderer): void;
  copyText(text: string): Promise<void>;
  /** Only this plugin's namespaced backend routes; response bodies belong to the plugin. */
  request(route: string, init?: RequestInit): Promise<Response>;
  onDispose(callback: () => void): void;
}

export interface WebPluginSessionEvent {
  sessionId: string;
  event: { type: string; [key: string]: unknown };
}
export interface WebPluginServerApi {
  version: 1;
  id: string;
  signal: AbortSignal;
  registerRoute(name: string, handler: (request: Request) => Response | Promise<Response>): void;
  onSessionEvent(type: string, handler: (event: WebPluginSessionEvent) => void | Promise<void>): void;
  onDispose(callback: () => void | Promise<void>): void;
}
