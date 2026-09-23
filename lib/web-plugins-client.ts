import { copyText } from "./clipboard";
import { WEB_PLUGIN_ID } from "./web-plugin-types";
import type { WebPluginClientApi, WebPluginDescriptor, WebPluginRenderer, WebPluginSlotName } from "./web-plugin-types";

export type SlotRegistration = { pluginId: string; slot: WebPluginSlotName; renderer: WebPluginRenderer };

/** Registration is separate from React so plugins don't depend on its private runtime. */
export class WebPluginClientRuntime {
  readonly slots: SlotRegistration[] = [];
  private disposers: Array<() => void> = [];
  private active = true;

  async activate(descriptor: WebPluginDescriptor, activate: (api: WebPluginClientApi) => void | Promise<void>) {
    const pending: SlotRegistration[] = [];
    const disposers: Array<() => void> = [];
    let open = true;
    const check = () => { if (!this.active || !open) throw new Error("Plugin registration is closed"); };
    const cleanup = () => {
      for (const dispose of disposers.splice(0).reverse()) {
        try { dispose(); } catch (error) { console.error("[pi-web plugins] cleanup:", error); }
      }
    };
    try {
      await activate({
        version: 1, id: descriptor.id, copyText,
        registerSlot: (slot, renderer) => {
          check();
          if (!["chat-toolbar", "extension-dialog"].includes(slot) || typeof renderer?.mount !== "function") {
            throw new Error("Invalid slot renderer");
          }
          pending.push({ pluginId: descriptor.id, slot, renderer });
        },
        request: (route, init) => {
          if (!this.active || !WEB_PLUGIN_ID.test(route)) return Promise.reject(new Error("Invalid plugin route or disposed runtime"));
          return fetch(`/api/web-plugins/${descriptor.id}/rpc/${route}`, { ...init, credentials: "same-origin" });
        },
        onDispose: (callback) => { check(); disposers.push(callback); },
      });
      if (!this.active) throw new Error("Plugin runtime was disposed");
      this.slots.push(...pending);
      this.disposers.push(cleanup);
    } catch (error) {
      cleanup();
      throw error;
    } finally {
      open = false;
    }
  }

  dispose() {
    if (!this.active) return;
    this.active = false;
    this.slots.splice(0);
    for (const dispose of this.disposers.splice(0).reverse()) dispose();
  }
}

const key = Symbol.for("@agegr/pi-web/web-plugins-client/v1");
export function loadWebPlugins(): Promise<WebPluginClientRuntime> {
  const store = window as unknown as Record<symbol, Promise<WebPluginClientRuntime> | undefined>;
  return store[key] ??= (async () => {
    const runtime = new WebPluginClientRuntime();
    window.addEventListener("pagehide", (event) => { if (!event.persisted) runtime.dispose(); });
    // Browser recovery switch does not disable server plugins; use PI_WEB_PLUGINS=0 for both.
    if (new URLSearchParams(window.location.search).get("webPlugins") === "0") return runtime;
    try {
      const response = await fetch("/api/web-plugins", { cache: "no-store" });
      if (!response.ok) throw new Error(`Plugin discovery failed (${response.status})`);
      const { plugins, errors } = await response.json() as { plugins: WebPluginDescriptor[]; errors: string[] };
      errors.forEach((error) => console.error("[pi-web plugins]", error));
      for (const plugin of plugins) {
        if (!plugin.clientUrl) continue;
        try {
          if (plugin.apiVersion !== 1 || !WEB_PLUGIN_ID.test(plugin.id)
            || !plugin.clientUrl.startsWith(`/api/web-plugins/${plugin.id}/client?`)) throw new Error("Invalid plugin descriptor");
          const entry = await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ plugin.clientUrl);
          if (typeof entry.activate !== "function") throw new Error("Client must export activate(api)");
          await runtime.activate(plugin, entry.activate);
        } catch (error) {
          console.error(`[pi-web plugins] ${plugin.id} activation:`, error);
        }
      }
    } catch (error) { console.error("[pi-web plugins]", error); }
    return runtime;
  })();
}
