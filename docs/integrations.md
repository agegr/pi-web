# Integration Hooks

Hooks for code that runs alongside Pi Web: browser integration, extension session liveness, and structured extension state for custom clients. None is needed to use Pi Web.

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

## Custom Session Entries

Custom clients can read entries written by Pi extensions with `pi.appendEntry(customType, data)`:

```text
GET /api/sessions/<id>/entries?customType=my-extension:checkpoint&limit=100
```

The response is `{ entries, leafId, nextAfter, hasMore }`. Entries are unmodified and ordered by append across all branches. `customType` is optional and repeatable, matching exact types. `limit` defaults to 100, with a maximum of 1000 entries.

Pass `nextAfter` as the exclusive `after` cursor, including after empty pages; continue while `hasMore` is true. Unknown cursors return HTTP 400. Start without a cursor when changing the type selection.

The session's `GET /api/agent/<id>/events` SSE stream emits custom-entry notifications without payloads:

```json
{"type":"entry_appended","entryId":"a1b2c3d4","customType":"my-extension:checkpoint"}
```

Connect before reading, then catch up from the cursor on `connected` and relevant `entry_appended` events. Notifications are not replayed. Reading entries does not activate a session; opening its event stream can.
