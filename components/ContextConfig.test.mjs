import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { I18nProvider } = await jiti.import("@/hooks/useI18n.tsx");
const { ContextConfigView, contextEntryName, contextRowBlockKey } = await jiti.import("./ContextConfig.tsx");
const { pickContextFile, contextFailureText, CONTEXT_REFUSAL_KEYS, loadContextFiles, saveContextFile } = await jiti.import("./context-config-helpers.ts");

const source = await readFile(new URL("./ContextConfig.tsx", import.meta.url), "utf8");
const helperSource = await readFile(new URL("./context-config-helpers.ts", import.meta.url), "utf8");
const panelSource = await readFile(new URL("./SettingsPanel.tsx", import.meta.url), "utf8");
const cssSource = await readFile(new URL("../app/settings.css", import.meta.url), "utf8");
const enSource = await readFile(new URL("../lib/i18n/messages/en.ts", import.meta.url), "utf8");
const zhSource = await readFile(new URL("../lib/i18n/messages/zh-CN.ts", import.meta.url), "utf8");
const twSource = await readFile(new URL("../lib/i18n/messages/zh-TW.ts", import.meta.url), "utf8");
const navigationSource = await readFile(new URL("../lib/settings-navigation.ts", import.meta.url), "utf8");

/** The hook's own `refresh`, taken from the source: state writes cannot be driven from a render. */
const configSourceFile = ts.createSourceFile("ContextConfig.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function callback(name) {
  let found;
  const visit = (node) => {
    if (found) return;
    if (
      ts.isVariableDeclaration(node)
      && node.name.getText(configSourceFile) === name
      && node.initializer
      && ts.isCallExpression(node.initializer)
      && node.initializer.expression.getText(configSourceFile) === "useCallback"
    ) {
      found = node.initializer.arguments[0];
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(configSourceFile);
  assert.ok(found, `useCallback ${name} not found`);
  const js = ts.transpileModule(`(${found.getText(configSourceFile)})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText.trim().replace(/;$/, "");
  // The callback's free variables are the hook's state; `with` resolves them from the scope.
  return new Function("scope", `with (scope) { return ${js}; }`);
}

const h = React.createElement;

function render(element) {
  return renderToStaticMarkup(h(I18nProvider, null, element));
}

function decode(html) {
  return html.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

function text(html) {
  return decode(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

const AGENT_DIR = "/Users/me/.pi/agent";
const CWD = "/Users/me/repo";

function file(overrides = {}) {
  return {
    id: "agents-global",
    scope: "global",
    deletable: false,
    path: `${AGENT_DIR}/AGENTS.md`,
    exists: true,
    effective: true,
    content: "# Instructions\n",
    sizeBytes: 15,
    truncated: false,
    ...overrides,
  };
}

/** All seven entries, with the local ones on a project. */
function listing(overrides = {}) {
  const byId = new Map((overrides.files ?? []).map((entry) => [entry.id, entry]));
  const base = [
    file({ id: "agents-global", scope: "global", path: `${AGENT_DIR}/AGENTS.md` }),
    file({ id: "system-global", scope: "global", path: `${AGENT_DIR}/SYSTEM.md`, exists: false, content: "", sizeBytes: 0 }),
    file({ id: "append-system-global", scope: "global", path: `${AGENT_DIR}/APPEND_SYSTEM.md`, exists: false, content: "", sizeBytes: 0 }),
    file({ id: "agents-local", scope: "local", path: `${CWD}/AGENTS.md`, content: "# Project\n" }),
    file({ id: "system-local", scope: "local", path: `${CWD}/.pi/SYSTEM.md`, exists: false, content: "", sizeBytes: 0 }),
    file({ id: "append-system-local", scope: "local", path: `${CWD}/.pi/APPEND_SYSTEM.md`, exists: false, content: "", sizeBytes: 0 }),
    file({ id: "agents-override-local", scope: "local", deletable: true, path: `${CWD}/AGENTS.override.md`, exists: false, content: "", sizeBytes: 0 }),
  ];
  return {
    ok: true,
    data: { agentDir: AGENT_DIR, cwd: CWD, maxBytes: 256 * 1024, files: base.map((entry) => ({ ...entry, ...byId.get(entry.id) })) },
    ...overrides.view,
  };
}

function view(props = {}) {
  const { load = listing(), ...rest } = props;
  return render(h(ContextConfigView, {
    cwd: CWD,
    embedded: true,
    load,
    selected: "agents-global",
    drafts: {},
    saving: null,
    saveError: null,
    onSelect: () => {},
    onDraftChange: () => {},
    onSave: () => {},
    onRefresh: () => {},
    onClose: () => {},
    ...rest,
  }));
}

test("no project: the local entries are listed, unavailable, and the card says why", () => {
  const withoutProject = listing({
    files: [
      { id: "agents-local", path: null, exists: false, content: "", sizeBytes: 0 },
      { id: "system-local", path: null, exists: false, content: "", sizeBytes: 0 },
      { id: "append-system-local", path: null, exists: false, content: "", sizeBytes: 0 },
      { id: "agents-override-local", path: null, exists: false, content: "", sizeBytes: 0 },
    ],
  });
  withoutProject.data = { ...withoutProject.data, cwd: null };

  const html = decode(view({ cwd: null, load: withoutProject }));
  assert.match(text(html), /Open a project to edit its context files\./);
  assert.match(text(html), /Global \(agent directory\)/, "the global group is listed");
  assert.match(text(html), /Project/, "the local group keeps its place");
  assert.equal((html.match(/<button[^>]*disabled=""[^>]*aria-label="AGENTS\.md: Open a project to edit this file\."/g) ?? []).length, 1,
    "a local row is disabled while it has no project");
  // The agent directory's own file stays editable without a project.
  assert.match(text(html), /AGENTS\.md/);
  assert.doesNotMatch(html, /context-editor-.* disabled/);
  assert.match(source, /context\.block\.noProject/);
});

test("shows the resolved path, the discovered file name, and the precedence of each entry", () => {
  const shadowed = listing({
    files: [
      { id: "system-global", path: `${AGENT_DIR}/SYSTEM.md`, exists: true, effective: false, shadowedBy: `${CWD}/.pi/SYSTEM.md`, content: "global\n", sizeBytes: 7 },
      { id: "system-local", path: `${CWD}/.pi/SYSTEM.md`, exists: true, content: "project\n", sizeBytes: 8 },
    ],
  });

  const global = text(view({ load: shadowed, selected: "system-global" }));
  assert.match(global, /\/Users\/me\/\.pi\/agent\/SYSTEM\.md/);
  // The precedence line names the winner as the Path row shows it (display-only shortening).
  assert.match(global, /Pi loads ~\/repo\/\.pi\/SYSTEM\.md instead: files of the same name are not combined\./);
  assert.match(global, /Absolute path \/Users\/me\/\.pi\/agent\/SYSTEM\.md/);
  assert.match(global, /Replaces Pi's default system prompt\./);

  const local = text(view({ load: shadowed, selected: "system-local" }));
  assert.match(local, /Pi loads this file\./);
  assert.match(local, /Replaces the system prompt for this project\./);

  // A discovered fallback is shown under the name Pi reads, not the card's default.
  const discovered = listing({ files: [{ id: "agents-local", path: `${CWD}/CLAUDE.md`, content: "# Claude\n" }] });
  assert.match(text(view({ load: discovered, selected: "agents-local" })), /CLAUDE\.md/);
  assert.equal(contextEntryName({ id: "agents-local", path: `${CWD}/CLAUDE.md` }), "CLAUDE.md");
  assert.equal(contextEntryName({ id: "agents-local", path: null }), "AGENTS.md");

  // Nothing is loaded from a file that is not there: no Precedence row, and the
  // card does not claim Pi reads it.
  const missing = decode(view({ selected: "system-global" }));
  assert.doesNotMatch(text(missing), /Pi loads this file\./);
  assert.doesNotMatch(text(missing), /Precedence/);
  assert.match(missing, /aria-label="SYSTEM\.md: Not created yet"/);

  // A project system prompt on an untrusted project waits for the trust before it wins.
  const waiting = listing({
    files: [
      { id: "system-global", path: `${AGENT_DIR}/SYSTEM.md`, exists: true, content: "global\n", sizeBytes: 7 },
      { id: "system-local", path: `${CWD}/.pi/SYSTEM.md`, exists: true, effective: false, requiresTrust: true, content: "project\n", sizeBytes: 8 },
    ],
  });
  const untrustedLocal = decode(view({ load: waiting, selected: "system-local" }));
  assert.match(text(untrustedLocal), /Pi loads this file once the project is trusted; until then it loads the agent directory's\./);
  assert.match(untrustedLocal, /aria-label="SYSTEM\.md: Waits for project trust"/);
  assert.doesNotMatch(text(untrustedLocal), /Pi loads this file\./);
  // The agent directory's file is the one sessions read until then.
  const waitingGlobal = text(view({ load: waiting, selected: "system-global" }));
  assert.match(waitingGlobal, /Precedence/);
});

test("the discovery and precedence rules from the docs are in the UI", () => {
  const agents = text(view({ selected: "agents-global" }));
  assert.match(agents, /AGENTS\.override\.md, AGENTS\.md, AGENTS\.MD, CLAUDE\.md and CLAUDE\.MD/);
  assert.match(agents, /applies in its directory and everything below it/);
  assert.match(agents, /Discovery does not need project trust\./);

  const override = text(view({ selected: "agents-override-local" }));
  assert.match(override, /replaces AGENTS\.md or CLAUDE\.md in the same directory only/);
  assert.match(override, /does not suppress the agent directory's context file/);

  const append = text(view({ selected: "append-system-local" }));
  assert.match(append, /project's \.pi directory\. The project file takes precedence once the project is trusted, and the two are never combined\./);});

test("saving, reverting and deleting are offered per entry, and Delete only for the override", () => {
  const existing = listing({
    files: [
      { id: "agents-override-local", path: `${CWD}/AGENTS.override.md`, deletable: true, content: "# override\n", exists: true },
      { id: "agents-local", path: `${CWD}/AGENTS.md`, exists: false, content: "", sizeBytes: 0 },
    ],
  });
  const html = decode(view({ load: existing, selected: "agents-override-local", drafts: { "agents-override-local": "# edited\n" } }));
  assert.match(text(html), /Save Revert Delete/);
  assert.match(source, /if \(window\.confirm\(t\("context\.deleteConfirm"/);

  // A card with nothing to write offers neither Save nor Revert as a change.
  const untouched = decode(view({ selected: "agents-global" }));
  assert.match(untouched, /disabled=""[^>]*>Save</, "Save waits for a change");
  // AGENTS.md is not the override: no Delete.
  assert.doesNotMatch(text(untouched), /Delete/);

  // An entry that does not exist yet offers Create.
  const missing = decode(view({ selected: "system-global" }));
  assert.match(text(missing), /Create/);
  assert.equal(contextRowBlockKey({ id: "system-global", path: `${AGENT_DIR}/SYSTEM.md`, problem: "not-a-file" }, CWD), "context.block.notAFile");
});

test("a file problem is shown on the row and in the card, and blocks the editor", () => {
  const outside = listing({
    files: [{ id: "system-local", problem: "outside-roots", path: `${CWD}/.pi/SYSTEM.md`, exists: false, content: "", sizeBytes: 0 }],
  });
  const html = decode(view({ load: outside, selected: "system-local" }));
  assert.match(text(html), /This path resolves outside the folders Pi Web may read, so it is not shown or changed here\./);
  assert.match(html, /<textarea[^>]*disabled=""/);
  assert.equal(contextRowBlockKey({ id: "system-local", path: "/x", problem: "outside-roots" }), "context.block.outsideRoots");
  assert.equal(contextRowBlockKey({ id: "system-local", path: "/x", problem: "unreadable" }), "context.block.unreadable");
  assert.equal(contextRowBlockKey({ id: "system-local", path: "/x" }), null);
});

test("a truncated file says so, and a Save of it asks before dropping the rest", () => {
  const big = listing({ files: [{ id: "agents-global", truncated: true, sizeBytes: 400 * 1024 }] });
  const html = decode(view({ load: big, selected: "agents-global", drafts: { "agents-global": "# edited\n" } }));
  assert.match(text(html), /Pi Web shows only its first part/);
  assert.match(html, /<button type="button"[^>]*>Save<\/button>/, "Save is still offered, behind the confirmation");
  assert.match(source, /if \(file\.truncated && !window\.confirm\(t\("context\.truncatedConfirm", \{ size: formatSize\(file\.sizeBytes\) \}\)\)\) return;/);
  assert.match(source, /onClick=\{startSave\}/);
  // Save on a truncated file, and Delete: nothing else asks.
  assert.equal((source.match(/window\.confirm/g) ?? []).length, 2);
});

test("a load failure or timeout has its own words", () => {
  const failed = view({ load: { ok: false, error: { error: "Access denied", reason: "cwd-denied" } } });
  assert.match(text(failed), /Could not read the context files\. Pi Web may not read this folder\. Access denied/);
  assert.match(text(failed), /Refresh/, "the panel stays usable after a failed load");

  const timedOut = view({ load: { ok: false, error: { error: "GET /api/context did not answer within 15000 ms", timedOut: true } } });
  assert.match(text(timedOut), /Pi Web did not answer in time\. Press Refresh to try again\./);

  assert.equal(contextFailureText({ error: "boom" }, (key) => key), "boom", "an untyped failure is its own diagnostic");
  assert.equal(CONTEXT_REFUSAL_KEYS["content-type"], "context.refusal.request-denied");
});

test("loading says so, and a refresh is disabled while one runs", () => {
  assert.match(text(view({ load: { ok: null } })), /Loading\.\.\./);
  assert.match(decode(view({ load: { ok: null } })), /<button type="button" disabled=""[^>]*>Refresh<\/button>/);
});

test("the selection stays on an editable entry", () => {
  const files = listing().data.files;
  assert.equal(pickContextFile(files, "system-local"), "system-local");
  // A selection the new listing cannot edit falls back to the first editable entry.
  assert.equal(pickContextFile(files, "gone"), "agents-global");
  assert.equal(pickContextFile(files, null), "agents-global");
  // A project that was refused leaves only the agent directory's entries usable.
  const onlyGlobal = files.map((entry) => entry.scope === "local" ? { ...entry, path: null } : entry);
  assert.equal(pickContextFile(onlyGlobal, "system-local"), "agents-global");
});

test("Settings wires the Context section without a project, with its own icon", () => {
  assert.match(panelSource, /id: "context", label: t\("settings\.context"\)/);
  assert.match(panelSource, /\{sectionHost\("context", <ContextConfig embedded key=\{cwd \?\? ""\} cwd=\{cwd\} onClose=\{onClose\} \/>\)\}/);
  assert.doesNotMatch(panelSource, /cwd && sectionHost\("context"/);
  assert.match(panelSource, /if \(section === "context"\) return <svg \{\.\.\.common\}>/);
  // The mobile picker and the tab list read the same array, so the new section is in both.
  assert.match(panelSource, /sections\.map\(\(item\) => \(/);
  assert.match(navigationSource, /"context",/);
  assert.match(navigationSource, /const PROJECT_SECTIONS = new Set<SettingsSection>\(\["skills", "agents", "plugins"\]\)/);
});

test("the panel keeps its text out of the source and in the three locales", () => {
  for (const source_ of [enSource, zhSource, twSource]) {
    for (const key of [
      "settings.context",
      "context.group.global",
      "context.group.local",
      "context.detail.path",
      "context.detail.absolutePath",
      "context.detail.role",
      "context.detail.precedence",
      "context.state.on",
      "context.state.missing",
      "context.state.shadowed",
      "context.state.needsTrust",
      "context.block.noProject",
      "context.block.outsideRoots",
      "context.block.notAFile",
      "context.block.unreadable",
      "context.help.agents",
      "context.help.system",
      "context.help.append",
      "context.help.override",
      "context.role.agentsGlobal",
      "context.role.agentsLocal",
      "context.role.systemGlobal",
      "context.role.systemLocal",
      "context.role.appendGlobal",
      "context.role.appendLocal",
      "context.role.overrideLocal",
      "context.create",
      "context.revert",
      "context.deleteConfirm",
      "context.selectItem",
      "context.loadFailed",
      "context.noProjectNotice",
      "context.truncated",
      "context.truncatedConfirm",
      "context.precedence.loaded",
      "context.precedence.needsTrust",
      "context.precedence.shadowed",
      "context.saveFailed",
      "context.loadTimedOut",
    ]) {
      assert.match(source_, new RegExp(`"${key.replace(/\./g, "\\.")}":`), `${key} is missing`);
    }
  }
  assert.match(enSource, /"settings\.context": "Context"/);
  assert.match(zhSource, /"settings\.context": "上下文"/);
  assert.match(twSource, /"settings\.context": "內容脈絡"/);
  for (const key of [...Object.values(CONTEXT_REFUSAL_KEYS)]) {
    assert.match(enSource, new RegExp(`"${key.replace(/\./g, "\\.")}":`), key);
  }
});

test("every context-* class the panel renders has a rule, and every rule a class", () => {
  const styled = new Set([...cssSource.matchAll(/\.(context-[a-z-]+)/g)].map((match) => match[1]));
  const rendered = new Set(
    [...source.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)]
      .flatMap((match) => (match[1] ?? match[2] ?? "").split(/\s+/))
      .filter((name) => name.startsWith("context-")),
  );
  assert.deepEqual([...rendered].filter((name) => !styled.has(name)).sort(), [], "a rendered class has no rule");
  assert.deepEqual([...styled].filter((name) => !rendered.has(name)).sort(), [], "a rule targets no rendered class");
});

test("the panel's requests carry the project and end at a deadline", async () => {
  const seen = [];
  const respond = (body, status = 200) => async (url, init) => {
    seen.push({ url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(init.body) : undefined, signal: init?.signal });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  };

  const loaded = await loadContextFiles(CWD, respond({ agentDir: AGENT_DIR, cwd: CWD, maxBytes: 1, files: [] }));
  assert.equal(loaded.ok, true);
  assert.equal(seen[0].url, `/api/context?cwd=${encodeURIComponent(CWD)}`);

  const global = await loadContextFiles(null, respond({ agentDir: AGENT_DIR, cwd: null, maxBytes: 1, files: [] }));
  assert.equal(global.ok, true);
  assert.equal(seen[1].url, "/api/context");

  const saved = await saveContextFile({ id: "system-local", content: "x" }, CWD, respond({ agentDir: AGENT_DIR, cwd: CWD, maxBytes: 1, files: [] }));
  assert.equal(saved.ok, true);
  assert.deepEqual(seen[2].body, { id: "system-local", content: "x", cwd: CWD });
  assert.equal(seen[2].method, "PUT");

  const removed = await saveContextFile({ id: "agents-override-local", remove: true }, null, respond({ agentDir: AGENT_DIR, cwd: null, maxBytes: 1, files: [] }));
  assert.equal(removed.ok, true);
  assert.deepEqual(seen[3].body, { id: "agents-override-local", remove: true });

  const refused = await saveContextFile({ id: "system-local", content: "x" }, CWD, respond({ error: "Access denied", reason: "link-outside" }, 403));
  assert.equal(refused.ok, false);
  assert.equal(refused.error.reason, "link-outside");

  // Not JSON, and not the shape: both are failures, not hangs.
  const notJson = await loadContextFiles(CWD, async () => new Response("<html>", { status: 502 }));
  assert.equal(notJson.ok, false);
  assert.match(notJson.error.error, /HTTP 502/);

  // A request that never answers ends at its deadline, with the caller's signal untouched.
  const hang = () => new Promise(() => {});
  const deadline = await loadContextFiles(CWD, hang, undefined, 20);
  assert.equal(deadline.ok, false);
  assert.equal(deadline.error.timedOut, true);
  assert.match(deadline.error.error, /did not answer within 20 ms/);
  assert.match(helperSource, /timedOut = true;\n\s*controller\.abort\(\);/);
  assert.match(helperSource, /Promise\.race\(\[run\(\), deadline\]\)/);
});

test("a failed save keeps its alert across the refetch, and a manual refresh clears it", async () => {
  // The hook's own `refresh`, the only way `saveError` is cleared besides a
  // successful save and a changed project.
  const calls = { saveError: [] };
  const refresh = callback("refresh")({
    cwd: CWD,
    loadRunRef: { current: 0 },
    loadContextFiles: async () => ({ ok: false, error: { error: "too large", reason: "too-large" } }),
    setLoad: () => {},
    setSaveError: (value) => calls.saveError.push(value),
    setSelected: () => {},
    pickContextFile,
    selectionRef: { current: "agents-global" },
  });

  await refresh({ keepSaveError: true });
  assert.deepEqual(calls.saveError, [], "the refetch a refused save started leaves the alert standing");
  await refresh();
  assert.deepEqual(calls.saveError, [null], "a manual refresh clears it");

  // The failure path asks for the load that keeps the alert.
  assert.match(source, /if \(!result\.ok\) \{[\s\S]*?setSaveError\(result\.error\);[\s\S]*?void refresh\(\{ keepSaveError: true \}\);/);
  // The alert goes on a manual Refresh, a change of project, and a successful save
  // (`setSaveError(null)` before the request and the listing the answer carries).
  assert.match(source, /onRefresh=\{\(\) => void refresh\(\)\}/);
  assert.match(source, /const save = async \(file: ContextFileInfo, remove: boolean\) => \{\n\s*setSaving\(file\.id\);\n\s*setSaveError\(null\);/);
  assert.match(source, /setDrafts\(\(current\) => \{\n\s*const next = \{ \.\.\.current \};\n\s*delete next\[file\.id\];/);
  // Switching cards never discards typing: one draft per entry.
  assert.match(source, /\[id\]: value/);
  assert.match(source, /drafts\[file\.id\] \?\? file\.content/);
});
