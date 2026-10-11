# 0006 — MCP servers and Code mode are managed like plugins

## Status

Accepted. Implemented in phases (see "Rollout"); P0, P1, and P2 are in place.
Normal sessions load pi's built-in `codemode`, `tool-search`, and `mcp`
extensions and connect the servers in the global `mcp.json` and in a trusted
project's `.pi/mcp.json`. Settings › MCP lists, adds, switches, removes,
tests, and signs in to those servers, and holds the Code mode choice.
Per-entry approval of project servers was dropped after P1 in favor of the
CLI's project trust (see "Safety"). Statements that building P2 proved wrong
are corrected in place below.

## Context

pi 0.99 ships three built-in extensions with the CLI: `codemode` (the model
writes JavaScript that runs in a QuickJS worker and calls other tools),
`tool-search`, and `mcp` (servers from `mcp.json`, stdio or streamable HTTP,
OAuth, the `/mcp` command). The CLI prepends them from
`dist/extensions/index.js`, which the package does not export. The SDK root
exports the three factories (`createCodemodeExtension`,
`createToolSearchExtension`, `createMcpExtension`), but not the list, nor the
MCP config editor, connection class, or OAuth sign-in helper.

Pi Web loads none of them, so `"defaultTools": ["+codemode"]` does nothing and
`mcp.json` is ignored. The goal is for both features to be as easy to use as
the Plugins panel: paste something to add it, a switch to turn it off, a button
to remove it, and no session required to manage any of it.

Loading the extensions exactly as the CLI does is not enough, because Pi Web is
a long-lived, possibly remote server that runs many sessions in one process:

- **Fan-out.** The MCP extension connects every enabled server on
  `session_start`, once per `AgentSession`. Pi Web creates wrappers without a
  prompt — `get_tools` when switching sessions, auto-naming, SSE warm-up — and a
  visible session holds a liveness lease, so it is never reclaimed by the idle
  timer. Every browsed session would spawn every stdio server and keep it.
- **Stop.** The extension's `before_agent_start` handler waits up to 10 s for
  servers to connect (since pi 1.0, only for servers with `direct` tools, at a
  session's first prompt) and ignores the abort signal, so Stop does nothing
  during that wait.
- **Environment.** The stdio transport spawns servers with the whole
  `process.env`, including `PI_WEB_PASSWORD`.
- **Applying changes.** `mcp.json` is read once, on `session_start`; a change
  needs `/reload`.
- **Sign-in.** The OAuth callback listens on `127.0.0.1`, and the default
  `openUrl` opens a browser on the server host, which a remote Web user never
  sees.
- **Management UI.** The `/mcp` manager renders only when `ctx.mode === "tui"`.
  Elsewhere a bare `/mcp` prints a plain-text status notice, while
  `/mcp login`, `logout`, and `reconnect` work outside the TUI too.
- **Trust.** A project `.pi/mcp.json` is read once the project is trusted, and
  trust is inherited from ancestor folders, so a repository cloned under a
  trusted parent starts its servers on first open without anyone seeing them.
  The same holds for its `.pi/extensions`, which run earlier still.
- **Tool activation.** `withExtensionTools()` re-activates every extension tool
  whose exposure is `direct` or `model-only`, ignoring `defaultActive: false`,
  so loading `codemode` and `tool_search` would force both on in every session.

## Decision

### Loading

Normal sessions add the three factories to `extensionFactories` as
`{ name, factory, replaceable: true, builtin: true }`, with the CLI's names
(`codemode`, `tool-search`, `mcp`). `DefaultResourceLoader` resolves them as
`builtin:<name>` paths, so the shared `-builtin:<name>` setting, project
`+`/`-`/`!` overrides, `noExtensions`, and replacement by a third-party
extension that registers `/mcp`, `codemode`, or `tool_search` all behave as in
the CLI. Chat-only sessions do not load them. Subagent profiles can now select
`codemode: inherit | on | off` (missing means `off`): they load only the Code mode factory, retain their
profile tool allow-list, and save the resolved choice in their resource snapshot.
They still do not load the normal session's MCP host or tool-search.

### Pi Web decides which MCP servers a session connects

The `mcp` factory is created with a `loadConfig` that returns no servers, so
`session_start` connects nothing, and with `startupWaitMs: 0`, so the
extension's own first-prompt wait (which since pi 1.0 also covers servers
registered later) never holds a prompt. A
per-wrapper `McpHost` reads the global and project `mcp.json` itself and
registers the servers it wants through the public `pi.registerMcpServer()` /
`pi.unregisterMcpServer()`:

- **Before every prompt that may start a run** it reads the config and the
  project's trust, registers or unregisters only the servers whose entry changed,
  and waits up to 10 s for the ones with `direct` tools still connecting. As in
  pi 1.0, other servers connect in the background: their tools are in no
  request, and the extension waits for them when a codemode script names or
  searches them, or `tool_search` runs. An extension command
  starts no run (pi runs it before anything else), so another extension's
  command skips this, and the built-in `/mcp`, which acts on the registered
  servers, registers them without waiting. The wrapper runs this
  before `AgentSession.prompt()`, because `before_agent_start` runs before a
  run has an abort signal: Stop ends the wait and rejects the message unsent,
  which returns it to the composer. A server that outlasts one full wait is
  not waited for again, and a failed server whose entry is unchanged is not
  retried; only the extension's own reconnects change its state. A change
  therefore reaches every open session on its next message, including changes
  made outside Pi Web (`pi mcp add`, a manual edit, `git pull`), and there is
  no Reload button. A sign-in made elsewhere needs no re-registration: at the
  session's next turn, the extension reconnects the servers that were waiting
  for a sign-in once their stored tokens have changed.
- **The project's trust is read afresh each time**, from `trust.json`, never
  from the session's own `ctx.isProjectTrusted()`. That flag is fixed when the
  session is built and refreshed only by a reload, and it is true for a folder
  that needed no trust at that moment. Until P2, a `.pi/mcp.json` that arrived
  afterwards (`git pull`, `pi mcp add -l`, the model's `write` tool) therefore
  connected on the next prompt with no trust decision. The read is true only
  while a decision, exact or inherited, trusts a folder that requires trust;
  a `trust.json` that cannot be read counts as untrusted.
- **Nothing connects until a session prompts.** Browsing, switching sessions,
  auto-naming, and forking start no MCP process. A host that has not prompted
  for `PI_WEB_MCP_IDLE_MS` (10 minutes) unregisters its servers.
- Operations on one host run in a serial queue, and a server is replaced only
  once the extension has opened its connection: the extension's
  `mcp_servers_change` handler closes `server.connection`, which it assigns
  only after loading the MCP runtime, so unregistering earlier finds nothing
  to close and the server connects anyway, out of reach. The wait is capped
  at 5 s; a registration unregistered without a connection is remembered, and
  the factory refuses the transport its late connection asks for, so nothing
  starts out of reach either way. The extension does
  not report connection state, so the host watches the transports it creates
  through the factory Pi Web passes in: one exists only once the connection
  is assigned, and its messages show when the server's tools are listed. What
  the host sees of each server (connected, needs a sign-in, failed with its
  stderr, dropped, a name conflict) goes to a process-wide status store that
  Settings › MCP shows.

This differs from the CLI in two ways. Servers carry the scope `extension`,
which only the TUI's `/mcp` manager prints, and Pi Web never shows that
manager; the panel says instead that sessions register its servers through
Pi Web's MCP host. And a package extension that registers a server with the
same name first keeps it, where in the CLI the `mcp.json` entry wins; the
panel reports that as a name conflict naming the extension.

### Settings › MCP, without a session

A new Settings section sits next to Plugins and is built from the same
`SettingsUi` primitives: a Code mode row, then servers grouped by Project and
Global with a group switch and an `n/m` count, a status dot per row, a detail
pane with Sign in, Test, Remove, a switch, and the server's exposure, and an
"Add MCP" action. It needs no project either: without one it lists the global
`mcp.json` alone.

- **Exposure is chosen per server**, as the TUI's `/mcp` manager does, and
  written as the SDK's config editor writes it (`codemode` removes the key,
  `toolExposure` is kept). It decides what a server costs every request, from
  nothing (`hidden`) through a name and a summary (`codemode`, whose tools
  scripts find by search) to every tool's schema (`direct`). pi 1.0 folded
  `codemode-deferred` into `codemode`: an entry that still holds it lists, and
  is keyed for its status, as `codemode`, and is no longer offered. The manager re-registers the tools in place; Pi
  Web can only register the changed entry again, so open sessions reconnect
  the server at their next message. Per-tool exposure stays in P3.
- **A global server can be turned on or off for one project**, as pi 1.0.1's
  `/mcp` does: an override in the project's `.pi/mcp.json`, an entry without
  `command`, `url` or `type` that may set only `enabled`, `exposure` and
  `toolExposure`. The panel lists it in the Project group as the global server
  with those changes, which is what the project's sessions connect, and its
  switch, exposure and Remove edit the override.

- `GET /api/mcp` reads files only. It never spawns a process, opens a network
  connection, or runs a `!command` value. The two obvious sources of its
  details would break that: the SDK's `McpOAuthCredentialStore` creates
  `mcp-auth.json` and a lock just to be read, and the codemode self-test
  starts a QuickJS worker. GET parses `mcp-auth.json` itself, read-only, and
  reports the sandbox only once a session has run the self-test.
- **Status** comes from the last Test, sign-in, or session report, held in the
  server's memory per entry and per entry content (an HMAC of its JSON, never
  the JSON, which may hold literal secrets), so an edited entry reads as
  untested and a restart forgets every status.
- **Adding is one paste box.** `lib/mcp-import.ts` recognises a URL, a command
  line, `pi|claude|codex|gemini mcp add …`, Claude / Cursor / VS Code / Zed /
  opencode JSON, and Cursor and VS Code install links, and maps them to pi's
  schema. The browser sends the pasted text, never a config: the server parses
  it again and validates the result with the SDK's `validateMcpServerConfig`.
  Missing values become password, text, or select fields, and only the
  secret-looking ones are masked, since many are paths or choices. Nothing
  connects on paste, because an install link can hide its command in base64:
  a new server is tested once, after the explicit Add, and the preview before
  it shows the decoded command line and URL as written, hiding only what the
  user typed into a password field.
- **Test connection and OAuth sign-in run server-side**, through SDK modules
  the package does not export (`McpServerConnection`, `signInMcpServer`),
  loaded by file URL in `lib/pi-sdk-internals.ts`. A test is bounded (15 s per
  request, a 20 s deadline, a close awaited for at most 2 s), and tests of
  entries that run a `!command` wait for each other.
- **A sign-in flow lives in the server process, not in a request.** The panel
  polls it, so a phone that sleeps or a closed Settings loses nothing, and the
  "paste the redirected address" box is always shown, so sign-in works from a
  phone or a remote browser. The SDK sets the limits:
  - `signInMcpServer()` takes no abort signal, and its loopback callback gives
    up after 5 minutes. A flow therefore expires after 5 minutes, except that
    one whose code is already being exchanged gets one more minute to finish,
    and Cancel works only by answering the SDK's prompt with nothing.
  - The SDK ends the whole sign-in on a bad paste, so Pi Web checks a pasted
    address (a URL, the flow's `state`, a `code`) before handing it on.
  - A stored refresh token can finish a sign-in with no page at all.
  - The SDK keeps one PKCE verifier per server (since pi 1.0 keyed by name
    and URL, so servers sharing a URL keep separate accounts), so one flow
    runs per server and a second start joins it.
  - Starting a sign-in can drop the stored client registration and its tokens
    when the loopback address changes; the panel says so beside the button.

  Sign out removes the server's tokens and client registration (or the record
  older versions kept by URL alone), as `pi mcp logout` does, and stops a code
  exchange already on its way from writing them back.
- **Writes** go through Pi Web's own writer (`lib/mcp-config-file.ts`), not the
  SDK's config editor, which writes in place with no lock, no atomic replace,
  and no file mode, and throws untyped errors. For every edit that changes
  the file, the writer produces the editor's bytes exactly (a contract test
  compares them); it leaves a file alone when nothing changes, and Undo puts
  an entry back where it was, not at the end. It adds a file lock, an atomic
  replace through the real path of a symlinked file, `0600` for the global
  file (a project file keeps its mode), and typed refusals
  (`409 unparsable` and others) that leave the file untouched. The lock
  serializes Pi Web's writes only: `pi mcp add` writes without one. A project
  file's real path must stay inside the folders Pi Web may read, as for
  `/api/files`.
- **Secrets typed in the panel are stored as escaped literal values in the
  global `mcp.json`**, which the CLI reads too. The SDK resolves `${NAME}`,
  `$NAME`, and a leading `!command` in env values, header values, and
  `oauth.clientSecret`, and documents its escapes, but neither it nor Pi Web
  had an encoder: provider API keys, which an earlier version of this decision
  cited as the model, are stored as typed, unescaped. Pi Web's encoder turns
  `$` into `$$` and a leading `!` into `$!` in those three fields only;
  `command`, `args`, `url`, and `cwd` are used raw by the SDK and never
  escaped. Values pasted from other clients are escaped the same way, so a
  pasted `"!curl … | sh"` header cannot run on the host; a `pi mcp add` line,
  or a paste marked as a pi config, keeps pi's syntax as written. A server
  that carries a literal secret can only be saved globally: the Project option
  says why, and a value the SDK resolves can be stored as a `${VAR}` reference
  to a host variable instead. A pasted config from another client whose
  headers or `oauth.clientSecret` read a variable set on the host is added
  only after a confirmation that names it, and a `PI_WEB_PASSWORD` reference
  is always refused.
- **Remove is undoable for 60 seconds**; the removed entry is held in the
  server's memory and never sent back to the browser, which gets a token.
- A bare `/mcp` typed in the composer opens this panel when the session's
  `/mcp` belongs to `builtin:mcp`, and when nothing answers `/mcp` (MCP off,
  `-builtin:mcp`, Chat only, or several extensions' `/mcp`, which pi renames
  `mcp:1`, `mcp:2`, so a bare `/mcp` runs none of them). Another extension's
  `/mcp` and every subcommand (`/mcp login`, `logout`, `reconnect`, which act
  on the session's own connections) are sent as before.
- Registry search is deferred. The add panel links to catalogs for browsing
  (glama.ai, smithery.ai, mcp.so, registry.modelcontextprotocol.io,
  github.com/mcp). A `github.com/mcp` page's Install buttons cannot be
  pasted: they are menu
  items, not links. The VS Code items open `vscode:mcp/by-name/<name>`, which names a
  server but carries none of its settings, and the GitHub Copilot app item
  navigates to a launch page. The paste box takes that launch address and the
  install badges in a server's README (Cursor, VS Code), and explains a
  by-name link or a `github.com/mcp` page instead of failing on it.

### Code mode

The panel offers one choice, **Automatic** or **Always on**:

- **Automatic** (default) writes nothing. `codemode` registers inactive, and
  the MCP extension activates it when a server with `codemode` exposure
  connects, unless `autoEnableCodemode` is false, which the panel then says.
- **Always on** adds `+codemode` to the global `defaultTools` through
  `/api/tools/settings`, which stays the only writer of that key and shares its
  lock with the PowerShell switch. It applies to sessions started afterwards
  and reloads none. It does not reach every project: a trusted project's
  `.pi/settings.json` decides Code mode for its own sessions when its
  `defaultTools` holds a plain name (that list replaces the global one,
  `+codemode` included) or a `+codemode` / `-codemode` modifier (which has the
  last word), and the panel names that file. Always on is unavailable, with
  the reason shown, while the sandbox has failed its self-test or the global
  `extensions` set `-builtin:codemode`.
- There is no **Never**: MCP tools with `codemode` or `deferred` exposure cannot
  be called without `codemode` or `tool_search`.

Before the first normal session, Pi Web runs one script through the SDK's
codemode tool. If the sandbox cannot run (its worker and wasm are resolved from
the SDK's files at run time), no session offers `codemode`: the
`builtin:codemode` entry stays, so settings that name it keep their meaning,
but registers nothing. The panel shows the result, and "not checked yet"
until a normal session has run the test.

The pane also edits two global `codemode` settings through the same route
and lock, and names a trusted project whose settings set their own. An
earlier version of this decision kept both file-only.

- `codemode.inlineBudget`, the estimated tokens the `codemode` description
  may spend declaring tools (pi's default 3000). One server with many tools
  fills that budget, so it is the setting that decides what an MCP server
  costs every request.
- `codemode.mode`, the **Built-in tools** switch: `on` (pi's default, which
  the switch writes by removing the key) keeps the active built-in and
  extension tools declared while Code mode is on; `only` leaves their
  declarations out of requests and lists them in the `codemode` description,
  within the same budget, so the model calls them from scripts. It decides
  how a session reaches its own tools, not which tools it has: a preset
  still bounds them, since a `direct` tool is callable only while active.

`autoEnableCodemode` and the `±builtin:*` entries stay file-only; they keep
working as in the CLI. The panel reports the ones that change what it offers
(`-builtin:mcp`, `-builtin:codemode`, `autoEnableCodemode: false`).

`resolveActiveToolNames()` replaces `withExtensionTools()`. It respects
`defaultActive: false`, carries extension tools that were activated at runtime
(by the MCP extension or `tool_search`) across `set_tools` and `reload`, and
re-applies a session's pinned preset after `navigate_tree`, because the SDK
restores the branch's tool set from its transcript.

### Safety

- **Environment.** Pi Web spawns stdio servers with `inheritEnv: false` and
  the environment that project bash commands receive (`PI_WEB_PASSWORD`,
  `PORT`, `NODE_ENV`, and `NEXT_*` removed), plus the server's own `env`. An
  entry that references `PI_WEB_PASSWORD` is refused. If the internals adapter
  cannot load, MCP is off: Pi Web never falls back to the SDK's default
  transport.
- **Project entries follow project trust, as in the CLI.** A project
  `mcp.json` is read only once the project is trusted, inherited trust
  included, and every enabled entry then connects on the next prompt. An
  earlier version of this decision also approved each entry by the SHA-256 of
  its JSON, in a Pi Web-only `mcp-approvals.json`. It was dropped after P1: a
  trusted project's `.pi/extensions` already run inside the same boundary,
  earlier (when a session is browsed, not when it prompts) and with no
  approval, so gating only MCP entries stopped neither a malicious repository
  nor inherited trust, and it made Pi Web and the CLI disagree about which
  servers run. What Pi Web adds is visibility: the panel lists an untrusted
  project's entries with the command each would run, as written rather than
  masked (masking by shape would let the repository choose what is hidden),
  and the host variables each would read, and the trust dialog lists them before the folder is
  trusted. A project file over 1 MiB, or declaring more than 200 servers, is
  reported instead of listed: it comes from a repository nobody has trusted
  yet. The dialog opens only for a folder that requires trust and is not
  trusted, so a project trusted through an ancestor, the case "Context"
  names, never shows it; the panel lists that project's servers under
  "Trusted through <path>". Tightening trust itself (exact rather than
  inherited, or per entry) belongs upstream, for extensions and MCP servers
  alike.
- **Fresh folders.** Writing `.pi/mcp.json` makes a folder require trust, and
  `POST /api/project-trust` refuses a folder that does not require it yet
  (`trustProject()` itself writes nothing for such a folder and reports it
  trusted, and the SDK's store would record any path). When neither the
  folder nor an ancestor has a trust decision, adding a project server
  therefore trusts the folder in the same request, and the button says "Add
  and trust this folder". A decision is inherited by every folder below it,
  so this step never trusts the home folder, a filesystem root, or a folder
  that holds the home folder, Pi's agent folder, another folder Pi Web
  knows (a session's folder, its project, a folder chosen in Pi Web), or a
  project with resources that need trust and no decision of its own, such
  as a repository cloned into it (found by a bounded scan of four levels
  below it; a folder too large to scan is refused). Steps
  for one folder run one at a time, and each checks again that the folder is
  still fresh (a `git pull` may have brought `.pi/extensions` in the
  meantime), trusts it first, then writes, and takes the decision back when
  the write fails.
- **Read-only.** A `tool_call` policy blocks MCP tools without
  `readOnlyHint: true` while the Read-only preset is pinned, for top-level and
  nested calls. The hint comes from the server; the policy guards against
  model mistakes, not against a malicious server.
- **File access.** Session file references no longer authorize paths that
  appear only in system messages or in the text of non-coding tool results;
  MCP results would otherwise make any string they contain readable through
  `/api/files`.
- **Subagents.** `Agent`, `get_subagent_result`, and `steer_subagent` become
  `model-only`, so a codemode script cannot start subagents.
- **Operators.** `PI_WEB_DISABLE_MCP=1` turns MCP off for the whole server.
  Nothing in the browser can override it, and the server list in Settings ›
  MCP becomes read-only: switches, Remove, Undo, Add, Test, sign-in and
  sign-out answer 409 `mcp-off`. The Code mode choice, which belongs to the
  separate codemode built-in, stays editable.

### Transport, rendering, and lifecycle

- The SSE projection slims nested tool events (those with `parentToolCallId`),
  drops nested updates, removes `result` from `tool_execution_end`, omits
  `entry_appended`, coalesces updates per `toolCallId`, and truncates codemode
  call snapshots, which otherwise grow with the square of the number of calls.
- Extension dialogs queue instead of sharing one slot, so concurrent confirms
  from a script cannot overwrite each other.
- A wrapper is removed from the registry by identity, reports itself closing
  as soon as shutdown starts, and gives `session_shutdown` a deadline
  (`PI_WEB_SHUTDOWN_DEADLINE_MS`, 5 s), because closing an MCP connection has
  no upper bound. Its MCP host lets go of what it reported to Settings when
  closing starts, before any extension's handler runs, so a close that never
  returns leaves no session reading as connected.

## Rollout

- **P0 — foundation, no visible feature.** `resolveActiveToolNames()`, wrapper
  lifecycle, extension dialog queue, SSE projection, narrower file references,
  `model-only` subagent tools, the internals adapter with contract tests, the
  environment-scrubbing transport, and the shared settings components (Plugins
  and Skills move to them; their hard-coded English and tooltip-only reasons
  are fixed on the way).
- **P1 — runtime, not yet exposed.** Load the built-ins, `McpHost`, the
  Read-only policy, the Code mode writer, the sandbox self-test (a failing
  self-test registers `codemode`-exposure servers as `deferred` instead), and
  the codemode and MCP result views.
- **P2 — Settings › MCP ships.** Panel, routes, paste import, test, sign-in,
  project servers in the trust dialog, `/mcp` interception, and, in the host,
  trust read afresh before every prompt and a report of each server's state.
- **P3.** Registry search, resolving `github.com/mcp` by-name links, editing an
  existing entry, TOML and YAML paste, per-tool exposure, the same
  fresh-folder fix for Plugins and Skills.
- **P4.** Per-session switches, MCP for subagents, and dropping the internals
  adapter once upstream exports what it needs.

## Consequences

- Pi Web and the CLI share `mcp.json`, `mcp-auth.json`, `trust.json`, and the
  `-builtin:<name>` settings, so, apart from the name conflict above, both
  connect the same servers for a project whose trust decision is recorded,
  as long as the CLI runs without `--approve` / `--no-approve` and no
  extension answers its `project_trust` event. In the CLI those two override
  a recorded decision, and when none is recorded it falls back to
  `defaultProjectTrust` (`always` / `never`) or an answer kept for one
  session. Pi Web ignores all of these: with `defaultProjectTrust: "always"`,
  the CLI connects project servers that Pi Web does not.
- Only MCP reads trust afresh. An open session's project extensions and
  settings keep the trust it was built with until a reload, so after a
  decision made in the CLI the two can disagree until then
  (`POST /api/project-trust` rebuilds the folder's sessions). The extension
  reads `autoEnableCodemode` on `session_start`, so that flag, too, follows a
  trust change only at the next reload.
- Statuses, pending undos, and sign-in flows live in the server process's
  memory: a restart forgets them, and separate Pi Web processes do not share
  them.
- The internals adapter couples Pi Web to file paths inside the SDK package.
  Contract tests fail on an SDK upgrade that moves or renames them; MCP then
  turns off with a visible reason instead of misbehaving.
- A `!command` value in `env`, `headers`, or `oauth.clientSecret` runs
  synchronously (up to 10 s) on every connection and blocks the event loop.
  Tests of such entries run one at a time, and the panel labels them.
- On Windows, a hard exit can leave stdio servers running: the transport's exit
  hook that kills the process group exists only on POSIX.
- Upstream requests that would remove Pi Web code: export the built-in list,
  the MCP config editor (with a lock and an atomic write),
  `McpServerConnection`, `signInMcpServer` (with an abort signal), and the
  list of project resources that require trust; a status callback; abortable
  startup waits; asynchronous `!command` resolution; a configurable OAuth
  redirect URI.
