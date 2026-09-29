# 0004 — Model switches edit `enabledModels` with minimal pattern edits

## Status

Accepted.

## Context

pi narrows the model selector with the global `enabledModels` setting, a
whitelist of `--models` patterns: minimatch globs against `provider/modelId`,
fuzzy matching for non-glob patterns, and an optional `:thinkingLevel` suffix.
pi-web already *read* it (`lib/model-scope.ts`) but offered no way to change it,
so a user had to drop to the TUI's `/scoped-models` or hand-edit
`~/.pi/agent/settings.json`.

`/scoped-models` keeps an in-memory `string[] | null` (`null` = everything
enabled) and, on Ctrl+S, writes back **the fully expanded list of model ids it
can currently see**, or removes the key when everything is enabled.

Two properties of that approach make it wrong for pi-web:

1. `ModelRuntime.getAvailable()` only returns models of providers with
   configured auth. Rewriting the whole list while the user is signed out of a
   provider silently deletes every entry they had for it.
2. It flattens hand-written globs (`anthropic/*` becomes dozens of ids) and
   drops `:level` pins, because the id list cannot carry them.

A whitelist also has an awkward degenerate case: pi falls back to *all* models
when the patterns resolve to nothing, so "disable everything" silently means
"enable everything".

## Decision

**Every toggle is a minimal edit of the existing pattern list**
(`lib/enabled-models.ts`, pure; `lib/enabled-models-runtime.ts`, SDK adapter):

- A pattern matching no available model is never touched. "Available" means the
  model's provider passed `checkAuth()` — a credential in `auth.json`, a
  runtime key, a models.json `apiKey`, or an environment variable — so an entry
  can stop matching because that credential is gone, because the model was
  renamed or deleted, or because it was written on another machine. None of
  those is a reason to drop it.
- Switching a model off expands **only** the patterns that cover it, in place,
  into explicit `provider/modelId` entries that keep the original `:level`
  suffix; a pattern that matched only that model is dropped.
- Switching a model on appends `provider/modelId` at the end.
- **Every write normalizes fully enabled providers**, not just the edited one:
  two or more entries covering all of a provider's models collapse into its
  glob, at the first slot they occupied. pi refreshes provider catalogs from the
  network into `models-store.json`, so an enumerated list rots — deepseek
  renamed `deepseek-v4-flash` to `deepseek-flash`, leaving dead entries behind
  while the new model stayed off, although the user had asked for the whole
  provider. A glob heals itself. Skipped when a pin is involved (a glob cannot
  carry one), when a wider pattern already covers the provider, and for a lone
  exact reference, which is a deliberate pick rather than an enumeration.
- The first edit against an unscoped setting materializes one provider glob per
  provider instead of enumerating the catalog, so models added later stay
  enabled.
- **A provider glob is verified, never assumed.** pi matches with minimatch,
  whose `*` does not cross `/`, so `commandcode/*` matches `commandcode/gpt-5.5`
  but not `commandcode/sakana/fugu-ultra`. `resolveProviderGlobs()` resolves
  `provider/*`, then `provider/**`, and keeps the first whose match set is
  exactly that provider's models; a provider neither covers is written model by
  model. Assuming the glob made "Enable all" store `commandcode/*` and report
  15 of 71 models enabled, because the collapse replaced the 56 explicit entries
  it had just added.
- The key is removed once nothing is narrowed any more, but only when that
  discards neither a stale pattern nor a pin.
- `prune` is the one operation that deletes unmatched entries. Every other one
  preserves them because an entry usually goes unmatched for a reversible
  reason; a provider that renamed its models is not reversible, so the panel
  offers this explicitly instead of making the user clear the whole scope.
- `resync` runs after a models.json save, because a pattern's meaning depends
  on the catalog that just moved. It rewrites renamed models and providers, cuts
  back entries whose provider prefix no longer scopes them, and re-asserts the
  providers the panel saw fully enabled before the save. pi matches patterns
  against the bare `modelId` too, so `stepfun/*` also matches `commandcode`'s
  model `stepfun/Step-5-Preview`: renaming a provider to `stepfun` turned its
  glob into a cross-provider one, silently enabling three `commandcode` models,
  and switching stepfun off then wrote them out. Renaming a *model* to an id
  with a slash is the mirror image — `provider/*` stops covering it, so a fully
  enabled provider quietly loses a model. A verified glob is only verified for
  the catalog it was written against.
- A rename made in the panel is a known move, so its entry travels instead of
  being preserved as a mismatch: renaming the one enabled model used to leave
  a dead entry, and with the list then resolving to nothing, pi enabled every
  model. Model references are rewritten before provider ids, since they still
  spell the provider the settings file knows. The panel mirrors the draft's
  array moves to tell a rename from an add or a delete rather than guessing
  from a diff.
- Repair is confined to `resync`. An ordinary toggle stays a minimal edit and
  never rewrites an entry the user did not touch, even one that over-matches by
  hand.
- Entry order is preserved: it is pi's model cycling order and the fallback for
  the initial model of a new session.

**The last enabled model cannot be switched off.** The server answers `409
{ reason: "last-model" }` and the UI locks that switch, because an empty scope
would read as no scope at all.

**The browser never composes patterns.** `/api/models/enabled` takes intents
(`{op:"models"|"provider"|"clear"}`) and returns the resolved view. Pattern
semantics exist only in the SDK resolver; duplicating them in client code is the
bug `lib/model-scope.ts` already warns about (#307).

**Built-in providers get per-model switches, custom providers a single
switch.** "Built-in" means pi's own providers plus anything an extension
registered — both own their model lists, so `enabledModels` is the only way to
hide one of their models. A models.json provider can simply have the model
deleted, so it is switched as a whole.

**Provider-level control is two buttons above a list, and one switch without
one.** With per-model rows underneath, a header switch would have to answer
"what happens when 12 of 40 are on"; `Enable all` / `Disable all` each have one
meaning, the `12/40` readout carries the state, the filter turns them into
`Enable shown` / `Disable shown`, and a partial state produced by
`/scoped-models` is displayed honestly instead of being forced into a binary
control. A models.json provider has no rows, so there both buttons only ever
sent the same provider-wide write and one switch says it with half the
controls. It lives in that provider's detail header next to Delete, where the
panel's other provider-wide actions are, and the sidebar's `1/2` badge carries
the count. That switch is on only when every model of the provider is on: a
partial state then reads as off and one click completes it. Reading it as "any
enabled" instead would leave partial unreachable in both directions whenever
the last-enabled-model guard blocks the way down.

**Chrome is a tooltip.** Why a switch cannot move, and why a models.json
provider is missing from the runtime, are one-line facts a user needs only when
they hit them, so they ride on `title` instead of a paragraph under the
control. The banner says
`~/.pi/agent/settings.json · enabledModels 20/104`: naming the file and the key
is shorter than a sentence about limiting the selector, and it answers the
question the sentence did not — where the panel just wrote. The path comes from
the route (`settingsPath`), because only the server knows the agent directory
and whether a project file shadows it, and it is the part that truncates: the
key and the counts never shrink.

## Consequences

- `/scoped-models` and the panel stay compatible both ways. The TUI reads the
  globs pi-web writes; pi-web reads (and minimally edits) the expanded lists the
  TUI writes. Pressing Ctrl+S in the TUI still flattens globs — that is the
  TUI's behavior, not something pi-web can prevent.
- Writes go to the global settings file only, like the TUI. When a project
  `.pi/settings.json` sets `enabledModels` it replaces the global array
  entirely, so the API reports `scope: "project"`, refuses writes, and the panel
  renders the switches read-only with an explanation.
- `enabledModels` is re-read per request through `SettingsManager`, which merges
  just that field into the current file contents under pi's own lock, so a
  concurrent TUI write of other settings is never clobbered. Panel edits are
  serialized client-side because each one is a read-modify-write of the same
  field.
- Running sessions keep the `scopedModels` they were created with; new sessions
  and the selector pick up the change after `invalidateModelsCache()` and the
  refresh `AppShell` triggers when the settings panel closes.
- pi-web never *creates* a `:thinkingLevel` pin. It preserves the ones it finds
  and shows them as a read-only badge.
- The switches live inside the models.json editor, so a save under them changes
  what they describe. Saving re-reads the view, and the section takes a `custom`
  flag so a models.json provider the runtime does not know yet — unsaved, empty,
  or with a key that does not work — is not reported as a missing sign-in.
