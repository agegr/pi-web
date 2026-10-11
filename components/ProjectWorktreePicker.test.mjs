import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { I18nProvider } = await jiti.import("@/hooks/useI18n.tsx");
const { ProjectWorktreePicker, WorktreeRemoveForm } = await jiti.import("./ProjectWorktreePicker.tsx");
const { SidebarMenuSurface, placeSidebarMenu } = await jiti.import("./SidebarMenu.tsx");
const source = await readFile(new URL("./ProjectWorktreePicker.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const menuCss = await readFile(new URL("../app/sidebar-menu.css", import.meta.url), "utf8");

const h = React.createElement;
const noop = () => {};

const context = {
  cwd: "/home/me/work/app-worktrees/feature",
  project: { key: "app-key", root: "/home/me/work/app" },
  worktrees: [
    { path: "/home/me/work/app", branch: "main", isMain: true },
    { path: "/home/me/work/app-worktrees/feature", branch: "feature/x", isMain: false },
  ],
  currentWorktreePath: "/home/me/work/app-worktrees/feature",
  projects: [{ key: "app-key", root: "/home/me/work/app" }, { key: "lib-key", root: "/home/me/work/lib" }],
};

function render(props = {}) {
  return renderToStaticMarkup(h(I18nProvider, null, h(ProjectWorktreePicker, {
    layout: "stacked",
    context,
    mobile: false,
    label: "Project and worktree",
    newWorktreeTitle: "Create a worktree checkout for a branch",
    onPick: noop,
    onUseDefaultDirectory: noop,
    onOpenFolder: noop,
    onRefreshWorktrees: noop,
    onCreateWorktree: async () => ({ error: "unused" }),
    ...props,
  })));
}

/** The source between two anchors. */
function between(start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `${start} … ${end}`);
  return source.slice(from, to);
}

test("inline: the project's name and the branch as text, no path and no notes", () => {
  const html = render({ layout: "inline", homeDir: "/home/me" });
  assert.match(html, /^<div class="project-picker is-inline" role="group" aria-label="Project and worktree">/);
  // A folder icon, the name, a chevron; the whole path only as the tooltip
  // (the menu's rows show it on a desktop).
  assert.match(html, /<button type="button" class="project-picker-button is-project" title="\/home\/me\/work\/app" aria-haspopup="menu" aria-expanded="false"><svg width="12" height="12"[^>]*class="project-picker-icon"[\s\S]*?<\/svg><span class="project-picker-name"><span class="project-picker-leaf">app<\/span><\/span><svg width="9" height="9"[^>]*class="project-picker-chevron sidebar-icon-down"[\s\S]*?<\/svg><\/button>/);
  assert.doesNotMatch(html, /~\/work\/app<|project-picker-label/);
  // The branch, cut at its left, and the chevron: neither "main" nor the count.
  assert.match(html, /class="project-picker-icon is-linked"[\s\S]*?<\/svg><span class="project-picker-path"><span>feature\/x<\/span><\/span><svg width="9" height="9"/);
  const main = render({ layout: "inline", context: { ...context, currentWorktreePath: "/home/me/work/app" } });
  assert.match(main, /<span class="project-picker-path"><span>main<\/span><\/span><svg width="9"/);
  assert.doesNotMatch(html + main, /project-picker-note|project-picker-divider|is-name/);
  // Twins get the parent folder and "/", dim, before the name, each in a
  // span of its own: the parent is cut first, the name last.
  const twins = { ...context, projects: [...context.projects, { key: "old-key", root: "/home/me/old/app" }] };
  assert.match(render({ layout: "inline", context: twins }), /<span class="project-picker-name"><span class="project-picker-parent">work<\/span>\/<span class="project-picker-leaf">app<\/span><\/span>/);
  assert.match(source, /describeProjectChoices\(projectChoices\(context\)\)\.find\(\(\{ choice \}\) => choice\.key === project\.key\)/);
  // The files tab's own: activity elsewhere and the hint for a missing worktree list.
  assert.doesNotMatch(render({ layout: "inline", projectActivity: new Map([["lib-key", { running: 1, unread: 0 }]]) }), /project-picker-activity/);
  // The files' boxes keep their paths and notes.
  assert.doesNotMatch(render({ homeDir: "/home/me" }) + render({ layout: "row" }), /project-picker-name|<svg width="12"/);
});

test("row: the files' boxes below the sessions, side by side, with everything the stacked ones have", () => {
  const activity = new Map([["lib-key", { running: 1, unread: 0 }]]);
  const hint = { label: "Open repo root", title: "Open the repository root to manage worktrees." };
  const subdir = { ...context, worktrees: null, currentWorktreePath: null };
  // The same markup as the files tab's but for the layout: the activity
  // dot, the worktree hint, the menus' minimum width.
  for (const props of [{ homeDir: "/home/me" }, { projectActivity: activity }, { context: subdir, worktreeHint: hint }]) {
    const row = render({ ...props, layout: "row" });
    assert.match(row, /^<div class="project-picker is-row" role="group" aria-label="Project and worktree">/);
    assert.equal(row.replace("project-picker is-row", "project-picker is-stacked"), render(props));
  }
  assert.match(render({ layout: "row", projectActivity: activity }), /project-picker-activity/);
  assert.match(render({ layout: "row", context: subdir, worktreeHint: hint }), /project-picker-button is-inactive/);
  // The main checkout's "main" note stays out of the row: there the box is a
  // share of a narrow sidebar, and the branch needs the room (at 180px the
  // note left it none); the icon, in the accent only for a linked checkout,
  // still tells the main one. The tab and the bar keep the note.
  const mainContext = { ...context, currentWorktreePath: "/home/me/work/app" };
  const mainRow = render({ layout: "row", context: mainContext });
  assert.match(mainRow, /class="project-picker-icon"[\s\S]*?<span class="project-picker-path"><span>main<\/span><\/span><span class="project-picker-note">2<\/span><svg/);
  assert.doesNotMatch(mainRow, /project-picker-note">main</);
  assert.doesNotMatch(mainRow, /is-linked/);
  assert.match(render({ context: mainContext }), /<span class="project-picker-note">main<\/span>/);
  assert.doesNotMatch(render({ layout: "inline", context: mainContext }), /project-picker-note/);
  assert.match(source, /layout: "inline" \| "stacked" \| "row";/);
  assert.match(source, /const stacked = layout !== "inline";/);
  // Side by side, a little lower than the tab's: the worktree box as wide as
  // its branch and notes up to 55% of the row, the project's path taking the
  // rest, cut at its left. A share is safe here: the row is the head's whole
  // width, never as wide as its boxes (the bar's case).
  const rules = css.slice(css.indexOf(".project-picker.is-stacked {"), css.indexOf(".file-viewer-icon-button {"));
  assert.match(rules, /\.project-picker\.is-row \{\s*flex: none;\s*flex-direction: row;\s*\}/);
  assert.match(rules, /\.project-picker\.is-row \.project-picker-button \{\s*height: 26px;\s*\}/);
  assert.match(rules, /\.project-picker\.is-row \.project-picker-button\.is-project \{\s*flex: 1 1 0;\s*\}/);
  assert.match(rules, /\.project-picker\.is-row \.project-picker-button:not\(\.is-project\) \{\s*flex: 0 1 auto;\s*max-width: 55%;\s*\}/);
  assert.match(rules, /\.project-picker\.is-row \.project-picker-label,\s*\.project-picker\.is-row \.project-picker-path \{\s*flex: 1 1 0;\s*\}/);
  // Its boxes keep the common min-width 0, so the path can be cut.
  assert.match(css, /\.project-picker-button \{[^}]*min-width: 0;/);
});

test("stacked: main's two boxes, the project's whole path and the worktree's branch with its notes", () => {
  const html = render({ homeDir: "/home/me" });
  assert.match(html, /^<div class="project-picker is-stacked" role="group" aria-label="Project and worktree">/);
  // The project box is its path, cut at its left: no folder icon, no name, no chevron.
  assert.match(html, /<button type="button" class="project-picker-button is-project" title="\/home\/me\/work\/app" aria-haspopup="menu" aria-expanded="false"><span class="project-picker-path"><span>~\/work\/app<\/span><\/span><\/button>/);
  assert.doesNotMatch(html, /project-picker-divider|is-name/);
  // A linked checkout: its branch icon in the accent, the branch, how many checkouts there are.
  assert.match(html, /<svg width="11" height="11"[^>]*class="project-picker-icon is-linked"[\s\S]*?<\/svg><span class="project-picker-path"><span>feature\/x<\/span><\/span><span class="project-picker-note">2<\/span><svg width="9" height="9"[^>]*class="project-picker-chevron sidebar-icon-down"/);
  // The main checkout says so, its icon not in the accent.
  const main = render({ context: { ...context, currentWorktreePath: "/home/me/work/app" } });
  assert.match(main, /class="project-picker-icon"[\s\S]*?<span class="project-picker-path"><span>main<\/span><\/span><span class="project-picker-note">main<\/span><span class="project-picker-note">2<\/span>/);
  assert.doesNotMatch(main, /is-linked/);
  // A checkout without a branch shows its path.
  const detached = render({ homeDir: "/home/me", context: { ...context, worktrees: [context.worktrees[0], { ...context.worktrees[1], branch: null }] } });
  assert.match(detached, /<span class="project-picker-path"><span>~\/work\/app-worktrees\/feature<\/span><\/span>/);
  // Without the home folder the path shows as it is.
  assert.match(render(), /<span class="project-picker-path"><span>\/home\/me\/work\/app<\/span><\/span>/);
  assert.doesNotMatch(html, /style=/, "no inline styles");
});

test("a project the user named shows that name in its box, in code type, the path as the tooltip", () => {
  const named = { ...context, project: { ...context.project, alias: "Thermal <b>Models</b>" } };
  for (const layout of ["stacked", "row"]) {
    const html = render({ layout, homeDir: "/home/me", context: named });
    assert.match(html, /<button type="button" class="project-picker-button is-project" title="\/home\/me\/work\/app" aria-haspopup="menu" aria-expanded="false"><span class="project-picker-label is-alias">Thermal &lt;b&gt;Models&lt;\/b&gt;<\/span><\/button>/);
    assert.doesNotMatch(html, /~\/work\/app<\/span>/);
  }
  // Inline every project shows a name: this one its own.
  const inline = render({ layout: "inline", homeDir: "/home/me", context: named });
  assert.match(inline, /title="\/home\/me\/work\/app"[^>]*><svg[^>]*>[\s\S]*?<\/svg><span class="project-picker-name"><span class="project-picker-leaf">Thermal &lt;b&gt;Models&lt;\/b&gt;<\/span><\/span>/);
  assert.doesNotMatch(inline, /is-alias|~\/work\/app<\/span>/);
  // In the menus a named project shows its name alone, the full path as the tooltip.
  const projects = between("const projectItems", "const worktreeItems");
  assert.match(projects, /title: choice\.root,/);
  const rules = css.slice(css.indexOf("/* The project and worktree picker (ProjectWorktreePicker)"), css.indexOf(".file-viewer-icon-button {"));
  assert.match(rules, /\.project-picker-label\.is-alias \{\s*color: var\(--text\);\s*font-family: var\(--font-mono\);\s*\}/);
});

test("stacked: activity elsewhere shows a dot; the project in use does not count", () => {
  const elsewhere = render({ projectActivity: new Map([["lib-key", { running: 0, unread: 2 }]]) });
  assert.match(elsewhere, /<span class="project-picker-activity" role="img" title="New activity" aria-label="New activity"><\/span><\/button>/);
  assert.doesNotMatch(render({ projectActivity: new Map([["app-key", { running: 1, unread: 1 }]]) }), /project-picker-activity/);
  assert.doesNotMatch(render({ projectActivity: new Map([["lib-key", { running: 0, unread: 0 }]]) }), /project-picker-activity/);
  // The chips never show it.
  assert.doesNotMatch(render({ layout: "inline", projectActivity: new Map([["lib-key", { running: 1, unread: 0 }]]) }), /project-picker-activity/);
  // In the menu the counts are the session tree's own badge.
  assert.match(source, /badge: activity \? <ActivitySummary running=\{activity\.running\} unread=\{activity\.unread\} t=\{t\} \/> : undefined,/);
});

test("stacked: no project yet, and no worktree list", () => {
  const empty = render({ context: { project: null, worktrees: null, currentWorktreePath: null, projects: [] }, placeholder: "Select project…" });
  assert.match(empty, /<button type="button" class="project-picker-button is-project is-empty" title="" aria-haspopup="menu" aria-expanded="false">/);
  assert.match(empty, /<span class="project-picker-label">Select project…<\/span>/);
  assert.equal((empty.match(/<button /g) ?? []).length, 1);

  // A subdirectory of a git checkout: a disabled row says why, out of the tab order.
  const hint = { label: "Open repo root", title: "Open the repository root to manage worktrees." };
  const subdir = render({ context: { ...context, worktrees: null, currentWorktreePath: null }, worktreeHint: hint });
  assert.match(subdir, /<button type="button" aria-disabled="true" tabindex="-1" title="Open the repository root to manage worktrees\." class="project-picker-button is-inactive"><svg[^>]*class="project-picker-icon"[\s\S]*?<span class="project-picker-label">Open repo root<\/span><\/button>/);
  assert.equal((subdir.match(/aria-haspopup="menu"/g) ?? []).length, 1, "one menu button");
  // A folder outside git gets no hint from the sidebar: the project box
  // alone, in the tab and in the row, where it takes the whole row.
  for (const layout of ["stacked", "row"]) {
    const plain = render({ layout, context: { ...context, worktrees: null, currentWorktreePath: null } });
    assert.equal((plain.match(/<button /g) ?? []).length, 1, layout);
    assert.doesNotMatch(plain, /is-inactive|project-picker-icon/, layout);
  }
  assert.match(css, /\.project-picker\.is-row \.project-picker-button\.is-project \{\s*flex: 1 1 0;\s*\}/);
  // The chips have no hint: the project alone.
  assert.doesNotMatch(render({ layout: "inline", context: { ...context, worktrees: null }, worktreeHint: hint }), /is-inactive|project-picker-divider/);
});

test("both menus in both places: picking what is in use changes nothing while the worktrees are listed", () => {
  const projects = between("const projectItems", "const worktreeItems");
  assert.match(projects, /checked: choice\.key === project\?\.key,/);
  // Without a worktree list (a removed checkout's cwd) the project in use is the way back to its root.
  assert.match(projects, /if \(choice\.key !== project\?\.key \|\| !worktrees\) onPick\(\{ cwd: choice\.root, projectKey: choice\.key, projectRoot: choice\.root \}, "project"\);/);
  // Names, a parent folder only where names collide, the full path as the tooltip.
  assert.match(projects, /describeProjectChoices\(projectChoices\(context\)\)/);
  assert.match(projects, /title: choice\.root,/);
  // Then the default directory and any other folder.
  const defaults = projects.indexOf('label: t("sidebar.useDefaultDirectory"),');
  const other = projects.indexOf('label: t(classic ? "sidebar.customPath" : "sidebar.openOtherProject"),');
  assert.ok(projects.indexOf('{ type: "separator", id: "separator" }') < defaults && defaults < other);
  // No project to list (a first run): no line above the two folder items.
  assert.match(projects, /const separator: SidebarMenuItem\[\] = choices\.length > 0 \? \[\{ type: "separator", id: "separator" \}\] : \[\];/);
  assert.match(projects, /onSelect: \(\) => onUseDefaultDirectory\(\),/);
  assert.match(projects, /onSelect: \(\) => onOpenFolder\(menu\?\.opener \?\? null\),/);

  const worktrees = between("const worktreeItems", "const body = ");
  assert.match(worktrees, /checked: worktree\.path === current\?\.path,/);
  assert.match(worktrees, /if \(project && worktree\.path !== current\?\.path\) \{\s*onPick\(\{ cwd: worktree\.path, projectKey: project\.key, projectRoot: project\.root \}, "worktree"\);/);
  assert.match(worktrees, /note: worktree\.isMain \? t\("sidebar\.main"\) : undefined,/);
  assert.match(worktrees, /label: t\("sidebar\.newWorktree"\),[\s\S]*?onSelect: \(\{ keepOpen \}\) => \{\s*keepOpen\(\);\s*showBody\(\{ kind: "create", busy: false, error: null \}\);/);
  // Opening the worktree menu lists the worktrees again.
  assert.match(source, /if \(kind === "worktree"\) onRefreshWorktrees\(\);/);
  // Both lists get a filter once they are long.
  // The files tab's desktop project menu, as main's, only past 8 projects.
  assert.match(source, /\? \{ placeholder: t\("sidebar\.filterProjects"\), emptyLabel: t\("sidebar\.noMatchingProjects"\), minChoices: classic \? 9 : undefined \}\s*: \{ placeholder: t\("sidebar\.filterWorktrees"\), emptyLabel: t\("sidebar\.noMatchingWorktrees"\) \};/);
  assert.match(source, /filter=\{filter\}/);
});

test("only the files tab removes worktrees, never the main one", () => {
  const worktrees = between("const worktreeItems", "const body = ");
  assert.match(worktrees, /secondary: onRemoveWorktree && !worktree\.isMain \? \{\s*label: t\("sidebar\.removeWorktreeTitle", \{ path: worktree\.path \}\),\s*icon: <TrashIcon size=\{12\} \/>,\s*danger: true,\s*disabled: menu\?\.removing,/);
  assert.match(worktrees, /keepOpen\(\);\s*void removeWorktree\(worktree, false\);/);
  assert.match(source, /onRemoveWorktree\?: \(project: ProjectChoice, path: string, force: boolean\) => Promise<WorktreeRemoval>;/);
});

test("a removal that needs an answer becomes the menu's body; a removed checkout goes back to the list", () => {
  const remove = between("const removeWorktree = async", "const projectItems");
  assert.match(remove, /result = await onRemoveWorktree\(project, worktree\.path, force\);/);
  assert.match(remove, /if \(result === "removed"\) return \{ \.\.\.menuState, removing: false, body: null \};/);
  assert.match(remove, /const dirty = result === "dirty" \|\| \(menuState\.body\?\.kind === "remove" && menuState\.body\.dirty\);/);
  assert.match(remove, /body: \{ kind: "remove", worktree, dirty, busy: false, error: result === "dirty" \? null : result\.error \},/);
  // Only the menu it was asked from takes the answer.
  assert.match(source, /const updateMenu = \(id: number, change: \(state: MenuState\) => MenuState \| null\) => \{\s*setMenu\(\(state\) => \(state\?\.id === id \? change\(state\) : state\)\);/);
  // Force from the body; Cancel takes the focus first, so Enter discards nothing.
  assert.match(source, /onForce=\{\(\) => \{ void removeWorktree\(body\.worktree, true\); \}\}/);
  assert.match(source, /<button type="button" className="sidebar-worktree-cancel" data-sidebar-menu-autofocus="" onClick=\{onCancel\}>/);
  assert.match(source, /focusCancel=\{body\?\.kind === "remove"\}/);
  assert.match(source, /\{dirty && <div className="sidebar-worktree-message">\{t\("sidebar\.forceRemoveCheckout"\)\}<\/div>\}/);
  assert.match(source, /menuTitle = t\("sidebar\.removeWorktreeHeading", \{ name: worktreeLabel\(body\.worktree\) \}\);/);
});

test("the menus on a desktop are main's: whole paths, Custom path, the form under the list, the question in its row", () => {
  assert.match(source, /const classic = !mobile;/);
  const projects = between("const projectItems", "const worktreeItems");
  // The whole path, unless the user named the project.
  assert.match(projects, /const wholePath = classic && choice\.alias === undefined;/);
  assert.match(projects, /label: wholePath \? displayPath\(choice\.root, homeDir\) : name,\s*note: wholePath \? undefined : note \?\? undefined,\s*mono: classic,\s*path: wholePath,/);
  assert.match(projects, /icon: classic \? <PlusIcon size=\{13\} \/> : <FolderPlusIcon size=\{13\} \/>,/);
  const worktrees = between("const worktreeItems", "const body = ");
  // A dirty checkout's question takes its row; the others show their branch, or their path.
  assert.match(worktrees, /classic && body\?\.kind === "remove" && body\.dirty && body\.worktree\.path === worktree\.path \? \{\s*type: "custom",/);
  assert.match(worktrees, /onForce=\{\(\) => \{ void removeWorktree\(worktree, true\); \}\}\s*onCancel=\{\(\) => showBody\(null\)\}/);
  assert.match(worktrees, /label: classic \? worktree\.branch \?\? displayPath\(worktree\.path, homeDir\) : worktreeLabel\(worktree\),\s*mono: classic,\s*path: classic,/);
  // No line before "New worktree…", which goes while its form shows below.
  assert.match(worktrees, /\.\.\.\(classic \? \[\] : \[\{ type: "separator", id: "separator" \} as const\]\),\s*\.\.\.\(classic && body\?\.kind === "create" \? \[\] : \[\{/);
  const chain = between("let menuBody: ReactNode = null;", "const filter = ");
  assert.match(chain, /if \(classic && menu\?\.kind === "worktree"\) \{\s*menuTitle = t\("sidebar\.switchWorktree"\);\s*menuItems = worktreeItems\(\);\s*if \(body\?\.kind === "create"\) \{\s*menuFooter = \(\s*<WorktreeCreateForm\s*heading=\{null\}/);
  assert.match(chain, /onCancel=\{\(\) => showBody\(null\)\}/);
  assert.match(chain, /\} else if \(body\?\.kind === "remove" && body\.error\) \{\s*menuFooter = <div className="sidebar-worktree-error" role="alert">\{body\.error\}<\/div>;/);
  const menu = source.slice(source.indexOf("<SidebarMenu\n"), source.indexOf("</SidebarMenu>"));
  assert.match(menu, /classic=\{classic\}\s*footer=\{menuFooter\}\s*focusKey=\{body \? `\$\{body\.kind\}:\$\{body\.kind === "remove" && body\.dirty\}` : "list"\}/);
  // The question's Cancel takes focus; both its buttons are the menu's items.
  const row = between("function WorktreeConfirmRow(", "\n}\n");
  assert.equal((row.match(/role="menuitem"/g) ?? []).length, 2);
  assert.match(row, /data-sidebar-menu-autofocus=""\s*className="sidebar-worktree-cancel"/);
  assert.match(row, /aria-describedby=\{questionId\}/);
});

test("a created worktree is moved to only while its form is still open", () => {
  const create = between("const createWorktree = async", "const removeWorktree = async");
  const mounted = create.indexOf("if (!mountedRef.current) return;");
  const error = create.indexOf('if ("error" in result) {');
  const open = create.indexOf("if (menuRef.current?.id !== id) return;");
  const pick = create.indexOf('onPickRef.current({ cwd: result.path, projectKey: project.key, projectRoot: project.root }, "worktree");');
  assert.ok(mounted >= 0 && mounted < error && error < open && open < pick, "mounted, error shown, form still open, then the move");
  assert.match(source, /const onPickRef = useRef\(onPick\);\s*onPickRef\.current = onPick;/);
  // A new body is a new menu: the list's pending removal answers nobody.
  assert.match(source, /setMenu\(\(state\) => \(state\?\.kind === "worktree" \? \{ \.\.\.state, id, body, removing: false \} : state\)\);/);
});

test("the owner reaches the buttons and opens a menu through the handle", () => {
  const handle = between("useImperativeHandle(handleRef", "/** Changes the menu");
  assert.match(handle, /button: \(control\) => \(control === "worktree" \? worktreeRef : projectRef\)\.current,/);
  assert.match(handle, /if \(button\) openMenuRef\.current\(control, button\);/);
  assert.match(handle, /\}\), \[\]\);/);
  // A menu is at least as wide as its box, as main's dropdowns were.
  assert.match(source, /const width = Math\.max\(stacked \? STACKED_MENU_MIN_WIDTH : kind === "project" \? 260 : 240, Math\.round\(rect\.width\)\);/);
  // In the row the worktree box is the right one, narrower than its menu:
  // the menu grows leftward from the box's right edge. At the default 260px
  // sidebar (the box from about 128 to 250) it stays over the sidebar
  // instead of reaching about 90px past it over the chat.
  assert.match(source, /const align = layout === "row" && kind === "worktree" \? "end" : "start";/);
  assert.match(source, /anchor: \{ kind: "rect", rect: \{ left: rect\.left, top: rect\.top, right: rect\.right, bottom: rect\.bottom \}, align \},/);
  const minWidth = Number(source.match(/const STACKED_MENU_MIN_WIDTH = (\d+);/)[1]);
  const box = { left: 128, top: 300, right: 250, bottom: 326 };
  const viewport = { left: 0, top: 0, width: 1280, height: 800 };
  const size = { width: minWidth, height: 200 };
  assert.equal(placeSidebarMenu({ kind: "rect", rect: box, align: "end" }, size, viewport).left, 250 - minWidth);
  assert.ok(placeSidebarMenu({ kind: "rect", rect: box, align: "start" }, size, viewport).left + minWidth > 260, "start would run past the sidebar");
});

test("client code stays parseable by Safari 16.2 and its CSS flat", () => {
  assert.doesNotMatch(source, /\(\?<[=!]/, "no RegExp lookbehind");
  const rules = css.slice(css.indexOf("/* The project and worktree picker (ProjectWorktreePicker)"), css.indexOf(".file-viewer-icon-button {"));
  assert.ok(rules.length > 0);
  assert.doesNotMatch(rules.replace(/@media[^{]*\{/g, ""), /\{[^}]*\{|&/, "no nested rules");
  // The files' look, main's: the header buttons' grey box, 11px, the path
  // and the branch in code type, cut at their left (the inline bar overrides
  // it: no box, 12px, the name; see the inline test).
  assert.match(rules, /\.project-picker-button \{\s*display: inline-flex;\s*flex: 0 1 auto;\s*align-items: center;\s*gap: 6px;\s*min-width: 0;\s*height: 29px;\s*padding: 0 10px;\s*border: 1px solid var\(--border\);\s*border-radius: 7px;\s*background: var\(--bg-hover\);/);
  assert.match(rules, /\.project-picker-path \{[^}]*font-family: var\(--font-mono\);[^}]*direction: rtl;/);
  assert.match(rules, /\.project-picker-icon\.is-linked,/);
  assert.doesNotMatch(rules, /is-name|project-picker-divider/);
  assert.match(rules, /\.project-picker-path \{\s*flex: 0 1 auto;\s*min-width: 0;/);
  // The files tab's: full width, the path or branch taking the room before the notes.
  assert.match(rules, /\.project-picker\.is-stacked \{\s*flex: none;\s*flex-direction: column;\s*align-items: stretch;\s*\}/);
  assert.match(rules, /\.project-picker\.is-stacked \.project-picker-button \{\s*width: 100%;\s*\}/);
  assert.match(rules, /\.project-picker\.is-stacked \.project-picker-label,\s*\.project-picker\.is-stacked \.project-picker-path \{\s*flex: 1 1 0;\s*\}/);
  assert.match(rules, /\.project-picker-path > span \{\s*unicode-bidi: plaintext;/);
  assert.match(rules, /\.project-picker-button\.is-inactive,\s*\.project-picker-button\.is-inactive:hover \{[^}]*cursor: default;/);
  assert.match(menuCss, /\.sidebar-worktree-force \{\s*border-color: #ef4444;/);
});

/** The removal body inside the menu surface, as the picker hands it over. */
function removalSurface({ sheet, dirty = true, error = null }) {
  return renderToStaticMarkup(h(I18nProvider, null, h(SidebarMenuSurface, {
    sheet,
    ariaLabel: "Remove feature/x?",
    title: "Remove feature/x?",
    cancelLabel: "Cancel",
    focusCancel: true,
    onActivate: noop,
    onClose: noop,
  }, h(WorktreeRemoveForm, {
    heading: sheet ? null : "Remove feature/x?",
    dirty,
    busy: false,
    error,
    showCancel: !sheet,
    onForce: noop,
    onCancel: noop,
  }))));
}

test("the force question starts on a Cancel on a desktop and in a sheet, never on Force", () => {
  const desktop = removalSurface({ sheet: false });
  assert.equal((desktop.match(/data-sidebar-menu-autofocus=""/g) ?? []).length, 1);
  assert.match(desktop, /<button type="button" class="sidebar-worktree-cancel" data-sidebar-menu-autofocus="">Cancel<\/button>/);
  // The sheet brings its own Cancel, which takes the focus Force would get as the first control.
  const sheet = removalSurface({ sheet: true });
  assert.equal((sheet.match(/data-sidebar-menu-autofocus=""/g) ?? []).length, 1);
  assert.match(sheet, /<button type="button" class="sidebar-worktree-force">Force<\/button>/);
  assert.match(sheet, /<button type="button" class="sidebar-sheet-cancel" data-sidebar-menu-autofocus="">Cancel<\/button><\/div><\/div>$/);
  assert.doesNotMatch(sheet, /sidebar-worktree-cancel/, "one Cancel in the sheet");
  // A failure without the question: the error, and still Cancel first.
  const failed = removalSurface({ sheet: true, dirty: false, error: "locked" });
  assert.doesNotMatch(failed, /sidebar-worktree-force/);
  assert.match(failed, /<div class="sidebar-worktree-error" role="alert">locked<\/div>/);
});

test("the menu gets one child, null while it lists items", () => {
  const menu = source.slice(source.indexOf("<SidebarMenu\n"), source.indexOf("</SidebarMenu>"));
  assert.match(menu, /focusKey=\{[\s\S]+?"list"\}\s*>\s*\{menuBody\}\s*$/);
  assert.match(source, /let menuBody: ReactNode = null;/);
  // Each body goes with its own title, and a list with no body at all.
  const chain = between("let menuBody: ReactNode = null;", "const filter = ");
  assert.match(chain, /\} else if \(body\?\.kind === "create"\) \{\s*menuTitle = newWorktreeTitle;\s*menuBody = \(\s*<WorktreeCreateForm/);
  assert.match(chain, /\} else if \(body\?\.kind === "remove"\) \{\s*menuTitle = [^;]+;\s*menuBody = \(\s*<WorktreeRemoveForm/);
  assert.match(chain, /\} else if \(menu\?\.kind === "project"\) \{\s*menuTitle = t\("workspace\.project"\);\s*menuItems = projectItems\(\);/);
});

test("clipped labels keep their descenders in both places", () => {
  const rules = css.slice(css.indexOf("/* The project and worktree picker (ProjectWorktreePicker)"), css.indexOf(".file-viewer-icon-button {"));
  assert.match(rules, /\.project-picker \{[^}]*line-height: 1;/);
  assert.match(rules, /\.project-picker-label,\s*\.project-picker-path,\s*\.project-picker-name \{\s*line-height: normal;\s*\}/);
  assert.match(rules, /\.project-picker-name \{[^}]*overflow: hidden;/);
  assert.match(rules, /\.project-picker-label \{[^}]*overflow: hidden;/);
  assert.match(rules, /\.project-picker-path \{[^}]*overflow: hidden;/);
});
