# Pi Agent Web - Agent-Facing Deep Architecture, lifecycle, & Crash-Avoidance Manual 🛡️

This document is a highly concentrated, single-source technical reference covering system design, critical React state machines, underlying IPC lifecycles, core algorithms, and development-specific traps. It serves as the primary guidance for AI coding agents and core developers looking to understand or modify the `pi-web` codebase.

---

## 🚀 1. Quick Start & Developer Sandbox

```bash
# Start local Next.js development server (port 3030)
npm run dev

# strict type checking (Run before pushing or making layout edits)
node_modules/.bin/tsc --noEmit

# lint checking 
node node_modules/next/dist/bin/next lint
```

> ⚠️ **CRITICAL DEV WARNING:** Never execute `next build` inside a dynamic local workspace development sandbox. It populates `.next/` with raw standalone output, breaking hot reloading triggers and generating phantom bundler path collisions.

---

## 🏛 2. Communication & Session Lifecycle Architecture

```
Browser (Visual Client)     Next.js Host-Server API           AgentSession (In-Process Runtime)
     │                                │                                │
     ├─ GET /api/sessions ────────────┼─▶ Read ~/.pi/agent/sessions/   │ (No session created
     ├─ GET /api/sessions/[id] ───────┼─▶ Reads .jsonl file directly   │  for static browsing)
     │                                │                                │
     ├─ POST /api/agent/[id]  ────────┼─▶ startRpcSession() ───────────┼─▶ createAgentSession()
     │  (Message Payload)             │   (Checks singleton locks)     │   instantiates actual Pi
     │                                │   session.send(cmd) ──────────▶│   session.prompt() loop
     │                                │                                │
     └─ GET /api/agent/[id]/events ───┼─▶ Establishes SSE stream  ◀────┼─▶ session.subscribe()
                                      │   (Converts events to SSE)     │
```

There are two operation modes depending on user action:
1. **Browse-Only Mode (Read-Only)**: Interrogating past branches, loading historical logs, and path navigations are totally stateless. The Host-Server API directly deserializes `.jsonl` lines using high-speed buffered IO via `lib/session-reader.ts`. **No active agent process is spawned.**
2. **Interactive Dialogue Mode (Active)**: Initiated by `/api/agent/new` or `/api/agent/[id]`. A full in-memory Node.js runner process `AgentSession` is hydrated and linked.

---

## ⚡ 3. Critical Implementation Traps & Safeguards

### A. The In-Process Global Object Lifecycle Lock (`lib/rpc-manager.ts`)
* **The Problem**: Node.js module-level variables or standard React Maps are instantly erased or initialized during Next.js Hot Component Rebuilds.
* **The Solution**: Live wrappers (`AgentSessionWrapper`) must be pinned directly onto `globalThis.__piSessions`. This keeps active agent execution loops intact through hot-reloads.
* **Timeout Boundary**: If an active session is left untouched, a background timer frees up the memory by destroying the session exactly **10 minutes** after idle.
* **Concurrency Protection**: During SSE reconnection, multiple POST/GET calls can enter concurrently. To prevent double-instantiation, `globalThis.__piStartLocks` manages a single atomic lock promise. Never bypass this lock.

### B. Immediate Destruction Registry Policy on Session Forking
* **The Trap**: When a user clicks the "Fork" button on an assistant message, the backend calls `AgentSession.fork()`. **This inbounds a mutation of the wrapper’s inner state in-place**, replacing its identifier with the newly split sub-session ID. Any residual cached session pointer registered under the parent ID inside the global map will now contain a corrupted parent session link, causing cascade splits!
* **The Fix**: The moment `send("fork")` return value is fetched inside the RPC loop, **`this.destroy()` must be immediately called** to scrub the outdated session from the registry. The next interaction with either the parent or the child session will safely reload a fresh, pristine instance from the correct `.jsonl` file.

### C. Multi-Branch Divergences (Fork vs. In-Session Branching)
Never conflate the two completely distinct tree-routing state machines:

| Machine Dimension | 🍴 Forking System (New File) | 🌿 In-Session Branching (Node Switching) |
| :--- | :--- | :--- |
| **Physical File** | Creates a **brand new independent** `.jsonl` file. | Appends new entries with matching `parentId`s to the **same** `.jsonl`. |
| **Sidebar Hierarchy** | Displayed as a sub-node in the sidebar via the `parentSession` header field value. | Kept under a single, unified project row item. |
| **Workspace Routing** | Switches the active file path to the new branch. | Emits a `/api/sessions/[id]/context?leafId=` query to prune/reconstruct the local timeline path. |

### D. Checked Files Synchronization Drifts in Git Panel
* **The Trap**: When fetching a new git status (`git status -s`), if you aggressively reconstruct or blindly copy the `checkedFiles` set directly over from the previous mount, entries for files that are already committed or reverted will hang around in the selection memory. The checkboxes will drift, causing unwanted rollback side effects.
* **The Guardrail**: On every git status fetch, `fetchGitStatus` must completely rebuild `checkedFiles` by doing a filter-intersection: keep only the files that are still present in the newly resolved `modifiedFiles` file-list.

### E. Chinese Filename (CJK Path) Octal Quote Escaping
* **The Trap**: On non-English environments, `git status -s` quotes Chinese paths using octal escapes (e.g., `"\346\216\245\345\217\245.md"`). This breaks the workspace tree-node compiler and creates unreadable file explorer structures.
* **The Fix**: Every invocation to the local OS Shell must explicitly disable core path quoting:
  ```bash
  git -c core.quotePath=false status -s
  ```
  Never strip, trim, or alter characters from `git status` output before evaluating status prefix codes (such as ` M` or `??`). The first two characters of row responses represent vital file metadata. Trimming prematurely corrupts the first character of the path.

---

## 🧮 4. Advanced High-UX Algorithms

### A. Minimap Fisheye Lens & Displaced Tooltip Spreading
To provide an interactive scrolling minimap on ultra-long, dense conversations, a high-performance linear expansion and dynamic physical positioning algorithm is implemented:

```typescript
// For every dot inside the ChatMinimap corresponding to message node i:
const yRatio = item.offsetY / parentHeight;
const delta = Math.abs(yRatio - mouseHoverYRatio);

// Proximity range set to 15% viewport height
if (delta < 0.15) {
  // Gaussian-like push factor
  const force = Math.pow((0.15 - delta) / 0.15, 2);
  const scale = 1.0 + force * 0.8; // Scales up exactly up to 1.8x
  const dispY = (yRatio > mouseHoverYRatio ? 12 : -12) * force; // Push adjacent dots outwards
  
  // Apply visual-coordinates
  applyStyle(dot, {
    transform: `translateY(${dispY}px) scale(${scale})`,
    transition: 'transform 0.1s cubic-bezier(0.16, 1, 0.3, 1)',
    zIndex: 10
  });
}
```
The tooltip calculates its floating Y-coordinate absolute offset based on this translated `dispY` variable so they never overlap or drift off-center.

### B. Caret-Aware Non-Destructive Slash Trigger Split
In `ChatInput.tsx`, slash triggers can be summoned in place for inline Skill execution, breaking the traditional constraint of "slash must be the absolute first character of the textarea":

```typescript
// Trigger extraction formula
const selectionStart = textarea.selectionStart;
const textBeforeCursor = fullVal.slice(0, selectionStart);

// Match at start of line OR after whitespace
const hasSlashMatch = /(^|\s)\/$/.test(textBeforeCursor) || /(^|\s)\/\w+$/.test(textBeforeCursor);

if (hasSlashMatch) {
  const match = textBeforeCursor.match(/\/(\w*)$/);
  const filterQuery = match ? match[1] : "";
  triggerMenu(filterQuery);
}

// Precision replacement when a Skill is selected
const preText = fullVal.slice(0, slashIndex); // Preserve prefix text exactly
const postText = fullVal.slice(selectionStart); // Preserve suffix text exactly
setTextAreaValue(`${preText}/${selectedSkill}${postText}`);
```

### C. Safe Viewport Buffer & Resonant Autoscroll
To ensure long texts and multi-line code cards keep their top edge readable (in-viewport), the autoscroll engine is balanced using a flexible buffer:

* **Traditional issue**: Immediate `scrollTop = scrollHeight` pushes the beginning of long code blocks out of view, forcing the user to fight the scroller.
* **The Buffer System**: We append a permanent `180px` air cushion footer (`safe-scrolling-spacer`) at the bottom of the chat view.
* When appending streaming tokens:
  ```typescript
  const clientHeight = chatViewport.clientHeight;
  const currentScroll = chatViewport.scrollTop;
  const totalHeight = chatViewport.scrollHeight;
  const distanceToBottom = totalHeight - (currentScroll + clientHeight);

  // Auto-scrolling is only invoked if the user was already sitting comfortably near the bottom
  if (distanceToBottom < 300) {
    chatViewport.scrollTo({
      top: totalHeight - clientHeight - 120, // Keeps the active writing zone center-aligned
      behavior: "smooth"
    });
  }
  ```

---

## 🏗️ 5. Next.js Host-Server API Reference

| Endpoint | Method | Payload / Queries | Expected JSON Response |
| :--- | :--- | :--- | :--- |
| `/api/sessions` | `GET` | — | `SessionMetadata[]` (grouped and indexed by normalized CWD paths) |
| `/api/sessions/[id]` | `GET` | — | The compiled active linear chat nodes matching resolved branches. |
| `/api/sessions/[id]` | `PATCH` | `{ parentSession?: string, name?: string }` | Success confirmation. |
| `/api/sessions/[id]/context` | `GET` | `?leafId=XXXX` | Full reconstructed timeline context of the selected file tree branch. |
| `/api/agent/new` | `POST` | `{ cwd, message, toolNames[], provider?, modelId? }` | `{ id: SessionId }` |
| `/api/agent/[id]` | `GET` | — | Return active execution flags: `{ isStreaming, thinkingLevel, isCompacting }` |
| `/api/agent/[id]` | `POST` | Dialogue control JSON primitives | Emits synchronous control triggers. |
| `/api/agent/[id]/events` | `GET` | — | Standard Server-Sent Events (SSE) stream pipe loop. |
| `/api/git-status` | `POST` | Action parameter `{ action: "status"\|"diff"\|"commit" }` | Unified Git payloads. |

---

## 🎨 6. Tailwind & CSS Global Variables (`app/globals.css`)

Always strictly map styles to the unified Design Tokens:
- **`--bg`**: Core canvas background color.
- **`--bg-panel`**: Container/sidebar/visual-panel overlays.
- **`--bg-hover`**: Snug row hovers, navigation lines (`22px` height line states).
- **`--bg-selected`**: Highlighting active files/tabs.
- **`--accent`**: Interactive highlights.
- **`--font-mono`**: Raw code segments & tree status codes.
- **`--border`**: Clean dividing rules. No shadows, minimal 1px borders.
- **`--text-dim`**: Used to mark auxiliary hints (e.g., deleted diff line markings).

---

## 🧩 7. Integration: Tauri Desktop Client Packaging & Sidecars

This web application operates as a standalone Desktop Client on native OS when wrapped with Rust Tauri:
* **The Client Shell (Tauri)**: Acts as a pure sandboxed native browser frame. Direct hardware commands (such as file reads/writes, child processes, local compilers spawning) are disabled inside the frontend.
* **The Standalone Sidecar (pkg & standalone Next)**: Next.js is compiled to standalone mode (`output: "standalone"`). It is bundled into a single binary (`pi-web-backend.exe`) using `@vercel/pkg`.
* **Port Discovery**: Tauri scans for an available local port (starting from `30141`), spawns the Next.js backend binary as an OS sidecar process with `PORT=XXXX`, and points its local WebView instance to `http://localhost:XXXX`.
* **Zombie Interception**: When Tauri exits, Rust kills the OS child process handle. As a fail-safe, the Node.js backend actively monitors its parent process handle and immediately performs a self-terminate `process.exit(0)` if it detects an orphaned IPC connection.
