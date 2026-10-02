import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./AgentsConfig.tsx", import.meta.url), "utf8");
const cssSource = await readFile(new URL("../app/settings.css", import.meta.url), "utf8");
const chatInputSource = await readFile(new URL("./ChatInput.tsx", import.meta.url), "utf8");
const modelSelectorSource = await readFile(new URL("./ModelSelector.tsx", import.meta.url), "utf8");

test("keeps same-name profiles selectable by scope and groups writable sources first", () => {
  assert.match(source, /return `\$\{profile\.scope\}:\$\{profile\.name\}`/);
  assert.match(source, /\["project", "global", "workspace"\] as const/);
  assert.match(source, /profile\.scope === scope/);
});

test("uses the shared enabled status treatment", () => {
  assert.match(source, /<ConfigStatusDot active \/>/);
  assert.match(source, /className="is-grow"/);
  assert.match(cssSource, /\.config-sidebar-text\.is-muted \{[\s\S]*?color: var\(--text-dim\)/);
});

test("is a pure agent-profile editor without the built-in engine settings", () => {
  assert.doesNotMatch(source, /\/api\/subagents\/settings/);
  assert.doesNotMatch(source, /builtInEnabled|maxConcurrent|disabledBuiltIns/);
  assert.doesNotMatch(source, /isTogglableScope|agents\.builtInTitle|agents\.builtinPath|scope === "builtin"/);
  assert.doesNotMatch(source, /agents-feature-setting|agents-concurrency-control/);
  assert.doesNotMatch(source, /sendAgentCommand/);
});

test("drops the enable toggle and points at agentOverrides instead", () => {
  assert.doesNotMatch(source, /ConfigSwitch checked=\{draft\.enabled\}/);
  assert.doesNotMatch(source, /update\("enabled"/);
  assert.doesNotMatch(source, /agents\.enable\b|agents\.disable\b/);
  assert.match(source, /t\("agents\.enabledViaSettings"\)/);
});

test("marks profiles shadowed by a higher-precedence source", () => {
  assert.match(source, /isSubagentProfileOverridden\(profile, profiles\)/);
  assert.match(source, /overridden && <span className="agents-overridden-label">\{t\("agents\.overridden"\)\}<\/span>/);
  assert.match(cssSource, /\.agents-overridden-label \{[\s\S]*?white-space: nowrap;/);
});

test("treats global and project profiles as directly editable", () => {
  assert.match(source, /scope === "global" \|\| scope === "project"/);
  assert.match(source, /setMode\(isWritableScope\(profile\.scope\) \? "edit" : "view"\)/);
  assert.match(source, /selected && isWritableScope\(selected\.scope\) && mode === "edit"/);
});

test("offers both writable scopes when creating a profile", () => {
  // In the header, where a saved profile shows its scope tag.
  assert.match(source, /\{creating \? \(\s*<ConfigSaveTarget\s+value=\{targetScope\}/);
  // Both, whatever the folder's trust: profiles are not project resources that wait for it.
  assert.match(source, /\(\["global", "project"\] as const\)\.map\(\(scope\) => \(\{\s*value: scope,\s*label: t\(`agents\.scope\.\$\{scope\}`\),\s*disabled: saving,\s*\}\)\)/);
  assert.doesNotMatch(source, /beginOverride|mode === "override"|agents\.readOnly|agents\.override/);
});

test("uses the shared sidebar action for new profiles", () => {
  assert.match(source, /<ConfigListAction[\s\S]*?active=\{creating\}[\s\S]*?onClick=\{beginCreate\}/);
  assert.match(source, /t\("agents\.new"\)[\s\S]*?<\/ConfigListAction>/);
});

test("sends the selected scope for saves and the source scope for deletes", () => {
  assert.match(source, /JSON\.stringify\(\{ cwd, scope: targetScope, profile: draft \}\)/);
  assert.match(source, /JSON\.stringify\(\{ cwd, scope: selected\.scope, name: selected\.name \}\)/);
});

test("shows a Skills-style path row in editable and readonly modes", () => {
  assert.match(source, /function displayProfilePath\(profile: SubagentProfile, cwd: string\)/);
  assert.match(source, /profile\.scope === "project" \|\| profile\.scope === "workspace"/);
  assert.match(source, /`~\/\.pi\/agent\/agents\/\$\{draft\.name \|\| "\.\.\."\}\.md`/);
  assert.doesNotMatch(source, /agents-readonly-status/);
});

test("authors the pi-subagents schema instead of the removed engine's keys", () => {
  assert.match(source, /toolsInherited/);
  assert.match(source, /systemPromptMode/);
  assert.match(source, /inheritProjectContext/);
  assert.match(source, /inheritGlobalContext/);
  assert.match(source, /inheritSkills/);
  assert.match(source, /subagentOnlyExtensions/);
  assert.match(source, /acceptanceRole/);
  assert.match(source, /allowNestedSubagents/);
  assert.doesNotMatch(source, /loadSkills|loadExtensions|maxTurns|promptMode|inheritContext\b|runInBackground/);
});

test("renders the tool list from the new tools route with raw-entry chips", () => {
  assert.match(source, /fetch\(`\/api\/subagents\/tools\?cwd=\$\{encodeURIComponent\(cwd\)\}`/);
  assert.match(source, /async function readTools\(response: Response \| null\): Promise<ToolOption\[\]>/);
  assert.match(source, /toolOptions\.map\(\(tool\) =>/);
  assert.match(source, /function RawEntries\(/);
  assert.match(source, /const knownToolNames = useMemo\(\(\) => new Set\(toolOptions\.map\(\(tool\) => tool\.name\)\), \[toolOptions\]\)/);
  assert.match(source, /appendRaw\("tools", rawEntry\)/);
  assert.doesNotMatch(source, /const TOOL_OPTIONS = \[/);
});

test("flips the tools checkbox into a strict allowlist off the inherit toggle", () => {
  assert.match(source, /label=\{t\("agents\.toolsInherit"\)\}[\s\S]{0,200}checked=\{draft\.toolsInherited === true\}/);
  assert.match(source, /\{!draft\.toolsInherited && \(/);
  assert.match(source, /t\("agents\.toolsInheritHelp"\)/);
});

test("offers the extensions tri-state control", () => {
  assert.match(source, /value=\{draft\.extensions\?\.kind \?\? "omit"\}/);
  assert.match(source, /updateExtensions\(\{ kind: event\.target\.value as SubagentExtensions\["kind"\] \}\)/);
  assert.match(source, /draft\.extensions\?\.kind === "list"/);
  assert.match(source, /t\("agents\.extensionsOmit"\)/);
  assert.match(source, /t\("agents\.extensionsNone"\)/);
});

test("collapses advanced groups behind a Section disclosure", () => {
  assert.match(source, /function Section\(\{ title, defaultOpen = false, children \}/);
  assert.match(source, /t\("agents\.section\.basics"\)/);
  assert.match(source, /t\("agents\.section\.prompt"\)/);
  assert.match(source, /t\("agents\.section\.tools"\)/);
  assert.match(source, /t\("agents\.section\.context"\)/);
  assert.match(source, /t\("agents\.section\.extensions"\)/);
  assert.match(source, /t\("agents\.section\.launch"\)/);
  assert.match(source, /t\("agents\.section\.extras"\)/);
});

test("nests inheritGlobalContext under inheritProjectContext", () => {
  assert.match(source, /label=\{t\("agents\.inheritGlobalContext"\)\} disabled=\{disabled \|\| !draft\.inheritProjectContext\}/);
});

test("reuses the ChatInput model selector with scoped models", () => {
  assert.match(source, /fetch\(`\/api\/models\?cwd=\$\{encodeURIComponent\(cwd\)\}`/);
  assert.match(source, /import \{ ModelSelector \} from "\.\/ModelSelector"/);
  assert.match(chatInputSource, /import \{ ModelSelector, type ModelSelectorOption \} from "\.\/ModelSelector"/);
  assert.match(source, /<ModelSelector[\s\S]*?options=\{modelSelectorOptions\}[\s\S]*?variant="field"/);
  assert.match(chatInputSource, /<ModelSelector[\s\S]*?options=\{modelOptions\}/);
  assert.match(modelSelectorSource, /filterModelOptions\(sortedOptions, filter\)/);
  assert.match(modelSelectorSource, /modelsByProvider\.map/);
  assert.match(modelSelectorSource, /event\.key !== "Escape" \|\| !open[\s\S]*?event\.preventDefault\(\)[\s\S]*?event\.stopPropagation\(\)/);
  assert.match(source, /agents\.modelUnavailable/);
  assert.doesNotMatch(source, /placeholder="provider\/modelId"/);
});

test("renders the stable agent id as text outside create mode", () => {
  assert.match(source, /creating \? \(\s*<input aria-label=\{t\("agents\.name"\)\}/);
  assert.match(source, /<code style=\{\{ minHeight: 34,[\s\S]*?\{draft\.name\}[\s\S]*?<\/code>/);
  assert.doesNotMatch(source, /disabled=\{disabled \|\| !creating\}/);
});

test("uses the same form controls for editable and readonly profiles", () => {
  assert.match(source, /<input aria-label=\{t\("agents\.displayName"\)\}[\s\S]*?disabled=\{disabled\}/);
  assert.match(source, /<input aria-label=\{t\("agents\.description"\)\}[\s\S]*?disabled=\{disabled\}/);
  assert.match(source, /<textarea className="agents-system-prompt"[\s\S]*?disabled=\{disabled\}/);
  assert.match(source, /<Toggle key=\{tool\.name\}[\s\S]*?disabled=\{disabled\}/);
  assert.match(source, /<select aria-label=\{t\("agents\.thinking"\)\}[\s\S]*?disabled=\{disabled\}/);
  assert.match(source, /<input aria-label=\{t\("agents\.timeoutMs"\)\}[\s\S]*?disabled=\{disabled\}/);
  assert.match(source, /<Toggle label=\{t\("agents\.inheritProjectContext"\)\} disabled=\{disabled\}/);
  assert.match(source, /<Toggle label=\{t\("agents\.background"\)\} disabled=\{disabled\}/);
  assert.doesNotMatch(source, /ReadonlyValue|readonlyPromptStyle|agents-readonly/);
});

test("shows disabled controls with a gray background", () => {
  const disabledStyle = source.match(/const disabledInputStyle: CSSProperties = \{([\s\S]*?)\n\};/)?.[1] ?? "";
  assert.match(source, /<textarea[^>]*aria-label=\{t\("agents\.prompt"\)\}[\s\S]*?disabled=\{disabled\}/);
  assert.match(source, /height: 195,[\s\S]*?minHeight: 195,[\s\S]*?maxHeight: "60vh"[\s\S]*?resize: disabled \? "none" : "vertical"/);
  assert.doesNotMatch(source, /agents-system-prompt[^\n]*fontFamily/);
  assert.match(disabledStyle, /background: "var\(--bg-panel\)"/);
  assert.match(disabledStyle, /color: "var\(--text-dim\)"/);
  assert.match(modelSelectorSource, /background: locked \? "var\(--bg-panel\)" : "var\(--bg\)"/);
});

test("keeps a larger resize corner when system instructions need a scrollbar", () => {
  assert.match(source, /<textarea className="agents-system-prompt" aria-label=\{t\("agents\.prompt"\)\}/);
  assert.match(cssSource, /.agents-system-prompt \{[\s\S]*?scrollbar-width: auto;/);
  assert.match(cssSource, /\.agents-system-prompt::-webkit-scrollbar \{[\s\S]*?width: 14px;[\s\S]*?height: 14px;/);
  assert.match(cssSource, /\.agents-system-prompt::-webkit-scrollbar-thumb \{[\s\S]*?border: 5px solid transparent;/);
});

test("duplicates any selected profile through the existing create flow", () => {
  assert.match(source, /function duplicateProfileName\(name: string, profiles: readonly SubagentProfile\[\]\)/);
  assert.match(source, /while \(existing\.has\(candidate\.toLowerCase\(\)\)\) candidate = `\$\{base\}-\$\{suffix\+\+\}`/);
  assert.match(source, /const beginDuplicate = \(\) =>/);
  assert.match(source, /\.\.\.editableProfile\(selected\),[\s\S]*?name,[\s\S]*?displayName: t\("agents\.copyName"/);
  assert.match(source, /setMode\("create"\)/);
  assert.match(source, /setTargetScope\(isWritableScope\(selected\.scope\) \? selected\.scope : "global"\)/);
  assert.match(source, /onClick=\{beginDuplicate\}[^>]*>[\s\S]*?t\("agents\.duplicate"\)/);
});

test("confirms deletion and limits it to writable profiles", () => {
  assert.match(source, /window\.confirm\(t\("agents\.deleteConfirm", \{ name: selected\.displayName \?\? selected\.name \}\)\)/);
  assert.match(source, /selected && isWritableScope\(selected\.scope\) && mode === "edit"/);
  assert.match(source, /method: "DELETE"/);
});

test("fetches the pi-subagents catalog alongside profiles and falls back silently", () => {
  assert.match(source, /fetch\(`\/api\/subagents\/catalog\?cwd=\$\{encodeURIComponent\(cwd\)\}`/);
  assert.match(source, /await Promise\.all\(\[/);
  assert.match(source, /async function readCatalog\(response: Response \| null\): Promise<AgentCatalogAgent\[\]>/);
  assert.match(source, /if \(!response\?\.ok\) return \[\]/);
  assert.doesNotMatch(source, /setError\([^)]*catalog/i);
});

test("renders read-only catalog rows only for definitions the editor cannot edit", () => {
  assert.match(source, /function catalogOnlyAgents\(/);
  assert.match(source, /const editablePaths = new Set\(profiles\.map\(\(profile\) => profile\.filePath\)\.filter\(Boolean\)\)/);
  assert.match(source, /\["builtin", "package", "user", "project"\] as const/);
  assert.match(source, /t\(sourceLabelKey\(source\)\)/);
  assert.match(source, /<CatalogAgentDetail/);
  assert.match(source, /agent=\{selectedCatalog\}/);
});

test("shows aliases, model, thinking, and disabled/shadowed state for catalog rows", () => {
  assert.match(source, /agent\.aliases\?\.join\(", "\) \?\? t\("agents\.catalog\.none"\)/);
  assert.match(source, /t\("agents\.catalog\.model"\), agent\.model \?\? t\("agents\.inherit"\)/);
  assert.match(source, /t\("agents\.catalog\.thinking"\), agent\.thinking \?\? t\("agents\.inherit"\)/);
  assert.match(source, /agent\.disabled && <span className="agents-catalog-badge">\{t\("agents\.catalog\.disabled"\)\}/);
  assert.match(source, /agent\.overriddenBy && \(/);
  assert.match(source, /t\("agents\.catalog\.overriddenBy", \{ source: t\(sourceLabelKey\(agent\.overriddenBy\)\) \}\)/);
});

test("keeps catalog selection separate from the editable profile selection", () => {
  assert.match(source, /const \[selectedCatalogKey, setSelectedCatalogKey\] = useState<string \| null>\(null\)/);
  assert.match(source, /function catalogKey\(agent: Pick<AgentCatalogAgent, "source" \| "name" \| "filePath">\): string/);
  assert.match(source, /setSelectedKey\(null\);\s*setSelectedCatalogKey\(catalogKey\(agent\)\)/);
  assert.match(source, /setSelectedKey\(profileKey\(profile\)\);\s*setSelectedCatalogKey\(null\)/);
});

test("offers a deny-all descendants affordance for allowedAgents", () => {
  assert.match(source, /t\("agents\.denyAllDescendants"\)/);
  assert.match(source, /checked=\{draft\.allowedAgentsDenyAll === true\}/);
  assert.match(source, /allowedAgentsDenyAll: checked, \.\.\.\(checked \? \{ allowedAgents: \[\] \} : \{\}\)/);
  assert.match(source, /disabled=\{disabled \|\| draft\.allowedAgentsDenyAll === true\}/);
  assert.match(source, /t\("agents\.allowedAgentsHelp"\)/);
});

test("rejects commas in raw tool entries with a validation note", () => {
  assert.match(source, /const appendRaw = \(list: "tools" \| "excludeTools", value: string\) =>/);
  assert.match(source, /if \(entry\.includes\(","\)\) \{/);
  assert.match(source, /setEntryError\(t\("agents\.rawEntryComma"\)\)/);
  assert.match(source, /\{rawEntryError && <span role="alert"/);
  assert.match(source, /\{rawExcludeEntryError && <span role="alert"/);
});

test("resets the raw entry inputs whenever the edited profile changes", () => {
  assert.match(source, /const resetRawEntries = \(\) => \{/);
  assert.match(source, /const selectProfile = \(profile: SubagentProfile\) => \{\s*resetRawEntries\(\);/);
  assert.match(source, /const selectCatalogAgent = \(agent: AgentCatalogAgent\) => \{\s*resetRawEntries\(\);/);
  assert.match(source, /const beginCreate = \(\) => \{\s*resetRawEntries\(\);/);
  assert.match(source, /const beginDuplicate = \(\) => \{\s*if \(!selected\) return;\s*resetRawEntries\(\);/);
  assert.match(source, /setRawEntry\(""\);\s*setRawExcludeEntry\(""\);/);
});

test("renders the allowNestedSubagents toggle with a translated label", () => {
  assert.match(source, /label=\{t\("agents\.allowNestedSubagents"\)\}/);
  assert.match(source, /checked=\{draft\.allowNestedSubagents === true\}/);
});

test("toggles a read-only catalog agent's disabled override through the overrides route", () => {
  assert.match(source, /const toggleCatalogDisabled = async \(agent: AgentCatalogAgent, disabled: boolean\) =>/);
  assert.match(source, /fetch\("\/api\/subagents\/overrides", \{/);
  assert.match(source, /JSON\.stringify\(\{ cwd, name: agent\.name, disabled \}\)/);
  assert.match(source, /method: "PUT"/);
  assert.match(source, /await loadProfiles\(\)/);
  assert.match(source, /onToggleDisabled=\{\(agent, disabled\) => void toggleCatalogDisabled\(agent, disabled\)\}/);
  assert.match(source, /<ConfigSwitch[\s\S]*?checked=\{agent\.disabled === true\}/);
});

test("locks the disable switch only when the user toggle could not undo the disable", () => {
  assert.match(source, /const disableHint = agent\.disabled === true && agent\.disabledSource/);
  assert.match(source, /agent\.disabledSource\.via === "bulk"/);
  assert.match(source, /agents\.catalog\.disableHint\.bulk/);
  assert.match(source, /agents\.catalog\.disableHint\.projectOverride/);
  assert.match(source, /const disableSwitchLocked = disableHint !== null/);
  assert.match(source, /disabled=\{saving \|\| disableSwitchLocked\}/);
  assert.match(source, /\{disableHint && \(/);
  assert.doesNotMatch(source, /projectOverrideWins/);
  assert.doesNotMatch(source, /agents\.catalog\.projectOverrideHint/);
});

test("ejects a read-only catalog agent through the eject route", () => {
  assert.match(source, /const ejectCatalogAgent = async \(agent: AgentCatalogAgent, scope: SubagentWritableScope, name: string\) =>/);
  assert.match(source, /fetch\("\/api\/subagents\/eject", \{/);
  assert.match(source, /JSON\.stringify\(\{ cwd, scope, sourcePath: agent\.filePath, name \}\)/);
  assert.match(source, /await loadProfiles\(profileKey\(data\.profile\)\)/);
  assert.match(source, /onEject=\{\(agent, scope, name\) => void ejectCatalogAgent\(agent, scope, name\)\}/);
  assert.match(source, /t\("agents\.catalog\.duplicateShadowHint"\)/);
  assert.match(source, /onClick=\{\(\) => onEject\(agent, duplicateScope, duplicateName\.trim\(\)\)\}/);
});

test("offers eject only for builtin and package catalog rows", () => {
  assert.match(source, /function isEjectableSource\(source: AgentCatalogSource\): boolean/);
  assert.match(source, /source === "builtin" \|\| source === "package"/);
  assert.match(source, /isEjectableSource\(agent\.source\) && \(/);
});

test("shows a read-only prompt section for catalog rows that carry one", () => {
  assert.match(source, /\{agent\.prompt && \(/);
  assert.match(source, /<Section title=\{t\("agents\.section\.prompt"\)\} defaultOpen>[\s\S]*?value=\{agent\.prompt\}/);
  assert.match(source, /<textarea[\s\S]*?className="agents-system-prompt"[\s\S]*?value=\{agent\.prompt\}[\s\S]*?readOnly[\s\S]*?disabled[\s\S]*?\/>/);
  assert.match(source, /resize: "none"/);
});

test("refreshes the panel on activation and polls quietly while it is visible", () => {
  assert.match(source, /import \{ useAgentsRefresh \} from "@\/hooks\/useAgentsRefresh"/);
  assert.match(source, /useAgentsRefresh\(\{/);
  // The section host keeps the panel mounted while another section is shown, so
  // the panel reports its own visibility instead of trusting a mount.
  assert.match(source, /active = true,/);
  assert.match(source, /busy: saving \|\| loading/);
  assert.match(source, /refresh: \(signal\) => loadProfiles\(undefined, \{ signal, quiet: true \}\)/);
  // A quiet refresh must not flip the panel into its loading state.
  assert.match(source, /if \(!quiet\) \{\s*setLoading\(true\);\s*setError\(null\);/);
  assert.match(source, /const quiet = options\?\.quiet === true/);
});

test("keeps an open draft out of the quiet refresh's way", () => {
  // Dirty detection compares against the loaded draft, not the reloaded file:
  // an external edit must not latch the panel dirty and stop refreshing it.
  assert.match(source, /const pristineDraftRef = useRef<EditableProfile \| null>\(null\)/);
  assert.match(source, /const applyDraft = \(next: EditableProfile\) => \{/);
  assert.match(source, /pristineDraftRef\.current = next;/);
  assert.match(source, /const draftDirty = mode === "create"\s*\|\| \(mode === "edit" && JSON\.stringify\(draft\) !== JSON\.stringify\(pristineDraftRef\.current\)\)/);
  // A quiet load only re-reads the draft when the editor is not open for edits.
  assert.match(source, /if \(currentMode === "view"\) applyDraft\(editableProfile\(current\)\)/);
  assert.match(source, /if \(!currentKey\) return;/);
  // Raw-entry inputs and the create form keep the setDraft state setter.
  assert.match(source, /setDraft\(\(current\) => \(\{\s*\.\.\.current, \[key\]: value \}\)\)/);
});

test("a torn-down poll neither reports an error nor clears the loading state", () => {
  // A quiet poll's failure is the same story: the next tick retries, so neither
  // an abort nor a quiet load may raise the banner.
  assert.match(source, /if \(quiet \|\| options\?\.signal\?\.aborted\) return;/);
  assert.match(source, /if \(!quiet && !options\?\.signal\?\.aborted\) setLoading\(false\)/);
  assert.match(source, /cache: "no-store", signal: options\?\.signal/);
  // A quiet load that succeeds is the recovery from an earlier quiet failure.
  assert.match(source, /if \(quiet\) setError\(null\);/);
});
