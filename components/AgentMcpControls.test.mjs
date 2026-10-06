import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { I18nProvider } = await jiti.import("@/hooks/useI18n.tsx");
const {
  AgentMcpControls, AgentMcpPickerList, agentMcpBlock, agentMcpBulkState,
  filterAgentMcpServers, hasAgentMcpRef, readAgentMcpOverview, selectAgentMcpServers, toggleAgentMcpRef,
} = await jiti.import("./AgentMcpControls.tsx");
const source = await readFile(new URL("./AgentMcpControls.tsx", import.meta.url), "utf8");
const agents = await readFile(new URL("./AgentsConfig.tsx", import.meta.url), "utf8");
const noop = () => {};
const render = (component, props) => renderToStaticMarkup(React.createElement(I18nProvider, null, React.createElement(component, props)));
const ref = (scope, name) => ({ scope, name });
const server = (scope, name, extra = {}) => ({ scope, name, enabled: true, ...extra });
const overview = (servers = [], extra = {}) => ({
  servers, files: [], mcp: { available: true },
  codemode: { sandbox: { state: "not-checked" }, builtinDisabled: false },
  project: { trust: { decision: true } }, ...extra,
});

// Pure profile-reference logic: no files, SDK runtime, server connections or browser.
test("MCP references are exact scope + original name, not namespace or bare name", () => {
  const refs = [ref("global", "a-b"), ref("project", "a-b"), ref("global", "a_b"), ref("global", "__proto__")];
  assert.equal(hasAgentMcpRef(refs, ref("project", "a_b")), false);
  assert.equal(hasAgentMcpRef(refs, ref("global", "A-b")), false);
  assert.equal(hasAgentMcpRef(refs, ref("global", "a-b ")), false);
  assert.equal(hasAgentMcpRef(refs, ref("global", "__proto__")), true);
  assert.deepEqual(toggleAgentMcpRef(refs, ref("project", "a-b"), false), [refs[0], refs[2], refs[3]]);
  const next = toggleAgentMcpRef(refs, { ...ref("project", "same"), namespace: "wrong", sourcePath: "/not-a-resource" }, true);
  assert.deepEqual(next.at(-1), ref("project", "same"));
  assert.equal(refs.length, 4);
});

test("file/trust blocks are visible and not inferred from a connection status", () => {
  const data = overview([]);
  assert.equal(agentMcpBlock(server("global", "disabled", { enabled: false }), data), "mcp.server.disabled");
  assert.equal(agentMcpBlock(server("global", "invalid", { invalidError: "invalid" }), data), "mcp.state.invalid");
  assert.equal(agentMcpBlock(server("global", "secret", { webPasswordField: {} }), data), "mcp.state.web-password");
  assert.equal(agentMcpBlock(server("project", "untrusted"), overview([], { project: { trust: { trusted: true, decision: null } } })), "mcp.stateDetail.not-trusted");
  assert.equal(agentMcpBlock(server("project", "unreadable"), overview([], { project: { trustError: "error" } })), "mcp.stateDetail.not-trusted");
  assert.equal(agentMcpBlock(server("global", "same", { shadowedByProject: true }), data), "mcp.server.shadowedByProject");
  assert.equal(agentMcpBlock(server("global", "same", { shadowedByProject: true }), overview([], { project: undefined })), undefined);
  assert.equal(agentMcpBlock(server("global", "off"), overview([], { mcp: { available: false, reason: "operator-disabled" } })), "mcp.stateDetail.mcp-off");
  assert.equal(agentMcpBlock(server("global", "last-failed", { status: { origin: "test", state: "failed" } }), data), undefined);
});

test("bulk interaction is tri-state, explicit, catalog-wide, and preserves unknown/blocked references", () => {
  const data = overview([server("global", "one"), server("project", "one"), server("global", "disabled", { enabled: false })]);
  const dormant = [ref("global", "missing"), ref("global", "disabled")];
  assert.equal(agentMcpBulkState(dormant, data), "none");
  const partial = toggleAgentMcpRef(dormant, data.servers[0], true);
  assert.equal(agentMcpBulkState(partial, data), "partial");
  const all = selectAgentMcpServers(partial, data);
  assert.equal(agentMcpBulkState(all, data), "all");
  assert.deepEqual(all, [...dormant, ref("global", "one"), ref("project", "one")]);
  assert.deepEqual(selectAgentMcpServers(all, data), all);
  assert.equal(agentMcpBulkState(all, overview([...data.servers, server("project", "later")])), "partial");
  assert.equal(agentMcpBulkState([], overview([])), "none");
  assert.equal(agentMcpBulkState([], overview(data.servers, { mcp: { available: false } })), "none");
  assert.equal(all.some((entry) => typeof entry === "string" || "path" in entry || "identity" in entry), false);
  assert.match(source, /bulk === "all" \? \[\] : selectAgentMcpServers\(refs, overview\)/);
});

test("search uses scope and original names without normalizing or changing the selection", () => {
  const list = [server("global", "a-b"), server("project", "a_b"), server("project", "__proto__")];
  assert.deepEqual(filterAgentMcpServers(list, "GLOBAL"), [list[0]]);
  assert.deepEqual(filterAgentMcpServers(list, "a_b"), [list[1]]);
  assert.deepEqual(filterAgentMcpServers(list, "__proto__"), [list[2]]);
  assert.deepEqual(filterAgentMcpServers(list, " "), list);
});

test("read-only rendering lists both scopes and shows blocked why text, not a tooltip", () => {
  const data = overview([server("global", "same", { enabled: false }), server("project", "same")], { project: { trust: { decision: false } } });
  const html = render(AgentMcpPickerList, { refs: [], overview: data, disabled: true, search: "", onChange: noop });
  assert.equal((html.match(/type="checkbox"/g) ?? []).length, 2);
  assert.equal((html.match(/disabled=""/g) ?? []).length, 2);
  assert.match(html, /config-scope-tag[^\"]*">global/);
  assert.match(html, /config-scope-tag[^\"]*">project/);
  assert.match(html, /Turned off in the file, so it does not connect/);
  assert.match(html, /This project is not trusted, so this server does not connect/);
  assert.doesNotMatch(html, /title=/);
});

test("chosen blocked/unknown servers can only be explicitly unchecked and survive search/load failure", () => {
  const selected = [ref("global", "off"), ref("project", "gone")];
  const data = overview([server("global", "off", { enabled: false })]);
  const html = render(AgentMcpPickerList, { refs: selected, overview: data, disabled: false, search: "", onChange: noop });
  assert.equal((html.match(/checked=""/g) ?? []).length, 2);
  assert.doesNotMatch(html, /disabled=""/);
  assert.match(html, /Not listed; retained, not loaded/);
  const failed = render(AgentMcpPickerList, { refs: selected, overview: null, disabled: false, search: "no-match", onChange: noop });
  assert.match(failed, /off/);
  assert.match(failed, /gone/);
  assert.match(failed, /Selection retained; availability not checked/);
  assert.doesNotMatch(failed, /Not listed/);
  assert.deepEqual(selected, [ref("global", "off"), ref("project", "gone")]);
});

test("hidden characters are revealed only for display and do not change stored names", () => {
  const raw = ref("global", "x\u200by");
  const html = render(AgentMcpPickerList, { refs: [raw], overview: overview([server(raw.scope, raw.name)]), disabled: false, search: "", onChange: noop });
  assert.match(html, /x\\u\{200B\}y/);
  assert.deepEqual(toggleAgentMcpRef([], raw, true), [raw]);
});

test("independent role switches render no list or third tool-search/global-mode control", () => {
  const props = { cwd: "/fixture", trustKey: "trusted", profileKey: "builtin:explore", codeMode: false, loadMcp: false, mcpServers: [], disabled: true,
    onCodeModeChange: noop, onLoadMcpChange: noop, onServersChange: noop };
  const html = render(AgentMcpControls, props);
  assert.equal((html.match(/role="switch"/g) ?? []).length, 2);
  assert.equal((html.match(/class="agents-resources-grid"/g) ?? []).length, 1);
  assert.equal((html.match(/class="agents-resource-summary"/g) ?? []).length, 2);
  assert.match(html, /Code mode/);
  assert.match(html, /MCP/);
  assert.match(html, /None/);
  assert.match(html, /Choose/);
  assert.doesNotMatch(html, /role="dialog"|<select|type="checkbox"|tool-search|Automatic|Always on/);
  const dormant = render(AgentMcpControls, { ...props, disabled: false, codeMode: true, mcpServers: [ref("project", "same")] });
  assert.match(dormant, /1 selected/);
  assert.match(dormant, /Selections retained while MCP is off/);
  assert.match(source, /size="small" disabled=\{disabled\} aria-haspopup="dialog"/);
  assert.doesNotMatch(source, /onServersChange[^\n]*onLoadMcpChange/);
  assert.match(agents, /<Field label=\{t\("agents\.resources"\)\}>\s*<AgentResourceControls[\s\S]*?<AgentMcpControls[\s\S]*?<\/Field>/);
  assert.match(agents, /onLoadMcpChange=\{\(value\) => update\("loadMcp", value\)\}/);
  assert.doesNotMatch(agents, /onLoadMcpChange[^\n]*mcpServers/);
});

test("overview GET is masked files-only, demand-loaded, bounded and race guarded", async () => {
  const previous = globalThis.fetch;
  const calls = [];
  const data = overview([server("global", "kept")]);
  try {
    globalThis.fetch = async (url, options) => { calls.push({ url, options }); return { ok: true, json: async () => data }; };
    const controller = new AbortController();
    assert.deepEqual(await readAgentMcpOverview("/fixture with spaces", controller.signal), data);
    assert.equal(calls[0].url, "/api/mcp?cwd=%2Ffixture%20with%20spaces");
    assert.equal(calls[0].options.cache, "no-store");
    assert.equal(calls[0].options.signal, controller.signal);
    assert.equal(calls[0].options.method, undefined);
    let finish;
    globalThis.fetch = async () => ({ ok: true, json: () => new Promise((resolve) => { finish = resolve; }) });
    const pending = readAgentMcpOverview("/old-cwd", controller.signal);
    await Promise.resolve();
    controller.abort();
    finish(data);
    assert.equal(await pending, null, "late response ignoring abort cannot publish");
    globalThis.fetch = async () => ({ ok: false, status: 500, json: async () => ({ error: "fixture failure" }) });
    await assert.rejects(readAgentMcpOverview("/fixture", new AbortController().signal), /fixture failure/);
  } finally { globalThis.fetch = previous; }
  assert.match(source, /if \(!needed\) return/);
  assert.match(source, /const needed = open \|\| codeMode \|\| loadMcp/);
  assert.match(source, /listing\?\.context === context && listing\.refresh === refresh/);
  assert.match(source, /if \(data && !controller\.signal\.aborted\) setListing/);
  assert.match(source, /clearTimeout\(timer\); controller\.abort\(\)/);
  assert.match(source, /15000/);
  assert.doesNotMatch(source, /method: "(?:POST|PUT|PATCH|DELETE)"|\/api\/mcp\/test|sign-in|sign-out|\/api\/tools\/settings|createDefaultTransport|SubagentResourceItem/);
});

test("picker reuses the resource DOM policy and gates old panels before effects, without resize refocus", () => {
  assert.match(source, /resourcePickerLayout\(trigger\.getBoundingClientRect\(\),/);
  assert.match(source, /offsetTop: viewport\?\.offsetTop, offsetLeft: viewport\?\.offsetLeft/);
  assert.match(source, /bindResourcePickerDismissal\(document, panelRef\.current, trigger,/);
  assert.match(source, /openResourcePickerDialog\(document, \(\) => closeResourcePicker\(trigger,/);
  assert.match(source, /observeResourcePickerVisibility\(window, trigger,/);
  assert.match(source, /const open = pickerFor === pickerContext && !disabled;/);
  assert.match(source, /JSON\.stringify\(\[context, profileKey, disabled, loadMcp\]\)/);
  assert.match(source, /setPickerFor\(null\); \}, \[pickerContext\]/);
  assert.equal((source.match(/openResourcePickerDialog\(/g) ?? []).length, 1);
  assert.doesNotMatch(source, /preventDefault\(|\.focus\(|onKeyDown=/);
  // Native keyboard/coarse-pointer/visibility details are unit-tested in AgentResourceControls.test.mjs.
  // These source wiring checks and SSR are not real DOM or browser acceptance.
});
