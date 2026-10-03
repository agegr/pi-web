import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const {
  addSourceKeySubmits,
  ConfigAddSourcePanel,
  ConfigDetailGrid,
  ConfigDetailGridRow,
  ConfigFooterStatus,
  ConfigNotice,
  ConfigSaveTarget,
  ConfigScopeSwitch,
  ConfigScopeTag,
  ConfigTrustNotice,
} = await jiti.import("./SettingsUi.tsx");

const h = React.createElement;
const render = (element) => renderToStaticMarkup(element);
const noop = () => {};

test("a scope tag shows the caller's label and tints only the project scope", () => {
  assert.equal(render(h(ConfigScopeTag, { scope: "project" }, "项目")), '<span class="config-scope-tag is-project">项目</span>');
  assert.equal(render(h(ConfigScopeTag, { scope: "global" }, "global")), '<span class="config-scope-tag">global</span>');
});

test("a scope switch shows why an option is unavailable as visible text", () => {
  const options = [
    { value: "global", label: "global" },
    { value: "project", label: "project", disabled: true },
  ];
  const html = render(h(ConfigScopeSwitch, {
    value: "global",
    options,
    label: "Scope",
    disabledReason: "Project installs are unavailable",
    onChange: noop,
  }));
  assert.match(html, /role="group" aria-label="Scope" class="config-scope-switch"/);
  assert.match(html, /<button type="button" aria-pressed="true" class="config-scope-switch-option">global<\/button>/);
  const reasonId = html.match(/<span id="([^"]+)" class="config-scope-switch-reason">Project installs are unavailable<\/span>/)?.[1];
  assert.ok(reasonId, "the reason is rendered as text");
  // The disabled option points at the visible reason instead of a tooltip.
  assert.match(html, new RegExp(`aria-pressed="false" aria-describedby="${reasonId}" disabled="" class="config-scope-switch-option">project`));
  assert.doesNotMatch(html, /title=/);
});

test("a scope switch says nothing while every option is available", () => {
  const html = render(h(ConfigScopeSwitch, {
    value: "project",
    size: "small",
    options: [{ value: "global", label: "global" }, { value: "project", label: "project" }],
    label: "Scope",
    disabledReason: "Project installs are unavailable",
    onChange: noop,
  }));
  assert.match(html, /class="config-scope-switch is-small"/);
  assert.doesNotMatch(html, /config-scope-switch-reason|aria-describedby|disabled=/);
});

test("a scope switch keeps the caller's controls on its line and the reason under both", () => {
  const html = render(h(ConfigScopeSwitch, {
    value: "global",
    options: [{ value: "global", label: "global" }, { value: "project", label: "project", disabled: true }],
    label: "Scope",
    disabledReason: "Project installs are unavailable",
    onChange: noop,
  }, h("button", { type: "button" }, "Install")));
  // An Install button inside the switch's own column would sit centered
  // against the switch plus its reason, out of line with the switch.
  assert.match(
    html,
    /^<div class="config-scope-switch-field"><div class="config-scope-switch-row"><div role="group"[^>]*>.*?<\/div><button type="button">Install<\/button><\/div><span id="[^"]+" class="config-scope-switch-reason">Project installs are unavailable<\/span><\/div>$/,
  );
});

test("a save target is the scope switch with the path it writes to, the reason and the caller's lines under both", () => {
  const html = render(h(ConfigSaveTarget, {
    value: "global",
    options: [{ value: "global", label: "global" }, { value: "project", label: "project", disabled: true }],
    label: "Save to",
    path: "~/.pi/agent/mcp.json",
    disabledReason: "Project installs are unavailable",
    onChange: noop,
  }, h("p", null, "Trust project…")));
  assert.match(
    html,
    /^<div class="config-save-target"><div class="config-scope-switch-field"><div class="config-scope-switch-row"><div role="group" aria-label="Save to" class="config-scope-switch is-small">.*?<\/div><span class="config-save-target-path">~\/<wbr\/>\.pi\/<wbr\/>agent\/<wbr\/>mcp\.json<\/span><\/div><span id="[^"]+" class="config-scope-switch-reason">Project installs are unavailable<\/span><\/div><p>Trust project…<\/p><\/div>$/,
  );
  // The path is shown whole, never cut short behind a tooltip; a narrow pane breaks it between folders.
  assert.doesNotMatch(html, /title=/);
  const windows = render(h(ConfigSaveTarget, { value: "global", options: [], label: "Save to", path: "C:\\Users\\me\\mcp.json", onChange: noop }));
  assert.match(windows, /<span class="config-save-target-path">C:\\<wbr\/>Users\\<wbr\/>me\\<wbr\/>mcp\.json<\/span>/);
});

test("a detail grid pairs each label with its value", () => {
  const html = render(h(ConfigDetailGrid, null,
    h(ConfigDetailGridRow, { label: "Status", tone: "plain", style: { color: "red" } }, "loaded"),
    h(ConfigDetailGridRow, { label: "Path", mono: true }, "~/x"),
    h(ConfigDetailGridRow, { label: "Installed path", tone: "error" }, "Not found"),
  ));
  assert.equal(html, [
    '<div class="config-detail-grid">',
    '<div class="config-detail-grid-label">Status</div><div class="config-detail-grid-value" style="color:red">loaded</div>',
    '<div class="config-detail-grid-label">Path</div><div class="config-detail-grid-value is-muted is-mono">~/x</div>',
    '<div class="config-detail-grid-label">Installed path</div><div class="config-detail-grid-value is-error">Not found</div>',
    "</div>",
  ].join(""));
});

test("a footer status with details opens a visible list instead of a tooltip", () => {
  assert.equal(render(h(ConfigFooterStatus, { summary: "3 ext" })), '<span class="config-footer-status-summary">3 ext</span>');
  const html = render(h(ConfigFooterStatus, {
    summary: "2 diagnostics",
    tone: "error",
    details: ["error: a: broken", "warning: b"],
  }));
  assert.match(html, /^<details class="config-footer-status-details"><summary class="config-footer-status-summary is-error">2 diagnostics<\/summary>/);
  assert.match(html, /<ul class="config-footer-status-list"><li>error: a: broken<\/li><li>warning: b<\/li><\/ul>/);
  assert.doesNotMatch(html, /title=/);
});

test("a trust notice offers its button only when the caller can trust the project", () => {
  assert.equal(
    render(h(ConfigTrustNotice, { message: "Project plugins are not loaded." })),
    '<div role="status" class="config-notice">Project plugins are not loaded.</div>',
  );
  // A label without a handler would be a button that does nothing.
  assert.doesNotMatch(render(h(ConfigTrustNotice, { message: "x", trustLabel: "Trust project" })), /<button/);
  const html = render(h(ConfigTrustNotice, { message: "x", trustLabel: "Trust project", onTrust: noop }));
  assert.match(html, /^<div role="status" class="config-notice has-action"><span class="config-notice-text">x<\/span><button type="button" class="config-button config-button-secondary config-button-small">Trust project<\/button><\/div>$/);
  assert.match(render(h(ConfigNotice, { action: h("a", { href: "#" }, "Open") }, "Off")), /class="config-notice has-action"/);
});

test("the add panel lays out the catalog, save target, source box, caller controls and examples", () => {
  const html = render(h(ConfigAddSourcePanel, {
    title: "Add plugin",
    catalogs: [{ href: "https://pi.dev/packages", label: "pi.dev/packages" }],
    target: h("div", { className: "save-target" }, "~/.pi/agent/{npm,git}"),
    inputLabel: "Source",
    inputId: "plugin-source",
    placeholder: "npm:@scope/package",
    value: "",
    canSubmit: false,
    onValueChange: noop,
    onSubmit: noop,
    examplesLabel: "Examples",
    examples: ["npm:a", "git:b"],
    error: "boom",
  }, h("div", { className: "caller-controls" }, "controls")));
  assert.match(html, /<div class="config-detail-title">Add plugin<\/div><span class="config-add-source-catalogs"><a href="https:\/\/pi\.dev\/packages" target="_blank" rel="noopener noreferrer" class="config-add-source-catalog">pi\.dev\/packages<\/a><\/span>/);
  // Where it saves comes first under the title, before the source box.
  assert.match(html, /<\/a><\/span><\/div><div class="save-target">~\/\.pi\/agent\/\{npm,git\}<\/div><\/div><div class="config-field">/);
  assert.match(html, /<span class="config-field-label">Source<\/span><input id="plugin-source" aria-label="Source" class="config-add-source-input" placeholder="npm:@scope\/package" value=""\/>/);
  // The caller's controls sit between the box and the examples.
  assert.match(html, /<\/div><div class="caller-controls">controls<\/div><div class="config-add-source-examples">/);
  assert.match(html, /<div class="config-add-source-examples-label">Examples<\/div>/);
  assert.match(html, /<button type="button" class="config-add-source-example">npm:a<\/button><button type="button" class="config-add-source-example">git:b<\/button>/);
  assert.match(html, /<div role="alert" class="config-add-source-error">boom<\/div>/);
});

test("a labeled example shows what it is beside its text, and the box gets the text alone", async () => {
  const html = render(h(ConfigAddSourcePanel, {
    title: "Add MCP server",
    catalogs: [{ href: "https://mcp.so/", label: "mcp.so" }],
    target: "~/.pi/agent/mcp.json",
    inputLabel: "Server to add",
    placeholder: "",
    value: "",
    canSubmit: false,
    onValueChange: noop,
    onSubmit: noop,
    examplesLabel: "Supported formats",
    examples: [{ label: "Zed settings", value: '{ "context_servers": {} }' }, "plain"],
  }));
  assert.match(html, /<button type="button" class="config-add-source-example has-label"><span class="config-add-source-example-label">Zed settings<\/span><span class="config-add-source-example-value">\{ &quot;context_servers&quot;: \{\} \}<\/span><\/button>/);
  assert.match(html, /<button type="button" class="config-add-source-example">plain<\/button>/);
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("./SettingsUi.tsx", import.meta.url), "utf8");
  assert.match(source, /onClick=\{\(\) => onValueChange\(example\.value\)\}/, "the label never reaches the box");
});

test("the multiline add box is a textarea where Enter adds a line and Cmd/Ctrl+Enter submits", () => {
  const html = render(h(ConfigAddSourcePanel, {
    title: "Add MCP server",
    catalogs: [{ href: "https://mcp.so/", label: "mcp.so" }],
    target: "~/.pi/agent/mcp.json",
    inputLabel: "Server to add",
    inputId: "mcp-add-source",
    placeholder: "https://…",
    value: "npx x",
    canSubmit: true,
    onValueChange: noop,
    onSubmit: noop,
    examplesLabel: "Examples",
    examples: [],
    multiline: true,
  }));
  assert.match(html, /<textarea id="mcp-add-source" aria-label="Server to add" class="config-add-source-input is-multiline" placeholder="https:\/\/…" rows="5" spellCheck="false" autoCapitalize="off" autoCorrect="off">npx x<\/textarea>/);
  assert.doesNotMatch(html, /<input/, "no single-line box beside it");

  const key = (overrides) => ({ key: "Enter", metaKey: false, ctrlKey: false, nativeEvent: { isComposing: false }, keyCode: 13, ...overrides });
  assert.equal(addSourceKeySubmits(key({})), false, "a plain Enter is a line break");
  assert.equal(addSourceKeySubmits(key({ metaKey: true })), true);
  assert.equal(addSourceKeySubmits(key({ ctrlKey: true })), true);
  assert.equal(addSourceKeySubmits(key({ ctrlKey: true, nativeEvent: { isComposing: true } })), false, "an input method picks a candidate");
  assert.equal(addSourceKeySubmits(key({ metaKey: true, keyCode: 229 })), false, "Safari's composing Enter");
  assert.equal(addSourceKeySubmits(key({ key: "a", metaKey: true })), false);
});

test("the single-line add box keeps taking focus, and the multiline one never on a coarse pointer", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("./SettingsUi.tsx", import.meta.url), "utf8");
  const effect = source.slice(source.indexOf("useEffect(() => {\n    if (!multiline)"), source.indexOf("}, [multiline]);"));
  assert.match(effect, /if \(!multiline\) \{\n\s*inputRef\.current\?\.focus\(\);\n\s*return;\n\s*\}/);
  assert.match(effect, /if \(typeof window !== "undefined" && window\.matchMedia\?\.\("\(pointer: coarse\)"\)\.matches\) return;\n\s*textareaRef\.current\?\.focus\(\);/);
  // The textarea submits only through addSourceKeySubmits(), never on a plain Enter.
  assert.match(source, /onKeyDown=\{\(event\) => \{\n\s*if \(!addSourceKeySubmits\(event\)\) return;\n\s*event\.preventDefault\(\);\n\s*if \(canSubmit\) onSubmit\(\);/);
});
