import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  MCP_CODEMODE_PROJECT_OVERRIDE_KEYS,
  MCP_CODEMODE_SAVE_TIMEOUT_MS,
  MCP_CODEMODE_SELECTION,
  MCP_CODEMODE_STATE_KEYS,
  MCP_EXPOSURE_KEYS,
  MCP_EXPOSURE_OPTIONS,
  MCP_ACTION_TIMEOUT_MS,
  MCP_OVERVIEW_TIMEOUT_MS,
  MCP_READ_ONLY_KEYS,
  MCP_ROW_STATE_BADGE_KEYS,
  MCP_ROW_STATE_DETAIL_KEYS,
  MCP_ROW_STATE_LABEL_KEYS,
  MCP_SERVER_ROW_STATES,
  MCP_SESSION_ROW_STATE_LABEL_KEYS,
  MCP_SESSION_STATE_KEYS,
  MCP_SESSION_SUMMARY_KEYS,
  isBlockingFileProblem,
  loadMcpOverview,
  mcpCodemodeAlwaysUnavailableNotice,
  mcpCodemodeAutomaticNotice,
  mcpCodemodeBuiltinNotice,
  mcpCodemodeProjectOverrideNotice,
  mcpCodemodeReachNotice,
  mcpExposureReachNotice,
  mcpCodemodeRowState,
  mcpCodemodeTone,
  mcpEffectiveAutoEnableCodemode,
  mcpEffectiveCodemodePreference,
  mcpEmptyDetailKey,
  mcpFileProblems,
  mcpGroupCounts,
  mcpGroupEmptyKey,
  mcpGroupSwitchChecked,
  mcpGroupSwitchTargets,
  mcpOverviewUrl,
  mcpProjectServersLoad,
  mcpProjectTrustable,
  mcpRowContext,
  mcpRowStateDetailKey,
  mcpRowStateLabelKey,
  mcpRowStateTone,
  mcpServerGroups,
  mcpServerKey,
  mcpServerRowState,
  mcpSessionStateView,
  mcpSessionSummaryKey,
  mcpStatusDot,
  mcpStatusRowState,
  mcpStatusTime,
  mcpStatusTimeText,
  mcpTrustNotice,
  mcpUnavailableNotice,
  pickMcpSelection,
  mcpWriteBlock,
  mcpWritesOff,
  postMcpAction,
  saveMcpCodemodePreference,
  withMcpCodemodePreference,
  mcpCodemodeInlineBudgetNotices,
  mcpInlineBudgetDraftChanges,
  mcpInlineBudgetDraftOf,
  parseMcpInlineBudgetDraft,
  saveMcpCodemodeInlineBudget,
  withMcpCodemodeInlineBudget,
  MCP_CODEMODE_MODE_DESCRIPTION_KEYS,
  MCP_CODEMODE_MODE_KEYS,
  mcpCodemodeModeChanges,
  mcpCodemodeModeNotices,
  saveMcpCodemodeMode,
  withMcpCodemodeMode,
  MCP_EXPOSURE_SHORT_KEYS,
  MCP_TEST_BLOCK_KEYS,
  MCP_TEST_REFUSAL_KEYS,
  MCP_TEST_SERIAL_KEY,
  MCP_TEST_STATE_KEYS,
  MCP_TEST_SUMMARY_KEYS,
  MCP_TEST_TIMEOUT_MS,
  mcpSeconds,
  mcpTestAnswerOutdates,
  mcpTestBlock,
  mcpTestRunAfter,
  mcpTestRunAfterSignOut,
  mcpTestRunFor,
  mcpTestStateView,
  mcpTestSummaryKey,
  mcpWithTestResults,
  postMcpTest,
} = await jiti.import("./mcp-config-helpers.ts");
const { enLocale } = await jiti.import("@/lib/i18n/messages/en.ts");

const messages = enLocale.messages;

function server(overrides = {}) {
  return {
    name: "github",
    scope: "global",
    sourcePath: "/home/u/.pi/agent/mcp.json",
    configKey: "key",
    enabled: true,
    validated: true,
    transport: "http",
    url: "https://example.com/mcp",
    envNames: [],
    headerNames: [],
    usesOAuth: true,
    commandFields: [],
    variableReferences: [],
    masked: false,
    ...overrides,
  };
}

function file(scope, overrides = {}) {
  return {
    scope,
    path: scope === "global" ? "/home/u/.pi/agent/mcp.json" : "/repo/.pi/mcp.json",
    exists: true,
    problems: [],
    ...overrides,
  };
}

const on = { mcpAvailable: true, projectServersLoad: true };

test("a row's state follows the file, the most important reason first", () => {
  assert.equal(mcpServerRowState(server(), on), "on");
  // pi refuses the entry: nothing else about it matters.
  assert.equal(mcpServerRowState(server({ invalidError: "bad", enabled: false, webPasswordField: { kind: "header", name: "X" } }), on), "invalid");
  // Pi Web refuses it even while turned off, since turning it on would be refused too.
  assert.equal(mcpServerRowState(server({ enabled: false, webPasswordField: { kind: "header", name: "X" } }), on), "web-password");
  assert.equal(mcpServerRowState(server({ enabled: false }), { mcpAvailable: false, projectServersLoad: false }), "disabled");
  // A project entry connects only where the project's file is read.
  const project = server({ scope: "project", sourcePath: "/repo/.pi/mcp.json" });
  assert.equal(mcpServerRowState(project, { mcpAvailable: true, projectServersLoad: false }), "not-trusted");
  assert.equal(mcpServerRowState(project, { mcpAvailable: false, projectServersLoad: false }), "not-trusted");
  assert.equal(mcpServerRowState(project, on), "on");
  // A global entry the project's entry replaces is replaced only while the project is read.
  const shadowed = server({ shadowedByProject: true });
  assert.equal(mcpServerRowState(shadowed, on), "replaced");
  assert.equal(mcpServerRowState(shadowed, { mcpAvailable: true, projectServersLoad: false }), "on");
  assert.equal(mcpServerRowState(server(), { mcpAvailable: false, projectServersLoad: true }), "mcp-off");
  assert.deepEqual([...MCP_SERVER_ROW_STATES].sort(), Object.keys(MCP_ROW_STATE_LABEL_KEYS).sort());
});

test("project servers load only under a trust decision, as the MCP host reads it", () => {
  const cwd = "/repo";
  assert.equal(mcpProjectServersLoad(undefined), false);
  assert.equal(mcpProjectServersLoad({ cwd, trustError: "locked" }), false);
  assert.equal(mcpProjectServersLoad({ cwd, trust: { requiresTrust: true, trusted: true, decision: true, decisionPath: cwd, inherited: false } }), true);
  assert.equal(mcpProjectServersLoad({ cwd, trust: { requiresTrust: true, trusted: true, decision: true, decisionPath: "/", inherited: true } }), true);
  assert.equal(mcpProjectServersLoad({ cwd, trust: { requiresTrust: true, trusted: false, decision: false, decisionPath: cwd, inherited: false } }), false);
  assert.equal(mcpProjectServersLoad({ cwd, trust: { requiresTrust: true, trusted: false, decision: null, inherited: false } }), false);
  // `trusted` is true for a fresh folder, but a file that appeared there is not read without a decision.
  assert.equal(mcpProjectServersLoad({ cwd, trust: { requiresTrust: false, trusted: true, decision: null, inherited: false } }), false);
  assert.deepEqual(
    mcpRowContext({ mcp: { available: false, reason: "operator-disabled", error: "x" }, project: undefined }),
    { mcpAvailable: false, projectServersLoad: false },
  );
});

test("each state has a color, a full label and, when it is not plain on, visible short text", () => {
  assert.equal(mcpRowStateTone("on"), "on");
  assert.equal(mcpRowStateTone("invalid"), "error");
  assert.equal(mcpRowStateTone("web-password"), "error");
  assert.equal(mcpRowStateTone("not-trusted"), "warning");
  for (const state of ["disabled", "replaced", "mcp-off"]) assert.equal(mcpRowStateTone(state), "off", state);
  assert.deepEqual(mcpStatusDot("on"), { active: true });
  assert.deepEqual(mcpStatusDot("off"), { active: false });
  assert.deepEqual(mcpStatusDot("error"), { color: "#ef4444" });
  assert.deepEqual(mcpStatusDot("warning"), { color: "#f59e0b" });
  // A tested server: connected reads like on, needing a sign-in like a warning, a failure like an error.
  assert.equal(mcpRowStateTone("connected"), "on");
  assert.equal(mcpRowStateTone("needs-auth"), "warning");
  assert.equal(mcpRowStateTone("failed"), "error");
  // Color is never the only sign: every state but on and connected (which need nothing done) and
  // MCP off (which the banner says once) has a badge.
  for (const state of MCP_SERVER_ROW_STATES) {
    assert.equal(typeof messages[MCP_ROW_STATE_LABEL_KEYS[state]], "string", state);
    if (state === "on" || state === "connected" || state === "mcp-off") assert.equal(MCP_ROW_STATE_BADGE_KEYS[state], undefined, state);
    else assert.equal(typeof messages[MCP_ROW_STATE_BADGE_KEYS[state]], "string", state);
  }
  for (const key of [...Object.values(MCP_EXPOSURE_KEYS), ...Object.values(MCP_CODEMODE_STATE_KEYS)]) {
    assert.equal(typeof messages[key], "string", key);
  }
  assert.deepEqual(Object.keys(MCP_EXPOSURE_KEYS).sort(), ["codemode", "deferred", "direct", "hidden"]);
});

test("the Project group appears only with a project, first, and says why it lists nothing", () => {
  const data = {
    files: [file("global"), file("project")],
    servers: [server({ name: "a" }), server({ name: "b", enabled: false }), server({ name: "c", scope: "project" })],
  };
  const withProject = mcpServerGroups(data, true);
  assert.deepEqual(withProject.map((group) => group.scope), ["project", "global"]);
  assert.deepEqual(withProject[0].servers.map((entry) => entry.name), ["c"]);
  assert.deepEqual(withProject[1].servers.map((entry) => entry.name), ["a", "b"]);
  assert.deepEqual(mcpGroupCounts(withProject[1].servers), { enabled: 1, total: 2 });
  assert.equal(mcpGroupEmptyKey(withProject[1]), undefined);

  const globalOnly = mcpServerGroups({ files: [file("global")], servers: [server()] }, false);
  assert.deepEqual(globalOnly.map((group) => group.scope), ["global"]);

  // A project the route refused has no file: the group stays and says it is not listed.
  const refused = mcpServerGroups({ files: [file("global")], servers: [] }, true);
  assert.equal(refused[0].file, undefined);
  assert.equal(mcpGroupEmptyKey(refused[0]), "mcp.group.notListed");
  assert.equal(mcpGroupEmptyKey(refused[1]), "mcp.group.empty");
  assert.equal(mcpGroupEmptyKey({ scope: "global", file: file("global", { exists: false }), servers: [] }), "mcp.group.empty");
  const unparsable = { reason: "unparsable", error: "Unexpected token" };
  assert.equal(mcpGroupEmptyKey({ scope: "global", file: file("global", { problems: [unparsable] }), servers: [] }), "mcp.group.fileProblem");
  // autoEnableCodemode of the wrong type still loads every server.
  const flag = { reason: "auto-enable-codemode-invalid", error: "x" };
  assert.equal(isBlockingFileProblem(flag), false);
  assert.equal(isBlockingFileProblem(unparsable), true);
  assert.equal(mcpGroupEmptyKey({ scope: "global", file: file("global", { problems: [flag] }), servers: [] }), "mcp.group.empty");
  for (const key of ["mcp.group.notListed", "mcp.group.empty", "mcp.group.fileProblem"]) assert.equal(typeof messages[key], "string");
});

test("the selection survives a reload while its row exists, and otherwise moves to the first server", () => {
  const groups = mcpServerGroups({
    files: [file("global"), file("project")],
    servers: [server({ name: "g" }), server({ name: "p", scope: "project" })],
  }, true);
  assert.equal(mcpServerKey({ scope: "global", name: "g" }), "global\0g");
  assert.equal(pickMcpSelection(groups, "global\0g"), "global\0g");
  assert.equal(pickMcpSelection(groups, MCP_CODEMODE_SELECTION), MCP_CODEMODE_SELECTION);
  assert.equal(pickMcpSelection(groups, "global\0gone"), "project\0p");
  assert.equal(pickMcpSelection(groups, null), "project\0p");
  assert.equal(pickMcpSelection(mcpServerGroups({ files: [file("global")], servers: [] }, false), "global\0gone"), null);
  // A server's key always holds a NUL, so no server can be taken for Code mode.
  assert.ok(!MCP_CODEMODE_SELECTION.includes("\0"));
});

test("MCP being off is said with the route's reason", () => {
  assert.equal(mcpUnavailableNotice({ available: true }), undefined);
  assert.deepEqual(mcpUnavailableNotice({ available: false, reason: "operator-disabled", error: "x" }), { key: "mcp.unavailable.operator-disabled" });
  assert.deepEqual(
    mcpUnavailableNotice({ available: false, reason: "internals-unavailable", error: "x", detail: "moved" }),
    { key: "mcp.unavailable.internals-unavailable" },
  );
  assert.deepEqual(
    mcpUnavailableNotice({ available: false, reason: "builtin-disabled", error: "x", settingsPath: "/repo/.pi/settings.json" }),
    { key: "mcp.unavailable.builtin-disabled", params: { path: "/repo/.pi/settings.json" } },
  );
  assert.deepEqual(mcpUnavailableNotice({ available: false, reason: "builtin-disabled", error: "x" }), { key: "mcp.unavailable.builtin-disabled-unknown" });
});

test("trust is reported only for a project with a .pi/mcp.json, and inherited trust names its folder", () => {
  const cwd = "/repo/app";
  const exists = file("project");
  const status = (overrides) => ({ requiresTrust: true, trusted: false, decision: null, inherited: false, ...overrides });
  assert.equal(mcpTrustNotice(undefined, exists), undefined);
  assert.equal(mcpTrustNotice({ cwd, trust: status() }, undefined), undefined);
  assert.equal(mcpTrustNotice({ cwd, trust: status() }, file("project", { exists: false })), undefined);
  assert.deepEqual(mcpTrustNotice({ cwd, trust: status() }, exists), { kind: "untrusted", key: "mcp.trust.untrusted" });
  // A file the folder holds that needs trust, but cannot be listed, is still worth a word.
  assert.deepEqual(
    mcpTrustNotice({ cwd, trust: status() }, file("project", { problems: [{ reason: "link-outside", error: "x" }] })),
    { kind: "untrusted", key: "mcp.trust.untrusted" },
  );
  // A dangling link, as the route reports it: listed as a file with a problem, while the
  // SDK's existsSync follows the link and finds nothing to trust. Trusting would answer
  // trust-not-required, so no notice; the footer explains the file.
  const dangling = file("project", { problems: [{ reason: "link-dangling", error: "a symbolic link to nothing" }] });
  const fresh = { requiresTrust: false, trusted: true, decision: null, inherited: false };
  assert.equal(mcpTrustNotice({ cwd, trust: fresh }, dangling), undefined);
  assert.equal(mcpTrustNotice({ cwd, trust: { ...fresh, decision: true, decisionPath: "/repo", inherited: true } }, dangling), undefined);
  // A decision that marks the folder untrusted still holds once the link leads somewhere.
  assert.deepEqual(
    mcpTrustNotice({ cwd, trust: { ...fresh, decision: false, decisionPath: cwd } }, dangling),
    { kind: "untrusted", key: "mcp.trust.untrusted" },
  );
  assert.deepEqual(
    mcpTrustNotice({ cwd, trust: status({ decision: false, decisionPath: "/repo", inherited: true }) }, exists),
    { kind: "untrusted", key: "mcp.trust.untrustedThrough", params: { path: "/repo" } },
  );
  assert.deepEqual(mcpTrustNotice({ cwd, trust: status({ decision: false, decisionPath: cwd }) }, exists), { kind: "untrusted", key: "mcp.trust.untrusted" });
  assert.equal(mcpTrustNotice({ cwd, trust: status({ trusted: true, decision: true, decisionPath: cwd }) }, exists), undefined);
  assert.deepEqual(
    mcpTrustNotice({ cwd, trust: status({ trusted: true, decision: true, decisionPath: "/repo", inherited: true }) }, exists),
    { kind: "inherited", key: "mcp.trust.trustedThrough", params: { path: "/repo" } },
  );
  assert.deepEqual(mcpTrustNotice({ cwd, trustError: "locked" }, exists), { kind: "untrusted", key: "mcp.trust.unreadable" });
  for (const key of ["mcp.trust.untrusted", "mcp.trust.untrustedThrough", "mcp.trust.trustedThrough", "mcp.trust.unreadable"]) {
    assert.equal(typeof messages[key], "string", key);
  }
  assert.match(messages["mcp.trust.trustedThrough"], /\{path\}/);
  assert.match(messages["mcp.trust.untrustedThrough"], /\{path\}/);
});

test("Trust is offered only for a folder that requires trust and is not trusted", () => {
  const cwd = "/repo/app";
  const status = (overrides) => ({ requiresTrust: true, trusted: false, decision: null, inherited: false, ...overrides });
  assert.equal(mcpProjectTrustable({ cwd, trust: status() }), true);
  // An ancestor's explicit false: trusting records this folder's own decision, which wins.
  assert.equal(mcpProjectTrustable({ cwd, trust: status({ decision: false, decisionPath: "/repo", inherited: true }) }), true);
  assert.equal(mcpProjectTrustable({ cwd, trust: status({ decision: false, decisionPath: cwd }) }), true);
  assert.equal(mcpProjectTrustable({ cwd, trust: status({ trusted: true, decision: true, decisionPath: cwd }) }), false);
  assert.equal(mcpProjectTrustable({ cwd, trust: status({ trusted: true, decision: true, decisionPath: "/repo", inherited: true }) }), false);
  // Requires no trust (a dangling .pi/mcp.json link), even under an explicit false: POST answers trust-not-required.
  assert.equal(mcpProjectTrustable({ cwd, trust: { requiresTrust: false, trusted: true, decision: false, decisionPath: cwd, inherited: false } }), false);
  // trust.json unreadable: whether the folder needs trust is unknown, and trusting would fail the same way.
  assert.equal(mcpProjectTrustable({ cwd, trustError: "locked" }), false);
  assert.equal(mcpProjectTrustable(undefined), false);
});

test("file problems are listed for the footer, the global file's first", () => {
  const problems = mcpFileProblems([
    file("project", { problems: [{ reason: "link-outside", error: "x" }] }),
    file("global", { problems: [{ reason: "unparsable", error: "y" }, { reason: "auto-enable-codemode-invalid", error: "z" }] }),
  ]);
  assert.deepEqual(problems.map(({ file: info, problem }) => `${info.scope}:${problem.reason}`), [
    "global:unparsable",
    "global:auto-enable-codemode-invalid",
    "project:link-outside",
  ]);
});

test("autoEnableCodemode is merged as the SDK merges it: the project's where read, else the global one's, else true", () => {
  const cwd = "/repo";
  const trustedProject = { cwd, trust: { requiresTrust: true, trusted: true, decision: true, decisionPath: cwd, inherited: false } };
  const untrustedProject = { cwd, trust: { requiresTrust: true, trusted: false, decision: null, inherited: false } };
  assert.deepEqual(mcpEffectiveAutoEnableCodemode({ files: [file("global")] }), { value: true });
  assert.deepEqual(
    mcpEffectiveAutoEnableCodemode({ files: [file("global", { autoEnableCodemode: false })] }),
    { value: false, path: "/home/u/.pi/agent/mcp.json" },
  );
  const both = [file("global", { autoEnableCodemode: false }), file("project", { autoEnableCodemode: true })];
  assert.deepEqual(mcpEffectiveAutoEnableCodemode({ files: both, project: trustedProject }), { value: true, path: "/repo/.pi/mcp.json" });
  // An unread project file sets nothing.
  assert.deepEqual(mcpEffectiveAutoEnableCodemode({ files: both, project: untrustedProject }), { value: false, path: "/home/u/.pi/agent/mcp.json" });
  assert.deepEqual(
    mcpEffectiveAutoEnableCodemode({ files: [file("global"), file("project", { autoEnableCodemode: false })], project: trustedProject }),
    { value: false, path: "/repo/.pi/mcp.json" },
  );
});

test("tools only Code mode scripts call are flagged where no session would reach them", () => {
  const info = (overrides) => ({ sandbox: { state: "available" }, builtinDisabled: false, preference: "automatic", ...overrides });
  const auto = { value: true };
  const off = { value: false, path: "/home/u/.pi/agent/mcp.json" };
  assert.equal(mcpCodemodeReachNotice(info(), auto), undefined);
  assert.equal(mcpCodemodeReachNotice(info({ sandbox: { state: "not-checked" } }), auto), undefined);
  // The host offers them through tool search instead.
  assert.deepEqual(mcpCodemodeReachNotice(info({ sandbox: { state: "unavailable", error: "x" }, builtinDisabled: true }), off), { key: "mcp.exposure.sandboxUnavailable" });
  // No codemode tool exists, and the host keeps their exposure.
  assert.deepEqual(mcpCodemodeReachNotice(info({ builtinDisabled: true, preference: "always" }), auto), { key: "mcp.exposure.builtinDisabled" });
  // Automatic never turns Code mode on with autoEnableCodemode false; Always on does not need it.
  assert.deepEqual(mcpCodemodeReachNotice(info(), off), { key: "mcp.exposure.autoEnableOff", params: { path: off.path } });
  assert.deepEqual(mcpCodemodeReachNotice(info({ preference: undefined, preferenceError: "bad" }), off), { key: "mcp.exposure.autoEnableOff", params: { path: off.path } });
  assert.equal(mcpCodemodeReachNotice(info({ preference: "always" }), off), undefined);

  assert.deepEqual(mcpCodemodeAutomaticNotice(info(), off), { key: "mcp.codemode.autoEnableOff", params: { path: off.path } });
  assert.equal(mcpCodemodeAutomaticNotice(info(), auto), undefined);
  assert.equal(mcpCodemodeAutomaticNotice(info({ preference: "always" }), off), undefined);
  for (const key of ["mcp.exposure.sandboxUnavailable", "mcp.exposure.builtinDisabled", "mcp.exposure.autoEnableOff", "mcp.codemode.autoEnableOff"]) {
    assert.equal(typeof messages[key], "string", key);
  }
  assert.match(messages["mcp.exposure.autoEnableOff"], /\{path\}/);
  assert.match(messages["mcp.codemode.autoEnableOff"], /\{path\}/);
});

test("a project whose own defaultTools decides Code mode is what its sessions get, and says so", () => {
  const info = (overrides) => ({ sandbox: { state: "available" }, builtinDisabled: false, preference: "automatic", ...overrides });
  const settingsPath = "/repo/.pi/settings.json";
  const off = { value: false, path: "/repo/.pi/mcp.json" };
  assert.equal(mcpEffectiveCodemodePreference(info()), "automatic");
  assert.equal(mcpEffectiveCodemodePreference(info({ preference: undefined, preferenceError: "bad" })), undefined);
  assert.equal(mcpCodemodeProjectOverrideNotice(info()), undefined);

  // The project starts its sessions with Code mode on: Automatic's autoEnableCodemode warning no longer applies.
  const projectOn = info({ projectOverride: { settingsPath, preference: "always" } });
  assert.equal(mcpEffectiveCodemodePreference(projectOn), "always");
  assert.equal(mcpCodemodeReachNotice(projectOn, off), undefined);
  assert.equal(mcpCodemodeAutomaticNotice(projectOn, off), undefined);
  assert.deepEqual(mcpCodemodeProjectOverrideNotice(projectOn), {
    key: "mcp.codemode.projectOverride.always",
    params: { path: settingsPath },
  });

  // It starts them without Code mode (-codemode, or a plain list without it) although Always on is chosen.
  const projectOff = info({ preference: "always", projectOverride: { settingsPath, preference: "automatic" } });
  assert.equal(mcpEffectiveCodemodePreference(projectOff), "automatic");
  assert.deepEqual(mcpCodemodeReachNotice(projectOff, off), { key: "mcp.exposure.autoEnableOff", params: { path: off.path } });
  assert.deepEqual(mcpCodemodeAutomaticNotice(projectOff, off), { key: "mcp.codemode.autoEnableOff", params: { path: off.path } });
  assert.deepEqual(mcpCodemodeProjectOverrideNotice(projectOff), {
    key: "mcp.codemode.projectOverride.automatic",
    params: { path: settingsPath },
  });
  // Said even when it agrees with the global choice: changing that choice still changes nothing there.
  assert.ok(mcpCodemodeProjectOverrideNotice(info({ preference: "always", projectOverride: { settingsPath, preference: "always" } })));

  for (const key of Object.values(MCP_CODEMODE_PROJECT_OVERRIDE_KEYS)) assert.match(messages[key], /\{path\}/, key);
});

test("Always on is unavailable while no session could offer Code mode, and says why", () => {
  const info = (overrides) => ({ sandbox: { state: "available" }, builtinDisabled: false, preference: "automatic", ...overrides });
  const globalPath = "/home/u/.pi/agent/settings.json";
  assert.equal(mcpCodemodeAlwaysUnavailableNotice(info()), undefined);
  // Nobody has run the self-test yet: Always on stays available, and the Sandbox line says it is unchecked.
  assert.equal(mcpCodemodeAlwaysUnavailableNotice(info({ sandbox: { state: "not-checked" } })), undefined);
  // The sandbox first: nothing in Settings fixes it.
  assert.deepEqual(
    mcpCodemodeAlwaysUnavailableNotice(info({
      sandbox: { state: "unavailable", error: "x" },
      builtinDisabled: true,
      builtinSettingsPath: globalPath,
      globalBuiltinSettingsPath: globalPath,
    })),
    { key: "mcp.codemode.alwaysUnavailable.sandbox" },
  );
  assert.deepEqual(
    mcpCodemodeAlwaysUnavailableNotice(info({ builtinDisabled: true, builtinSettingsPath: globalPath, globalBuiltinSettingsPath: globalPath })),
    { key: "mcp.codemode.alwaysUnavailable.builtin", params: { path: globalPath } },
  );
  for (const key of ["sandbox", "builtin"]) {
    assert.equal(typeof messages[`mcp.codemode.alwaysUnavailable.${key}`], "string", key);
  }
  assert.match(messages["mcp.codemode.alwaysUnavailable.builtin"], /\{path\}/);
});

test("Always on is weighed against the global extensions alone, never the project Settings was opened from", () => {
  const info = (overrides) => ({ sandbox: { state: "available" }, builtinDisabled: false, preference: "automatic", ...overrides });
  const globalPath = "/home/u/.pi/agent/settings.json";
  const projectPath = "/work/app/.pi/settings.json";
  // Only the trusted project turns Code mode off: its sessions lose it, Always on still works everywhere else.
  const projectOnly = info({ builtinDisabled: true, builtinSettingsPath: projectPath });
  assert.equal(mcpCodemodeAlwaysUnavailableNotice(projectOnly), undefined);
  assert.deepEqual(mcpCodemodeBuiltinNotice(projectOnly), { key: "mcp.codemode.builtinDisabledProject", params: { path: projectPath } });
  // This project's sessions still cannot offer it, so the row and the Tools line say so.
  assert.equal(mcpCodemodeRowState(projectOnly), "unavailable");
  assert.deepEqual(mcpCodemodeReachNotice(projectOnly, { value: true }), { key: "mcp.exposure.builtinDisabled" });
  // The global settings turn it off and the project turns it back on: Always on is still unavailable,
  // as it is from every other folder, and this project's sessions have nothing to report.
  const reEnabled = info({ globalBuiltinSettingsPath: globalPath });
  assert.deepEqual(mcpCodemodeAlwaysUnavailableNotice(reEnabled), { key: "mcp.codemode.alwaysUnavailable.builtin", params: { path: globalPath } });
  assert.equal(mcpCodemodeBuiltinNotice(reEnabled), undefined);
  // Both off: the line names the file that decides for these sessions.
  assert.deepEqual(
    mcpCodemodeBuiltinNotice(info({ builtinDisabled: true, builtinSettingsPath: projectPath, globalBuiltinSettingsPath: globalPath })),
    { key: "mcp.codemode.builtinDisabled", params: { path: projectPath } },
  );
  assert.deepEqual(
    mcpCodemodeBuiltinNotice(info({ builtinDisabled: true, builtinSettingsPath: globalPath, globalBuiltinSettingsPath: globalPath })),
    { key: "mcp.codemode.builtinDisabled", params: { path: globalPath } },
  );
  assert.deepEqual(mcpCodemodeBuiltinNotice(info({ builtinDisabled: true })), { key: "mcp.codemode.builtinDisabledUnknown" });
  assert.equal(mcpCodemodeBuiltinNotice(info()), undefined);
  for (const key of ["mcp.codemode.builtinDisabled", "mcp.codemode.builtinDisabledProject"]) {
    assert.match(messages[key], /\{path\}/, key);
  }
  assert.equal(typeof messages["mcp.codemode.builtinDisabledUnknown"], "string");
});

test("with nothing selected, the detail pane tells an empty listing from one a file problem hides", () => {
  assert.equal(mcpEmptyDetailKey(2, [file("global")]), "mcp.selectItem");
  assert.equal(mcpEmptyDetailKey(0, [file("global"), file("project", { exists: false })]), "mcp.empty");
  assert.equal(mcpEmptyDetailKey(0, [file("global", { problems: [{ reason: "auto-enable-codemode-invalid", error: "x" }] })]), "mcp.empty");
  assert.equal(mcpEmptyDetailKey(0, [file("global"), file("project", { problems: [{ reason: "too-large", error: "x" }] })]), "mcp.emptyFileProblem");
  // Servers listed from the other file still make it a choice.
  assert.equal(mcpEmptyDetailKey(1, [file("global", { problems: [{ reason: "unparsable", error: "x" }] })]), "mcp.selectItem");
  for (const key of ["mcp.selectItem", "mcp.empty", "mcp.emptyFileProblem"]) assert.equal(typeof messages[key], "string", key);
});

test("the Code mode row says whether a session can offer it, and the preference otherwise", () => {
  const info = (overrides) => ({ sandbox: { state: "available" }, builtinDisabled: false, preference: "automatic", ...overrides });
  assert.equal(mcpCodemodeRowState(info()), "automatic");
  assert.equal(mcpCodemodeRowState(info({ preference: "always", sandbox: { state: "not-checked" } })), "always");
  assert.equal(mcpCodemodeRowState(info({ sandbox: { state: "unavailable", error: "no wasm" } })), "unavailable");
  assert.equal(mcpCodemodeRowState(info({ builtinDisabled: true })), "unavailable");
  assert.equal(mcpCodemodeRowState(info({ preference: undefined, preferenceError: "bad json" })), "unknown");
  assert.equal(mcpCodemodeTone("unavailable"), "error");
  assert.equal(mcpCodemodeTone("unknown"), "off");
  assert.equal(mcpCodemodeTone("always"), "on");
});

function fakeFetch(responses) {
  const calls = [];
  const fetchImpl = async (input, init) => {
    calls.push({ input, init });
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return {
      ok: next.status >= 200 && next.status < 300,
      status: next.status,
      json: async () => {
        if (next.body === undefined) throw new SyntaxError("Unexpected end of JSON input");
        return next.body;
      },
    };
  };
  return { calls, fetchImpl };
}

const overview = {
  mcp: { available: true },
  codemode: { sandbox: { state: "not-checked" }, builtinDisabled: false, preference: "automatic" },
  files: [file("global")],
  servers: [],
};

test("the overview is loaded for the panel's project, or for the global file alone", async () => {
  assert.equal(mcpOverviewUrl(null), "/api/mcp");
  assert.equal(mcpOverviewUrl("/a b/c&d"), "/api/mcp?cwd=%2Fa%20b%2Fc%26d");

  const global = fakeFetch([{ status: 200, body: overview }]);
  assert.deepEqual(await loadMcpOverview(null, global.fetchImpl), { ok: true, data: overview });
  assert.equal(global.calls.length, 1);
  assert.equal(global.calls[0].input, "/api/mcp");
  // Always read fresh: the files change outside the page.
  assert.equal(global.calls[0].init.cache, "no-store");
  assert.equal(global.calls[0].init.method, undefined);

  const project = fakeFetch([{ status: 200, body: { ...overview, project: { cwd: "/repo" } } }]);
  const loaded = await loadMcpOverview("/repo", project.fetchImpl);
  assert.equal(loaded.ok, true);
  assert.equal(loaded.projectError, undefined);
  assert.deepEqual(project.calls.map((call) => call.input), ["/api/mcp?cwd=%2Frepo"]);
});

test("a project folder the route refuses still leaves the global servers listed", async () => {
  for (const [status, reason] of [[403, "cwd-denied"], [400, "cwd-not-directory"], [400, "cwd-invalid"]]) {
    const { calls, fetchImpl } = fakeFetch([
      { status, body: { error: "Access denied", reason } },
      { status: 200, body: overview },
    ]);
    const result = await loadMcpOverview("/gone", fetchImpl);
    assert.deepEqual(result, { ok: true, data: overview, projectError: { error: "Access denied", reason } }, reason);
    assert.deepEqual(calls.map((call) => call.input), ["/api/mcp?cwd=%2Fgone", "/api/mcp"]);
  }
  // Without a project there is nothing to fall back from.
  const noProject = fakeFetch([{ status: 403, body: { error: "Access denied", reason: "cwd-denied" } }]);
  assert.deepEqual(await loadMcpOverview(null, noProject.fetchImpl), { ok: false, error: { error: "Access denied", reason: "cwd-denied" } });
  // When the global listing fails too, that failure is what the panel shows.
  const both = fakeFetch([
    { status: 403, body: { error: "Access denied", reason: "cwd-denied" } },
    { status: 500, body: { error: "boom", reason: "internal" } },
  ]);
  assert.deepEqual(await loadMcpOverview("/gone", both.fetchImpl), { ok: false, error: { error: "boom", reason: "internal" } });
});

test("other failures keep their reason, or their diagnostic when there is none", async () => {
  const internal = fakeFetch([{ status: 500, body: { error: "EACCES", reason: "internal" } }]);
  assert.deepEqual(await loadMcpOverview("/repo", internal.fetchImpl), { ok: false, error: { error: "EACCES", reason: "internal" } });
  assert.equal(internal.calls.length, 1);
  const network = fakeFetch([new TypeError("Failed to fetch")]);
  assert.deepEqual(await loadMcpOverview(null, network.fetchImpl), { ok: false, error: { error: "Failed to fetch" } });
  const html = fakeFetch([{ status: 502 }]);
  assert.deepEqual(await loadMcpOverview(null, html.fetchImpl), { ok: false, error: { error: "HTTP 502" } });
  // A 200 that is not an overview is not shown as one.
  const odd = fakeFetch([{ status: 200, body: { servers: [] } }]);
  assert.deepEqual(await loadMcpOverview(null, odd.fetchImpl), { ok: false, error: { error: "HTTP 200" } });
});

test("the caller's signal reaches the request, and a load that never answers ends at the deadline", async () => {
  assert.equal(MCP_OVERVIEW_TIMEOUT_MS, 15_000);
  // Aborting the caller's signal aborts the request on its way.
  const caller = new AbortController();
  const seen = [];
  const pending = loadMcpOverview(null, (input, init) => {
    seen.push(init.signal);
    return new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
  }, caller.signal);
  caller.abort();
  const aborted = await pending;
  assert.equal(seen[0].aborted, true);
  assert.equal(aborted.ok, false);
  assert.equal(aborted.error.timedOut, undefined);
  // An already aborted signal is honored too.
  const early = new AbortController();
  early.abort();
  const earlySeen = [];
  await loadMcpOverview(null, async (input, init) => {
    earlySeen.push(init.signal.aborted);
    throw new DOMException("aborted", "AbortError");
  }, early.signal);
  assert.deepEqual(earlySeen, [true]);

  // A request that ignores its signal still ends: the deadline settles the load, and aborts the request.
  const hung = [];
  const started = Date.now();
  const timedOut = await loadMcpOverview("/repo", (input, init) => {
    hung.push(init.signal);
    return new Promise(() => {});
  }, undefined, 30);
  assert.ok(Date.now() - started < 2_000);
  assert.equal(timedOut.ok, false);
  assert.equal(timedOut.error.timedOut, true);
  assert.equal(hung[0].aborted, true);
  assert.equal(typeof messages["mcp.loadTimedOut"], "string");

  // The deadline covers the global listing loaded after a refused project folder too.
  let calls = 0;
  const second = await loadMcpOverview("/gone", async () => {
    calls += 1;
    if (calls === 1) return { ok: false, status: 403, json: async () => ({ error: "Access denied", reason: "cwd-denied" }) };
    return new Promise(() => {});
  }, undefined, 30);
  assert.equal(calls, 2);
  assert.equal(second.ok, false);
  assert.equal(second.error.timedOut, true);
});

test("the Code mode choice is saved through the tools settings route and answers with what it stored", async () => {
  assert.equal(MCP_CODEMODE_SAVE_TIMEOUT_MS, 15_000);
  const saved = fakeFetch([{ status: 200, body: { isWindows: false, powerShellEnabled: false, codemode: "always" } }]);
  assert.deepEqual(await saveMcpCodemodePreference("always", saved.fetchImpl), { ok: true, preference: "always" });
  assert.equal(saved.calls.length, 1);
  assert.equal(saved.calls[0].input, "/api/tools/settings");
  assert.equal(saved.calls[0].init.method, "PUT");
  assert.deepEqual(saved.calls[0].init.headers, { "Content-Type": "application/json" });
  assert.deepEqual(JSON.parse(saved.calls[0].init.body), { codemode: "always" });

  // What the route read back after writing is what the switch shows.
  const stored = fakeFetch([{ status: 200, body: { isWindows: true, powerShellEnabled: true, codemode: "automatic" } }]);
  assert.deepEqual(await saveMcpCodemodePreference("always", stored.fetchImpl), { ok: true, preference: "automatic" });

  // Refusals keep their reason; failures without one keep their diagnostic.
  const refused = fakeFetch([{ status: 403, body: { error: "Untrusted API request", reason: "request-denied" } }]);
  assert.deepEqual(await saveMcpCodemodePreference("always", refused.fetchImpl), {
    ok: false,
    error: { error: "Untrusted API request", reason: "request-denied" },
  });
  const unparsable = fakeFetch([{ status: 500, body: { error: "Unexpected token n in JSON", reason: "internal" } }]);
  assert.deepEqual(await saveMcpCodemodePreference("automatic", unparsable.fetchImpl), {
    ok: false,
    error: { error: "Unexpected token n in JSON", reason: "internal" },
  });
  const network = fakeFetch([new TypeError("Failed to fetch")]);
  assert.deepEqual(await saveMcpCodemodePreference("always", network.fetchImpl), { ok: false, error: { error: "Failed to fetch" } });
  const html = fakeFetch([{ status: 502 }]);
  assert.deepEqual(await saveMcpCodemodePreference("always", html.fetchImpl), { ok: false, error: { error: "HTTP 502" } });
  // A 200 without a preference is not taken for a save.
  const odd = fakeFetch([{ status: 200, body: { codemode: "never" } }]);
  assert.deepEqual(await saveMcpCodemodePreference("always", odd.fetchImpl), { ok: false, error: { error: "HTTP 200" } });
});

test("a save that never answers ends at the deadline, and the caller's signal reaches it", async () => {
  const hung = [];
  const started = Date.now();
  const timedOut = await saveMcpCodemodePreference("always", (input, init) => {
    hung.push(init.signal);
    return new Promise(() => {});
  }, undefined, 30);
  assert.ok(Date.now() - started < 2_000);
  assert.equal(timedOut.ok, false);
  assert.equal(timedOut.error.timedOut, true);
  assert.equal(hung[0].aborted, true);

  const caller = new AbortController();
  const seen = [];
  const pending = saveMcpCodemodePreference("automatic", (input, init) => {
    seen.push(init.signal);
    return new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
  }, caller.signal);
  caller.abort();
  const aborted = await pending;
  assert.equal(seen[0].aborted, true);
  assert.equal(aborted.ok, false);
  assert.equal(aborted.error.timedOut, undefined);
  for (const key of ["mcp.codemode.saveFailed", "mcp.codemode.saveTimedOut"]) assert.equal(typeof messages[key], "string", key);
});

test("a saved choice replaces the preference and its read error in the loaded overview", () => {
  const data = { ...overview, codemode: { sandbox: { state: "available" }, builtinDisabled: false, preferenceError: "Unexpected token" } };
  const next = withMcpCodemodePreference(data, "always");
  assert.deepEqual(next.codemode, { sandbox: { state: "available" }, builtinDisabled: false, preference: "always" });
  assert.equal(next.servers, data.servers);
  assert.equal(data.codemode.preferenceError, "Unexpected token", "the loaded overview is not changed in place");
});

test("the exposure dropdown offers every exposure the SDK accepts, each described", async () => {
  const { MCP_EXPOSURES } = await jiti.import("@/lib/mcp-import.ts");
  assert.deepEqual([...MCP_EXPOSURE_OPTIONS], [...MCP_EXPOSURES]);
  for (const exposure of MCP_EXPOSURE_OPTIONS) {
    assert.equal(typeof messages[MCP_EXPOSURE_KEYS[exposure]], "string", exposure);
    assert.equal(typeof messages[MCP_EXPOSURE_SHORT_KEYS[exposure]], "string", exposure);
  }
});

test("why an exposure's tools may be out of reach depends on the exposure", () => {
  const codemode = { sandbox: { state: "available" }, builtinDisabled: true, preference: "automatic" };
  const autoEnable = { value: true };
  const toolSearchDisabled = { settingsPath: "/Users/me/.pi/agent/settings.json" };
  // Code mode's own reasons reach only the exposures Code mode serves.
  assert.deepEqual(mcpExposureReachNotice("codemode", { codemode, toolSearchDisabled }, autoEnable), { key: "mcp.exposure.builtinDisabled" });
  // Tool search off strands deferred tools, naming the file when there is one.
  assert.deepEqual(mcpExposureReachNotice("deferred", { codemode, toolSearchDisabled }, autoEnable), {
    key: "mcp.exposure.toolSearchDisabled",
    params: { path: toolSearchDisabled.settingsPath },
  });
  assert.deepEqual(mcpExposureReachNotice("deferred", { codemode, toolSearchDisabled: {} }, autoEnable), { key: "mcp.exposure.toolSearchDisabledUnknown" });
  assert.equal(mcpExposureReachNotice("deferred", { codemode }, autoEnable), undefined);
  for (const exposure of ["direct", "hidden"]) {
    assert.equal(mcpExposureReachNotice(exposure, { codemode, toolSearchDisabled }, autoEnable), undefined, exposure);
  }
  for (const key of ["mcp.exposure.toolSearchDisabled", "mcp.exposure.toolSearchDisabledUnknown"]) assert.equal(typeof messages[key], "string", key);
});

const globalSettingsPath = "/Users/me/.pi/agent/settings.json";
const projectSettingsPath = "/Users/me/repo/.pi/settings.json";

test("the mode switch saves another mode, or either one over a value that is not a mode", () => {
  const mode = { settingsPath: globalSettingsPath, value: "on" };
  assert.equal(mcpCodemodeModeChanges(mode, "on"), false);
  assert.equal(mcpCodemodeModeChanges(mode, "only"), true);
  assert.equal(mcpCodemodeModeChanges({ ...mode, value: "only" }, "only"), false);
  assert.equal(mcpCodemodeModeChanges({ ...mode, invalid: '"never"' }, "on"), true);
  for (const key of [...Object.values(MCP_CODEMODE_MODE_KEYS), ...Object.values(MCP_CODEMODE_MODE_DESCRIPTION_KEYS)]) {
    assert.equal(typeof messages[key], "string", key);
  }
});

test("the mode's notes name a value that is not a mode, a project that decides for itself, and Automatic's wait", () => {
  const info = (mode, extra = {}) => ({ sandbox: { state: "available" }, builtinDisabled: false, preference: "always", mode, ...extra });
  assert.deepEqual(mcpCodemodeModeNotices(info(undefined)), []);
  assert.deepEqual(mcpCodemodeModeNotices(info({ settingsPath: globalSettingsPath, value: "only" })), []);
  assert.deepEqual(mcpCodemodeModeNotices(info({
    settingsPath: globalSettingsPath,
    value: "on",
    invalid: '"never"',
    projectOverride: { settingsPath: projectSettingsPath, value: "only" },
  })), [
    { key: "mcp.codemode.toolMode.invalid", params: { path: globalSettingsPath, value: '"never"' } },
    { key: "mcp.codemode.toolMode.projectOverride.only", params: { path: projectSettingsPath } },
  ]);
  assert.deepEqual(mcpCodemodeModeNotices(info({
    settingsPath: globalSettingsPath,
    value: "only",
    projectOverride: { settingsPath: projectSettingsPath, value: "on" },
  })), [{ key: "mcp.codemode.toolMode.projectOverride.on", params: { path: projectSettingsPath } }]);

  // "only" under Automatic waits for an MCP server to turn Code mode on; the effective values count.
  const only = { settingsPath: globalSettingsPath, value: "only" };
  assert.deepEqual(mcpCodemodeModeNotices(info(only, { preference: "automatic" })), [{ key: "mcp.codemode.toolMode.automaticNote" }]);
  assert.deepEqual(mcpCodemodeModeNotices(info(only, { preference: "automatic", projectOverride: { settingsPath: projectSettingsPath, preference: "always" } })), []);
  assert.deepEqual(mcpCodemodeModeNotices(info(
    { settingsPath: globalSettingsPath, value: "on", projectOverride: { settingsPath: projectSettingsPath, value: "only" } },
    { projectOverride: { settingsPath: projectSettingsPath, preference: "automatic" } },
  )).map((notice) => notice.key), ["mcp.codemode.toolMode.projectOverride.only", "mcp.codemode.toolMode.automaticNote"]);
  for (const key of [
    "mcp.codemode.toolMode.invalid",
    "mcp.codemode.toolMode.projectOverride.on",
    "mcp.codemode.toolMode.projectOverride.only",
    "mcp.codemode.toolMode.automaticNote",
    "mcp.codemode.toolMode.saveFailed",
  ]) assert.equal(typeof messages[key], "string", key);
});

test("the mode is saved through the tools settings route and answers with what it stored", async () => {
  const saved = fakeFetch([{ status: 200, body: { isWindows: false, powerShellEnabled: false, codemode: "automatic", codemodeMode: { value: "only" }, codemodeInlineBudget: {} } }]);
  assert.deepEqual(await saveMcpCodemodeMode("only", saved.fetchImpl), { ok: true, mode: { value: "only" } });
  assert.equal(saved.calls[0].input, "/api/tools/settings");
  assert.equal(saved.calls[0].init.method, "PUT");
  assert.deepEqual(JSON.parse(saved.calls[0].init.body), { codemodeMode: "only" });

  const refused = fakeFetch([{ status: 500, body: { error: "Invalid settings.json: codemode must be an object", reason: "internal" } }]);
  assert.deepEqual(await saveMcpCodemodeMode("only", refused.fetchImpl), {
    ok: false,
    error: { error: "Invalid settings.json: codemode must be an object", reason: "internal" },
  });
  // A 200 without a mode is not taken for a save.
  const odd = fakeFetch([{ status: 200, body: { codemode: "automatic", codemodeMode: { value: "off" } } }]);
  assert.deepEqual(await saveMcpCodemodeMode("on", odd.fetchImpl), { ok: false, error: { error: "HTTP 200" } });
  const timedOut = await saveMcpCodemodeMode("on", () => new Promise(() => {}), undefined, 30);
  assert.equal(timedOut.ok, false);
  assert.equal(timedOut.error.timedOut, true);
});

test("a saved mode replaces the stored value and keeps the file and the project's own", () => {
  const projectOverride = { settingsPath: projectSettingsPath, value: "on" };
  const data = { ...overview, codemode: { ...overview.codemode, mode: { settingsPath: globalSettingsPath, value: "on", invalid: '"never"', projectOverride } } };
  const next = withMcpCodemodeMode(data, { value: "only" });
  assert.deepEqual(next.codemode.mode, { settingsPath: globalSettingsPath, projectOverride, value: "only" });
  assert.equal(next.codemode.preference, data.codemode.preference);
  assert.equal(data.codemode.mode.invalid, '"never"', "the loaded overview is not changed in place");
  // An overview without a mode (its file could not be read) is left for the reload.
  assert.equal(withMcpCodemodeMode(overview, { value: "only" }), overview);
});

const inlineBudget = { settingsPath: globalSettingsPath, default: 3000, max: 1_000_000 };

test("the budget field is empty for pi's default and saves a whole number within the limit, or empty", () => {
  assert.equal(mcpInlineBudgetDraftOf(inlineBudget), "");
  assert.equal(mcpInlineBudgetDraftOf({ ...inlineBudget, value: 0 }), "0");
  assert.deepEqual(parseMcpInlineBudgetDraft("", 1_000_000), { ok: true, value: null });
  assert.deepEqual(parseMcpInlineBudgetDraft("  ", 1_000_000), { ok: true, value: null });
  assert.deepEqual(parseMcpInlineBudgetDraft(" 1500 ", 1_000_000), { ok: true, value: 1500 });
  assert.deepEqual(parseMcpInlineBudgetDraft("0", 1_000_000), { ok: true, value: 0 });
  assert.deepEqual(parseMcpInlineBudgetDraft("1000000", 1_000_000), { ok: true, value: 1_000_000 });
  for (const draft of ["-1", "1.5", "1e3", "3,000", "abc", "1000001"]) {
    assert.deepEqual(parseMcpInlineBudgetDraft(draft, 1_000_000), { ok: false }, draft);
  }

  const changes = (budget, draft) => mcpInlineBudgetDraftChanges(budget, parseMcpInlineBudgetDraft(draft, budget.max));
  assert.equal(changes(inlineBudget, ""), false);
  assert.equal(changes(inlineBudget, "3000"), true, "writing the default's value is a change: it no longer follows pi");
  assert.equal(changes({ ...inlineBudget, value: 1000 }, "1000"), false);
  assert.equal(changes({ ...inlineBudget, value: 1000 }, ""), true);
  assert.equal(changes({ ...inlineBudget, value: 1000 }, "x"), false);
  // Saving empty over a value pi ignores removes it.
  assert.equal(changes({ ...inlineBudget, invalid: '"lots"' }, ""), true);
});

test("the budget's warnings name a value pi ignores and a project that decides for itself", () => {
  assert.deepEqual(mcpCodemodeInlineBudgetNotices(inlineBudget), []);
  const projectPath = "/Users/me/repo/.pi/settings.json";
  assert.deepEqual(mcpCodemodeInlineBudgetNotices({
    ...inlineBudget,
    invalid: '"lots"',
    projectOverride: { settingsPath: projectPath, value: 800 },
  }), [
    { key: "mcp.codemode.inlineBudget.invalid", params: { path: inlineBudget.settingsPath, value: '"lots"', default: "3000" } },
    { key: "mcp.codemode.inlineBudget.projectOverride", params: { path: projectPath, value: "800" } },
  ]);
  // A project value pi ignores, or a codemode that is not an object, leaves its sessions the default.
  for (const projectOverride of [{ settingsPath: projectPath }, { settingsPath: projectPath, invalid: "null" }]) {
    assert.deepEqual(mcpCodemodeInlineBudgetNotices({ ...inlineBudget, projectOverride }), [
      { key: "mcp.codemode.inlineBudget.projectOverrideDefault", params: { path: projectPath, default: "3000" } },
    ]);
  }
  for (const key of [
    "mcp.codemode.inlineBudget.invalid",
    "mcp.codemode.inlineBudget.projectOverride",
    "mcp.codemode.inlineBudget.projectOverrideDefault",
    "mcp.codemode.inlineBudget.saveFailed",
  ]) assert.equal(typeof messages[key], "string", key);
});

test("the budget is saved through the tools settings route and answers with what it stored", async () => {
  const saved = fakeFetch([{ status: 200, body: { isWindows: false, powerShellEnabled: false, codemode: "automatic", codemodeInlineBudget: { value: 1000 } } }]);
  assert.deepEqual(await saveMcpCodemodeInlineBudget(1000, saved.fetchImpl), { ok: true, inlineBudget: { value: 1000 } });
  assert.equal(saved.calls[0].input, "/api/tools/settings");
  assert.equal(saved.calls[0].init.method, "PUT");
  assert.deepEqual(JSON.parse(saved.calls[0].init.body), { codemodeInlineBudget: 1000 });

  const reset = fakeFetch([{ status: 200, body: { codemode: "automatic", codemodeInlineBudget: {} } }]);
  assert.deepEqual(await saveMcpCodemodeInlineBudget(null, reset.fetchImpl), { ok: true, inlineBudget: {} });
  assert.deepEqual(JSON.parse(reset.calls[0].init.body), { codemodeInlineBudget: null });

  const refused = fakeFetch([{ status: 500, body: { error: "Invalid settings.json: codemode must be an object", reason: "internal" } }]);
  assert.deepEqual(await saveMcpCodemodeInlineBudget(1000, refused.fetchImpl), {
    ok: false,
    error: { error: "Invalid settings.json: codemode must be an object", reason: "internal" },
  });
  // A 200 without a budget is not taken for a save.
  const odd = fakeFetch([{ status: 200, body: { codemode: "automatic", codemodeInlineBudget: { value: "1000" } } }]);
  assert.deepEqual(await saveMcpCodemodeInlineBudget(1000, odd.fetchImpl), { ok: false, error: { error: "HTTP 200" } });
  const timedOut = await saveMcpCodemodeInlineBudget(1000, () => new Promise(() => {}), undefined, 30);
  assert.equal(timedOut.ok, false);
  assert.equal(timedOut.error.timedOut, true);
});

test("a saved budget replaces the stored value and keeps the default, the limit and the project's own", () => {
  const projectOverride = { settingsPath: "/Users/me/repo/.pi/settings.json", value: 800 };
  const data = { ...overview, codemode: { ...overview.codemode, inlineBudget: { ...inlineBudget, invalid: '"lots"', projectOverride } } };
  const next = withMcpCodemodeInlineBudget(data, { value: 1000 });
  assert.deepEqual(next.codemode.inlineBudget, { ...inlineBudget, projectOverride, value: 1000 });
  assert.equal(next.codemode.preference, "automatic");
  assert.equal(data.codemode.inlineBudget.invalid, '"lots"', "the loaded overview is not changed in place");
  // An overview without a budget (its file could not be read) is left for the reload.
  assert.equal(withMcpCodemodeInlineBudget(overview, { value: 1000 }), overview);
});

test("the panel is read-only while MCP is off on the server, and for a project no decision trusts", () => {
  const trusted = { cwd: "/repo", trust: { requiresTrust: true, trusted: true, decision: true, decisionPath: "/repo", inherited: false } };
  const data = (mcp, project = trusted) => ({ mcp, project });
  const available = { available: true };
  assert.equal(mcpWriteBlock("global", data(available)), undefined);
  assert.equal(mcpWriteBlock("project", data(available)), undefined);
  // The operator's switch and missing SDK modules stop every write, whatever the scope.
  for (const reason of ["operator-disabled", "internals-unavailable"]) {
    const mcp = { available: false, reason, error: "x" };
    assert.equal(mcpWritesOff(mcp), true, reason);
    assert.equal(mcpWriteBlock("global", data(mcp)), "mcp-off", reason);
    assert.equal(mcpWriteBlock("project", data(mcp)), "mcp-off", reason);
  }
  // -builtin:mcp is a setting a project can reverse, so it never decides whether a file may be written.
  const builtin = { available: false, reason: "builtin-disabled", error: "x" };
  assert.equal(mcpWritesOff(builtin), false);
  assert.equal(mcpWriteBlock("global", data(builtin)), undefined);
  // A project needs a decision that trusts it, as the MCP host reads its file; an unreadable store blocks too.
  assert.equal(mcpWriteBlock("project", data(available, { cwd: "/repo", trust: { requiresTrust: true, trusted: false, decision: null, inherited: false } })), "project-untrusted");
  assert.equal(mcpWriteBlock("project", data(available, { cwd: "/repo", trust: { requiresTrust: true, trusted: false, decision: false, decisionPath: "/repo", inherited: false } })), "project-untrusted");
  assert.equal(mcpWriteBlock("project", data(available, { cwd: "/repo", trust: { requiresTrust: false, trusted: true, decision: null, inherited: false } })), "project-untrusted");
  assert.equal(mcpWriteBlock("project", data(available, { cwd: "/repo", trust: { ...trusted.trust, decisionPath: "/", inherited: true } })), undefined);
  assert.equal(mcpWriteBlock("project", data(available, { cwd: "/repo", trustError: "locked" })), "trust-unreadable");
  assert.equal(mcpWriteBlock("global", data(available, { cwd: "/repo", trustError: "locked" })), undefined);
  for (const key of Object.values(MCP_READ_ONLY_KEYS)) assert.equal(typeof messages[key], "string", key);
  for (const block of Object.keys(MCP_READ_ONLY_KEYS)) assert.equal(typeof messages[`mcp.reason.${block}`], "string", block);
});

test("a group switch sends only the servers it changes, and never turns on one that references PI_WEB_PASSWORD", () => {
  const servers = [
    server({ name: "on" }),
    server({ name: "off", enabled: false }),
    server({ name: "pw-off", enabled: false, webPasswordField: { kind: "header", name: "Authorization" } }),
    server({ name: "pw-on", webPasswordField: { kind: "header", name: "Authorization" } }),
  ];
  const names = ({ targets, keptOff }) => [targets.map((target) => target.name), keptOff];
  assert.deepEqual(names(mcpGroupSwitchTargets(servers, true)), [["off"], 1]);
  // Switching off reaches every server that is on, a PI_WEB_PASSWORD one included.
  assert.deepEqual(names(mcpGroupSwitchTargets(servers, false)), [["on", "pw-on"], 0]);
  assert.deepEqual(names(mcpGroupSwitchTargets([server({ name: "on" })], true)), [[], 0]);
});

test("a group switch reads on once every server it can turn on is, so a click can always switch the group off", () => {
  const pwField = { kind: "header", name: "Authorization" };
  // Click the switch the way the panel does: it reads `mcpGroupSwitchChecked()`, asks for the
  // opposite, and the route turns exactly the targets.
  const click = (servers) => {
    const next = !mcpGroupSwitchChecked(servers);
    const { targets, keptOff } = mcpGroupSwitchTargets(servers, next);
    return {
      sent: [next, targets.map((target) => target.name), keptOff],
      servers: servers.map((item) => (targets.includes(item) ? { ...item, enabled: next } : item)),
    };
  };
  // A server on and one referencing PI_WEB_PASSWORD off: reading "every row on" kept this group
  // off for good, so each click asked to turn it on, sent nothing, and it never switched off.
  let servers = [server({ name: "a" }), server({ name: "pw", enabled: false, webPasswordField: pwField })];
  assert.equal(mcpGroupSwitchChecked(servers), true);
  let step = click(servers);
  assert.deepEqual(step.sent, [false, ["a"], 0]);
  servers = step.servers;
  assert.equal(mcpGroupSwitchChecked(servers), false);
  step = click(servers);
  assert.deepEqual(step.sent, [true, ["a"], 1]);
  assert.equal(mcpGroupSwitchChecked(step.servers), true);

  // Without such entries it is the Skills and Plugins rule: on only while every server is.
  assert.equal(mcpGroupSwitchChecked([server({ name: "a" }), server({ name: "b" })]), true);
  assert.equal(mcpGroupSwitchChecked([server({ name: "a" }), server({ name: "b", enabled: false })]), false);
  assert.equal(mcpGroupSwitchChecked([]), false);
  // A PI_WEB_PASSWORD entry that is on counts as on, and switching off reaches it.
  assert.equal(mcpGroupSwitchChecked([server({ name: "pw", webPasswordField: pwField })]), true);
  // Nothing it could turn on: off, and a click only says why the entries stay off.
  servers = [server({ name: "pw", enabled: false, webPasswordField: pwField })];
  assert.equal(mcpGroupSwitchChecked(servers), false);
  assert.deepEqual(click(servers).sent, [true, [], 1]);

  // An entry that is not an object reads as on but has nothing to switch: it is never sent, and
  // it neither holds the group on nor off.
  const junk = server({ name: "junk", notAnObject: true, invalidError: 'server "junk" must be an object' });
  assert.equal(mcpGroupSwitchChecked([junk]), false);
  assert.deepEqual(click([junk]).sent, [true, [], 0]);
  servers = [junk, server({ name: "a" })];
  assert.equal(mcpGroupSwitchChecked(servers), true);
  assert.deepEqual(click(servers).sent, [false, ["a"], 0]);
  servers = [junk, server({ name: "a", enabled: false })];
  assert.equal(mcpGroupSwitchChecked(servers), false);
  assert.deepEqual(click(servers).sent, [true, ["a"], 0]);
});

test("a change is posted to the MCP route with the project only when the listing covers one", async () => {
  assert.equal(MCP_ACTION_TIMEOUT_MS, 15_000);
  const done = fakeFetch([{ status: 200, body: { ...overview, undo: { scope: "global", name: "a", token: "t", path: "/p", expiresInMs: 60_000 } } }]);
  const result = await postMcpAction({ action: "remove", scope: "global", name: "a" }, "/repo", done.fetchImpl);
  assert.equal(result.ok, true);
  assert.equal(result.data.undo.token, "t");
  assert.equal(done.calls[0].input, "/api/mcp");
  assert.equal(done.calls[0].init.method, "POST");
  assert.deepEqual(done.calls[0].init.headers, { "Content-Type": "application/json" });
  assert.deepEqual(JSON.parse(done.calls[0].init.body), { action: "remove", scope: "global", name: "a", cwd: "/repo" });

  const global = fakeFetch([{ status: 200, body: overview }]);
  await postMcpAction({ action: "set-enabled", enabled: false, servers: [{ scope: "global", name: "a" }] }, null, global.fetchImpl);
  assert.deepEqual(JSON.parse(global.calls[0].init.body), { action: "set-enabled", enabled: false, servers: [{ scope: "global", name: "a" }] });

  // A refusal keeps its reason and the file and server it names.
  const refused = fakeFetch([{ status: 409, body: { error: "/p: Unexpected token", reason: "unparsable", path: "/p" } }]);
  assert.deepEqual(await postMcpAction({ action: "disable", scope: "global", name: "a" }, null, refused.fetchImpl), {
    ok: false,
    error: { error: "/p: Unexpected token", reason: "unparsable", path: "/p" },
  });
  const missing = fakeFetch([{ status: 409, body: { error: "gone", reason: "server-missing", path: "/p", name: "a" } }]);
  assert.deepEqual((await postMcpAction({ action: "enable", scope: "global", name: "a" }, null, missing.fetchImpl)).error, {
    error: "gone",
    reason: "server-missing",
    path: "/p",
    name: "a",
  });
  const network = fakeFetch([new TypeError("Failed to fetch")]);
  assert.deepEqual(await postMcpAction({ action: "undo", token: "t" }, null, network.fetchImpl), { ok: false, error: { error: "Failed to fetch" } });
  // A 200 that is not the overview is not taken for a change.
  const odd = fakeFetch([{ status: 200, body: { ok: true } }]);
  assert.deepEqual(await postMcpAction({ action: "undo", token: "t" }, null, odd.fetchImpl), { ok: false, error: { error: "HTTP 200" } });

  // A change that never answers ends at the deadline, and may still have landed.
  const hung = [];
  const timedOut = await postMcpAction({ action: "disable", scope: "global", name: "a" }, null, (input, init) => {
    hung.push(init.signal);
    return new Promise(() => {});
  }, undefined, 30);
  assert.deepEqual([timedOut.ok, timedOut.error.timedOut, hung[0].aborted], [false, true, true]);
  for (const key of ["mcp.actionFailed", "mcp.actionTimedOut"]) assert.equal(typeof messages[key], "string", key);
});

// ---------------------------------------------------------------------------
// Test connection
// ---------------------------------------------------------------------------

function testStatus(state, extra = {}) {
  return { origin: "test", state, tools: [], toolCount: 0, durationMs: 420, testedAt: 1_000, ...extra };
}

test("a tested server's row shows its last status, but only where the file lets it connect", () => {
  assert.equal(mcpServerRowState(server({ status: testStatus("connected") }), on), "connected");
  assert.equal(mcpServerRowState(server({ status: testStatus("needs-auth") }), on), "needs-auth");
  assert.equal(mcpServerRowState(server({ status: testStatus("failed") }), on), "failed");
  // What the file says comes first: a server turned off, untrusted or replaced does not connect,
  // whatever an earlier test found.
  assert.equal(mcpServerRowState(server({ enabled: false, status: testStatus("connected") }), on), "disabled");
  assert.equal(mcpServerRowState(server({ scope: "project", status: testStatus("connected") }), { mcpAvailable: true, projectServersLoad: false }), "not-trusted");
  assert.equal(mcpServerRowState(server({ shadowedByProject: true, status: testStatus("failed") }), on), "replaced");
  assert.equal(mcpServerRowState(server({ status: testStatus("connected") }), { mcpAvailable: false, projectServersLoad: true }), "mcp-off");
});

test("Test is offered exactly where the route would test, with the reason as text", () => {
  const data = { mcp: { available: true }, project: { cwd: "/repo", trust: { requiresTrust: true, trusted: true, decision: true, decisionPath: "/repo", inherited: false } } };
  assert.equal(mcpTestBlock(server(), data), undefined);
  // A switched-off entry can be tested before it is turned on, and -builtin:mcp leaves Test as an explicit action.
  assert.equal(mcpTestBlock(server({ enabled: false }), data), undefined);
  assert.equal(mcpTestBlock(server(), { ...data, mcp: { available: false, reason: "builtin-disabled", error: "x" } }), undefined);
  assert.equal(mcpTestBlock(server(), { ...data, mcp: { available: false, reason: "operator-disabled", error: "x" } }), "mcp-off");
  assert.equal(mcpTestBlock(server(), { ...data, mcp: { available: false, reason: "internals-unavailable", error: "x" } }), "mcp-off");
  const project = server({ scope: "project" });
  assert.equal(mcpTestBlock(project, data), undefined);
  assert.equal(mcpTestBlock(project, { ...data, project: { cwd: "/repo", trust: { requiresTrust: true, trusted: false, decision: null, inherited: false } } }), "project-untrusted");
  // A fresh folder is `trusted` with no decision, and its servers are not read: the host's rule.
  assert.equal(mcpTestBlock(project, { ...data, project: { cwd: "/repo", trust: { requiresTrust: false, trusted: true, decision: null, inherited: false } } }), "project-untrusted");
  assert.equal(mcpTestBlock(project, { ...data, project: { cwd: "/repo", trustError: "locked" } }), "trust-unreadable");
  // The global servers beside an untrusted project can still be tested.
  assert.equal(mcpTestBlock(server(), { ...data, project: { cwd: "/repo", trustError: "locked" } }), undefined);
  assert.equal(mcpTestBlock(server({ invalidError: "legacy SSE" }), data), "invalid");
  assert.equal(mcpTestBlock(server({ webPasswordField: { kind: "header", name: "Authorization" } }), data), "web-password");
  for (const key of [...Object.values(MCP_TEST_BLOCK_KEYS), ...Object.values(MCP_TEST_REFUSAL_KEYS)]) {
    assert.equal(typeof messages[key], "string", key);
  }
  // The route's reasons for refusing a test read as a test's, not as a change's.
  assert.equal(MCP_TEST_REFUSAL_KEYS["mcp-off"], MCP_TEST_BLOCK_KEYS["mcp-off"]);
  assert.equal(MCP_TEST_REFUSAL_KEYS["server-invalid"], MCP_TEST_BLOCK_KEYS.invalid);
  // Every reason the route shares with the writer whose wording speaks of a change or a write.
  for (const reason of ["entry-not-object", "invalid-request", "unparsable", "invalid-shape", "link-dangling", "link-outside", "not-a-file", "too-large"]) {
    assert.equal(MCP_TEST_REFUSAL_KEYS[reason], `mcp.test.refused.${reason}`, reason);
    assert.doesNotMatch(messages[MCP_TEST_REFUSAL_KEYS[reason]], /unchanged|write|turned on or off|change/, reason);
  }
  // The shell-command sentence fits an HTTP server as well as a stdio one.
  assert.equal(typeof messages[MCP_TEST_SERIAL_KEY], "string");
  assert.doesNotMatch(messages[MCP_TEST_SERIAL_KEY], /starts the server/);
  assert.doesNotMatch(messages["mcp.test.summary.timedOut"], /stopped it/, "an HTTP server is not stopped, only its test");
});

test("a test's state reads as connected, a sign-in, a failure, or no answer, with how long and when", () => {
  assert.deepEqual(mcpTestStateView({ state: "connected" }), { key: "mcp.test.state.connected", tone: "on" });
  assert.deepEqual(mcpTestStateView({ state: "needs-auth" }), { key: "mcp.test.state.needs-auth", tone: "warning" });
  assert.deepEqual(mcpTestStateView({ state: "failed" }), { key: "mcp.test.state.failed", tone: "error" });
  assert.deepEqual(mcpTestStateView({ state: "failed", timedOut: true }), { key: "mcp.test.state.timedOut", tone: "error" });
  assert.equal(mcpTestSummaryKey({ state: "failed", timedOut: true }), "mcp.test.summary.timedOut");
  assert.equal(mcpTestSummaryKey({ state: "connected" }), "mcp.test.summary.connected");
  assert.equal(mcpSeconds(420), "0.4");
  assert.equal(mcpSeconds(20_004), "20.0");
  assert.equal(mcpSeconds(-5), "0.0");
  for (const key of [...Object.values(MCP_TEST_STATE_KEYS), ...Object.values(MCP_TEST_SUMMARY_KEYS), ...Object.values(MCP_EXPOSURE_SHORT_KEYS)]) {
    assert.equal(typeof messages[key], "string", key);
  }
  assert.deepEqual(Object.keys(MCP_EXPOSURE_SHORT_KEYS).sort(), Object.keys(MCP_EXPOSURE_KEYS).sort());
});

test("a test's answer is the server's status for the entry it read, while it is the newest", () => {
  const data = { mcp: { available: true }, codemode: {}, files: [], servers: [server({ name: "a", configKey: "a1" }), server({ name: "b", configKey: "b1" })] };
  const answer = (name, configKey, result) => ({ running: false, response: { scope: "global", name, configKey, result } });
  // No answers: the same overview.
  assert.equal(mcpWithTestResults(data, {}), data);
  const shown = mcpWithTestResults(data, { [mcpServerKey({ scope: "global", name: "a" })]: answer("a", "a1", testStatus("connected", { origin: undefined })) });
  assert.equal(shown.servers[0].status.state, "connected");
  assert.equal(shown.servers[0].status.origin, "test");
  assert.equal(shown.servers[1].status, undefined);
  assert.equal(data.servers[0].status, undefined, "the overview it was given is not changed");
  // An answer about the entry before an edit is not the edited entry's.
  assert.equal(mcpWithTestResults(data, { "global\0a": answer("a", "a0", testStatus("connected")) }), data);
  // A newer status from the server (a later test from another tab) wins over an older answer here.
  const newer = { ...data, servers: [server({ name: "a", configKey: "a1", status: testStatus("failed", { testedAt: 2_000 }) })] };
  assert.equal(mcpWithTestResults(newer, { "global\0a": answer("a", "a1", testStatus("connected", { testedAt: 1_500 })) }).servers[0].status.state, "failed");
  assert.equal(mcpWithTestResults(newer, { "global\0a": answer("a", "a1", testStatus("connected", { testedAt: 2_500 })) }).servers[0].status.state, "connected");
});

test("an open session's report refines a row as a test's does, in a session's words", () => {
  const report = (state, extra = {}) => ({ origin: "session", state, sessionId: "s", cwd: "/repo", updatedAt: 3_000, ...extra });
  const states = ["connecting", "connected", "needs-auth", "failed", "disconnected", "conflict"];
  for (const state of states) {
    assert.equal(mcpStatusRowState(report(state)), state, state);
    assert.equal(mcpServerRowState(server({ status: report(state) }), on), state, state);
  }
  // A session that found the project untrusted saw an older trust than the listing, which says it is read now.
  assert.equal(mcpStatusRowState(report("not-trusted")), "on");
  // The file still decides first.
  assert.equal(mcpServerRowState(server({ enabled: false, status: report("conflict") }), on), "disabled");
  assert.equal(mcpStatusRowState({ origin: "test", state: "failed" }), "failed");

  assert.equal(mcpRowStateTone("connecting"), "off");
  assert.equal(mcpRowStateTone("disconnected"), "warning");
  assert.equal(mcpRowStateTone("conflict"), "error");
  // Where a test and a session say the same thing differently, the session's words say where it was seen.
  assert.equal(mcpRowStateLabelKey("connected", report("connected")), "mcp.state.session.connected");
  assert.equal(mcpRowStateLabelKey("connected", { origin: "test", state: "connected" }), "mcp.state.connected");
  assert.equal(mcpRowStateLabelKey("needs-auth", report("needs-auth")), "mcp.state.needs-auth");
  assert.equal(mcpRowStateLabelKey("disabled", report("connected")), "mcp.state.disabled");
  // The Connection row reports what a test or a session saw; the Status row adds no sentence of its own.
  for (const state of ["connected", "needs-auth", "failed", "connecting"]) assert.equal(mcpRowStateDetailKey(state), undefined, state);
  assert.equal(mcpRowStateDetailKey("conflict"), "mcp.stateDetail.conflict");
  assert.equal(mcpRowStateDetailKey("invalid"), undefined, "the pane words a refusal with its reason");
  assert.deepEqual(mcpSessionStateView(report("disconnected")), { key: "mcp.session.state.disconnected", tone: "warning" });
  assert.deepEqual(mcpSessionStateView(report("not-trusted")), { key: "mcp.session.state.not-trusted", tone: "warning" });
  for (const key of [
    ...Object.values(MCP_SESSION_ROW_STATE_LABEL_KEYS),
    ...Object.values(MCP_ROW_STATE_DETAIL_KEYS),
    ...Object.values(MCP_SESSION_STATE_KEYS),
    ...Object.values(MCP_SESSION_SUMMARY_KEYS),
  ]) {
    assert.equal(typeof messages[key], "string", key);
  }
  assert.deepEqual(Object.keys(MCP_SESSION_STATE_KEYS).sort(), [...states, "not-trusted"].sort());
  assert.deepEqual(Object.keys(MCP_SESSION_SUMMARY_KEYS).sort(), Object.keys(MCP_SESSION_STATE_KEYS).sort());
  // Each summary names the session's folder and the time.
  for (const key of Object.values(MCP_SESSION_SUMMARY_KEYS)) assert.match(messages[key], /\{path\}[\s\S]*\{time\}|\{time\}[\s\S]*\{path\}/, key);

  // A session's report newer than the panel's own test answer stands; an older one gives way.
  assert.equal(mcpStatusTime(report("connected")), 3_000);
  assert.equal(mcpStatusTime({ origin: "test", testedAt: 7 }), 7);
  const data = { mcp: { available: true }, codemode: {}, files: [], servers: [server({ name: "a", configKey: "a1", status: report("disconnected") })] };
  const answer = (testedAt) => ({ "global\0a": { running: false, response: { scope: "global", name: "a", configKey: "a1", result: testStatus("connected", { testedAt }) } } });
  assert.equal(mcpWithTestResults(data, answer(2_000)).servers[0].status.state, "disconnected");
  assert.equal(mcpWithTestResults(data, answer(4_000)).servers[0].status.state, "connected");
});

test("a connection a session closed since reads like an untested entry, and its Connection row says when it closed", () => {
  const closed = { origin: "session", state: "connected", sessionId: "s", cwd: "/repo", updatedAt: 3_000, closedAt: 9_000 };
  assert.equal(mcpStatusRowState(closed), "on");
  assert.equal(mcpServerRowState(server({ status: closed }), on), "on");
  // Neutral, not the green of a live connection.
  assert.deepEqual(mcpSessionStateView(closed), { key: "mcp.session.state.closed", tone: "off" });
  assert.equal(mcpSessionSummaryKey(closed), "mcp.session.summary.closed");
  assert.equal(mcpSessionSummaryKey({ ...closed, closedAt: undefined }), "mcp.session.summary.connected");
  assert.equal(typeof messages["mcp.session.state.closed"], "string");
  assert.match(messages["mcp.session.summary.closed"], /\{path\}[\s\S]*\{time\}[\s\S]*\{closedTime\}/);
  // Its write time is the close, which a test answer must be newer than to replace it.
  assert.equal(mcpStatusTime(closed), 9_000);
});

test("a status's time carries its date unless it is today's", () => {
  const now = new Date(2026, 9, 2, 18, 0).getTime();
  const today = new Date(2026, 9, 2, 9, 5).getTime();
  const yesterday = new Date(2026, 9, 1, 9, 5).getTime();
  assert.equal(mcpStatusTimeText(today, "en", now), new Date(today).toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit" }));
  const dated = mcpStatusTimeText(yesterday, "en", now);
  assert.equal(dated, new Date(yesterday).toLocaleString("en", { dateStyle: "medium", timeStyle: "short" }));
  assert.match(dated, /Oct 1, 2026/);
  // Same day and month a year before is not today either.
  assert.match(mcpStatusTimeText(new Date(2025, 9, 2, 9, 5).getTime(), "en", now), /2025/);
});

test("a test request leaves its last answer standing when it fails or never left the queue", () => {
  const response = { scope: "global", name: "a", configKey: "k", result: testStatus("connected") };
  const previous = { running: true, response };
  // A failure is about the entry the press was for; a queue timeout about the one the route read.
  assert.deepEqual(mcpTestRunAfter(previous, { ok: false, error: { error: "x", reason: "mcp-off" } }, "k"), {
    running: false,
    response,
    error: { error: "x", reason: "mcp-off" },
    configKey: "k",
  });
  assert.deepEqual(mcpTestRunAfter(previous, { ok: true, data: { ...response, configKey: "k2", result: testStatus("failed", { queueTimedOut: true }) } }, "k"), {
    running: false,
    response,
    queueTimedOut: true,
    configKey: "k2",
  });
  const next = { ...response, result: testStatus("failed") };
  assert.deepEqual(mcpTestRunAfter(previous, { ok: true, data: next }, "k"), { running: false, response: next });
  assert.deepEqual(mcpTestRunAfter(undefined, { ok: false, error: { error: "x" } }), { running: false, error: { error: "x" } });
});

test("after a Sign out that worked, the panel's own test answers no longer read as the server's status", () => {
  const key = mcpServerKey({ scope: "global", name: "a" });
  const response = { scope: "global", name: "a", configKey: "a1", result: testStatus("connected", { toolCount: 12 }) };
  // The route forgot every status of the entry, so the overview after the sign-out carries none.
  const data = { mcp: { available: true }, codemode: {}, files: [], servers: [server({ name: "a", configKey: "a1" })] };
  const kept = { running: false, startedAt: 100, response };
  assert.equal(mcpServerRowState(mcpWithTestResults(data, { [key]: kept }).servers[0], on), "connected", "the stale answer used to win");

  const after = mcpTestRunAfterSignOut(kept, 200);
  assert.deepEqual(after, { running: false, startedAt: 100, signedOutAt: 200 });
  const shown = mcpWithTestResults(data, { [key]: after });
  assert.equal(shown.servers[0].status, undefined);
  assert.equal(mcpServerRowState(shown.servers[0], on), "on");
  assert.equal(mcpTestRunAfterSignOut(undefined, 200), undefined, "nothing tested, nothing to change");

  // A test that was on its way when the sign-out worked: its answer, found with the old tokens, is dropped.
  const inFlight = mcpTestRunAfterSignOut({ running: true, startedAt: 150 }, 200);
  assert.deepEqual(inFlight, { running: true, startedAt: 150, signedOutAt: 200 });
  assert.deepEqual(mcpTestRunAfter(inFlight, { ok: true, data: response }, "a1"), { running: false, startedAt: 150, signedOutAt: 200 });
  assert.deepEqual(mcpTestRunAfter(inFlight, { ok: false, error: { error: "x" } }, "a1"), { running: false, startedAt: 150, signedOutAt: 200 });
  // One pressed after it is the server's answer again.
  const later = { ...inFlight, running: true, startedAt: 300 };
  assert.deepEqual(mcpTestRunAfter(later, { ok: true, data: response }, "a1"), { running: false, startedAt: 300, signedOutAt: 200, response });
});

test("a failure or a queue timeout is shown only for the entry it was about", () => {
  const response = { scope: "global", name: "a", configKey: "k1", result: testStatus("connected") };
  const run = { running: false, response, error: { error: "x", reason: "server-missing" }, configKey: "k1" };
  assert.equal(mcpTestRunFor(run, { configKey: "k1" }), run);
  // Edited since: the failure is the old entry's; the answer is filtered by `mcpWithTestResults()` on its own.
  assert.deepEqual(mcpTestRunFor(run, { configKey: "k2" }), { running: false, response });
  assert.deepEqual(mcpTestRunFor({ running: true, queueTimedOut: true, configKey: "k1" }, { configKey: "k2" }), { running: true });
  assert.equal(mcpTestRunFor(undefined, { configKey: "k1" }), undefined);
  const plain = { running: false, error: { error: "offline" } };
  assert.equal(mcpTestRunFor(plain, { configKey: "k2" }), plain, "no entry named: shown");
});

test("an answer that shows the listing is out of date loads it again", () => {
  const answer = (configKey) => ({ ok: true, data: { scope: "global", name: "a", configKey, result: testStatus("connected") } });
  assert.equal(mcpTestAnswerOutdates(answer("k1"), { configKey: "k1" }), false);
  // The route read other content than the listing shows: the entry was edited outside the panel.
  assert.equal(mcpTestAnswerOutdates(answer("k2"), { configKey: "k1" }), true);
  assert.equal(mcpTestAnswerOutdates(answer("k1"), undefined), true, "the listing no longer has the server");
  // Any refusal with a reason: the server is gone, the file no longer parses, trust or MCP changed.
  for (const reason of ["server-missing", "unparsable", "project-untrusted", "mcp-off", "server-invalid"]) {
    assert.equal(mcpTestAnswerOutdates({ ok: false, error: { error: "x", reason } }, { configKey: "k1" }), true, reason);
  }
  // A request that failed or timed out says nothing about the files.
  assert.equal(mcpTestAnswerOutdates({ ok: false, error: { error: "offline" } }, { configKey: "k1" }), false);
  assert.equal(mcpTestAnswerOutdates({ ok: false, error: { error: "late", timedOut: true } }, { configKey: "k1" }), false);
});

test("a test is posted to its own route with the project only when given, and ends at its deadline", async () => {
  const calls = [];
  const answer = { scope: "global", name: "lint", configKey: "k", result: testStatus("connected") };
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, json: async () => answer };
  };
  assert.deepEqual(await postMcpTest({ scope: "global", name: "lint" }, null, fetchImpl), { ok: true, data: answer });
  assert.deepEqual(await postMcpTest({ scope: "project", name: "repo" }, "/repo", fetchImpl), { ok: true, data: answer });
  assert.deepEqual(calls.map(({ url, init }) => [url, init.method, init.headers["Content-Type"], JSON.parse(init.body)]), [
    ["/api/mcp/test", "POST", "application/json", { scope: "global", name: "lint" }],
    ["/api/mcp/test", "POST", "application/json", { scope: "project", name: "repo", cwd: "/repo" }],
  ]);
  // A refusal keeps its reason and the server it names.
  const refused = await postMcpTest({ scope: "global", name: "pw" }, null, async () => ({
    ok: false,
    status: 409,
    json: async () => ({ error: "references PI_WEB_PASSWORD", reason: "web-password", name: "pw" }),
  }));
  assert.deepEqual(refused, { ok: false, error: { error: "references PI_WEB_PASSWORD", reason: "web-password", name: "pw" } });
  // An answer that is not a test result is a failure, not a result.
  assert.deepEqual(await postMcpTest({ scope: "global", name: "x" }, null, async () => ({ ok: true, status: 200, json: async () => ({ servers: [] }) })), {
    ok: false,
    error: { error: "HTTP 200" },
  });
  // The deadline is longer than the route's own (queue, close and a blocking !command included).
  assert.ok(MCP_TEST_TIMEOUT_MS >= 45_000);
  // At the deadline the panel stops waiting but leaves the request running: the route stops a test
  // nobody waits for and records nothing, while one left running lands in the store.
  let signal;
  const hung = await postMcpTest({ scope: "global", name: "x" }, null, (url, init) => {
    signal = init.signal;
    return new Promise(() => {});
  }, undefined, 30);
  assert.equal(hung.ok, false);
  assert.equal(hung.error.timedOut, true);
  assert.equal(signal.aborted, false);
  // A caller's own signal still aborts it.
  const caller = new AbortController();
  let callerSignal;
  const stopped = postMcpTest({ scope: "global", name: "x" }, null, (url, init) => {
    callerSignal = init.signal;
    return new Promise((resolve, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
  }, caller.signal, 5_000);
  caller.abort();
  assert.deepEqual(await stopped, { ok: false, error: { error: "aborted" } });
  assert.equal(callerSignal.aborted, true);
});
