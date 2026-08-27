/**
 * External open actions for the file tree's "open with" menu: hand a path to
 * the OS file manager (reveal/select) or launch a URL scheme's registered
 * handler (vscode://, cursor://, zed://, custom schemes).
 *
 * The client runs in a browser / DSH Desktop renderer where a raw `vscode://`
 * navigation is unreliable, so both actions fan out through this host route
 * and spawn the platform opener with an argv array (no shell interpolation).
 * The command builders are pure — the platform is injectable — so every
 * per-platform branch is unit-testable without spawning anything.
 */
import { spawn } from 'node:child_process'
import { parentOf, requireAbsolute } from './fs-tree'
import { SidebarError } from './wire'

/** The two external open actions the route accepts. */
export type OpenExternalAction = 'reveal' | 'url'

/** One platform opener invocation (argv array — never a shell string). */
export interface ExternalCommand {
  command: string
  args: string[]
}

/** Reveal/select a path in the OS file manager. On Linux there is no common
 *  select protocol — the containing directory is opened instead (KISS). */
export function revealCommand(path: string, platform: NodeJS.Platform = process.platform): ExternalCommand {
  switch (platform) {
    case 'darwin':
      return { command: 'open', args: ['-R', path] }
    // `explorer /select,<path>` — the classic "show in folder" incantation.
    // Passed as separate argv entries (no shell); verify on Windows, with
    // `cmd /c start "" explorer.exe "/select,<path>"` as the fallback.
    case 'win32':
      return { command: 'explorer.exe', args: ['/select,', path] }
    default: {
      const parent = parentOf(path)
      return { command: 'xdg-open', args: [parent ?? path] }
    }
  }
}

/** Hand a custom-scheme URL to the OS protocol handler. */
export function urlCommand(url: string, platform: NodeJS.Platform = process.platform): ExternalCommand {
  switch (platform) {
    case 'darwin':
      return { command: 'open', args: [url] }
    // url.dll,FileProtocolHandler launches the registered protocol handler;
    // `cmd /c start "" <url>` is the fallback if rundll32 misbehaves.
    case 'win32':
      return { command: 'rundll32.exe', args: ['url.dll,FileProtocolHandler', url] }
    default:
      return { command: 'xdg-open', args: [url] }
  }
}

/** Validate a URL-scheme open target: a parseable custom-scheme URL (never
 *  http/https — those would only dump the URL into a browser tab). */
export function validateExternalUrl(raw: string): string {
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
    throw new SidebarError('bad-request', 'url must be a custom-scheme URL')
  }
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new SidebarError('bad-request', 'invalid url')
  }
  if (url.protocol === 'http:' || url.protocol === 'https:') {
    throw new SidebarError('bad-request', 'only custom-scheme urls can be opened externally')
  }
  return raw
}

/**
 * Launch one external open action and return immediately (detached, no
 * stdio). Spawn failures are reported through the child's 'error' event —
 * by then the route already returned, so the event is swallowed (the OS
 * dialog about a missing handler is the user-visible outcome either way).
 */
export function launchExternal(action: OpenExternalAction, value: string): { started: true } {
  const platform = process.platform
  const spec = action === 'reveal'
    ? revealCommand(requireAbsolute(value), platform)
    : urlCommand(validateExternalUrl(value), platform)
  const child = spawn(spec.command, spec.args, { detached: true, stdio: 'ignore' })
  child.on('error', () => { /* opener missing/denied: handled by the OS */ })
  child.unref()
  return { started: true }
}
