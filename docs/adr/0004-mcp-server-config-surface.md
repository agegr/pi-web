# MCP server config surface and project-trust gating

Pi Web exposes a settings section for MCP servers. It edits the same two files
the `pi` CLI and the `mcp-bridge` extension read:

- `<agentDir>/mcp.json` (global)
- `<cwd>/.pi/mcp.json` (project)

Project entries override global entries with the same name, matching what the
extension resolves at runtime.

## Why the config surface is only the file

Pi has no built-in MCP support; an extension provides the runtime. Pi Web
therefore does not start MCP servers itself. `app/api/mcp/route.ts` only reads
and writes config, and the running session applies changes when the MCP
extension re-reads the file on `session_start`.

That keeps one runtime instead of two. The extension is transport- and
mode-agnostic, so the same servers work in the terminal, in Pi Web, and in any
other host. A server-side MCP implementation in Pi Web would only work inside
this app.

The panel asks the session for `get_tools` to show which `mcp_*` tools are
actually live. That is read-only and reuses existing plumbing; there is
deliberately no "test connection" endpoint, because that would let an HTTP
request spawn an arbitrary command.

## Why project servers are trust-gated

An MCP `command` is spawned as a local process, so a project-level
`mcp.json` is equivalent to letting a repository run code on this machine.

Pi Web already gates project *extensions* behind the project-trust store
(issue #236). That gate covers extension code loading, not config file reads. A
globally installed MCP extension reading `<cwd>/.pi/mcp.json` would therefore
bypass it: cloning a hostile repository and opening it in Pi Web would spawn the
repository's command.

The gate is applied in two places:

- `app/api/mcp/route.ts` refuses to write project-scope config while the project
  is untrusted, so the UI cannot be used to plant a payload either.
- The `mcp-bridge` extension itself skips project-origin servers when
  `ctx.isProjectTrusted()` is false, so an untrusted repository's config stays
  dormant even when the extension is installed globally.

Global config is never gated: the user wrote it, and it does not come from a
repository.

Because the override is resolved per entry, a project entry that overrides a
global server makes that server project-origin and therefore gated. This fails
closed: an untrusted project cannot influence a server, even one the global
config also defines.

## Consequences

- Project MCP servers silently do not start in untrusted projects; the settings
  panel shows a notice and the extension reports a skipped server.
- Users who want a project server must trust the project first, using the same
  decision that already governs project extensions and skills.
- Editing a global server stays available for any project, trusted or not.
