# Subagent resource selections

Subagent profiles use the existing YAML aliases and SDK resource loader. Selections control resource loading and tool authorization; they are **not a filesystem or extension-JavaScript sandbox**.

## Profile and API contract

- `skills` and `extensions` accept booleans, CSV strings or string arrays in profile YAML. API responses normalize them to `boolean | string[]`; legacy clients sending only `loadSkills` / `loadExtensions` still work. `load_*: false` closes a resource dimension; `true` does not erase an existing whitelist. Unedited aliases and foreign frontmatter survive saves.
- `true` selects SDK-enabled resources, `false` selects none, and arrays select concrete files or unambiguous names. `*` may coexist with explicit entries. Unknown or ambiguous selections never fall back to All. Explicit paths may select a normally disabled discovered entry, but extensions must be files and skills must be Markdown files, not directories or package specifications.
- `GET /api/subagents/resources?cwd=<allowed cwd>` returns `{skills, extensions, diagnostics}`. Items include concrete `path`, canonical `identity`, matching `names` / `pathAliases`, `enabled` and SDK source `metadata`. Listing creates no session or model runtime, imports no extension and installs nothing.
- Profile PUT accepts optional `cloneFrom: {scope, name}`. The source is resolved server-side; cloning preserves foreign frontmatter and extension tool selectors and refuses an existing target with 409. Enabled PATCH updates only that flag. The writer derives the target path; client `filePath` is never a write target.

## Static discovery and restricted loading

`lib/subagent-resource-catalog.ts` reuses public `DefaultPackageManager.resolve`, installed package paths and `loadSkills`. Missing-package checks also work offline, where the SDK skips `onMissing`. Readiness checks use local manifests and SDK paths; no installation or remote version query is attempted. Static inspection excludes project `npmCommand` and other non-resource overrides. Legacy local npm-location queries can use the trusted host/global command only.

`lib/subagent-resources.ts` preserves the original cwd, agentDir, model runtime and session manager boundaries:

- All/All keeps the normal SDK loader. Restricted selections use scope-separated `SettingsManager.fromStorage`, with packages/extensions/skills/prompts/themes cleared on every storage read and write. Setters and flush remain memory-only. Explicit reload refreshes non-resource source settings while retaining transient overrides; resource and tool permissions remain frozen. Storage observes serialized changes, not setter intent: a no-op setter does not pin a baseline value. Arrays are atomic; changed/deleted nested leaves remain local overrides.
- Restricted extensions use `noExtensions: true` plus approved canonical `additionalExtensionPaths`. Filtering happens **before import**, not after executing excluded factories. Skills use `noSkills`, explicit paths and `skillsOverride`.
- Loaded entries regain their SDK source metadata, including tool/command metadata, so existing `ext:` selectors still work. Tool selectors grant execution, not extension loading.
- Creation, restore and reload consult actual project trust. Project ownership includes discovered scope, canonical containment and selected symlink aliases. Explicit project extension files outside normal discovery require a genuine trust decision; no manager is artificially marked trusted.
- Auto-discovered project skills wait for SDK trust. Explicit static Markdown selection is separate from executable project resources. Dynamic skills in Selected mode require both approved canonical identity and effective SDK name; a same-name foreign skill is not admitted. Restricted subagents do not discover additional prompts/themes.

## Snapshots and late-registered tools

New children persist `resourceSnapshot` v2 with the resource selections, prompt, frozen builtin tools and `{mode, selectors, deny}` extension tool policy. Deny wins. Cold restoration does not reread the current profile or widen shell permissions. Invalid or missing snapshots on identified subagents fail closed. V1 keeps its original hard tool allowlist and is not migrated.

SDK 1.0 treats `options.tools` as a permanent allowlist, so it cannot admit approved tools registered later during `session_start`. V2 instead uses `noTools: "builtin"`, excludes unauthorized builtins/reserved control names and applies a shared authorization predicate to the actual registration winner and approved extension roster. Direct and nested `tool_call` execution both pass that guard; inactive deferred tools are still nested-callable, so active pruning alone is insufficient.

The wrapper reconciles unauthorized active tools after its single bind, after both reload paths and before public tool/state reads. Binding includes `resources_discover`, which occurs after `session_start`. Reconciliation removes names only; it never force-activates optional tools. Delegated prompts wait for readiness, check cancellation again before starting, and handle queued startup failures without leaving rejected promises unobserved. They use the wrapper's complete prompt/admission/Stop boundary rather than calling the SDK prompt directly; Stop during extension UI is reset before a resumed prompt, without rebinding.

**SDK limitation:** there is no public registration-policy hook. Denied tools may remain in `getAllTools()` or briefly become active between boundaries, but execution is guarded. This is not hard registry filtering or a sandbox for trusted extension JavaScript. No private registry mutation or duplicate bind is used.

## Resource picker UI

Settings › Sub-agents uses shared `SettingsUi` blocks and the existing profile draft/Save flow. Built-in profiles remain read-only. Each resource row shows All enabled, Disabled or a selected count, with a Choose button and visible unknown/ambiguous warnings; there is no mode dropdown or always-expanded list.

- One checkbox picker opens beside the current button. Search filters the view, not the selection. Source/path details expand on demand, and packaged skills keep their effective SDK names.
- The header has one tri-state bulk toggle. Selecting all writes explicit paths for the complete enabled catalog, preserving unknown/ambiguous entries; clearing writes `false`. It never converts a complete list into future-enabled `true`/`*`. Loading, unavailable and read-only catalogs disable bulk editing.
- Unchecking one item from All or `*` narrows the draft to explicit current entries. Opening, searching, retrying and closing never change or save the draft.
- Escape and the close button restore the visible current trigger. Outside interaction, native Tab leaving the picker, hidden sections, offscreen anchors and profile/cwd/trust changes close without stealing focus. Both summary buttons remain available for one-click kind switching.
- Fixed positioning uses layout-viewport coordinates and clamps to the visual viewport, including its offsets. It flips above near the lower edge. Initial focus follows the pointer type: search for a fine pointer, panel for a coarse pointer; viewport resize does not refocus the picker.

Component tests cover draft and matching rules, bulk scope, dismissal, positioning and focus policy. Browser acceptance uses isolated catalogs and in-memory storage; no real profile write is needed.

## Regression coverage

- Resource integration tests use temporary HOME/agentDir/cwd and separate module/factory markers to verify pre-import exclusion, scope preservation, trust transitions, dynamic skills and cold restoration. Rejecting npm fixtures prohibit installation and remote commands.
- Tool-policy integration tests use delayed mock registration and canned in-process provider responses to exercise direct/nested authorization, actual collision winners, readiness, reload, legacy snapshots and strict parsing.
- Controller regressions cover cancellation during readiness and queued startup rejection. Route/profile tests cover clone conflicts and foreign frontmatter round-tripping.
- All fixtures are local and isolated; they require no real browser extension, provider request or MCP connection.
