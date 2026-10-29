import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");
const { DebugPanelView } = await jiti.import("./DebugPanel.tsx");
const { EMPTY_DEBUG_SERVER_READING } = await jiti.import("./debug-panel-state.ts");
const { focusIfLost } = await jiti.import("@/lib/stacked-dialog.ts");
const { enLocale } = await jiti.import("@/lib/i18n/messages/en.ts");
const { zhCNLocale } = await jiti.import("@/lib/i18n/messages/zh-CN.ts");
const { interpolateMessage } = await jiti.import("@/lib/i18n/format.ts");
const panelSource = await readFile(new URL("./DebugPanel.tsx", import.meta.url), "utf8");
const shellSource = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
const sidebarSource = await readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8");

const h = React.createElement;
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const t = (key, params) => {
  assert.equal(typeof enLocale.messages[key], "string", `missing translation ${key}`);
  return interpolateMessage(enLocale.messages[key], params);
};

function decode(html) {
  return html.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

/** Every aria-label, in order. */
function ariaLabels(html) {
  return [...html.matchAll(/aria-label="([^"]*)"/g)].map((match) => match[1]);
}

/** Every title attribute, in order. */
function titles(html) {
  return [...html.matchAll(/ title="([^"]*)"/g)].map((match) => match[1]);
}

/** What a sighted reader sees: the text between tags, the stylesheet left out. */
function visibleText(html) {
  return html.replace(/<style>[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

/** Where a section's title starts: its class, since a title such as "SSE" is also a badge's word. */
function sectionTitleAt(html, key, from = 0) {
  const match = new RegExp(`class="debug-section-title[^"]*">${t(`debug.section.${key}`)}<`).exec(html.slice(from));
  return match ? from + match.index : -1;
}

/** The part of the markup from one section's title to the next one's. */
function section(html, key, nextKey) {
  const from = sectionTitleAt(html, key);
  assert.notEqual(from, -1, key);
  const to = nextKey ? sectionTitleAt(html, nextKey, from) : html.length;
  return html.slice(from, to);
}

/** The session list as lines: "# group", then rows "[sub ]name[ · this chat]" ("this chat": the row with the sidebar's bar). */
function sessionLines(html) {
  const list = section(html, "sessions", "global");
  const lines = [];
  for (const match of list.matchAll(/class="debug-group-name">([^<]*)<|class="(debug-row(?: is-[a-z-]+)*)"|class="debug-row-name">([^<]*)</g)) {
    if (match[1] !== undefined) lines.push(`# ${match[1]}`);
    else if (match[2] !== undefined) lines.push({ classes: match[2] });
    else lines[lines.length - 1].name = match[3];
  }
  return lines.map((line) => (typeof line === "string"
    ? line
    : `${line.classes.includes("is-sub") ? "sub " : ""}${line.name}${line.classes.includes("is-current") ? " · this chat" : ""}`));
}

// The browser's clock is far from the server's: only the time since the answer counts.
const LOCAL = 50_000;
const SERVER = 9_000_000;

function client(extra = {}) {
  return {
    pageId: "page-mine-123",
    sessionId: "s1",
    selectedSessionId: "s1",
    mounted: true,
    wantsStream: true,
    connection: {
      sessionId: "s1",
      state: "connected",
      readyState: 1,
      openedAt: LOCAL - 5 * MINUTE,
      connectedAt: LOCAL - 5 * MINUTE + 200,
      lastSeenAt: LOCAL - 3 * SECOND,
      lastHeartbeatAt: LOCAL - 3 * SECOND,
      events: 12,
      opens: 1,
      retries: 0,
      retryDueAt: null,
      watchdogArmed: true,
      staleAfterMs: 45 * SECOND,
      lastError: null,
      lastClose: null,
    },
    released: { active: false, count: 0, lastAt: null },
    reattached: { count: 0, lastAt: null, lastReason: null },
    hiddenReleaseDueAt: null,
    hiddenGraceMs: 60 * SECOND,
    graceDueAt: null,
    run: { agentRunning: false, bashRunning: false, compacting: false, dialogs: 0 },
    lease: {
      renewIntervalMs: 15 * SECOND,
      renewStartedAt: LOCAL - 20 * SECOND,
      inFlightSince: null,
      requests: 2,
      unanswered: 0,
      errors: 0,
      last: { at: LOCAL - 5 * SECOND, durationMs: 18, outcome: "reply", httpStatus: 200, reply: { running: false, awaitingInput: false, subagentsActive: false } },
    },
    ...extra,
  };
}

function page(extra = {}) {
  return {
    at: LOCAL,
    client: client(),
    clientFailed: false,
    sources: [
      { id: 1, kind: "agent", label: "s1", state: "open", createdAt: LOCAL - 5 * MINUTE, opens: 1, errors: 0, lastOpenAt: LOCAL - 5 * MINUTE, lastErrorAt: null },
      { id: 2, kind: "file-watch", label: "/work/app/a.ts", state: "open", createdAt: LOCAL - MINUTE, opens: 1, errors: 0, lastOpenAt: LOCAL - MINUTE, lastErrorAt: null },
    ],
    visibility: { state: "visible", trackingSince: LOCAL - 10 * MINUTE, lastHiddenAt: LOCAL - 2 * MINUTE, lastVisibleAt: LOCAL - MINUTE, hiddenCount: 1 },
    protocol: "http/1.1",
    runningPoll: { count: 40, failures: 1, last: { at: LOCAL - SECOND, durationMs: 12, outcome: "ok", httpStatus: 200 } },
    pollInFlightSince: null,
    ...extra,
  };
}

function summary(sessionId, extra = {}) {
  return {
    sessionId, state: "alive", running: false, awaitingInput: false, subagent: false,
    eventStreams: 0, providers: 0, nextIdleCheckAt: null, forcedByStop: false, starts: 1, ...extra,
  };
}

function wrapper(extra = {}) {
  return {
    sessionId: "s1", state: "alive", stale: false, subagent: false, chatOnly: false,
    createdAt: SERVER - 6 * MINUTE, startedAt: SERVER - 6 * MINUTE, closingAt: null, extensions: "bound",
    run: { running: false, streaming: false, promptRunning: false, pendingPrompts: 0, bashRunning: false, compacting: false, retrying: false, queuedMessages: 0, waitingForMcp: false, runningTools: 0, mutatingCommands: 0, replacement: null },
    idle: { timeoutMs: 10 * MINUTE, nextCheckAt: SERVER + 8 * MINUTE + 30 * SECOND, lastResetAt: SERVER - 90 * SECOND, forcedByStop: false },
    awaitingInput: false, pendingUiRequests: 0, customUis: 0, eventListeners: 2,
    lastEvent: { type: "agent_end", at: SERVER - 90 * SECOND }, lastCommand: { type: "prompt", at: SERVER - 2 * MINUTE },
    ...extra,
  };
}

function reply() {
  return {
    now: SERVER,
    server: {
      startedAt: SERVER - 2 * 60 * MINUTE,
      idleTimeoutMs: 10 * MINUTE,
      heartbeatMs: 15 * SECOND,
      wrappers: { alive: 3, closing: 1, starting: 0 },
      eventStreams: { total: 3, byHolder: [{ holder: "page-other-456", count: 2 }, { holder: "page-mine-123", count: 1 }] },
      fileWatches: 1,
      terminals: { count: 1, listeners: 1, detached: 0, exited: 0, nextCleanupAt: null },
    },
    sessions: [
      summary("other-session", { state: "closing" }),
      summary("notes-1", { awaitingInput: true, eventStreams: 1, nextIdleCheckAt: SERVER + 3 * MINUTE }),
      summary("s1", { eventStreams: 2, providers: 1, nextIdleCheckAt: SERVER + 8 * MINUTE + 30 * SECOND }),
      summary("sub-xyz-789", { subagent: true, running: true, eventStreams: 1 }),
    ],
    session: {
      sessionId: "s1",
      wrapper: wrapper(),
      lifecycle: { starts: 2, firstStartedAt: SERVER - 30 * MINUTE, lastStartedAt: SERVER - 6 * MINUTE, lastClosedAt: SERVER - 7 * MINUTE },
      starting: false,
      providers: [{ name: "keepalive-ext", active: true, byFile: true }],
      eventStreams: [
        { holder: "page-other-456", openedAt: SERVER - 6 * MINUTE, connectedAt: SERVER - 6 * MINUTE, lastWriteAt: SERVER - 3 * SECOND, droppedEvents: 0, queuedBytes: 0 },
        { holder: "page-mine-123", openedAt: SERVER - 5 * MINUTE, connectedAt: SERVER - 5 * MINUTE, lastWriteAt: SERVER - 3 * SECOND, droppedEvents: 0, queuedBytes: 0 },
      ],
      subagents: { active: false, runs: [], notifications: [] },
      mcp: null,
    },
  };
}

function server(extra = {}) {
  // Received 10 s (on the browser's clock) before the page was read.
  return { ...EMPTY_DEBUG_SERVER_READING, sessionId: "s1", reply: reply(), receivedAt: LOCAL - 10 * SECOND, roundTripMs: 42, requests: 5, ...extra };
}

function withDetail(extra) {
  const answer = reply();
  answer.session = { ...answer.session, ...extra };
  return server({ reply: answer });
}

const catalog = [
  { id: "s1", name: "Current chat", path: "", cwd: "/work/app", projectRoot: "/work/app", created: "", modified: "2026-10-01T00:00:00Z", messageCount: 2, firstMessage: "" },
  { id: "sub-xyz-789", name: "", path: "", cwd: "/work/app", projectRoot: "/work/app", created: "", modified: "2026-10-02T00:00:00Z", messageCount: 1, firstMessage: "explore the repo", relation: { kind: "subagent", parentSessionId: "s1", profile: "explore", description: "", status: "running" } },
  { id: "notes-1", name: "Weekly plan", path: "", cwd: "/work/notes", projectRoot: "/work/notes", created: "", modified: "2026-10-09T00:00:00Z", messageCount: 3, firstMessage: "" },
];

function render(props = {}) {
  return decode(renderToStaticMarkup(h(I18nProvider, null, h(DebugPanelView, {
    page: page(),
    server: server(),
    selectedSessionId: "s1",
    sessions: catalog,
    copied: false,
    onCopy() {},
    t,
    ...props,
  }))));
}

test("a quiet page reads OK: no issue list, the meter's scale in its label, every section", () => {
  const html = render();
  assert.match(html, /<span class="debug-panel-status is-muted"><span class="debug-dot is-ok" aria-hidden="true"><\/span><span class="debug-panel-status-text">OK<\/span><\/span>/);
  assert.doesNotMatch(html, /<ul/, "no issues, no list");
  // The meter's name says what its slots count: the slots' own titles are not read inside an image.
  assert.ok(ariaLabels(html).includes("http/1.1 · six connections per origin, shared by all tabs · 2/6 · Agent 1 · File watch 1"), ariaLabels(html).join("\n"));
  for (const key of ["page", "stream", "lease", "session", "global", "sessions"]) {
    assert.ok(html.includes(`>${t(`debug.section.${key}`)}<`), key);
  }
  // Constants are scales and tooltips, never rows: the sentence is not on screen.
  const text = visibleText(html);
  assert.doesNotMatch(text, /six connections|every 15s|timeout 10m|stale after/);
  assert.doesNotMatch(html, /<dl|<dt|debug-panel-footer/);
  assert.match(html, /<span class="debug-panel-heading" title="Read-only: [^"]+">Debug<\/span>/);
  assert.match(html, /<button type="button" class="debug-panel-copy"[^>]*>Copy JSON<\/button>/);
  // No live region: a screen reader would read every change out.
  assert.doesNotMatch(html, /role="status"|aria-live/);
});

test("the meter names what it holds on h2 and with no protocol known, not a bare code and number", () => {
  const terminal = { id: 3, kind: "terminal", label: "/work/app", state: "open", createdAt: LOCAL - 30 * SECOND, opens: 1, errors: 0, lastOpenAt: null, lastErrorAt: null };
  const h2 = render({ page: page({ protocol: "h2", sources: [...page().sources, terminal] }) });
  assert.ok(ariaLabels(h2).includes("This page · Agent 1 · File watch 1 · Terminal 1 · h2"), ariaLabels(h2).join("\n"));
  assert.match(h2, /<span class="debug-chip is-dim">h2<\/span>/);
  const unknown = render({ page: page({ protocol: null }) });
  assert.ok(ariaLabels(unknown).includes("This page · Agent 1 · File watch 1 · unknown"));
  assert.doesNotMatch(unknown, /<span class="debug-chip is-dim">/);
});

test("a timeout: the verdict counts it and its sentence is written once", () => {
  const html = render({ server: server({ failure: { kind: "timeout", status: null, at: LOCAL - SECOND } }) });
  assert.match(html, /<span class="debug-panel-status is-warning"><svg[^>]*>.*?<\/svg><span class="debug-panel-status-text">Issues: 1<\/span>/);
  // The tone's mark and the sentence: no mark for what it is about, the sentence names it.
  assert.match(html, /<ul class="debug-issues"><li class="debug-issue is-warning"><svg[^>]*>(?:<path [^>]*><\/path>)+<\/svg><span class="debug-issue-text">/);
  const sentence = `${t("debug.poll.timeout")} · 1s ago`;
  assert.ok(html.includes(`<span class="debug-issue-text">${sentence}</span>`));
  assert.equal(html.split(t("debug.poll.timeout")).length - 1, 1, "once, in the issues");
});

test("server countdowns run on the server's clock plus the time since its answer", () => {
  const html = render();
  const text = visibleText(html);
  // 8m 30s left when the server answered, 10 s ago: 8m 20s, whatever the browser's clock says.
  assert.ok(text.includes("Reap countdown 8m 20s"), text);
  const all = titles(html);
  assert.ok(all.includes("started 2× · last 6m 10s ago · closed 7m 10s ago"));
  assert.ok(all.includes(`timeout 10m 00s · reset 1m 40s ago · ${t("debug.server.idleHint")}`), "the idle bar's scale in its tooltip");
  assert.ok(text.includes("Uptime 2h 00m"));
  assert.ok(text.includes("↻2"));
  // The browser's own times run on its own clock: next renewal 10 s after the 30 s mark.
  assert.match(html, /aria-label="every 15s · 2 sent · 0 unanswered · 0 failed · this page page-min"/);
  assert.ok(text.includes("Next renewal in 10s"));
  assert.ok(text.includes("Last renewal answered · 18 ms · 5s ago"));
});

test("one boxed word per stream and provider: this page's first and filled, other pages' outlined", () => {
  const html = render();
  // The chat's badges sit in its row of the list, where every other session's are.
  const list = section(html, "sessions", "global");
  const card = list.slice(list.indexOf("debug-row is-current"), list.indexOf("debug-row is-sub"));
  assert.doesNotMatch(section(html, "session", "sessions"), /debug-badge/, "none left in the card");
  const labels = ariaLabels(card);
  assert.ok(labels.includes("SSE: 2 (this page 1, other page 1)"), labels.join("\n"));
  assert.ok(!labels.some((label) => label.startsWith("Lease")), "the server keeps no leases to show");
  assert.ok(labels.includes("Liveness providers: 1"));
  // The badges say what they are: no "SSE" label before them, no icon in them.
  assert.match(card, /<span class="debug-row-badges"><span class="debug-run" title="SSE: 2 [^"]*" role="img" aria-label="SSE: 2 [^"]*"><span class="debug-badge is-accent is-filled" title="this page page-min · connected 5m 10s ago · last write 13s ago">SSE<\/span><span class="debug-badge is-muted" title="other page page-oth · connected 6m 10s ago · last write 13s ago">SSE<\/span><\/span><span class="debug-run"/);
  assert.doesNotMatch(card, /debug-mini-label/);
  assert.doesNotMatch(card, />Lease</);
  // A provider's badge is its name.
  assert.match(card, /<span class="debug-badge is-name is-muted" title="keepalive-ext · active · by file">keepalive-ext<\/span>/);

  const strip = section(html, "global");
  assert.match(strip, /<span class="debug-badge is-accent is-filled" title="this page page-min · 1 streams">SSE<\/span>/);
  assert.match(strip, /<span class="debug-badge is-muted" title="other page page-oth · 2 streams">SSE<\/span><span class="debug-badge is-muted" title="other page page-oth · 2 streams">SSE<\/span>/);
  assert.ok(ariaLabels(strip).includes("SSE: 3 from 2 pages"));
  assert.ok(strip.indexOf("this page page-min") < strip.indexOf("other page page-oth"), "this page's streams first");
  assert.match(strip, /aria-label="File watches: 1"><span class="debug-badge is-muted" title="File watches: 1">File<\/span><\/span>/);
  assert.match(strip, /aria-label="Terminals: 1 [^"]*"><span class="debug-badge is-muted" title="Terminals: 1 [^"]*">Term<\/span><\/span>/);
  assert.ok(titles(strip).some((title) => title.startsWith("Timers: idle 10m 00s · heartbeat 15s\n3 alive · 1 closing · 0 starting")));
});

test("a starting stream is dashed amber, one dropping events amber; past the cap the rest is a count", () => {
  const stream = (holder, at, extra = {}) => ({ holder, openedAt: at, connectedAt: at, lastWriteAt: null, droppedEvents: 0, queuedBytes: 0, ...extra });
  const eventStreams = [
    stream("page-mine-123", SERVER - 5 * MINUTE, { connectedAt: null }),
    stream("page-other-456", SERVER - 6 * MINUTE, { droppedEvents: 2 }),
    ...[5, 4, 3, 2, 1, 0].map((index) => stream(`page-x-${index}`, SERVER - index * SECOND)),
  ];
  const list = section(render({ server: withDetail({ eventStreams }) }), "sessions", "global");
  const from = list.indexOf('<span class="debug-run" title="SSE: 8 (this page 1, other page 7)"');
  assert.notEqual(from, -1);
  const run = list.slice(from, list.indexOf('<span class="debug-run"', from + 1));
  assert.equal(run.match(/>SSE<\/span>/g).length, 3, "three badges, a row's cap");
  assert.match(run, /<span class="debug-run-more">\+5<\/span><\/span>$/);
  // This page's own still starting: filled, amber and dashed; another page's that dropped events: amber, solid.
  assert.match(run, /^[^>]*><span class="debug-badge is-warning is-filled is-dashed" title="this page page-min · starting the session">SSE<\/span>/);
  assert.match(run, /<span class="debug-badge is-warning" title="other page page-oth · connected 6m 10s ago · 2 dropped">SSE<\/span>/);
  assert.equal(run.match(/is-filled/g).length, 1, "only this page's is filled");
});

test("a session row: up to three SSE and one Provider badge, then counts; this page's streams filled", () => {
  const answer = reply();
  answer.sessions = answer.sessions.map((entry) => (entry.sessionId === "notes-1" ? { ...entry, eventStreams: 5, providers: 2 } : entry));
  const grace = { id: 3, kind: "agent", label: "notes-1", state: "open", createdAt: LOCAL - MINUTE, opens: 1, errors: 0, lastOpenAt: null, lastErrorAt: null };
  const list = section(render({ page: page({ sources: [...page().sources, grace] }), server: server({ reply: answer }) }), "sessions", "global");
  const from = list.indexOf('<div class="debug-row" title="notes-1');
  const row = list.slice(from, list.indexOf("</div>", from));
  const badges = row.slice(row.indexOf('<span class="debug-row-badges">'), row.indexOf('<span class="debug-row-idle'));
  assert.equal(badges, [
    '<span class="debug-row-badges">',
    '<span class="debug-run" title="5 event streams" role="img" aria-label="5 event streams">',
    '<span class="debug-badge is-accent is-filled" title="5 event streams">SSE</span>',
    '<span class="debug-badge is-muted" title="5 event streams">SSE</span>',
    '<span class="debug-badge is-muted" title="5 event streams">SSE</span>',
    '<span class="debug-run-more">+2</span></span>',
    '<span class="debug-run" title="2 liveness providers" role="img" aria-label="2 liveness providers">',
    '<span class="debug-badge is-muted" title="2 liveness providers">Provider</span>',
    '<span class="debug-run-more">+1</span></span>',
    "</span>",
  ].join(""));
  // A wide panel's two columns leave the list narrow: the title keeps room, the badges wrap.
  const wide = panelSource.slice(0, panelSource.indexOf("@container debug-panel (max-width: 520px)"));
  assert.match(wide, /\.debug-row \{[^}]*grid-template-columns: 14px minmax\(96px, 1fr\) auto 76px;/);
  assert.match(wide, /\.debug-row-badges \{[^}]*flex-wrap: wrap;\s*justify-content: flex-end;/);
  // A narrow panel puts them on a line of their own under the title, which keeps its width.
  const narrow = panelSource.slice(panelSource.indexOf("@container debug-panel (max-width: 520px)"));
  assert.match(narrow, /\.debug-row \{\s*grid-template-columns: 14px minmax\(0, 1fr\) 32px;/);
  assert.match(narrow, /\.debug-row-badges \{\s*grid-column: 2 \/ -1;\s*grid-row: 2;\s*flex-wrap: wrap;/);
});

test("the meter's slots say what holds them: SSE, File, Term; a connecting one dashed amber, empty ones dotted", () => {
  const extra = (id, kind, label, createdAt, state = "open") => ({ id, kind, label, state, createdAt, opens: 1, errors: 0, lastOpenAt: null, lastErrorAt: null });
  const [chat, watch] = page().sources;
  const sources = [chat, extra(3, "agent", "notes-1", LOCAL - 4 * MINUTE), watch, extra(4, "terminal", "/work/app", LOCAL - 30 * SECOND, "connecting")];
  const html = render({ page: page({ sources }) });
  const tile = section(html, "page", "stream");
  const meterFrom = tile.indexOf('<span class="debug-meter"');
  const meter = tile.slice(meterFrom, tile.indexOf("</div>", meterFrom));
  const slots = [...meter.matchAll(/<span class="(debug-(?:badge|slot)[^"]*)"[^>]*>([^<]*)<\/span>/g)].map((match) => `${match[1]}: ${match[2]}`);
  assert.deepEqual(slots, [
    "debug-badge debug-slot is-accent is-filled: SSE",
    "debug-badge debug-slot is-muted: SSE",
    "debug-badge debug-slot is-muted: File",
    "debug-badge debug-slot is-warning is-dashed: Term",
    "debug-slot is-empty: ",
    "debug-slot is-empty: ",
  ]);
  assert.match(meter, /title="Terminal · app · connecting · opened 1× · 0 errors · 30s ago">Term</);
  assert.match(panelSource, /\.debug-slot\.is-empty \{\s*border: 1px dotted var\(--border\);/);
  // The words follow the language; "SSE" stays as it is.
  const zh = (key, params) => interpolateMessage(zhCNLocale.messages[key], params);
  const zhHtml = render({ page: page({ sources }), t: zh });
  const zhFrom = zhHtml.indexOf('<span class="debug-meter"');
  const zhMeter = zhHtml.slice(zhFrom, zhHtml.indexOf("</div>", zhFrom));
  assert.deepEqual([...zhMeter.matchAll(/class="debug-badge[^"]*"[^>]*>([^<]*)</g)].map((match) => match[1]), ["SSE", "SSE", "文件", "终端"]);
});

test("sessions on the server: grouped by project, the chat's first and not repeated, subagents under their root", () => {
  assert.deepEqual(sessionLines(render()), [
    "# app",
    "Current chat · this chat",
    "sub explore the repo",
    "# notes",
    "Weekly plan",
    "# Not in the session list",
    "other-se",
  ]);
  const list = section(render(), "sessions", "global");
  assert.match(list, /class="debug-row is-current" title="this chat · s1 · alive · 2 event streams · 1 liveness providers · reap countdown 8m">/);
  // The chat's row: the sidebar's short bar instead of a status dot, and its badges with their holders.
  const current = list.slice(list.indexOf("debug-row is-current"), list.indexOf("debug-row is-sub"));
  assert.match(current, /<span class="debug-row-status"><\/span>/);
  assert.match(current, /aria-label="SSE: 2 \(this page 1, other page 1\)"/);
  assert.match(panelSource, /\.debug-row\.is-current::before \{\s*content: "";\s*position: absolute;\s*top: 5px;\s*left: 0;\s*width: 3px;\s*height: 14px;/);
  assert.match(list, /<span class="session-tree-awaiting" role="img" aria-label="awaiting input" title="awaiting input"><\/span>/, "the sidebar's awaiting dot");
  assert.match(list, /<span class="debug-status is-accent" title="running"><svg[^>]*class="sidebar-spin"/, "the sidebar's spinner");
  assert.match(list, /<span class="debug-status-ring is-closing"><\/span>/);
  assert.match(list, /title="1 event streams" role="img" aria-label="1 event streams"><span class="debug-badge is-muted" title="1 event streams">SSE<\/span><\/span>/);
  // 3 min left when the server answered, 10 s ago.
  assert.match(list, /<span class="debug-row-idle-text">2m<\/span>/);
});

test("a chat that moved on waits for its own answer; a hidden page pauses", () => {
  // The chat moved to s2: the answer about s1 still on screen is not s2's.
  const moved = render({ page: page({ client: client({ sessionId: "s2" }) }), selectedSessionId: "s2" });
  const card = section(moved, "session", "sessions");
  assert.ok(card.includes(`<div class="debug-empty">${t("debug.poll.waiting")}</div>`));
  assert.doesNotMatch(card, /debug-card-head/);

  const hidden = render({ page: page({ visibility: { ...page().visibility, state: "hidden" } }) });
  assert.match(hidden, /<span class="debug-panel-status is-dim"><span class="debug-dot is-dim is-ring" aria-hidden="true"><\/span><span class="debug-panel-status-text">Paused while the page is hidden<\/span>/);

  // Nor does a hidden page read or render each second; it reads again as it comes back.
  const tick = panelSource.slice(panelSource.indexOf("const tick = window.setInterval("), panelSource.indexOf("}, DEBUG_TICK_MS);"));
  assert.match(tick, /^const tick = window\.setInterval\(\(\) => \{\s*\/\/[^\n]*\n\s*if \(document\.visibilityState !== "visible"\) return;\s*read\(\);/);
  const back = panelSource.slice(panelSource.indexOf("const onVisibilityChange = () => {"), panelSource.indexOf("document.addEventListener(\"visibilitychange\", onVisibilityChange)"));
  assert.match(back, /if \(document\.visibilityState !== "visible"\) return;\s*read\(\);\s*poller\.poll\(\);/);
});

test("server states, run statuses and close reasons read as words, not codes", () => {
  const html = render({
    page: page({ client: client({ connection: { ...client().connection, lastClose: { reason: "set_tools", at: LOCAL - 4 * SECOND } } }) }),
    server: withDetail({
      subagents: {
        active: true,
        runs: [
          { sessionId: "sub-queued-1", parentSessionId: "s1", status: "queued", profile: "general", background: true, resumed: false, dispatchedAt: SERVER - 2 * SECOND, abortRequested: false, mcpWaiting: false },
          { sessionId: "sub-newer-2", parentSessionId: "s1", status: "paused", profile: null, background: false, resumed: false, dispatchedAt: null, abortRequested: true, mcpWaiting: false },
        ],
        notifications: [{ sessionId: "sub-queued-1", parentSessionId: "s1", since: SERVER - SECOND }],
      },
      mcp: {
        active: true, disposed: false, runActive: false, idleMs: 0, idleReleaseAt: null, problems: 0,
        servers: [
          { name: "github", scope: "global", state: "needs-auth", hasError: false, released: false },
          { name: "later", scope: "project", state: "warming", hasError: false, released: false },
        ],
      },
    }),
  });
  const stateTitle = titles(html).find((title) => title.startsWith("readyState 1"));
  assert.ok(stateTitle?.split("\n").includes("Last close tools changed · 4s ago"), stateTitle);
  assert.ok(stateTitle.split("\n").includes("Page wants it yes"));
  assert.ok(stateTitle.split("\n").includes("hidden 1× · last hidden 2m 00s ago"));
  const text = visibleText(html);
  assert.ok(text.includes("general Queued · background · 12s ago"), text);
  // A value newer than the panel's maps reads as it came.
  assert.ok(text.includes("sub-newe paused abort requested"));
  assert.ok(text.includes("notifying s1 · 11s ago"));
  assert.ok(text.includes("a run is unsettled"));
  assert.ok(titles(html).includes("github (global) · Needs sign-in"));
  assert.ok(titles(html).includes("later (project) · warming"));

  const noReason = render({ page: page({ client: client({ connection: { ...client().connection, lastClose: { reason: null, at: LOCAL - SECOND } } }) }) });
  assert.ok(titles(noReason).some((title) => title.split("\n").includes("Last close — · 1s ago")));
});

test("an MCP server's state is never the dot's hue alone: words after the name, and the pill's name", () => {
  const servers = [
    { name: "github", scope: "global", state: "connected", hasError: false, released: false },
    { name: "linear", scope: "project", state: "needs-auth", hasError: false, released: false },
    { name: "fs", scope: "global", state: "connected", hasError: false, released: true },
    { name: "sentry", scope: "global", state: "failed", hasError: true, released: false },
    { name: "jira", scope: "global", state: "connected", hasError: true, released: false },
  ];
  const html = render({
    server: withDetail({ mcp: { active: true, disposed: false, runActive: false, idleMs: 0, idleReleaseAt: null, problems: 1, servers } }),
  });
  const card = section(html, "session", "sessions");
  const pill = (name) => card.match(new RegExp(`<span class="debug-pill" role="img"[^>]*>(?:(?!</span></span>).)*?>${name}</span>.*?</span>(?=<span class="debug-(?:pill|chip)|</div>)`))?.[0];
  assert.match(pill("github"), /^<span class="debug-pill" role="img" aria-label="github \(global\) · Connected" title="github \(global\) · Connected"><span class="debug-dot is-ok" aria-hidden="true"><\/span><span>github<\/span><\/span>$/);
  assert.match(pill("linear"), /aria-label="linear \(project\) · Needs sign-in"[^>]*><span class="debug-dot is-warning" aria-hidden="true"><\/span><span>linear<\/span><span class="debug-pill-state">· Needs sign-in<\/span><\/span>$/);
  // Let go while idle: a dim ring and a dim name, no state word (it was connected).
  assert.match(pill("fs"), /aria-label="fs \(global\) · Connected · released"[^>]*><span class="debug-dot is-dim is-ring" aria-hidden="true"><\/span><span class="is-dim">fs<\/span><\/span>$/);
  assert.match(pill("sentry"), /aria-label="sentry \(global\) · Did not connect · error"[^>]*><span class="debug-dot is-error" aria-hidden="true"><\/span><span>sentry<\/span><span class="debug-pill-state">· Did not connect<\/span><\/span>$/);
  // Red beside a green dot of the same shape: the error is written out too.
  assert.match(pill("jira"), /<span class="debug-dot is-error" aria-hidden="true"><\/span><span>jira<\/span><span class="debug-pill-state">· error<\/span><\/span>$/);
  const text = visibleText(card);
  assert.ok(text.includes("linear · Needs sign-in") && text.includes("sentry · Did not connect"), text);
});

test("the run's chips show only what is true: no chip row while idle, amber for what waits", () => {
  const withRun = (run) => {
    const answer = reply();
    answer.session.wrapper = { ...answer.session.wrapper, run: { ...answer.session.wrapper.run, ...run } };
    return section(render({ server: server({ reply: answer }) }), "session", "sessions");
  };
  assert.doesNotMatch(section(render(), "session", "sessions"), /debug-chips/);
  const busy = withRun({ running: true, streaming: true, promptRunning: true, pendingPrompts: 1, retrying: true });
  assert.match(busy, /<div class="debug-chips"><span class="debug-chip is-dim">streaming<\/span><span class="debug-chip is-dim">prompt<\/span><span class="debug-chip is-warning">1 more prompts in flight<\/span><span class="debug-chip is-warning">retrying<\/span><\/div>/);
  assert.match(busy, /<span class="debug-status is-accent" title="running · Started 6m 10s ago">/, "running is the status slot, not a chip");
});

test("notable states show in place and leave the verdict at OK", () => {
  const html = render({
    page: page({ client: client({ released: { active: true, count: 1, lastAt: LOCAL - MINUTE }, graceDueAt: LOCAL + 24 * SECOND }) }),
    server: withDetail({
      wrapper: wrapper({
        state: "closing",
        closingAt: SERVER - 3 * SECOND,
        idle: { timeoutMs: 10 * MINUTE, nextCheckAt: SERVER + 40 * SECOND, lastResetAt: null, forcedByStop: true },
      }),
    }),
  });
  assert.match(html, /<span class="debug-panel-status-text">OK<\/span>/);
  assert.doesNotMatch(html, /<ul/);
  const card = section(html, "session", "sessions");
  assert.match(card, /<span class="debug-status-ring is-closing"><\/span>/);
  assert.match(card, /<span class="debug-chip is-warning">closing 13s ago<\/span>/);
  // Closing after Stop: the stop square, then the time alone, amber.
  assert.match(card, /<span class="debug-row-forced is-warning" role="img" aria-label="Stopped: [^"]*" title="Stopped: [^"]*"><\/span><span class="debug-value is-warning"[^>]*>30s<\/span>/);
  const stream = section(html, "stream", "lease");
  assert.match(stream, /<span class="debug-chip is-accent">released while hidden<\/span><span class="debug-chip is-accent">Grace before close in 24s<\/span>/);
});

test("a session closing after Stop carries a stop square, not the amber alone", () => {
  const rowOf = (forcedByStop) => {
    const answer = reply();
    answer.sessions = answer.sessions.map((entry) => (entry.sessionId === "notes-1" ? { ...entry, awaitingInput: false, running: true, forcedByStop } : entry));
    const list = section(render({ server: server({ reply: answer }) }), "sessions", "global");
    const from = list.indexOf('<div class="debug-row" title="notes-1');
    return list.slice(from, list.indexOf("</div>", from));
  };
  const forced = rowOf(true);
  const normal = rowOf(false);
  assert.match(forced, /<span class="debug-row-idle is-warning">[^]*?<span class="debug-row-forced" role="img" aria-label="closes in 2m \(after Stop\)" title="closes in 2m \(after Stop\)"><\/span><span class="debug-row-idle-text">2m<\/span>/);
  assert.doesNotMatch(normal, /debug-row-forced/);
  // More than a class name apart: with every class dropped, the two rows still differ.
  const shape = (html) => html.replace(/ class="[^"]*"/g, "").replace(/ title="[^"]*"/g, "");
  assert.notEqual(shape(forced), shape(normal));
  // Kept at every width: the narrow rules hide the bar, never the square.
  const narrow = panelSource.slice(panelSource.indexOf("@container debug-panel (max-width: 520px)"));
  assert.doesNotMatch(narrow, /debug-row-forced/);
  assert.match(panelSource, /\.debug-status-ring\.is-none \{\s*border-style: dotted;\s*border-color: var\(--text-dim\);/, "the no-wrapper ring is visible");
});

test("the sparklines draw the poll samples against the 5 s timeout", () => {
  const html = render({
    samples: {
      poll: [
        { ms: 41, tone: "dim", failed: false },
        { ms: 1000, tone: "dim", failed: false },
        { ms: 20, tone: "dim", failed: false },
        { ms: 5000, tone: "warning", failed: true },
      ],
      running: [],
    },
  });
  const labels = ariaLabels(html);
  assert.ok(labels.includes("3 answers · median 41 ms · max 1s"), labels.join("\n"));
  // The values line up on the right, in ms in every language.
  assert.match(panelSource, /\.debug-measures > \.debug-value \{\s*justify-self: end;\s*text-align: right;/);
  assert.equal(zhCNLocale.messages["debug.duration.ms"], "{count} ms");
  assert.ok(labels.includes("40 polls · 1 failed · not yet"));
  // A faint baseline under the bars, the chart's full width: a few short answers are no dashed line.
  assert.match(html, /<svg width="120" height="15" viewBox="0 0 120 15" aria-hidden="true"><rect x="0" y="14" width="120" height="1" style="fill:var\(--border\)"><\/rect><rect class="is-dim"/);
  const empty = section(html, "page", "stream").split('aria-label="40 polls')[1];
  assert.match(empty, /^[^>]*><svg[^>]*><rect x="0" y="14" width="120" height="1" style="fill:var\(--border\)"><\/rect><\/svg>/, "drawn before the first sample");
  // Newest on the right, standing on the baseline; 41 ms and 20 ms are 1px stubs, 1 s is 6px, a failure is a full bar.
  assert.match(html, /<rect class="is-dim" x="105" y="13" width="3" height="1" fill="currentColor"><\/rect>/);
  assert.match(html, /<rect class="is-dim" x="109" y="8" width="3" height="6" fill="currentColor"><\/rect>/);
  assert.match(html, /<rect class="is-dim" x="113" y="13" width="3" height="1" fill="currentColor"><\/rect>/);
  assert.match(html, /<rect class="is-warning" x="117" y="0" width="3" height="14" fill="currentColor"><\/rect>/);
  assert.match(html, /<span class="debug-value is-warning">—<\/span>/, "no round trip for a failure");
});

test("without a chat or with a reader that throws, the panel says so and still shows the server", () => {
  const failed = render({ page: page({ client: null, clientFailed: true }) });
  assert.ok(failed.includes(`<span class="debug-issue-text">${t("debug.stream.readerFailed")}</span>`));
  assert.match(failed, /Issues: 1/);
  assert.ok(visibleText(failed).includes("Uptime 2h 00m"));
  const none = render({ page: page({ client: null }), selectedSessionId: null });
  assert.ok(visibleText(none).includes(t("debug.stream.noChat")));
  assert.ok(visibleText(none).includes(t("debug.server.noSession")));
  const before = render({ page: null });
  assert.match(before, /<span class="debug-panel-status-text">Reading…<\/span>/);
  assert.doesNotMatch(before, /<div class="debug-panel-scroll">/);
});

test("the panel keeps to the theme and to Safari 16.2: tokens, the three state colors, no :has or nesting", () => {
  const colors = new Set((panelSource.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).map((color) => color.toLowerCase()));
  assert.deepEqual([...colors].sort(), ["#16a34a", "#d97706", "#ef4444"]);
  assert.doesNotMatch(panelSource, /AbortSignal\.(any|timeout)|\(\?<[=!]/, "Safari 16.2");
  const css = panelSource.slice(panelSource.indexOf("const DEBUG_PANEL_CSS"));
  assert.doesNotMatch(css, /:has\(|&|transition/);
  // Rules are flat: only the container queries hold rules inside braces.
  const outside = css.replace(/@container debug-panel \(max-width: \d+px\) \{[^]*?\n {2}\}\n/g, "");
  // Four tiles in a row, two on a narrower panel, one on a phone; the bars keep one width.
  assert.match(css, /\.debug-tiles \{\s*display: grid;\s*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\) minmax\(0, 1\.3fr\);/);
  assert.match(css, /@container debug-panel \(max-width: 900px\) \{\s*\.debug-tiles \{\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
  assert.match(css, /@container debug-panel \(max-width: 520px\) \{\s*\.debug-tiles \{\s*grid-template-columns: minmax\(0, 1fr\);/);
  assert.doesNotMatch(outside, /\{[^}]*\{/, "no nested rule");
  assert.match(css, /container-type: inline-size;\s*container-name: debug-panel;/);
  assert.match(css, /@container debug-panel \(max-width: 520px\)/);
  // Escape on document (before the window's Stop shortcut), and nothing that keeps a session alive.
  assert.match(panelSource, /document\.addEventListener\("keydown", handleKeyDown\)/);
  assert.doesNotMatch(panelSource, /\/lease|\/events|EventSource|sendAgentCommand|method: "POST"/);
  // The sidebar shows nothing: the panel writes no labels anywhere.
  assert.doesNotMatch(panelSource, /debug-overlay-store|setDebugOverlay/);
});

function between(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.notEqual(from, -1, start);
  assert.notEqual(to, -1, end);
  return source.slice(from, to);
}

test("the Debug button only toggles its panel, left of the session stats", () => {
  const button = between(shellSource, "const renderDebugButton = (mobile: boolean) => {", "const renderMainFileToggle");
  assert.match(button, /onClick=\{\(\) => toggleTopPanel\("debug", mobile\)\}/);
  assert.doesNotMatch(button, /handleSystemInfoToggle|sendAgentCommand|fetch\(|setSessionKey|loadSession|systemInfoLoaderRef/);
  assert.match(button, /aria-label=\{translate\("debug\.title"\)\}/);
  assert.match(button, /aria-pressed=\{open\}/);
  assert.match(button, /data-mobile-toolbar-action=\{mobile \? "debug" : undefined\}/);
  assert.match(button, /if \(!showChat\) return null;/);
  assert.notEqual(enLocale.messages["debug.title"], enLocale.messages["session.title"], "e2e finds the stats button by its own name");

  // Desktop: after the chat's actions, right before the stats, taking the free space.
  assert.match(shellSource, /\{renderChatToolbarActions\(false\)\}\s*\{renderDebugButton\(false\)\}\s*\{renderSessionStatsButton\(false\)\}/);
  assert.match(button, /marginLeft: mobile \? 0 : "auto"/);
  const stats = between(shellSource, "const renderSessionStatsButton = (mobile: boolean) => {", "const renderDebugButton");
  assert.match(stats, /\n\s*marginLeft: 0,/);
  assert.match(shellSource, /marginLeft: !mobile && !showChat \? "auto" : 0,/);
  // Phones: before the stats on a wide one, in the "more" overlay on a narrow one.
  assert.match(shellSource, /\{!isNarrowMobile && renderChatToolbarActions\(true\)\}\s*\{!isNarrowMobile && renderDebugButton\(true\)\}\s*\{renderSessionStatsButton\(true\)\}/);
  assert.match(shellSource, /\{renderChatToolbarActions\(true\)\}\s*\{renderDebugButton\(true\)\}\s*<\/div>/);
});

test("Escape with focus in the panel gives it back to the Debug button, after the panel left the page", () => {
  assert.match(panelSource, /<section ref=\{sectionRef\} className="debug-panel"/);
  assert.match(panelSource, /createDebugPanelEscapeListener\(\s*document,\s*\(\) => sectionRef\.current,\s*\(restoreFocus\) => onCloseRef\.current\(restoreFocus\),\s*\)/);
  const button = between(shellSource, "const renderDebugButton = (mobile: boolean) => {", "const renderMainFileToggle");
  assert.match(button, /<button\s+ref=\{debugButtonRef\}/);
  const close = between(shellSource, "const closeDebugPanel = useCallback(", "}, []);");
  assert.match(close, /\(restoreFocus: boolean\) => \{\s*setActiveTopPanel\(\(panel\) => panel === "debug" \? null : panel\);\s*if \(restoreFocus\) requestAnimationFrame\(\(\) => focusIfLost\(document, debugButtonRef\.current\)\);/);
  assert.match(shellSource, /import \{ focusIfLost \} from "@\/lib\/stacked-dialog";/);
  assert.match(shellSource, /onClose=\{closeDebugPanel\}/);

  // What that frame does: focus that fell to the page goes to the button; focus put elsewhere stays.
  const focused = [];
  const debugButton = { focus: () => focused.push("debug") };
  const body = { name: "body" };
  assert.equal(focusIfLost({ activeElement: body, body }, debugButton), true);
  assert.equal(focusIfLost({ activeElement: { name: "composer" }, body }, debugButton), false);
  assert.equal(focusIfLost({ activeElement: body, body }, null), false, "no Debug button on screen (narrow phone, more closed)");
  assert.deepEqual(focused, ["debug"]);
});

test("the sidebar's running poll records its request alone, not the session-list reload after it", () => {
  const poll = between(sidebarSource, "const poll = async () => {", "const onVisibilityChange = () => {");
  const json = poll.indexOf("await res.json()");
  const answered = poll.indexOf("answeredAt = Date.now();");
  assert.ok(json !== -1 && answered > json, "after the answer is read");
  assert.ok(answered < poll.indexOf("if (stopped || controller !== current) return;"), "before a poll that lost the race returns");
  assert.ok(answered < poll.indexOf("await loadSessions();"), "before the reload");
  assert.match(poll, /\} finally \{[^]*?noteRunningPoll\(startedAt, outcome, httpStatus, answeredAt\);\s*\}/);
});

test("the narrow phone's more overlay scrolls the buttons it cannot fit instead of clipping the last", () => {
  const overlay = between(shellSource, 'data-mobile-toolbar-actions="true"', "{renderChatToolbarActions(true)}");
  assert.match(overlay, /overflowX: "auto",\s*overflowY: "hidden",\s*scrollbarWidth: "none",/);
});

test("AppShell keeps the chat's reader in a ref and the panel open across session switches", () => {
  const register = between(shellSource, "const handleDebugSnapshotReaderChange = useCallback(", "}, []);");
  assert.match(register, /debugSnapshotReaderRef\.current = reader;/);
  assert.doesNotMatch(register, /\bset[A-Z]\w*\(/, "registering renders nothing");
  assert.match(shellSource, /onDebugSnapshotReaderChange=\{handleDebugSnapshotReaderChange\}/);
  assert.match(shellSource, /<DebugPanelBoundary fallback=\{translate\("debug\.failed"\)\}>\s*<DebugPanel\s/);
  assert.match(shellSource, /useEffect\(\(\) => \{\s*startPageVisibilityTracking\(\);\s*\}, \[\]\);/);
  for (const [name, next] of [["handleCwdChange", "handleSelectSession"], ["handleSelectSession", "handleNewSession"], ["handleNewSession", "hydrateSelectedSession"], ["handleSessionDeleted", "handleOpenFile"]]) {
    const body = between(shellSource, `const ${name} = useCallback`, `const ${next} = useCallback`);
    assert.match(body, /setActiveTopPanel\(\(panel\) => panel === "debug" \? panel : null\);/, name);
    assert.doesNotMatch(body, /setActiveTopPanel\(null\)/, name);
  }
});
