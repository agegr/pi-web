# 0006 — Delegate sub-agents to the user-installed pi-subagents package

## Status

Accepted. Supersedes `0003-built-in-subagent-toggle.md` and
`0005-built-in-subagent-disable.md`.

## Context

Pi Web used to ship its own sub-agent engine: in-process child pi sessions
(`lib/subagent-runtime.ts`), an inline extension registering the tools `Agent`,
`get_subagent_result`, and `steer_subagent` (`lib/subagent-extension.ts`), a run
queue and prompt/input handling (`lib/subagent-queue.ts`, `lib/subagent-prompt.ts`,
`lib/subagent-input.ts`), three built-in profiles (`general-purpose`, `explore`,
`plan`), a feature switch and profile disable list in
`~/.pi/agent/agents/settings.json` (`builtInEnabled`, `disabledBuiltIns`,
`maxConcurrent`), `GET/PUT /api/subagents/settings`, and `POST
/api/subagents/[id]` for steering and aborting a run.

That engine duplicated a package users install themselves: `pi-subagents` is a
standard pi extension that registers its own `subagent` tool and steering/wait
tooling, and it reads and writes the same `~/.pi/agent/agents/*.md` profile
files. Because both implementations claimed the same tool names, Pi Web had to
detect and suppress a recognized `pi-subagents` extension whenever its own
engine was enabled (0003), and even the way a built-in profile was switched off
had to avoid a copied `.md` file that the other runtime would also see (0005).
Two independent implementations therefore had to stay in precedence with each
other, and a user who ran the pi TUI and Pi Web against one agent directory got
whichever engine that surface happened to load.

## Decision

**Pi Web ships no sub-agent engine.** Sub-agent delegation comes only from the
user-installed `pi-subagents` package.

- `pi-subagents` is a **normal pi extension**, not an npm dependency of Pi Web.
  Users install it once through pi's package install (`pi install
  npm:pi-subagents`), and its tools then load with every session like any other
  installed package. Pi Web neither bundles it nor strips, suppresses, or
  otherwise manages it.
- The built-in engine is deleted: `lib/subagent-runtime.ts`,
  `lib/subagent-extension.ts`, `lib/subagent-queue.ts`, `lib/subagent-prompt.ts`,
  `lib/subagent-input.ts`, `lib/subagent-settings.ts`, the built-in profiles, the
  `builtInEnabled` / `disabledBuiltIns` / `maxConcurrent` settings, `GET/PUT
  /api/subagents/settings`, and `POST /api/subagents/[id]` (steer/abort). The
  inline extension factory and its precedence override are removed from
  `lib/rpc-manager.ts`.
- **Legacy session readers stay.** Sessions created by the removed engine carry
  the metadata types `pi-web:subagent`, `pi-web:subagent-status`, and
  `pi-web:subagent-result`. `readSubagentRun()` and
  `readSubagentSessionResources()` in `lib/subagents.ts`, the
  `relation.kind === "subagent"` branch in `lib/session-reader.ts`, and
  `GET /api/subagents/[id]` keep those historical runs rendering in the session
  tree and in `AgentSessionPanel`. Reopening one also restores its persisted
  `resourceSnapshot` policy and exact system prompt; the reserved control tools
  remain excluded from a legacy sub-agent's own tool list so a reopened run
  cannot nest another dispatch.
- **The agent-profile editor stays, shared.** `listSubagentProfileSources()`,
  `saveSubagentProfile()`, `deleteSubagentProfile()`, and
  `GET/PUT/DELETE /api/subagents/profiles` edit `~/.pi/agent/agents/*.md` and
  project `.pi/agents/*.md`. These are the files `pi-subagents` reads, so the
  editor is a shared configuration surface rather than part of an engine. Saves
  round-trip frontmatter keys Pi Web does not own so the other runtime does not
  lose them.

## Consequences

- There is one sub-agent implementation per agent directory, so no precedence
  rule is needed between Pi Web and `pi-subagents`.
- The user installs and updates `pi-subagents` the same way in the TUI and Pi
  Web, and Pi Web inherits its tools and run records without tracking them
  itself.
- **The upgrade is silent for anyone who had delegation on.** A user with
  `builtInEnabled: true` loses delegation the moment they upgrade, because the
  engine is gone; Pi Web neither prompts them nor reports the absence as an
  error. They must run `pi install npm:pi-subagents` to get it back.
- The old `~/.pi/agent/agents/settings.json` is no longer read. It may be
  deleted; leaving it in place has no effect.
- Historical built-in-engine sessions remain readable and their run status still
  resolves; they no longer accept steering or abort through Pi Web, which is why
  only `GET /api/subagents/[id]` survives.
- A user who wants sub-agents must install `pi-subagents`. Pi Web does not offer
  a feature switch for it and does not report its absence as an error.
- Deeper Pi Web integration with `pi-subagents` — live run status and
  steering/abort bridging — is possible later but is not part of this decision.
