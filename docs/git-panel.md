# Git Panel Design (`components/GitPanel.tsx`)

A premium, IntelliJ-IDEA-inspired Git visualizer integrated as a dockable right-side panel tab. It mirrors the bottom-left EXPLORER's visual language (zero-emoji, 22px row height, foldable sections with chevron toggles).

---

## Activation Flow

```
User clicks "Git" button in header
  → AppShell pushes { id: "file:git", label: "Git", filePath: "git" } tab
  → FileViewer intercepts filePath === "git"
  → Renders <GitPanel cwd={cwd} />
```

- No new route needed — virtual tab only
- Reuses the right panel's existing resizable container (TabBar)
- The Git button highlights with `--accent` border when the Git tab is active and the right panel is open

---

## Three Section Layout

### 1. CHANGES (变更清单)
- **flex: 2** when open, `flex: 0 0 auto` when collapsed
- **Toolbar**: Select All / Rollback / Pull / Push(+dropdown Force Push) / Refresh(SVG)
- **File tree**: Recursive tree built from `git status -s` output
  - Folder rows: chevron + `FolderIcon` + name + (right-aligned file count badge)
  - File rows: checkbox + `getFileIcon` + filename + status label (M/U/D/!)
  - Double-click any file → opens diff modal
- **Commit form**: Input + "Commit" button at the bottom

### 2. BRANCHES (分支管理)
- **flex: 1** when open
- **Create branch**: `+` button (top-right), expands inline form
- **Branch list**: 22px rows
  - Current branch → highlighted with `(current)` suffix
  - Click a non-current branch → shows checkout / merge / delete buttons
- **Sync bar**: Fetch / Pull buttons

### 3. HISTORY (提交日志)
- **flex: 2** when open
- **Commit list**: Hash + message in 22px rows
- **Detail panel**: Click a commit → shows bottom panel with file changes
  - Double-click a file in the detail panel → opens historical diff modal

---

## Tree Rendering

```typescript
function buildFileTree(files: GitFileInfo[]): FileTreeNode
```

**Rules:**
- Splits each `file.path` on `/` or `\\`
- Creates nested `FileTreeNode` objects with `{ name, fullPath, isFolder, children, fileEntry? }`
- `renderTreeNodes()` recursively renders the tree:
  - Folders: chevron (rotates on expand) + FolderIcon + name + **recursive file count badge**
  - Files: checkbox + getFileIcon + name + status label

**Indentation:**
```
folder: paddingLeft = 8 + depth * 16
file:   paddingLeft = 8 + depth * 16 + 13
```

**Row height:** 22px (matches bottom-left EXPLORER)

---

## Diff Modal

A full-viewport overlay (fixed, z-index 1000):
- `width: min(1300px, 94vw)`, `height: 82vh`
- Backdrop: `rgba(0,0,0,0.5)` + `backdrop-filter: blur(2.5px)`
- Header: shows file path + "Working Copy" or commit hash
- Conflict resolution: "Keep Ours" / "Keep Theirs" buttons appear when `isConflict === true`
- Diff body: simple line-by-line comparison with `+` / `-` / ` ` signs
  - Added lines: green bg (`rgba(34,197,94,0.06)`)
  - Deleted lines: red bg (`rgba(239,68,68,0.06)`)

---

## API Contract (`POST /api/git-status`)

| Action | Body | Response |
|--------|------|----------|
| `status` | `{ cwd, action: "status" }` | `{ branch, ahead, behind, modifiedFiles[], history[], isClean }` |
| `diff` | `{ filePath, commitHash? }` | `{ oldContent, newContent }` or `{ binary: true }` |
| `commit` | `{ commitMessage }` | success |
| `rollback` | `{ rollbackFiles[] }` | success |
| `push` | `{ forcePush?: boolean }` | success |
| `pull` | — | success |
| `fetch` | — | success |
| `checkout` | `{ branchName }` | success |
| `merge` | `{ targetBranch }` | `{ conflicted?: boolean }` |
| `create-branch` | `{ branchName }` | success |
| `delete-branch` | `{ branchName }` | success |
| `list-branches` | — | `{ local[], remote[] }` |
| `commit-files` | `{ branchName }` | `{ files: { status, file }[] }` |
| `resolve-conflict` | `{ filePath, resolveConflictMode: "mine"\|"theirs" }` | success |

---

## Styling Rules

1. **No emojis anywhere.** Use SVG icons that match the EXPLORER style.
2. **One canonical chevron**: `<Chevi open={boolean} />` — `viewBox="0 0 10 10"`, `strokeWidth="1.8"`, `polyline points="3 2 7 5 3 8"`. Rotates 90° when open.
3. **Section header font**: `fontSize: 11, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase"`, same as EXPLORER's "EXPLORER" header.
4. **Background**: `"none"` for section headers (no panel background, just text).
5. **Row hover**: `var(--bg-hover)`, selected: `var(--bg-selected)`.
6. **Status labels**: Single uppercase letter (M / U / D / !) with semantic color.
7. **No nesting `<button>` inside `<button>`** — use `<div>` wrapper + separate buttons to avoid React hydration errors.

---

## Key Traps

- **Hydration error**: The "新建" create-branch button must be outside the section `<button>`. Use `<div>` wrapper with two independent `<button>` children.
- **Section flex when collapsed**: Set `flex: "0 0 auto"` when `secOpen.* === false` to avoid leaving empty space inside the panel.
- **Status prefix trimming**: `git status -s` returns `" M package.json"`. Do `.trim()` BEFORE slicing — trimming first removes the space prefix, corrupting the 2-char status code and shifting filenames by 1 character.
- **Binary file detection**: `git diff` on `.png`/`.jpg`/`.webp`/`.mp3`/`.mp4` files corrupts the output. The API route detects these by extension and returns `{ binary: true }`.
