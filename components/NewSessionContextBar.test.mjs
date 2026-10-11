import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { I18nProvider } = await jiti.import("@/hooks/useI18n.tsx");
const { NewSessionContextBar } = await jiti.import("./NewSessionContextBar.tsx");
const source = await readFile(new URL("./NewSessionContextBar.tsx", import.meta.url), "utf8");
const chatWindowSource = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const contextSource = await readFile(new URL("../lib/new-session-context.ts", import.meta.url), "utf8");

const h = React.createElement;
const noop = () => {};

const context = {
  cwd: "/work/app-worktrees/feature",
  project: { key: "app-key", root: "/work/app" },
  worktrees: [
    { path: "/work/app", branch: "main", isMain: true },
    { path: "/work/app-worktrees/feature", branch: "feature/x", isMain: false },
  ],
  currentWorktreePath: "/work/app-worktrees/feature",
  projects: [{ key: "app-key", root: "/work/app" }],
};

function render(props = {}) {
  return renderToStaticMarkup(h(I18nProvider, null, h(NewSessionContextBar, {
    context,
    mobile: false,
    initialFocus: null,
    onInitialFocusDone: noop,
    onPick: noop,
    onUseDefaultDirectory: noop,
    onOpenFolder: noop,
    onRefreshWorktrees: noop,
    onCreateWorktree: async () => ({ error: "unused" }),
    ...props,
  })));
}

test("the bar shows the project's name and the worktree's branch as two menu buttons", () => {
  const html = render();
  // No visible label: the folder icon says what the row is; the group keeps its name.
  assert.match(html, /^<div class="new-session-context"><div class="project-picker is-inline" role="group" aria-label="New session location"><button /);
  assert.equal((html.match(/New session location/g) ?? []).length, 1);
  // The project: a 12px folder icon, its name in code type, a chevron; the
  // full path is the tooltip (and the menu's rows), never the button's text.
  assert.match(html, /<button type="button" class="project-picker-button is-project" title="\/work\/app" aria-haspopup="menu" aria-expanded="false"><svg width="12" height="12"[^>]*class="project-picker-icon" aria-hidden="true"><path d="M3 8a2[^"]*"><\/path><\/svg><span class="project-picker-name"><span class="project-picker-leaf">app<\/span><\/span><svg width="9" height="9"[^>]*class="project-picker-chevron sidebar-icon-down" aria-hidden="true">/);
  assert.doesNotMatch(html, /project-picker-path"><span>\/work\/app</);
  // The worktree: the branch icon (the accent for a linked checkout), the
  // branch cut at its left, a chevron; no "main" note and no count.
  assert.match(html, /<button type="button" class="project-picker-button" title="Worktree: \/work\/app-worktrees\/feature" aria-haspopup="menu" aria-expanded="false"><svg width="11" height="11"[^>]*class="project-picker-icon is-linked"[\s\S]*?<\/svg><span class="project-picker-path"><span>feature\/x<\/span><\/span><svg width="9" height="9"[^>]*class="project-picker-chevron sidebar-icon-down"[\s\S]*?<\/svg><\/button><\/div><\/div>$/);
  const main = render({ context: { ...context, currentWorktreePath: "/work/app" } });
  assert.match(main, /class="project-picker-icon" aria-hidden="true">[\s\S]*?<span class="project-picker-path"><span>main<\/span><\/span><svg width="9"/);
  assert.doesNotMatch(main, /project-picker-note|is-linked/);
  assert.doesNotMatch(html, /project-picker-note|project-picker-divider|style=/);
  // The paths (the menus', a detached checkout's in the worktree button)
  // show the home folder as ~, asked for once per page (the bar mounts
  // again with every move).
  assert.match(source, /homeDir=\{homeDir\}/);
  assert.match(source, /homeDirCheck \?\?= fetch\("\/api\/home"\)/);
  assert.match(source, /const \[homeDir, setHomeDir\] = useState\(\(\) => homeDirFound\);/);
  assert.match(source, /if \(homeDirFound\) return;\s*let cancelled = false;/);
  // The side padding is the header's (ChatWindow), on phones too.
  assert.match(render({ mobile: true }), /^<div class="new-session-context"><div class="project-picker is-inline"/);
  // The files tab's picker, with the bar's own title for "New worktree…".
  assert.match(source, /<ProjectWorktreePicker\s+handleRef=\{pickerRef\}\s+layout="inline"/);
  assert.match(source, /label=\{t\("workspace\.newSessionContext"\)\}/);
  assert.match(source, /newWorktreeTitle=\{t\("sidebar\.newWorktreeForSession"\)\}/);
  assert.match(source, /onUseDefaultDirectory=\{onUseDefaultDirectory\}/);
  assert.doesNotMatch(source, /onRemoveWorktree|SidebarMenu/, "the bar removes nothing, and its menus are the picker's");
});

test("the project's name is the menus': its display name, else its folder's, its parent only where names collide", () => {
  const twins = { ...context, projects: [{ key: "app-key", root: "/work/app" }, { key: "other", root: "/other/app" }] };
  // The parent and "/" outside the name's own span: the parent is cut first.
  assert.match(render({ context: twins }), /<span class="project-picker-name"><span class="project-picker-parent">work<\/span>\/<span class="project-picker-leaf">app<\/span><\/span>/);
  // A project the user named: that name alone, the path still the tooltip.
  const named = { ...twins, project: { ...context.project, alias: "Thermal <b>Models</b>" } };
  const html = render({ context: named });
  assert.match(html, /title="\/work\/app"[^>]*><svg[^>]*>[\s\S]*?<\/svg><span class="project-picker-name"><span class="project-picker-leaf">Thermal &lt;b&gt;Models&lt;\/b&gt;<\/span><\/span>/);
  assert.doesNotMatch(html, /project-picker-parent|is-alias/);
  // A name only the list knows (a move names its project by key and root).
  const listed = { ...context, projects: [{ key: "app-key", root: "/work/app", alias: "Listed" }] };
  assert.match(render({ context: listed }), /<span class="project-picker-name"><span class="project-picker-leaf">Listed<\/span><\/span>/);
});

test("the worktree button needs a worktree list: a non-git folder or a subdirectory has none", () => {
  const html = render({ context: { ...context, cwd: "/work/app/sub", project: { key: "/work/app/sub", root: "/work/app/sub" }, worktrees: null, currentWorktreePath: null } });
  assert.match(html, /title="\/work\/app\/sub"[^>]*>[\s\S]*?<span class="project-picker-name"><span class="project-picker-leaf">sub<\/span><\/span>/);
  assert.doesNotMatch(html, /Worktree:|project-picker-divider|is-inactive/);
  assert.equal((html.match(/aria-haspopup="menu"/g) ?? []).length, 1);
  // A detached checkout shows its path, cut at its left as a branch is.
  assert.match(
    render({ context: { ...context, worktrees: [{ path: "/work/app", branch: null, isMain: true }], currentWorktreePath: "/work/app" } }),
    /title="Worktree: \/work\/app"[^>]*>[\s\S]*?picker-path"><span>\/work\/app<\/span>/,
  );
});

test("the control a move came from takes focus in the bar of the new composer", () => {
  assert.match(source, /const from = initialFocusRef\.current;\s*if \(!from\) return;\s*initialFocusRef\.current = null;\s*onInitialFocusDoneRef\.current\(\);\s*const picker = pickerRef\.current;\s*focusIfLost\(document, \(from === "worktree" \? picker\?\.button\("worktree"\) : null\) \?\? picker\?\.button\("project"\) \?\? null\);/);
});

test("the header: the brand and its versions line, then the bar right above the composer, only while the page is empty", () => {
  const start = chatWindowSource.indexOf("{isEmptyNew && (\n          <div className=\"new-session-hero\"");
  assert.ok(start > 0);
  const hero = chatWindowSource.slice(start, chatWindowSource.indexOf("{chatInputElement}", start));
  // The composer's side padding and width; the logo, then "Pi Web" over its
  // versions line; then the bar, the header's last child, so the composer
  // follows it. Nothing on the right: no versions block, no float.
  const shape = hero.match(/^\{isEmptyNew && \(\s*<div className="new-session-hero" style=\{\{ paddingLeft: 16, paddingRight: isMobile \? 16 : 52 \}\}>\s*<div className="new-session-hero-inner" style=\{\{ maxWidth: "var\(--chat-content-max-width, 820px\)" \}\}>\s*<div className="new-session-brand">\s*<Image src="\/icons\/apple-touch-icon\.png" width=\{40\} height=\{40\} alt="" priority className="new-session-logo" \/>\s*<div className="new-session-brand-text">\s*<span className="new-session-brand-name">Pi Web<\/span>\s*<span className="new-session-meta">([\s\S]*?)<\/span>\s*<\/div>\s*<\/div>\s*\{newSessionContextBar\}\s*<\/div>\s*<\/div>\s*\)\}\s*$/);
  assert.ok(shape, hero);
  // The versions line: the version in use, the update link when there is
  // one (→ v<latest> ↗), then pi's.
  assert.match(shape[1], /^\s*<span>web v\{process\.env\.NEXT_PUBLIC_APP_VERSION \?\? "0\.0\.0"\}<\/span>\s*<NewSessionUpdateLink label=\{\(version\) => t\("appUpdate\.releaseNotes", \{ version \}\)\} \/>\s*<span aria-hidden="true">·<\/span>\s*<span className="new-session-meta-pi">pi v\{process\.env\.NEXT_PUBLIC_PI_VERSION \?\? "0\.0\.0"\}<\/span>\s*$/);
  assert.doesNotMatch(chatWindowSource, /new-session-versions|new-session-hero-row|new-session-version"/);
  // Nothing renders the bar elsewhere.
  assert.equal((chatWindowSource.match(/newSessionContextBar\}/g) ?? []).length, 1);
});

test("the update link: once per page, in the versions line, styled by classes", () => {
  assert.match(chatWindowSource, /let appUpdateCheck: Promise<AppUpdateResponse \| null> \| null = null;\s*let appUpdateFound: AppUpdateResponse \| null = null;/);
  assert.match(chatWindowSource, /appUpdateCheck \?\?= fetch\("\/api\/app-update"\)/);
  // A failure is forgotten: a later header asks again.
  assert.match(chatWindowSource, /\.catch\(\(\) => \{[^}]*appUpdateCheck = null;\s*return null;/);
  // A later header has the link in its first paint.
  assert.match(chatWindowSource, /useState<AppUpdateResponse \| null>\(\(\) => appUpdateFound\);/);
  assert.match(chatWindowSource, /if \(appUpdateFound\) return;\s*let cancelled = false;/);
  const link = chatWindowSource.slice(chatWindowSource.indexOf("function NewSessionUpdateLink("), chatWindowSource.indexOf("function hasFinalAssistantAnswer("));
  assert.match(link, /if \(!update\) return null;/);
  assert.match(link, /<>\s*<span className="new-session-meta-arrow" aria-hidden="true">→<\/span>\s*<a\s+className="new-session-update"\s+href=\{update\.releaseUrl\}\s+target="_blank"\s+rel="noopener noreferrer"\s+title=\{accessibleLabel\}\s+aria-label=\{accessibleLabel\}\s*>\s*v\{update\.latestVersion\}\s*<svg width="10" height="10"[^>]*aria-hidden="true">/);
  assert.match(link, /const accessibleLabel = label\(update\.latestVersion\);/);
  assert.doesNotMatch(link, /style=|onMouseEnter|onMouseLeave/, "its look is the CSS's");
});

test("client code stays parseable by Safari 16.2 and its CSS flat", () => {
  for (const file of [source, contextSource]) {
    assert.doesNotMatch(file, /\(\?<[=!]/, "no RegExp lookbehind");
  }
  const header = css.slice(css.indexOf(".new-session-hero-inner {"), css.indexOf("/* The project and worktree picker (ProjectWorktreePicker)"));
  const rules = css.slice(css.indexOf(".new-session-hero-inner {"), css.indexOf(".file-viewer-icon-button {"));
  assert.ok(header.length > 0 && rules.length > header.length);
  assert.doesNotMatch(rules.replace(/@media[^{]*\{/g, ""), /\{[^}]*\{|&/, "no nested rules");
  // None of the old one-row machinery: no float, inline boxes, zero line
  // height, calc() or fixed 40px lines.
  assert.doesNotMatch(header, /float|inline-block|vertical-align|line-height: 0;|calc\(|new-session-versions|new-session-hero-row/);
  assert.doesNotMatch(rules, /@container|container-type/);
  assert.match(header, /\.new-session-hero-inner \{\s*margin: 0 auto;\s*\}/);
  // The brand: the 40px logo, then "Pi Web" over its versions line, in code type.
  assert.match(header, /\.new-session-brand \{\s*display: flex;\s*align-items: center;\s*gap: 12px;\s*min-width: 0;\s*margin-bottom: 20px;\s*\}/);
  assert.match(header, /\.new-session-logo \{\s*flex: none;\s*width: 40px;\s*height: 40px;\s*\}/);
  assert.match(header, /\.new-session-brand-text \{\s*display: flex;\s*flex-direction: column;\s*gap: 2px;\s*min-width: 0;\s*font-family: var\(--font-mono\);\s*\}/);
  assert.match(header, /\.new-session-brand-name \{\s*color: var\(--text\);\s*font-size: 22px;\s*font-weight: 700;\s*line-height: 1\.15;\s*white-space: nowrap;\s*\}/);
  // One line of meta: pi's version gives way first; the version in use and
  // the update link are never cut.
  assert.match(header, /\.new-session-meta \{\s*display: flex;\s*align-items: center;\s*gap: 6px;\s*min-width: 0;\s*color: var\(--text-dim\);\s*font-size: 11px;\s*line-height: 1\.4;\s*white-space: nowrap;\s*\}/);
  assert.match(header, /\.new-session-meta > \* \{\s*flex: none;\s*\}/);
  assert.match(header, /\.new-session-meta > \.new-session-meta-pi \{\s*flex: 0 1 auto;\s*min-width: 0;\s*overflow: hidden;\s*text-overflow: ellipsis;\s*\}/);
  // The link's box: padding offset by equal negative margins, so hover and
  // focus never move the line, and a taller tap target on a coarse pointer.
  const update = header.match(/\.new-session-update \{\s*display: inline-flex;\s*align-items: center;\s*gap: 3px;\s*margin: -(\d+)px -(\d+)px;\s*padding: (\d+)px (\d+)px;\s*border-radius: 5px;\s*color: var\(--accent\);\s*font-weight: 600;\s*text-decoration: none;/);
  assert.ok(update);
  assert.deepEqual([update[1], update[2]], [update[3], update[4]]);
  assert.match(header, /\.new-session-update:hover,\s*\.new-session-update:focus-visible \{\s*background: var\(--bg-hover\);\s*\}/);
  // Its ring inside that box, clear of the "→" and "·" beside it.
  assert.match(header, /\.new-session-update:focus-visible \{\s*outline: 2px solid var\(--accent\);\s*outline-offset: -2px;\s*\}/);
  assert.match(header, /@media \(pointer: coarse\) \{\s*\.new-session-update \{\s*margin-top: -8px;\s*margin-bottom: -8px;\s*padding-top: 8px;\s*padding-bottom: 8px;\s*\}/);
  // Phones: a smaller brand, 16px above the bar.
  assert.match(header, /@media \(max-width: 640px\) \{\s*\.new-session-brand \{\s*margin-bottom: 16px;\s*\}\s*\.new-session-logo \{\s*width: 32px;\s*height: 32px;\s*\}\s*\.new-session-brand-name \{\s*font-size: 20px;\s*\}\s*\}/);
  // The bar: a 28px row that never wraps, pulled left by the project
  // button's own padding, so its folder icon stands on the logo's and the
  // composer card's edge.
  const row = header.match(/\.new-session-context \{\s*display: flex;\s*flex-wrap: nowrap;\s*align-items: center;\s*min-width: 0;\s*min-height: 28px;\s*margin: 0 0 6px -(\d+)px;\s*\}/);
  assert.ok(row);
  const button = rules.match(/\.project-picker\.is-inline \.project-picker-button \{\s*gap: 4px;\s*height: 26px;\s*padding: 0 (\d+)px;\s*border: 0;\s*border-radius: 6px;\s*background: transparent;\s*\}/);
  assert.ok(button);
  assert.equal(row[1], button[1]);
  // Touch: the buttons' 36px make the row 36px; no margins make up for them.
  assert.equal((rules.match(/\.new-session-context \{/g) ?? []).length, 1);
  assert.match(rules, /@media \(pointer: coarse\) \{\s*\.project-picker-button \{\s*min-height: 36px;\s*\}\s*\}/);
  // The picker inline: 12px, 2px apart, no box until hovered or open.
  assert.match(rules, /\.project-picker\.is-inline \{\s*gap: 2px;\s*font-size: 12px;\s*\}/);
  assert.match(rules, /\.project-picker\.is-inline \.project-picker-button:hover,\s*\.project-picker\.is-inline \.project-picker-button\[aria-expanded="true"\] \{\s*background: var\(--bg-hover\);\s*\}/);
  assert.match(rules, /\.project-picker-button:focus-visible \{\s*outline: 2px solid var\(--accent\);/);
  // On a narrow row the branch gives way first, cut at its left (a long
  // branch beside "pi-web" took the name's last pixels at 375px when both
  // shrank with their text; at a factor of 1000 "work/app" still lost
  // 2/64px, enough for "wo…"), then the name, cut at its end; each down to
  // a width of its own. Never a share of the row (60% of a lone project
  // button, in a repo subdirectory, once left it 0px wide).
  assert.match(rules, /\.project-picker\.is-inline \.project-picker-button\.is-project \{\s*min-width: 56px;\s*\}/);
  assert.match(rules, /\.project-picker\.is-inline \.project-picker-button:not\(\.is-project\) \{\s*min-width: 72px;\s*flex-shrink: 1000000;\s*\}/);
  // A twin's dim parent folder gives way before the name ("/" never): with
  // one span the cut fell on the name and left only the parent (at a factor
  // of 1000 a 24-character name still lost its last letter beside it).
  assert.match(rules, /\.project-picker-name \{\s*display: inline-flex;\s*min-width: 0;\s*max-width: 28ch;\s*overflow: hidden;\s*color: var\(--text-dim\);\s*font-family: var\(--font-mono\);\s*white-space: nowrap;\s*\}/);
  assert.match(rules, /\.project-picker-parent \{\s*flex: 0 1000000 auto;\s*min-width: 0;\s*overflow: hidden;\s*text-overflow: ellipsis;\s*\}/);
  assert.match(rules, /\.project-picker-leaf \{\s*flex: 0 1 auto;\s*min-width: 0;\s*overflow: hidden;\s*color: var\(--text\);\s*text-overflow: ellipsis;\s*\}/);
  assert.match(rules, /\.project-picker\.is-inline \.project-picker-path \{\s*max-width: 32ch;\s*\}/);
  assert.match(rules, /\.project-picker-path \{[^}]*direction: rtl;/);
  assert.match(rules, /\.project-picker-label,\s*\.project-picker-path,\s*\.project-picker-name \{\s*line-height: normal;\s*\}/);
  assert.doesNotMatch(rules.slice(0, rules.indexOf(".project-picker.is-stacked {")), /max-width: [1-9]\d?%/);
  // While the phone keyboard is up the bar goes; the brand stays.
  const keyboard = css.slice(css.indexOf("@media (max-width: 640px), (pointer: coarse) and (max-height: 500px) {"));
  assert.match(keyboard, /html\[data-keyboard-open\] \.new-session-context \{\s*display: none !important;/);
  assert.doesNotMatch(keyboard, /new-session-(brand|hero|meta|logo)/);
});
