# Project trust in omp-web

## Why omp-web has a trust gate and `omp` does not

The `omp` CLI loads a repository's `.omp/extensions`, `.omp/hooks`, `.omp/tools`
and `.mcp.json` as a matter of course. That is safe by construction: you ran
`omp` inside that repository, which is itself the decision to execute it.

omp-web reaches the same code from a browser tab. Clicking a project in the
sidebar — or having a session for it restored on page load — would otherwise
import and run repository-controlled code on the machine hosting the server,
without anything that reads as consent. So omp-web keeps a trust store that omp
itself has no need for.

## What requires trust

Only resources omp *executes*:

| Kind | Paths |
| --- | --- |
| Extensions | `.omp/extensions`, `.pi/extensions`, `.claude/extensions`, `.agents/extensions` |
| Hooks | the `hooks/` directory under each of those config roots |
| Custom tools | the `tools/` directory under each of those config roots |
| MCP servers | `.mcp.json`, `.omp/.mcp.json`, `.omp/mcp.json`, `.claude/.mcp.json`, `.claude/mcp.json`, `.cursor/mcp.json` |

Skills, rules, prompts and `AGENTS.md` are **not** gated. They are data folded
into the system prompt, not modules the loader imports, and gating them would
break ordinary projects for no gain in execution safety. They remain a prompt-
injection surface, exactly as they are in the CLI.

A project with none of the above never sees a prompt: `requiresTrust` is false
and the session loads on omp's normal path.

## What the gate actually does

When a project needs trust and has not been trusted, omp-web still runs omp's
own discovery, then removes the project-local entries from the result before
handing it to `createAgentSession`:

- `preloadedExtensionPaths` — discovered extensions minus anything under the
  project root
- `preloadedCustomToolPaths` — discovered tools minus anything marked
  `level: "project"` or living under the project root
- `enableMCP: false` — MCP servers are processes omp would spawn from a
  project manifest

User-level extensions and tools in `~/.omp/agent` keep working throughout, so an
untrusted project is a *narrowed* session, not a crippled one.

## Where the decision is stored

`~/.omp/agent/omp-web-trusted-projects.json`, keyed by the project's real path
(symlinks resolved). It is written `0600` through the same atomic-replace helper
used for credentials. Deleting an entry revokes trust; deleting the file revokes
everything.

Trust is granted from the dialog omp-web shows when you open such a project, and
takes effect immediately: granting it invalidates the model cache and destroys
any running session for that working directory so the next one starts with the
project's resources loaded.

## Relationship to the CLI

The store is omp-web's own. Trusting a project in the browser does not change
what `omp` does in a terminal — the CLI already loads everything — and running
`omp` in a project does not mark it trusted for the browser.
