# 0005 — A built-in sub-agent is switched off in settings, not copied to a file

## Status

Accepted.

## Context

Pi Web ships three built-in profiles (`general-purpose`, `explore`, `plan`) as
constants in `lib/subagents.ts`. Everything else about a profile lives in a
markdown file — `~/.pi/agent/agents/*.md`, `.agents/agents/*.md`, or
`.pi/agents/*.md` — whose `enabled: false` frontmatter key switches it off.

A built-in has no such file, so the Agents panel rendered its switch disabled
along with the rest of the form, and the only way to turn one off was to write a
same-name file that shadows it (`#874`). That works, but it costs far more than
the user asked for:

- the override is a **full copy** of the built-in's system prompt, frozen at the
  version it was copied from, so later improvements to that prompt never reach
  the user, and nothing in the file says it was ever a copy;
- the panel's `Duplicate` button renames (`explore` → `explore-copy`), so it
  does not produce an override at all — the user has to know to rename it back;
- "I want one fewer agent in the list" ends as a file on disk that another
  runtime reading the same directory (pi-subagents) now also sees.

## Decision

**The off state of a built-in is a name in
`~/.pi/agent/agents/settings.json`**, the file that already holds
`builtInEnabled` and `maxConcurrent`:

```json
{ "version": 1, "builtInEnabled": true, "disabledBuiltIns": ["explore"] }
```

- `builtInProfiles()` in `lib/subagents.ts` stamps `enabled` onto the constants
  from that list; both `listSubagentProfiles` and `listSubagentProfileSources`
  go through it, so the panel, the `Agent` tool description, and the spawn guard
  in `resolveSubagentProfile` all agree without a second code path.
- **Every write is a minimal edit of the stored list**, like the `enabledModels`
  toggles of ADR 0004. Names this call did not touch keep their position and
  their spelling, including a name no built-in claims — that usually means the
  file was written by a newer build, and dropping it would silently re-enable an
  agent on the next launch of that build. The server stores the built-in's own
  spelling and matches case-insensitively, the way profile names are compared
  everywhere else.
- **Reading the list fails open**, unlike `isBuiltInSubagentsEnabled`, which
  fails closed. A damaged settings file must not make the built-in profiles
  disappear from the panel, and the feature switch in the same file has already
  failed closed by then, so nothing can be dispatched regardless.
- `PATCH /api/subagents/profiles` accepts `scope: "builtin"` and routes it to
  that setting; `PUT` and `DELETE` still refuse the scope, because there is no
  file to write or remove. The route answers with the built-in profile carrying
  its new `enabled`, so the panel updates the row it already has.
- **A same-name file still replaces the built-in outright, its own `enabled`
  included.** `disabledBuiltIns` describes the built-in, not the name: an
  override is a profile in its own right and is switched off through its own
  frontmatter.

**A built-in remains deliberately uneditable in place.** Only the switch gained
somewhere to write; the name, prompt, tools and model of a built-in are changed
by saving a same-name profile that shadows it, which is the supported path and
not a workaround for a missing feature. An editable form would have to persist
the result as a full copy of the profile, frozen at the version it was copied
from — the cost this decision exists to avoid — so the switch is the only
control a built-in gets.

## Consequences

- Disabling a built-in leaves no `.md` file, so pi-subagents and any other
  runtime reading those directories are unaffected, and the built-in's prompt
  keeps tracking the version Pi Web ships.
- A running session keeps the `Agent` tool description it was created with, so a
  disabled built-in is still advertised there until the session reloads. It
  cannot be started: `resolveSubagentProfile` re-reads the setting and rejects
  the call, exactly as it does for a file profile switched off mid-session, so
  the panel does not ask for a reload for this switch the way `builtInEnabled`
  does.
- `readSubagentSettings()` now reports `disabledBuiltIns`. `maxConcurrent`
  remains non-enumerable on that object; the new field does not.
