# Workspace Terminals

The Explorer terminal action opens or focuses a terminal for its selected cwd
in the right panel's existing tab bar. Each terminal tab keeps the cwd it was
created with. Files still mount only their active viewer; terminal panels stay
mounted behind inactive tabs, hidden panels, and session or project switches.

## Lifecycle

- Each new tab generates a random terminal ID before creation. Creation with
  the same ID and cwd is idempotent, including React Strict Mode's repeated
  effects. An existing ID cannot be reused for another cwd.
- `sessionStorage` retains terminal IDs, cwds, and the active terminal layout
  across refresh. Restored tabs first check the existing server instance and
  never silently start replacement processes after expiry or server restart.
- A new PTY gets a 120-second connection lease. Subscribing cancels expiry;
  the last subscriber leaving starts a new 120-second grace period. This also
  collects creations that never establish their initial connection.
- Hiding a panel, switching tabs, and unmounting a component only disconnect
  clients. Explicitly terminating a tab waits for creation and in-flight input
  before deleting the PTY. Restart waits for termination before creating a new
  ID. Failed termination leaves the tab available to retry.
- A shell exit closes the SSE stream and retains its output and exit code in
  the browser. Unobserved server records expire after the same grace period.
- Explicit termination and expiry signal the shell, escalating to SIGKILL after
  two seconds if it ignores SIGHUP. Server shutdown force-kills shells immediately.

## Transport

Output events carry a monotonically increasing UTF-16 offset in SSE `id`.
Reconnections use `Last-Event-ID` (or `after` on an explicit reconnect) and send
only the missing suffix. The server keeps at most 128 KiB of UTF-16 code units;
an older cursor triggers a terminal reset and bounded history replay. This is
bounded output history, not a serialized full-screen terminal snapshot. Slow
SSE consumers are disconnected once their response queue fills.

Input and resizes are serialized. Pending adjacent input is batched so remote
connections do not require one round trip per keystroke; large pastes are split
without splitting Unicode characters. Failed input is not retried because its
delivery may be ambiguous. Reconnect attaches to the same process with a fresh
writer; restart explicitly replaces the process.

`bin/prepare-terminal.js` repairs node-pty 1.1.0's macOS spawn-helper executable
bits during installation, including published/npm-installed Pi Web packages.

## Verification

Run `npm test` for native PTY, lease, output cursor, input queue, and storage
checks. `npm run test:terminal` starts an isolated development server and runs
desktop/mobile browser checks using generated session fixtures. Install the
Playwright Chromium browser first with `npx playwright install chromium`.
The browser check prints the temporary location of its screenshots and log.
