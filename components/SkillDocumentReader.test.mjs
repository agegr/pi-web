import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const require = createRequire(import.meta.url);
const { jsx } = require("react/jsx-runtime");
const shimPath = fileURLToPath(new URL("../hooks/__fixtures__/react-hook-shim.mjs", import.meta.url));
const { renderHook } = await import(shimPath);
const fixtures = await mkdtemp(join(tmpdir(), "skill-document-reader-test-"));
test.after(() => rm(fixtures, { recursive: true, force: true }));
const stubPath = join(fixtures, "ui.mjs");
await writeFile(stubPath, `
  const t = (key, values) => values ? key + ":" + values.anchor : key;
  export const useI18n = () => ({ t });
  export const MarkdownBody = "MarkdownBody";
  export const ConfigButton = "ConfigButton";
`);
const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
  alias: {
    "react/jsx-runtime": require.resolve("react/jsx-runtime"),
    react: shimPath,
    [fileURLToPath(new URL("../hooks/useI18n", import.meta.url))]: stubPath,
    "./MarkdownBody": stubPath,
    "./SettingsUi": stubPath,
  },
});
const { SkillDocumentReader, skillInstructionsBody, SKILL_DOCUMENT_HISTORY_LIMIT } = await jiti.import("./SkillDocumentReader.tsx");
const initialProps = { cwd: "/project with spaces", filePath: "/skills/example/SKILL.md", baseDir: "/skills/example" };
const renderOverview = (instructions) => jsx("Overview", {
  children: [jsx("Metadata", { children: "Original metadata" }), jsx("Instructions", { children: instructions })],
});
const response = (content, status = 200) => ({ ok: status < 400, status, json: async () => ({ content }) });
function elements(tree) {
  if (Array.isArray(tree)) return tree.flatMap(elements);
  return tree && typeof tree === "object" ? [tree, ...elements(tree.props?.children)] : [];
}

function mount(t, props = initialProps) {
  const requests = [];
  // Aborted transports may still settle: the reader must ignore them itself.
  t.mock.method(globalThis, "fetch", (url, { signal }) => new Promise((resolve, reject) => {
    requests.push({ url: new URL(url, "http://localhost"), signal, resolve, reject });
  }));
  const scroller = {
    scrollTop: 0, getBoundingClientRect: () => ({ top: 100 }),
    ownerDocument: { defaultView: { getComputedStyle: () => ({ paddingTop: "20px" }) } },
  };
  const focus = [];
  const layout = { noticeHeight: 0, offset: 0, toolbar: null };
  const target = (top, attributes = {}) => ({
    tabIndex: -1, dataset: {}, ...attributes,
    getBoundingClientRect: () => ({ top: 100 + top() - scroller.scrollTop }),
    focus(options) {
      assert.equal(this.tabIndex, attributes.tabIndex ?? -1);
      assert.deepEqual(options, { preventScroll: true });
      focus.push(this);
    },
  });
  const body = target(() => 100 + layout.offset);
  let headings = [];
  const root = {
    closest: () => scroller,
    querySelector: (selector) => selector === ".skill-document-toolbar" ? layout.toolbar : body,
    querySelectorAll: () => headings,
  };
  // Child components stay opaque; attach only the DOM needed by layout effects.
  const hook = renderHook((props) => {
    const tree = SkillDocumentReader(props);
    const nodes = elements(tree);
    layout.offset = nodes.some((node) => ["status", "alert"].includes(node.props.role)) ? layout.noticeHeight : 0;
    layout.toolbar = nodes.some((node) => node.props.className === "skill-document-toolbar")
      ? { offsetHeight: 24 + layout.offset } : null;
    tree.props.ref.current = root;
    return tree;
  }, { renderOverview, ...props });
  let unmounted = false;
  const unmount = () => { if (!unmounted) { hook.unmount(); unmounted = true; } };
  t.after(unmount);
  const find = (predicate) => elements(hook.result).find(predicate);
  const markdown = () => find((node) => node.type === "MarkdownBody");
  return {
    hook, requests, scroller, layout, body, focus, unmount, find, markdown,
    text: () => markdown()?.props.children,
    document: () => find((node) => node.props.className === "skill-document-body")?.props["aria-label"],
    status: () => find((node) => node.props.role === "status")?.props.children,
    error: () => find((node) => node.props.role === "alert")?.props.children,
    buttons: () => elements(hook.result).filter((node) => node.type === "ConfigButton"),
    async settle() { await new Promise((resolve) => setImmediate(resolve)); hook.flush(); },
    async answer(content, index = requests.length - 1) {
      requests[index].resolve(response(content));
      await this.settle();
    },
    navigate(href) {
      const pending = markdown().props.onNavigateLink(href);
      hook.flush();
      return pending;
    },
    async visit(href, content) {
      const pending = this.navigate(href);
      await this.answer(content);
      await pending;
    },
    click(action) {
      const button = this.buttons().find((node) => node.props.children === `skills.document${action}`);
      assert.ok(button, `${action} is available`);
      button.props.onClick();
      hook.flush();
    },
    heading(attributes) {
      const heading = target(() => 540, attributes);
      headings = [heading];
      return heading;
    },
  };
}
async function loaded(t, props) {
  const reader = mount(t, props);
  await reader.answer("---\nname: example\n---\n\n# Overview\n");
  return reader;
}
function overview(reader, expected = true) {
  assert.equal(reader.hook.result.props["data-reference"], !expected);
  assert.equal(!!reader.find((node) => node.type === "Metadata"), expected);
  const instructions = reader.find((node) => node.type === "Instructions");
  assert.equal(!!instructions, expected);
  if (expected && reader.markdown()) assert.ok(elements(instructions).includes(reader.markdown()));
}
function request(reader, document, props = initialProps) {
  const { url } = reader.requests.at(-1);
  assert.equal(url.pathname, "/api/skills/content");
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    cwd: props.cwd, filePath: props.filePath, ...(document === undefined ? {} : { document }),
  });
}

test("overview owns loading, failure, empty instructions and accessible initial content", async (t) => {
  assert.equal(skillInstructionsBody("  Plain instructions\n"), "Plain instructions");
  const reader = mount(t);
  overview(reader);
  request(reader);
  assert.equal(reader.status(), "i18n.loading");
  assert.equal(reader.document(), undefined);
  reader.requests[0].resolve(response(undefined, 503));
  await reader.settle();
  overview(reader);
  assert.equal(reader.status(), undefined);
  assert.equal(reader.error(), "HTTP 503");
  assert.equal(reader.document(), undefined);
  reader.hook.rerender({ ...initialProps, renderOverview, filePath: "/skills/empty/SKILL.md" });
  assert.equal(reader.error(), undefined);
  await reader.answer("---\nname: empty\n---\n");
  overview(reader);
  assert.equal(reader.markdown(), undefined);
  assert.ok(reader.find((node) => node.props.children === "skills.noInstructions"));
  reader.hook.rerender({ ...initialProps, renderOverview });
  await reader.answer("---\nname: example\n---\n\n# Overview\n");
  assert.equal(reader.document(), "SKILL.md");
  assert.equal(reader.text(), "# Overview");
  assert.equal(reader.markdown().props.cwd, "/skills/example/");
  assert.equal(reader.buttons().length, 0);
  assert.equal(reader.focus.length, 0, "initial reads never steal focus");
});

test("references take over the pane; root links, Back and overview restore the right cached layout", async (t) => {
  const props = { ...initialProps, filePath: "/skills/example/ROOT.markdown" };
  const reader = await loaded(t, props);
  reader.scroller.scrollTop = 123;
  const pending = reader.navigate("guides/one.md");
  overview(reader);
  assert.equal(reader.text(), "# Overview");
  assert.equal(reader.status(), "i18n.loading");
  request(reader, "guides/one.md", props);
  await reader.answer("---\nname: reference\n---\n# One");
  await pending;
  overview(reader, false);
  assert.equal(reader.text(), "# One");
  assert.equal(reader.find((node) => node.props.className === "skill-document-path").props.children, "guides/one.md");
  assert.equal(reader.markdown().props.cwd, "/skills/example/guides");
  assert.equal(reader.scroller.scrollTop, 0);
  assert.equal(reader.focus.at(-1), reader.body);
  reader.scroller.scrollTop = 456;
  await reader.visit("../ROOT.markdown", "# Updated overview");
  request(reader, undefined, props);
  overview(reader);
  assert.equal(reader.text(), "# Updated overview");
  reader.click("Back");
  overview(reader, false);
  assert.equal(reader.text(), "# One");
  assert.equal(reader.scroller.scrollTop, 456);
  reader.click("Overview");
  overview(reader);
  assert.equal(reader.text(), "# Overview", "overview restores the original snapshot, not the reread root");
  assert.equal(reader.scroller.scrollTop, 123);
  assert.equal(reader.buttons().length, 0);
  assert.equal(reader.requests.length, 3, "cached restores never fetch");
});

test("successful reads snapshot completion-time position, excluding transient header shifts", async (t) => {
  const reader = await loaded(t);
  for (const [action, noticeHeight, extraScroll] of [["Back", 0, 40], ["Back", 26, 0], ["Back", 26, 40], ["Overview", 26, 40]]) {
    if (action === "Back") await reader.visit("reference.md", "# Reference");
    const outgoing = reader.document();
    reader.layout.noticeHeight = noticeHeight;
    reader.scroller.scrollTop = 814;
    const pending = reader.navigate("setup.md#missing");
    assert.equal(reader.layout.offset, noticeHeight);
    reader.scroller.scrollTop += noticeHeight + extraScroll; // Browser anchoring, then deliberate scrolling.
    await reader.answer("# Setup");
    await pending;
    assert.equal(reader.error(), "skills.documentAnchorMissing:missing");
    assert.equal(reader.scroller.scrollTop, 0);
    assert.equal(reader.focus.at(-1), reader.body);
    reader.click(action);
    assert.equal(reader.document(), outgoing);
    assert.equal(reader.scroller.scrollTop, 814 + extraScroll, "restore the paragraph, not notice-inflated scrollTop");
    assert.equal(reader.error(), undefined);
    assert.equal(reader.focus.at(-1), reader.body);
    if (action === "Back") reader.click("Overview");
    overview(reader);
  }
});

test("anchors focus headings without changing callbacks/history; missing same-document anchors leave position alone", async (t) => {
  const reader = await loaded(t);
  for (const reference of [false, true]) {
    if (reference) {
      const heading = reader.heading({ dataset: { headingAnchor: "café" } });
      await reader.visit("reference.md#caf%C3%A9", "# Reference");
      assert.equal(reader.scroller.scrollTop, 504, "cross-document anchor clears the reference header");
      assert.equal(reader.focus.at(-1), heading);
    }
    const callback = reader.markdown().props.onNavigateLink;
    const count = reader.requests.length;
    for (const attributes of [
      { dataset: { headingAnchor: "café" } }, { id: "café" }, { id: "user-content-café" },
      { id: "user-content-café", tabIndex: 0 }, { id: "user-content-café", tabIndex: 2 },
    ]) {
      const heading = reader.heading(attributes);
      await reader.navigate("#caf%C3%A9");
      assert.equal(reader.focus.at(-1), heading);
      assert.equal(reader.scroller.scrollTop, reference ? 504 : 508);
      assert.equal(reader.markdown().props.onNavigateLink, callback);
      overview(reader, !reference);
    }
    const top = reader.scroller.scrollTop;
    const focusCount = reader.focus.length;
    await reader.navigate("#missing");
    assert.equal(reader.error(), "skills.documentAnchorMissing:missing");
    assert.equal(reader.scroller.scrollTop, top);
    assert.equal(reader.focus.length, focusCount);
    assert.equal(reader.markdown().props.onNavigateLink, callback);
    assert.equal(reader.requests.length, count);
    assert.equal(reader.buttons().length, reference ? 2 : 0);
  }
  reader.click("Back");
  overview(reader);
  assert.equal(reader.buttons().length, 0, "Back skips every same-document anchor");
});

test("failed reads and rejected links leave the displayed document, reading position and history intact", async (t) => {
  const reader = await loaded(t);
  reader.scroller.scrollTop = 210;
  const failures = [
    [(r) => r.resolve(response("ignored", 404)), "HTTP 404"],
    [(r) => r.resolve({ ok: true, json: async () => ({ error: "Permission denied" }) }), "Permission denied"],
    [(r) => r.resolve(response(undefined)), "HTTP 200"],
    [(r) => r.resolve(response(42)), "HTTP 200"],
    [(r) => r.reject(new Error("offline")), "offline"],
    [(r) => r.resolve({ json: async () => { throw new Error("invalid JSON"); } }), "invalid JSON"],
  ];
  for (const reference of [false, true]) {
    if (reference) await reader.visit("good.md", "# Good");
    reader.scroller.scrollTop = 210;
    const unchanged = () => {
      overview(reader, !reference);
      assert.equal(reader.text(), reference ? "# Good" : "# Overview");
      assert.equal(reader.scroller.scrollTop, 210);
      assert.equal(reader.buttons().length, reference ? 2 : 0);
      assert.equal(reader.status(), undefined);
    };
    for (const [finish, message] of failures) {
      const focusCount = reader.focus.length;
      const pending = reader.navigate("missing.md");
      assert.equal(reader.error(), undefined, "retry clears the old error");
      finish(reader.requests.at(-1));
      await pending;
      await reader.settle();
      assert.equal(reader.error(), message);
      assert.equal(reader.focus.length, focusCount);
      unchanged();
    }
    const count = reader.requests.length;
    // Resolver permutations live in lib/skill-document-links.test.mjs; keep the integration/security boundary here.
    for (const [href, error] of [["../outside.md", "Outside"], ["javascript:alert(1)", "Outside"], ["image.png", "Unsupported"], ["broken%.md", "Invalid"], ["", "Invalid"], ["https://example.com/guide.md", undefined]]) {
      await reader.navigate(href);
      assert.equal(reader.error(), error && `skills.document${error}`, href);
      assert.equal(reader.requests.length, count, "rejected/external links never reach fetch");
      unchanged();
    }
  }
  reader.click("Back");
  assert.equal(reader.text(), "# Overview");
  assert.equal(reader.scroller.scrollTop, 210);
  assert.equal(reader.buttons().length, 0, "failures never pushed snapshots");
});

test("new navigation and Back abort pending reads and ignore late success/failure", async (t) => {
  const reader = await loaded(t);
  const old = reader.navigate("old.md");
  const latest = reader.navigate("latest.md");
  assert.equal(reader.requests[1].signal.aborted, true);
  await reader.answer("# Stale", 1);
  await old;
  assert.equal(reader.text(), "# Overview");
  assert.equal(reader.status(), "i18n.loading", "stale finally must not clear the newer loading state");
  await reader.answer("# Latest");
  await latest;
  const pending = reader.navigate("slow.md");
  reader.click("Back");
  assert.equal(reader.requests.at(-1).signal.aborted, true);
  reader.requests.at(-1).reject(new Error("late failure"));
  await pending;
  await reader.settle();
  assert.equal(reader.text(), "# Overview");
  assert.equal(reader.error(), undefined);
  assert.equal(reader.status(), undefined);
  assert.equal(reader.buttons().length, 0, "stale success never pushed history");
});

for (const nested of [false, true]) test(`skill changes and unmount ignore late reads (nested=${nested})`, async (t) => {
  const reader = mount(t);
  if (nested) {
    await reader.answer("# Overview");
    await reader.visit("one.md", "# One");
  }
  const pending = nested ? reader.navigate("slow.md") : undefined;
  const stale = reader.requests.length - 1;
  const props = { cwd: "/new-project", filePath: "/skills/new/ROOT.markdown", baseDir: "/skills/new", renderOverview };
  reader.hook.rerender(props);
  assert.equal(reader.requests[stale].signal.aborted, true);
  request(reader, undefined, props);
  await reader.answer("# Stale skill", stale);
  await pending;
  assert.equal(reader.document(), undefined);
  assert.equal(reader.status(), "i18n.loading");
  assert.equal(reader.buttons().length, 0);
  if (nested) {
    await reader.answer("# New skill");
    assert.equal(reader.document(), "ROOT.markdown");
    assert.equal(reader.text(), "# New skill");
  }
  const late = nested ? reader.navigate("unmounted.md") : undefined;
  const tree = reader.hook.result;
  const focusCount = reader.focus.length;
  reader.unmount();
  assert.equal(reader.requests.at(-1).signal.aborted, true);
  await reader.answer("# Too late");
  await late;
  assert.equal(reader.hook.result, tree, "the shim would rerender on any post-cleanup state update");
  assert.equal(reader.focus.length, focusCount);
});

for (const action of ["Back", "Overview"]) test(`bounded history keeps the original overview and recent snapshots for ${action}`, async (t) => {
  const reader = await loaded(t);
  const visits = SKILL_DOCUMENT_HISTORY_LIMIT + 5;
  for (let index = 1; index <= visits; index++) {
    reader.scroller.scrollTop = index * 10;
    await reader.visit(`reference-${index}.md`, `# Reference ${index}`);
  }
  if (action === "Back") {
    for (let step = 1; step < SKILL_DOCUMENT_HISTORY_LIMIT; step++) {
      reader.click(action);
      const index = visits - step;
      assert.equal(reader.document(), `reference-${index}.md`);
      assert.equal(reader.text(), `# Reference ${index}`);
      assert.equal(reader.scroller.scrollTop, (index + 1) * 10);
    }
  }
  reader.click(action);
  overview(reader);
  assert.equal(reader.text(), "# Overview");
  assert.equal(reader.scroller.scrollTop, 10);
  assert.equal(reader.buttons().length, 0);
  assert.equal(reader.requests.length, visits + 1);
});
