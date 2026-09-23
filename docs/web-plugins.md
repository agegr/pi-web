# Web plugins (API v1)

Web plugins extend **Pi Web**, independently of Pi's agent extensions. This first version offers two browser UI slots, namespaced server routes, and session event observers. It intentionally does not expose React internals or replace the agent's security/lifecycle logic.

## Install and trust

Store plugins **outside** the npm installation, for example `~/.pi/web/plugins/my-plugin/`. Create `~/.pi/web/settings.json`:

```json
{
  "plugins": [
    { "path": "./plugins/my-plugin", "enabled": true }
  ]
}
```

Paths resolve relative to the configuration file. Only `enabled: true` entries execute. No project-directory discovery, remote URLs, automatic npm installs, or browser upload endpoint is provided. `PI_WEB_PLUGIN_CONFIG` selects a different configuration; `PI_WEB_PLUGINS=0` disables both halves. Restart Pi Web and refresh the browser after changing plugins. Pi's `/reload` reloads **Pi extensions**, not web plugins.

**Trusted code only.** Browser plugins execute with the user's same-origin privileges, and server plugins execute with the server account's Node.js/filesystem/network privileges. These are not sandboxed; an untrusted plugin can steal credentials or damage files. The explicit allowlist is a consent boundary, not a permission sandbox. Exceptions are caught at host entry points, but plugins must handle their own asynchronous callbacks and must not block the event loop or hang `activate()`.

All plugin API/module requests use Pi Web's existing authentication, host and origin checks. The host exposes only the declared browser bundle, never the plugin directory or server source. Symlink/traversal escapes for entry points are rejected. Backend routes must still validate their own input, HTTP methods and authorization needs; do not treat GET as permission to mutate data.

## Manifest

`pi-web-plugin.json`:

```json
{
  "id": "my-plugin",
  "name": "My plugin",
  "apiVersion": 1,
  "client": "client.mjs",
  "server": "server.mjs"
}
```

IDs are lowercase kebab-case (`[a-z][a-z0-9-]{0,63}`). At least one entry point is required. `client` and `server` must be distinct relative `.mjs` files inside the plugin directory. Unsupported API versions fail closed. `GET /api/web-plugins` lists loaded plugins and sanitized activation diagnostics.

**Browser entry points must be self-contained ESM bundles** (plain JS works without a build). There is no asset directory/file server and no host React dependency injection. If using a framework, bundle it and mount it only inside the supplied root. Server entries use native Node ESM and may import their own dependencies.

## Browser API

```js
export function activate(api) {
  // api.version === 1; api.id is this plugin's manifest id.
  api.registerSlot("chat-toolbar", {
    matches: context => Boolean(context.sessionId),
    mount(root, context) {
      const button = document.createElement("button");
      button.textContent = "My action";
      button.disabled = context.busy;
      button.addEventListener("click", () => {
        // Use the existing composer + SSE path. A Pi command must already exist.
        void context.sendPrompt("/my-command");
      }, { signal: context.signal });
      root.append(button);
      return () => { /* cleanup resources owned by this mounted instance */ };
    }
  });
  api.onDispose(() => { /* cleanup plugin-wide resources */ });
}
```

Slots:

- `chat-toolbar`: above the composer. All matching plugins mount in configuration/registration order. Context includes `sessionId`, `busy`, `sendPrompt(text)`.
- `extension-dialog`: a replacement for an existing select/confirm/input/editor dialog. Context adds `request` and `respond({value})`, `respond({confirmed})`, or `respond({cancelled:true})`. The first matching renderer wins. An explicitly hinted request is restricted to its named plugin. If none matches, or mounting fails, the original Pi dialog remains available.

`mount()` is synchronous and may return cleanup. The host aborts `context.signal` and disposes mounted resources when the context changes or the slot unmounts. Capture neither private DOM selectors nor host React state. Use CSS variables (`--bg`, `--bg-panel`, `--border`, `--text`, `--text-muted`, `--accent`, `--accent-contrast`, `--font-mono`) and scope your styling to your island. Plugins own accessibility and event-handler error feedback.

Other browser APIs:

- `api.copyText(text)`: browser clipboard, with legacy fallback. **Call directly from a click**, before unrelated awaits; browser permissions still apply. Failure rejects and must be shown to the user.
- `api.request("route-name", requestInit?)`: fetch `/api/web-plugins/<id>/rpc/route-name`, using same-origin credentials. This does not automatically parse JSON or reject non-2xx responses.
- `api.onDispose(callback)`: plugin-wide cleanup. Registration is allowed only during `activate()`.

`?webPlugins=0` skips browser plugins as a recovery measure; it does not disable the backend. Plugin activation and mounting errors are logged in the browser console. Full code trust means the host cannot recover from every possible plugin failure (e.g. an infinite loop).

## Pi extension bridge

Pi Web adds an **optional** `ctx.ui.web` object. This is a Pi Web API, not a change to upstream Pi. Current Pi SDK UI wrapping preserves this property; a regression test checks that integration.

```ts
const web = (ctx.ui as typeof ctx.ui & { web?: {
  version: number;
  supportsEditorData?: boolean;
  editor(request: {
    plugin: string; view: string; title: string; prefill: string; data?: unknown;
  }): Promise<string | undefined>;
} }).web;

if (web?.version === 1) {
  await web.editor({
    plugin: "my-plugin", view: "preview", title: "Preview", prefill: markdown,
  });
} else {
  await ctx.ui.editor("Preview", markdown);
}
```

The bridge transports an ordinary `editor` request with a validated `web: {plugin, view}` hint. Hosts advertising `ctx.ui.web.supportsEditorData === true` also carry the optional JSON-serializable `data` payload into `request.web.data`. This is plugin-owned presentation metadata, separate from the editable `prefill` text. It is neither appended to the session nor sent to the model; it is replayed with the pending dialog on SSE reconnection. Browser plugins may use `respond({value: JSON.stringify(action)})` to return control actions; the Pi extension must validate them before selecting any data. Keep a metadata-free fallback for older hosts. It reuses pending-request IDs, SSE replay, responses and cancellation, without automatically adding editor contents to the model context. Stop/shutdown cancels the request. A missing/disabled frontend plugin falls back to the standard editor; a missing bridge (TUI, generic RPC or upstream Pi Web) falls back inside the Pi extension. Do not pass a third argument to upstream `ctx.ui.editor`: the current SDK discards it.

## Server API

```js
export function activate(api) {
  const counts = new Map();
  api.onSessionEvent("agent_end", ({sessionId}) => {
    counts.set(sessionId, (counts.get(sessionId) ?? 0) + 1);
  });
  api.registerRoute("counts", request => {
    if (request.method !== "GET") return new Response("Method not allowed", {status: 405});
    return Response.json(Object.fromEntries(counts));
  });
  api.onDispose(() => counts.clear());
}
```

`api.version`, `api.id`, `api.signal`, `registerRoute`, `onSessionEvent`, and `onDispose` are available. Plugins initialize once per Node process when the first plugin discovery or agent start requests the runtime. The global runtime survives Next.js module reloads. Restart to reload server code/config; no hot unload/reload or activation timeout in v1.

- Routes receive standard `Request` and return `Response` or `Promise<Response>`. Routing is namespaced; plugins cannot register host routes. Host-level failures return sanitized 500s and log details on the server.
- Events are read-only observations of live wrapper events, not historical replay, with separate structured clones per handler. Observer promises are not awaited by the agent loop. Subscribe to specific types (avoid expensive work on every token).
- `api.signal` aborts on disposal. Cleanup callbacks run once, in reverse order, on graceful SIGINT/SIGTERM (best effort; not guaranteed for crashes/SIGKILL). Plugins own timers, open handles, in-flight task cancellation and route input limits.

No backend session-mutation facade is exposed yet. Add concrete capabilities with independent validation as real use cases arise; do not export the raw `AgentSession` or global registry.

## Upgrade model

Plugin files and settings live outside the host package and survive npm upgrades. **The host API must still be present after an upgrade.** Until this loader is merged upstream, run your maintained source branch/release and rebase the small host integration onto newer Pi Web versions; installing the unmodified upstream package does not retain these capabilities. This is not an automatic update-proof patcher.

API major versions are checked; breaking changes require a new API version or a compatibility adapter. Internal React/CSS DOM changes are not part of the contract. Back up your plugin directory and test updates against the plugin suite before switching the live service.

## Verification

```sh
node --test lib/web-plugins.test.mjs lib/clipboard.test.mjs lib/rpc-manager-extension-ui.test.mjs
node_modules/.bin/tsc --noEmit
npm run lint
```

The tests exercise opt-in loading, API version checks, native server modules, route namespacing, isolated event delivery, path/symlink rejection, activation cleanup, clipboard failure handling, and the real SDK UI wrapper's bridge/cancellation/replay behavior. For browser testing, use an isolated agent directory and plugin configuration, expose the host through your normal authenticated/reverse-proxy setup, and verify the built-in editor fallback with `?webPlugins=0`.
