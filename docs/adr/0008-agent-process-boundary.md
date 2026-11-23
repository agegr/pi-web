# 0008 — A session's agent runs in its own process

## Status

Proposed. Design only; nothing here is implemented yet.

## Context

Every `AgentSession` is created inside the Next.js server process. `lib/rpc-manager.ts:1656` keeps them in `globalThis.__piSessions`, `startRpcSession()` calls the SDK's `createAgentSessionServices()` / `createAgentSessionFromServices()` directly, and `lib/rpc-manager.ts:1664-1672` installs `process.once("SIGINT" | "SIGTERM")` handlers that call `shutdown()` on every session. The liveness registry in `lib/session-liveness.ts` is a module-level `Map`, so it dies with the same process.

That is a deliberate trade: no protocol, no serialization, extension dialogs and the headless custom UI (`lib/custom-ui-terminal.ts`) run in the same heap.

It also makes the process boundary the lifetime of a turn. Restarting the web server — a `next.config.ts` edit during development, a crash, a manual restart — is an orderly abort of everything that is running:

- the in-flight model request;
- tool execution, including `bash` children that are left orphaned and sub-agent runs;
- queued prompts (`pendingPromptCount` in `isSessionRunningForReplacement()`, `lib/rpc-manager.ts:526`) and streamed deltas that have not been written to the session file;
- extension dialogs waiting for an answer (`pendingUiRequests`);
- extension runtime state that is not persisted: status text, widgets, active custom UIs.

The JSONL transcript survives, so the UI can re-render history, but the tail of the interrupted turn is missing. This is not only a development annoyance: it is what makes "restart the server" and "lose work" the same operation.

Pi already ships the shape needed to avoid this. The SDK exports an `RpcClient`, `@earendil-works/pi-coding-agent` exposes `./rpc-entry`, and `docs/rpc.md` describes RPC mode as the interface for "process isolation, IDEs, and custom clients", with `docs/rpc-extension-ui.md` defining how extension interactions cross that boundary.

## Decision

**The agent owns its session. The web server becomes a client of it.**

### Process and transport

- One process per session, speaking JSONL over a Unix domain socket (`$TMPDIR`-hosted, so no port allocation). Windows falls back to loopback TCP plus a token in the registry record.
- `lib/rpc-manager.ts` stops creating sessions and starts spawning or connecting to them. `POST /api/agent/*`, the SSE route, and the lease endpoint keep their current contracts, so the browser is unchanged.
- The spawner writes a record per session — `{ sessionId, pid, socketPath, startedAt, protocolVersion }` — under `~/.pi/agent/pi-web/agents/`. `proper-lockfile` is already a dependency and covers the concurrent-write case.
- On boot the web server scans that directory, connects to every live socket, and adopts it. Records whose process is gone or whose socket refuses a connection are deleted. Sessions that were mid-turn keep running; sessions that had settled are left to the idle timer, which moves into the agent process.

### What has to cross the boundary

1. **Event replay.** A re-attaching client must learn what it missed. Either every event carries a monotonic sequence number and `attach` accepts `fromSeq`, or `attach` answers with a snapshot of the running turn and then follows live events. Without this, a restarted server re-renders history and then shows a gap.
2. **Liveness.** `hasActiveSessionLivenessProvider` currently asks an in-process `Map`. It becomes "who holds this socket", which is what the existing lease (`SESSION_LIVENESS_LEASE_TTL_MS`, 90 s) was already modelling.
3. **Extension UI.** Dialogs and custom UIs already travel as requests and responses (`pendingUiRequests` / `pendingUiResponses`); RPC mode defines the same pair, so this is a forwarding change rather than a redesign.
4. **Idle timeout.** `PI_WEB_IDLE_TIMEOUT_MS` applies where the session lives. The web server can request a shutdown, but must not be the thing that decides the session is idle.
5. **Orphan reaping.** A web server that dies without telling anyone leaves agents behind. The registry needs a stale sweep (missing pid, or a socket that no longer accepts), and a way to list and stop adopted agents from the UI.

### Bootstrapping the agent process

The child has to run the *same* session setup as `startRpcSession()`: resource loading, project trust, the sub-agent controller, model scope, tool presets, and the chat-only policy. It cannot be `pi --mode rpc` on its own, because that is pi's default setup rather than Pi Web's.

Two ways to get Pi Web's own code into that process:

- **From source, with a TypeScript loader.** `jiti` is already used by the test suite, so a `bin/agent-host.js` that loads `lib/agent-host.ts` through it would work in a checkout. It is currently a dev dependency and would have to be promoted, and it does nothing for the published package, whose `files` list ships only `.next`, `bin`, `public`, and the config.
- **As a build artifact.** Bundle the host entry with esbuild into `bin/agent-host.js` and let `next build` (or a sibling script) produce it. This is the only option that works for `npx @agegr/pi-web`, and it costs one dev dependency and one build step.

Both are needed: source loading is the fast path for development, the artifact is what ships.

### What does not change

The HTTP surface, the SSE payloads, the session files, and the browser. `lib/agent-event-stream.ts`, the lease route, and the session reader keep their roles; only `lib/rpc-manager.ts` changes from owner to client.

## Consequences

- Restarting the web server no longer interrupts a turn. The acceptance test is: start a long turn, `kill` the server, restart it, and watch the turn keep streaming into the page.
- A crashed server is survivable in the same way, which is the more valuable half: today a crash and a restart are the same event.
- The same change makes multiple web servers, or a headless client, able to attach to one agent, which the current design cannot express at all.
- It costs a protocol to version, extension UI to forward, two logs to read when something goes wrong, and orphaned agents to reap. Agents outliving their client is the point, but it is also new operational surface, and the idle timeout becomes the only thing standing between a stray prompt and a process that never exits.
- Session file writes move out of the web server, so `cacheSessionPath`, `invalidateSessionListCache`, and the reader's caches need to follow the agent rather than assume a local `SessionManager`.
