# Pi Agent Web - Sidebar Redesign (Project-Session Unified Tree)

This document permanentizes the lessons, decisions, and architectural details derived from the minimalist single-column Sidebar redesign in **May 2026**. Keep these guidelines in mind during future UI refactorings.

---

## 1. Architectural Drivers

* **Single-column Consolidation Over Vertical Activity Bars**: Vertical activity bars (such as VS Code/Slack-style narrow left ribbons) waste valuable layout width and split related project files, directory explorer controls, and session lists apart. Merging workspace configuration directly into collapsible nested project nodes is the gold standard for layout cohesion.
* **Extreme Minimalism (Zero Emojis, Barebone Indents)**: Visual clutter is reduced by avoiding cartoonish folder graphical emojis (`📂`/`📁`). The hierarchy is elegantly conveyed through clean rotatable carets (`▶` / `▼`), lightweight subtle dashed tree-guide indents (`borderLeft: "1px dashed var(--border)"`), text line-height tight-ups, and varying text-muted colors.
* **Self-Contained State Capsule**: All calculations of active CWD selection, `localStorage` hydration / state mutation, validation fallback, and workspace folder index maintenance must live solely inside `components/SessionSidebar.tsx`. Keep `components/AppShell.tsx` oblivious to lower-level directory changes to maintain app-level decoupling.

---

## 2. Core Interactive State Machines

The Sidebar relies on three tightly coupled state vectors. Changes to any of them require meticulous attention to maintain seamless sync:

```
  [User Toggle/Select Project]
               │
               ▼
       1. selectedCwd (CWD Selection Updates)
               │
               ├─▶ 2. Automatically focus and restore pickSessionForCwd()
               ├─▶ 3. Updates FileExplorer root matching CWD (Bottom Panel)
               └─▶ 4. Re-anchors "New Session" context instantly
```

### A. Non-Destructive Concealment (`hiddenCwds` vs `recentCwds`)
* **UX Specification**: When a project card is closed/removed using the `×` button, it must **never destructively delete** any physical logs or forget associated sessions. Instead, it temporarily fades from sight but keeps its history perfectly stored under-the-hood.
* **Mechanism**:
  * **Hide**: Clicking `×` moves the CWD path into a `localStorage` record under the namespace `pi-hidden-cwds`, excluding it from current rendered memo groups. If the deleted project was active, auto-focuses the next nearest unhidden workspace.
  * **Unhide / Exact Restore**: When the same path is subsequently reopened via `Add Project Directory...`, it is instantly deleted from `hiddenCwds`. The whole CWD folder subtree (and its associated forks) rises back into view intact.

### B. Golden Layout Space Formula
To prevent sidebar overflows and折行 (unwanted wraps) on compact high-density screens:
```typescript
{
  ITEM_HEIGHT: 44, // Perfectly snug session row heights
  PROJECT_HEADER_HEIGHT: 5, // Squeezed paddings (Padding: 5px 6px)
  PADDING_LEFT_DEPTH_COEFFICIENT: (depth: number) => (depth > 0 ? depth * 12 + 6 : 6)
}
```

---

## 3. Implementation Guardrails

* **Shadow variables & Scope Collisions**: Avoid duplicating helper indicators or derived constants globally (e.g. `activeProjectCwd = selectedCwdProp ?? selectedCwd`). Ensure you do not declare shadow versions inside nested `useMemo` hooks or callback scopes, as it instantly causes block-scoped rededication errors.
* **Never Skip Compiler Sanity Testing**:
  Hot-rebuild modules in Next.js could implicitly swallow nested JSX tree syntax discrepancies or mismatched types during development. Before pushing/staging, always trigger a formal validation:
  ```bash
  node_modules/.bin/tsc --noEmit
  ```
  This is the primary shield protecting concurrent wrapper instances (`globalThis.__piSessions`) from freezing or losing hot reloading threads.

---

## 4. Retained Layout Structure Map

```
 components/SessionSidebar.tsx Layout Structure:
 ┌──────────────────────────────────────────────────────────┐
 │ [PiAgentTitle (Animated logo)]           [New] [Refresh] │ (Unified Minimalist Row)
 ├──────────────────────────────────────────────────────────┤
 │ [+ Add Project Directory...]                             │ (Simple line button trigger)
 ├──────────────────────────────────────────────────────────┤
 │                                                          │
 │   ▶ Project path A  (e.g. pi-web)                    [×] │ (Click to collapse / hide)
 │     │                                                    │
 │     ├── 📝 session item 1 (Latest session)               │
 │     └── 📝 session item 2                                │
 │                                                          │
 │   ▼ Project path B                                   [×] │
 │     │                                                    │
 │     ├── 📝 session item 3                                │
 │     │     └── 📝 fork sub-branch (Depth-based offset)    │
 │     └── 📝 session item 4                                │
 │                                                          │
 ├──────────────────────────────────────────────────────────┤
 │  ================= RESIZE DRAG BAR ====================  │ (Supports explorer fractional resize)
 ├──────────────────────────────────────────────────────────┤
 │  [▶] EXPLORER (Lower Panel)                              │ (Displays files associated with active CWD)
 └──────────────────────────────────────────────────────────┘
```

Maintain this pattern to protect layout density while delivering maximum vertical and horizontal visual comfort.
