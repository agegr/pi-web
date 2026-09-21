import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

// Importing the module is a parse smoke test.
const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
await jiti.import("./SessionSidebar.tsx");

const source = await readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8");

function sliceBetween(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.ok(start !== -1, `marker not found: ${startMarker}`);
  const end = source.indexOf(endMarker, start);
  assert.ok(end !== -1, `end marker not found after ${startMarker}: ${endMarker}`);
  return source.slice(start, end);
}

test("the explorer section set is built from pins plus the selector's own selection", () => {
  assert.match(source, /import \{ buildExplorerRoots \} from "@\/lib\/explorer-roots";/);
  assert.match(
    source,
    /const explorerRoots = useMemo\(\s*\(\) => buildExplorerRoots\(pinnedProjects, explorerSelection\),\s*\[pinnedProjects, explorerSelection\],\s*\);/,
  );
  // The trailing-section selection is dedicated sidebar state.
  assert.match(source, /const \[explorerSelection, setExplorerSelection\] = useState<ProjectSelection \| null>\(null\);/);
});

test("session clicks never move the explorer selection", () => {
  const body = sliceBetween(
    "const handleSelectSessionFromList = useCallback(",
    "}, [onSelectSession]);",
  );
  assert.match(body, /if \(s\.cwd\) setSelectedCwd\(s\.cwd\);/);
  assert.doesNotMatch(body, /setExplorerSelection/);
});

test("pane-focus prop sync never moves the explorer selection", () => {
  const body = sliceBetween(
    "const lastSyncedCwdPropRef = useRef<string | null>(null);",
    "}, [selectedCwdProp]);",
  );
  assert.match(body, /setSelectedCwd\(selectedCwdProp\);/);
  assert.doesNotMatch(body, /setExplorerSelection/);
});

test("pinned-group [+] never moves the explorer selection", () => {
  const body = sliceBetween(
    "const handleNewSessionInProject = useCallback(",
    "}, [stalePinnedRoots, onNewSession]);",
  );
  assert.match(body, /setSelectedCwd\(project\.root\);/);
  assert.doesNotMatch(body, /setExplorerSelection/);
});

test("worktree actions never move the explorer selection", () => {
  for (const [start, end] of [
    ["const handleCreateWorktree = useCallback(", "}, [wtNewBranch, wtBusy, worktreeState]);"],
    ["const handleRemoveWorktree = useCallback(", "}, [worktreeState, wtBusy, currentWorktreePath]);"],
  ]) {
    const body = sliceBetween(start, end);
    assert.doesNotMatch(body, /setExplorerSelection/);
  }
});

test("explicit workspace-selector actions are the only explorer-selection writers", () => {
  // Dropdown row select.
  const dropdownStart = source.indexOf("visibleProjects.map((project) => (");
  assert.ok(dropdownStart !== -1);
  const dropdownBody = source.slice(dropdownStart, source.indexOf("onTogglePin={() => togglePin", dropdownStart));
  assert.match(dropdownBody, /setSelectedCwd\(project\.root\);/);
  assert.match(dropdownBody, /setExplorerSelection\(project\);/);
  // Custom-path commit.
  const commitBody = sliceBetween(
    "const commitCustomPath = useCallback(",
    "}, [customPathValue, customPathValidating]);",
  );
  assert.match(commitBody, /setExplorerSelection\(\{ root: data\.projectRoot, key: data\.projectKey \}\);/);
  // Default-directory shortcut: identity from projectFor with a synthetic
  // fallback so a session-less default directory still gets a trailing
  // section (pi#18).
  const defaultBody = sliceBetween(
    "const handleDefaultCwd = useCallback(",
    "}, [projectFor]);",
  );
  assert.match(defaultBody, /setExplorerSelection\(projectFor\(data\.cwd\) \?\? syntheticProjectFor\(data\.cwd\)\);/);
  // One-shot initial auto-select / URL restore.
  assert.match(
    source,
    /if \(target\) \{[\s\S]*?setExplorerSelection\(\{ root: target\.projectRoot \?\? target\.cwd, key: workspaceKeyOf\(target\) \}\);/,
  );
  assert.match(
    source,
    /const projects = getRecentProjects\(allSessions\);[\s\S]*?setExplorerSelection\(projects\[0\]\);/,
  );
});

test("the sidebar mounts the multi-root container, not a single-cwd FileExplorer", () => {
  assert.doesNotMatch(source, /<FileExplorer\b/);
  assert.doesNotMatch(source, /fileExplorerRef/);
  assert.match(source, /import \{ MultiRootFileExplorer, type MultiRootFileExplorerHandle \} from "\.\/MultiRootFileExplorer";/);
  const mountStart = source.indexOf("<MultiRootFileExplorer\n");
  assert.ok(mountStart !== -1, "MultiRootFileExplorer JSX mount not found");
  const mount = source.slice(mountStart, source.indexOf("/>", mountStart));
  assert.match(mount, /roots=\{explorerRoots\}/);
  assert.match(mount, /staleRoots=\{stalePinnedRoots\}/);
  assert.match(mount, /refreshKey=\{explorerKey\}/);
  assert.match(mount, /onChangesCountChange=\{setChangesCount\}/);
  assert.match(mount, /onUploadBusyChange=\{setExplorerUploadBusy\}/);
  assert.match(mount, /fileSearchOpen=\{fileSearchOpen\}/);
  assert.match(mount, /onFileSearchOpenChange=\{setFileSearchOpen\}/);
  assert.match(mount, /changesCollapsed=\{changesCollapsed\}/);
});

test("the toolbar delegates upload to the container and disables root-dependent actions with no roots", () => {
  assert.match(source, /multiRootExplorerRef\.current\?\.openUploadPicker\(\)/);
  assert.match(source, /disabled=\{explorerUploadBusy \|\| explorerRoots\.length === 0\}/);
  assert.match(source, /disabled=\{explorerRoots\.length === 0\}/);
  // The explorer section stays mounted with an empty root set: no
  // selectedCwd gate wraps it anymore.
  assert.doesNotMatch(source, /\{\(selectedCwdProp \|\| selectedCwd\) && \(/);
});

test("the file-search button routes its OPEN path through the container handle", () => {
  // Review-FAIL blocker 2 fix: opening goes through openFileSearch (which
  // expands the deterministic target section first), only closing toggles
  // the local state directly.
  assert.match(
    source,
    /if \(fileSearchOpen\) \{[\s\S]*?setFileSearchOpen\(false\);[\s\S]*?return;[\s\S]*?multiRootExplorerRef\.current\?\.openFileSearch\(\);/,
  );
  // The direct toggle that bypassed the handle is gone.
  assert.doesNotMatch(source, /setFileSearchOpen\(\(open\) => !open\)/);
});

test("selectedCwd keeps driving new-session defaults, highlighting and the terminal", () => {
  assert.match(source, /onClick=\{\(\) => onOpenTerminal\(selectedCwd \?\? selectedCwdProp!\)\}/);
  assert.match(source, /const handleNewSession = useCallback\(\(\) => \{[\s\S]*?if \(!selectedCwd\) return;/);
});
