# Windows Desktop Launcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (\`- [ ]\`) syntax for tracking.

**Goal:** Let Windows users create a Pi Logo Desktop shortcut that starts a source-checkout Pi Web instance and opens the local browser page.

**Architecture:** Two PowerShell scripts live under \`scripts/windows/\`. The launcher derives the repository root from its own location, starts \`npm.cmd run dev\` only when port 30141 is unused, then opens the loopback URL. The installer creates a Desktop \`.lnk\` that invokes the launcher and points it at a bundled Pi Logo \`.ico\` file. README sections explain setup and a deliberate manual update flow.

**Tech Stack:** Windows PowerShell 5.1+, Windows Script Host shortcut COM API, Node.js/npm, Markdown.

## Global Constraints

- Support a cloned Pi Web repository on Windows; do not add a service, task scheduler entry, or login auto-start.
- Do not set \`PI_CODING_AGENT_DIR\`, run \`git pull\`, or install dependencies automatically.
- Use only \`127.0.0.1:30141\`; do not expose Pi Web on a network interface.
- Include the Pi Logo as a committed \`.ico\` asset; do not download assets at runtime.
- Keep English and Simplified Chinese usage instructions semantically equivalent.

---

## File structure

- \`scripts/windows/Start-PiWeb.ps1\`: Starts or reuses the local dev server and opens the browser.
- \`scripts/windows/Install-PiWebDesktopLauncher.ps1\`: Creates or updates the Desktop shortcut and sets its icon.
- \`scripts/windows/assets/pi-web.ico\`: Pi Logo icon consumed by the installer.
- \`README.md\`: English Windows quick-launch and update instructions.
- \`README.zh-CN.md\`: Simplified Chinese equivalent.

### Task 1: Add the Pi Logo shortcut asset

**Files:**
- Create: \`scripts/windows/assets/pi-web.ico\`

**Interfaces:**
- Produces: an \`.ico\` file at \`$PSScriptRoot\\assets\\pi-web.ico\` for \`Install-PiWebDesktopLauncher.ps1\`.

- [ ] **Step 1: Write the failing asset inspection**

Run:

\`\`\`powershell
$iconPath = Resolve-Path 'scripts/windows/assets/pi-web.ico'
if (-not $iconPath) { throw 'The Pi Web icon is missing.' }
\`\`\`

Expected before adding the asset: path resolution fails.

- [ ] **Step 2: Generate the icon**

Create a multi-size ICO with 16×16, 32×32, 48×48, and 256×256 images from the approved Pi Logo SVG. Preserve the supplied geometry and transparent background.

- [ ] **Step 3: Verify the icon is readable**

Run:

\`\`\`powershell
Add-Type -AssemblyName System.Drawing
[System.Drawing.Icon]::ExtractAssociatedIcon((Resolve-Path 'scripts/windows/assets/pi-web.ico')) | Out-Null
\`\`\`

Expected: no exception.

- [ ] **Step 4: Commit**

\`\`\`powershell
git add scripts/windows/assets/pi-web.ico
git commit -m "feat: add Pi Web shortcut icon"
\`\`\`

### Task 2: Implement the local launcher

**Files:**
- Create: \`scripts/windows/Start-PiWeb.ps1\`

**Interfaces:**
- Consumes: a repository root derived as \`Split-Path (Split-Path $PSScriptRoot -Parent) -Parent\`.
- Produces: one listener on \`127.0.0.1:30141\` and opens \`http://127.0.0.1:30141\`.

- [ ] **Step 1: Write a failing manual invocation**

Run:

\`\`\`powershell
& .\\scripts\\windows\\Start-PiWeb.ps1
\`\`\`

Expected before implementation: the script path does not exist.

- [ ] **Step 2: Implement the launcher**

Derive \`$projectRoot\` from \`$PSScriptRoot\`; set \`$address = 'http://127.0.0.1:30141'\`; verify \`$projectRoot\\package.json\` exists; and probe with:

\`\`\`powershell
$listener = Get-NetTCPConnection -LocalPort 30141 -State Listen -ErrorAction SilentlyContinue
\`\`\`

When no listener exists, start a hidden child PowerShell in \`$projectRoot\` with \`npm.cmd run dev\`, redirect stdout/stderr into a local log directory, and wait in 500 ms intervals for at most 20 seconds. Throw an error naming the stderr log if startup times out. When a listener exists or becomes ready, run \`Start-Process $address\`.

- [ ] **Step 3: Verify the stopped-server path**

Stop Pi Web, invoke the launcher, then run:

\`\`\`powershell
(Invoke-WebRequest -Uri 'http://127.0.0.1:30141' -UseBasicParsing -TimeoutSec 10).StatusCode
\`\`\`

Expected: \`200\`.

- [ ] **Step 4: Verify the already-running path**

Record the listener PID, invoke the launcher again, and run:

\`\`\`powershell
(Get-NetTCPConnection -LocalPort 30141 -State Listen).OwningProcess
\`\`\`

Expected: one listener and the same PID.

- [ ] **Step 5: Commit**

\`\`\`powershell
git add scripts/windows/Start-PiWeb.ps1
git commit -m "feat: add Windows Pi Web launcher"
\`\`\`

### Task 3: Implement Desktop shortcut installation

**Files:**
- Create: \`scripts/windows/Install-PiWebDesktopLauncher.ps1\`

**Interfaces:**
- Consumes: \`Start-PiWeb.ps1\` and \`assets/pi-web.ico\` relative to \`$PSScriptRoot\`.
- Produces: \`%USERPROFILE%\\Desktop\\Pi Web.lnk\` with a hidden PowerShell target, launcher arguments, repository working directory, and Pi Logo icon.

- [ ] **Step 1: Write a failing manual invocation**

Run:

\`\`\`powershell
& .\\scripts\\windows\\Install-PiWebDesktopLauncher.ps1
\`\`\`

Expected before implementation: the script path does not exist.

- [ ] **Step 2: Implement the installer**

Derive the project root, launcher, and icon paths from \`$PSScriptRoot\`; validate each path; then use \`WScript.Shell\` and \`CreateShortcut\` to create \`$env:USERPROFILE\\Desktop\\Pi Web.lnk\`. Set these values:

\`\`\`powershell
$shortcut.TargetPath = "$env:SystemRoot\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"
$shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \`"$launcherPath\`""
$shortcut.WorkingDirectory = $projectRoot
$shortcut.IconLocation = "$iconPath,0"
\`\`\`

Set a concise description, save the shortcut, and print its path.

- [ ] **Step 3: Verify idempotence and metadata**

Run the installer twice. Then inspect the result:

\`\`\`powershell
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut("$env:USERPROFILE\\Desktop\\Pi Web.lnk")
$shortcut.TargetPath
$shortcut.IconLocation
\`\`\`

Expected: one shortcut exists, target is \`powershell.exe\`, and the icon location ends in \`scripts\\windows\\assets\\pi-web.ico,0\`.

- [ ] **Step 4: Verify the shortcut launch**

Stop Pi Web, double-click the shortcut, and confirm \`http://127.0.0.1:30141\` returns HTTP 200.

- [ ] **Step 5: Commit**

\`\`\`powershell
git add scripts/windows/Install-PiWebDesktopLauncher.ps1
git commit -m "feat: add Windows desktop launcher installer"
\`\`\`

### Task 4: Document setup and safe updates in both READMEs

**Files:**
- Modify: \`README.md\`
- Modify: \`README.zh-CN.md\`

**Interfaces:**
- Consumes: \`scripts/windows/Install-PiWebDesktopLauncher.ps1\`.
- Produces: equivalent English and Simplified Chinese guidance for setup, behavior, and manual updates.

- [ ] **Step 1: Write the documentation acceptance check**

Run:

\`\`\`powershell
rg -n "Install-PiWebDesktopLauncher" README.md README.zh-CN.md
\`\`\`

Expected before implementation: no matches.

- [ ] **Step 2: Add the English section**

After Quick Start, add a \`Windows desktop shortcut (source checkout)\` subsection. Explain that it is for a cloned repository whose Node dependencies are installed; show the installer invocation; state that the shortcut starts or reuses a local server and opens loopback only; state that it does not change system execution policy; and show \`git pull --ff-only\` plus \`npm install\` only when dependencies changed.

- [ ] **Step 3: Add the Simplified Chinese section**

Add an equivalent Chinese subsection at the same location. Explicitly state that a failed fast-forward pull should be resolved as local Git changes before retrying.

- [ ] **Step 4: Verify documentation and project checks**

Run:

\`\`\`powershell
rg -n "Install-PiWebDesktopLauncher|127\\.0\\.0\\.1:30141|git pull --ff-only" README.md README.zh-CN.md
node_modules/.bin/tsc --noEmit
npm run lint
git diff --check
\`\`\`

Expected: both READMEs contain the concepts; all checks exit successfully.

- [ ] **Step 5: Commit**

\`\`\`powershell
git add README.md README.zh-CN.md
git commit -m "docs: add Windows desktop launcher guide"
\`\`\`

### Task 5: Review and prepare the pull request

**Files:**
- Review: \`scripts/windows/Start-PiWeb.ps1\`
- Review: \`scripts/windows/Install-PiWebDesktopLauncher.ps1\`
- Review: \`scripts/windows/assets/pi-web.ico\`
- Review: \`README.md\`
- Review: \`README.zh-CN.md\`

- [ ] **Step 1: Review final scope**

Run:

\`\`\`powershell
git diff origin/main...HEAD --stat
git diff --check origin/main...HEAD
git status --short
\`\`\`

Expected: only the designed scripts, icon, and README documentation differ; the working tree is clean.

- [ ] **Step 2: Push and open the PR**

Push \`docs/windows-desktop-launcher\` to the contributor fork. Open a PR against \`agegr/pi-web:main\` with a concise summary, testing evidence, and a note that automatic updates are deliberately excluded.
