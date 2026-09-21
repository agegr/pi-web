import { readFile, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { WEB_PLUGIN_API_VERSION, WEB_PLUGIN_ID } from "./web-plugin-types";
import type { WebPluginDescriptor, WebPluginServerApi, WebPluginSessionEvent } from "./web-plugin-types";

type Route = Parameters<WebPluginServerApi["registerRoute"]>[1];
type Listener = Parameters<WebPluginServerApi["onSessionEvent"]>[1];
type Plugin = {
  descriptor: WebPluginDescriptor;
  client?: string;
  routes: Map<string, Route>;
  listeners: Map<string, Listener[]>;
  controller: AbortController;
  disposers: Array<() => void | Promise<void>>;
};

async function entryPath(root: string, value: unknown): Promise<string | undefined> {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.endsWith(".mjs") || isAbsolute(value)) {
    throw new Error("Plugin entries must be relative .mjs files");
  }
  const file = await realpath(resolve(root, value));
  const local = relative(root, file);
  if (!local || local === ".." || local.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(local)) {
    throw new Error("Plugin entry escapes its directory");
  }
  return file;
}

/** Trusted operator configuration only. Never scans a project's working directory. */
export class WebPluginRuntime {
  readonly plugins = new Map<string, Plugin>();
  readonly errors: string[] = [];
  private disposed = false;

  async load(configPath: string): Promise<void> {
    let configured: unknown;
    try {
      configured = JSON.parse(await readFile(configPath, "utf8"));
      if (!configured || typeof configured !== "object" || !Array.isArray((configured as { plugins?: unknown }).plugins)) {
        throw new Error("Expected a plugins array");
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        this.errors.push("Invalid web plugin configuration; no plugins loaded.");
        console.error("[pi-web plugins] config:", error);
      }
      return;
    }
    const entries = (configured as { plugins: unknown[] }).plugins;
    for (const [index, entry] of entries.entries()) {
      let plugin: Plugin | undefined;
      try {
        if (!entry || typeof entry !== "object") throw new Error("Invalid plugin setting");
        const { enabled, path } = entry as { enabled?: boolean; path?: string };
        if (enabled !== true) continue;
        if (typeof path !== "string") throw new Error("Missing plugin path");
        const root = await realpath(resolve(dirname(configPath), path));
        const manifest = JSON.parse(await readFile(join(root, "pi-web-plugin.json"), "utf8"));
        if (manifest.apiVersion !== WEB_PLUGIN_API_VERSION || !WEB_PLUGIN_ID.test(manifest.id ?? "")) {
          throw new Error("Unsupported API version or invalid plugin id");
        }
        if (this.plugins.has(manifest.id)) throw new Error("Duplicate plugin id");
        const clientPath = await entryPath(root, manifest.client);
        const serverPath = await entryPath(root, manifest.server);
        if ((!clientPath && !serverPath) || (clientPath && clientPath === serverPath)) {
          throw new Error("Provide distinct client and/or server entry points");
        }
        const client = clientPath ? await readFile(clientPath, "utf8") : undefined;
        plugin = {
          descriptor: {
            id: manifest.id,
            name: typeof manifest.name === "string" ? manifest.name : manifest.id,
            apiVersion: 1,
            ...(client !== undefined ? {
              clientUrl: `/api/web-plugins/${manifest.id}/client?v=${createHash("sha256").update(client).digest("hex").slice(0, 16)}`,
            } : {}),
          },
          client, routes: new Map(), listeners: new Map(), controller: new AbortController(), disposers: [],
        };
        const current = plugin;
        if (serverPath) {
          const moduleUrl = pathToFileURL(serverPath).href;
          const entry = await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ moduleUrl);
          if (typeof entry.activate !== "function") throw new Error("Server must export activate(api)");
          const active = () => {
            if (current.controller.signal.aborted) throw new Error("Plugin is disposed");
          };
          await entry.activate({
            version: 1, id: manifest.id, signal: current.controller.signal,
            registerRoute(name: string, handler: Route) {
              active();
              if (!WEB_PLUGIN_ID.test(name) || typeof handler !== "function" || current.routes.has(name)) throw new Error("Invalid or duplicate route");
              current.routes.set(name, handler);
            },
            onSessionEvent(type: string, handler: Listener) {
              active();
              if (!type || typeof handler !== "function") throw new Error("Invalid event handler");
              current.listeners.set(type, [...(current.listeners.get(type) ?? []), handler]);
            },
            onDispose(callback: () => void | Promise<void>) { active(); current.disposers.push(callback); },
          } satisfies WebPluginServerApi);
        }
        if (this.disposed) { await this.disposePlugin(current); break; }
        this.plugins.set(manifest.id, current);
      } catch (error) {
        if (plugin) await this.disposePlugin(plugin);
        this.errors.push(`Web plugin configuration entry ${index + 1} failed; see server log.`);
        console.error(`[pi-web plugins] entry ${index + 1}:`, error);
      }
    }
  }

  descriptors(): WebPluginDescriptor[] {
    return Array.from(this.plugins.values(), (plugin) => plugin.descriptor);
  }

  /** Subscribers receive isolated snapshots; observer errors never alter the agent loop. */
  publish(sessionId: string, event: WebPluginSessionEvent["event"]): void {
    for (const plugin of this.plugins.values()) {
      for (const listener of plugin.listeners.get(event.type) ?? []) {
        try {
          const snapshot = structuredClone({ sessionId, event });
          void Promise.resolve(listener(snapshot)).catch((error) => console.error(`[pi-web plugins] ${plugin.descriptor.id} event:`, error));
        } catch (error) {
          console.error(`[pi-web plugins] ${plugin.descriptor.id} event:`, error);
        }
      }
    }
  }

  async dispatch(id: string, route: string, request: Request): Promise<Response> {
    const plugin = this.plugins.get(id);
    if (!plugin) return new Response("Plugin not enabled", { status: 404 });
    if (route === "client") {
      if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });
      if (plugin.client === undefined) return new Response("No client entry", { status: 404 });
      return new Response(plugin.client, { headers: {
        "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
      } });
    }
    const handler = route.startsWith("rpc/") ? plugin.routes.get(route.slice(4)) : undefined;
    if (!handler) return new Response("Unknown plugin route", { status: 404 });
    try {
      const response = await handler(request);
      if (!(response instanceof Response)) throw new Error("Route must return a Response");
      return response;
    } catch (error) {
      console.error(`[pi-web plugins] ${id} route:`, error);
      return Response.json({ error: "Plugin request failed; see server log." }, { status: 500 });
    }
  }

  private async disposePlugin(plugin: Plugin): Promise<void> {
    plugin.controller.abort();
    plugin.routes.clear();
    plugin.listeners.clear();
    for (const callback of plugin.disposers.splice(0).reverse()) {
      try { await callback(); } catch (error) { console.error("[pi-web plugins] cleanup:", error); }
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    const plugins = [...this.plugins.values()];
    this.plugins.clear();
    await Promise.all(plugins.map((plugin) => this.disposePlugin(plugin)));
  }
}

type State = { runtime: WebPluginRuntime; ready: Promise<WebPluginRuntime> };
const key = Symbol.for("@agegr/pi-web/web-plugins/v1");
function store() { return globalThis as unknown as Record<symbol, State | undefined>; }

export function getWebPluginRuntime(): Promise<WebPluginRuntime> {
  const existing = store()[key];
  if (existing) return existing.ready;
  const runtime = new WebPluginRuntime();
  const config = process.env.PI_WEB_PLUGIN_CONFIG ?? join(homedir(), ".pi", "web", "settings.json");
  const ready = (process.env.PI_WEB_PLUGINS === "0" ? Promise.resolve() : runtime.load(config)).then(() => runtime);
  store()[key] = { runtime, ready };
  const dispose = () => { void runtime.dispose(); };
  process.once("SIGINT", dispose);
  process.once("SIGTERM", dispose);
  return ready;
}

export function publishWebPluginEvent(sessionId: string, event: WebPluginSessionEvent["event"]): void {
  store()[key]?.runtime.publish(sessionId, event);
}
