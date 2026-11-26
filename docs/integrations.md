# Integration Hooks

Two hooks for code that runs alongside Pi Web: a browser event for apps that embed it (an Electron wrapper, for example) and a server-side registry for pi extensions. Neither is needed to use Pi Web.

## Downstream Session Context Menu

Electron wrappers and other downstream integrations can provide a session-row
context menu without patching `SessionSidebar`. Listen for the cancelable
`pi-web:session-row-contextmenu` browser event and call `preventDefault()`
synchronously when the integration will handle it:

```js
window.addEventListener("pi-web:session-row-contextmenu", (event) => {
  event.preventDefault();
  const { id, path, cwd, name, clientX, clientY, refresh } = event.detail;

  void openSessionMenu({ id, path, cwd, name, clientX, clientY }).then((changed) => {
    if (changed) refresh();
  });
});
```

The detail object contains `id`, `path`, `cwd`, optional `name`, pointer
coordinates, and a `refresh()` callback for actions that change the session
list. If no listener cancels the extension event, Pi Web opens its built-in
session menu (pin, rename, fork, mark read or unread, archive, open in new
tab, delete) at the pointer instead of the browser's native context menu.
The row's `⋯` button always opens the built-in menu and does not dispatch the
event. Sessions not yet saved to disk get no built-in menu, so the native one
still appears for them. This hook is browser-side and independent of Pi agent
extensions.

## Extension Session Liveness

Server-side Pi extensions with detached work can prevent automatic idle
session eviction through the versioned global registry:

```js
const liveness = globalThis[Symbol.for("@agegr/pi-web/session-liveness/v1")];
const release = liveness?.version === 1
  ? liveness.register({
      name: "my-extension",
      sessionId,
      sessionFile: sessionFile || undefined,
      isActive: () => detachedJobs.size > 0,
    })
  : () => {};
```

Register once per active extension session and call the returned idempotent
`release` function on session shutdown, replacement, or reload. `isActive`
must be synchronous, cheap, and scoped to the supplied exact session id or
file. Provider errors fail safe by preserving that session. This lease only
affects automatic idle eviction; explicit shutdown and Stop fallback cleanup
still take precedence.

## Downstream Settings Sections

A pi extension can add one Settings section — a status line, a few fields, an
Apply button and optional notes — and Pi Web renders it with its own settings
blocks. The extension sends data, never a component, HTML or CSS.

```js
const registry = globalThis[Symbol.for("@agegr/pi-web/settings-sections/v1")];
const release = registry?.version === 1
  ? registry.register({
      id: "ext:my-service",
      label: { en: "My service", "zh-CN": "我的服务", "zh-TW": "我的服務" },
      icon: "sync",
      fields: [
        { kind: "readonly", label: { en: "Server" }, value: "http://127.0.0.1:30141", mono: true },
        { kind: "text", key: "address", label: { en: "Address", "zh-CN": "地址", "zh-TW": "位址" } },
        { kind: "password", key: "token", label: { en: "Token", "zh-CN": "令牌", "zh-TW": "權杖" } },
        { kind: "switch", key: "enabled", label: { en: "Enabled", "zh-CN": "启用", "zh-TW": "啟用" } },
      ],
      applyLabel: { en: "Apply", "zh-CN": "应用", "zh-TW": "套用" },
      read: () => ({ values: loadMine(), status: { state: "ok", text: { en: "Running" } } }),
      apply: (values) => { if (!valid(values)) throw new Error("Address must be an http(s) URL"); saveMine(values); },
      status: () => ({ state: health(), text: { en: health() === "ok" ? "Running" : "Stopped" } }),
    })
  : () => {};
```

The registry is the `session-liveness/v1` shape again: a versioned object an
extension writes from the process it runs in, which `lib/settings-sections-host.ts`
reads. A descriptor declares an `ext:` id (`ext:<slug>`, never a built-in name),
a `label` in `en` / `zh-CN` / `zh-TW`, an optional `icon` (`sync`, `server` or
`plug`), 1–24 `fields` of kind `text`, `password`, `switch`, `select` or
`readonly`, an optional `applyLabel`, and up to four `notes`. `register()`
refuses anything else (pi records the error as an extension diagnostic) and
returns an idempotent release; registering an id again replaces it.

Pi Web loads the user's extensions at server start, not at a session's start, so
a section exists before anyone chats: extensions only — no skills, prompts,
themes, context files, model runtime or session, and none of the four
session-bound built-ins (`llama.cpp`, `codemode`, `tool-search`, `mcp`). Until
that load answers, `/api/settings/sections` returns `{ ready: false, sections: [] }`
and the dialog is exactly as it was. Settings › Plugins re-reads the extensions
after a package change, so an installed plugin's section appears without a
restart.

The extension keeps its values, validation and storage; `apply` rejecting with a
message shows that message under the form, untranslated. `read` and `status` run
while the section is on screen, `apply` only when its Apply is pressed, and
`status` is polled every 2.5 s when it is present — driving the status dot alone,
never a field being edited. At most eight sections are listed, and only the
extension's installed **global** code is loaded at boot: project extensions still
wait for trust and a session.
