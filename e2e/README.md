# CI and browser regression tests

Adapted from @Nuctori's CI/E2E proposal in #617 and #599. The performance
scanner, reverse reader, sidebar changes, and timing benchmarks are not included.

```sh
npm ci
npx playwright install chromium
npm run test:e2e
```

The script starts and stops its own Turbopack dev server on an available
loopback port. Run it in a checkout without an active dev server; Next.js
shares `.next/dev/lock` within a checkout. All fixtures are created before
startup in a temporary `PI_CODING_AGENT_DIR` and removed on completion.
No model credentials or existing Pi sessions are needed. Git is required for
the linked-worktree fixture.

CI runs lint, type checking, and unit tests in one job. A separate job builds
the application in a clean checkout and runs the same browser tests with
`E2E_SERVER_MODE=start` against `next start`. Do not build in a checkout used
for development.

Coverage:

- A 5,000-message session opens with exactly the last 50 entries, bounded
  detail/context responses, and no browser errors.
- Desktop and mobile scrolling load two consecutive older pages. Each response
  has the expected IDs, no gaps or duplicates, and the messages appear once in
  the chat. A small session checks pagination through the root.
- Branch context follows the selected leaf and excludes the other branch.
- Markdown, code blocks, and real tool-call/tool-result blocks render.
- Chat width and font size persist, existing drafts resize, and short settings
  panels keep every language option reachable on desktop and mobile.
- Interface/chat and monospace font lists and weights apply live, survive
  refresh, sync between tabs and reset independently without changing width or
  font size. Headings and Markdown emphasis retain their weights.
- On a desktop the sidebar shows the files below the sessions; Settings ›
  General › File browser brings back the Sessions | Files tabs and returns,
  without remounting the file tree (its file search keeps its query).
- Unknown sessions and paths outside the fixture project are rejected.
- Sidebar sessions open in browser tabs (`session-navigation.mjs`, desktop
  Chromium, one context so tabs share storage): a plain click and Enter
  select in place without a page load; Ctrl+click, middle-click and the row
  menu's Open in new tab (right-click, ⋯, T; just before Delete) open the clicked row's session in
  a new tab while the original keeps its own; both tabs keep their session
  through reloads; pinned and archived rows link the same way; nothing
  creates, copies or prompts a session; a missing session's link selects none
  in a fresh profile; a keyboard Fork puts focus on the copy row's link.
- Project groups offer Open in new tab (`project-navigation.mjs`, desktop
  and mobile Chromium): the current linked worktree, another project's root,
  and a pinned project without sessions open as fresh composers. Reload keeps
  that destination, not a remembered session. The original tab keeps its
  session, directory, draft, files and group expansion; + still opens in the
  same tab, and no session is created, copied, prompted or stopped. An
  unavailable directory shows the validation error instead of another session.
- The model picker, with a synthetic catalog: on a phone, a simulated keyboard
  (visual viewport shrink, pan, a late height with no event) keeps the same
  filter focused and the list in the visible viewport. Native phone keyboards
  still need real-device verification.
- Settings › Models drags a custom provider's models within it (never into
  another provider) and moves them with Alt+↑/↓, keeps the moved row focused,
  keeps the selected model open and its row mounted while it is edited, sorts
  shown names once with A–Z, appends later additions, and saves only the changed array order
  while preserving rename tracking (`model-order.mjs`, desktop and phone widths,
  mocked config routes).
- A local extension checks dialog keyboard navigation, Esc cancellation,
  collapse/expand draft preservation, countdown display, server-side expiry,
  and that `setEditorText` replaces the composer's draft while `pasteToEditor`
  inserts at the caret.
- The production assistant header keeps its height and numeric columns when streaming metrics appear, update and disappear. Static component renders cover digit boundaries with proportional and monospace fonts, without a live model. Run this check alone with `node e2e/streaming-metrics.mjs` (1280, 390 and 320px).

Model prompts, live model streaming, and agent execution are outside this suite.
Failures save a screenshot, Playwright trace, and server log under
`test-results/e2e/`; CI uploads that directory. Open a trace with
`npx playwright show-trace test-results/e2e/trace.zip`.

## HTTP connection pool mechanism acceptance (standalone)

```sh
PLAYWRIGHT_BROWSERS_PATH=/path/to/existing/ms-playwright node e2e/http-connection-pool.mjs
```

Uses the repository's Playwright and an already cached Chromium; it does not
install dependencies or download a browser. Requires `openssl` on `PATH`.
This check **does not start Next.js, contact an existing Pi Web instance, read
agent configuration, or run a model**. It serves only synthetic HTML/JSON/SSE
on ephemeral `127.0.0.1` ports, launches Chromium with an empty temporary home,
and blocks browser requests outside the fixture origin.

Controls distinguish encryption from multiplexing:

- HTTP/1.1 and HTTPS + HTTP/1.1 each hold six real `EventSource` streams.
  An ordinary JSON `fetch` remains pending and has not reached the server in
  an approximately 800ms observation window. Closing exactly one SSE stream
  lets that same fetch reach the server and complete promptly.
- HTTPS + HTTP/2 uses the actual `createHttp2Gateway({ backendPort, cert, key })`
  helper in `bin/http2-gateway.js`, in front of `startPoolFixture("http1")`.
  A single page holds twelve SSE streams while the fetch succeeds. The browser
  must actually negotiate `h2`; backend probes/streams must actually use `1.1`.
- Another gateway context holds eight same-origin pages and sixteen logical
  SSE streams (two per page). After warming each page with the streams held,
  twenty sequential short fetches (ten GET, ten POST with verified JSON echo)
  rotate across those pages. All streams must stay open without errors/reconnects.
  Warm p95 must be <500ms, max <2000ms, and no request may hit the 5s deadline.
  Closing one stream and then its page must release their backend sockets,
  while the other fourteen streams continue receiving new events.
- Gateway observations record completed frontend TLS connections and HTTP/2
  sessions separately from logical SSE streams: observed totals, concurrent
  peaks and active counts. Browser snapshots exclude the later Node Origin
  control; final snapshots include it when present and are taken after cleanup.
  These are measurements, not assertions that Chromium must use exactly one
  physical connection/session.
- A trusted-certificate Node HTTP/2 client sends an Origin-only POST without
  Fetch Metadata. Backend counters independently verify unchanged public
  Host/Origin, `x-forwarded-proto=https`, and HTTP/1.1. Explicit `:authority`
  uses the public URL, not Node's default derived from the TLS `servername`.

JSON lines on stdout record the Chromium version, actual navigation and fetch
`nextHopProtocol`, server-side HTTP/ALPN protocols, whether probes reached the
server, every measured duration, and nearest-rank p50/p95/max. Redirect stdout
and stderr to a log outside the checkout to retain evidence; failures exit
nonzero. Durations measure browser fetch through JSON consumption, not
Playwright RPC overhead. These conservative thresholds are **local mechanism
acceptance, not a production performance guarantee**. The positive cases
validate the production gateway helper with synthetic backend data, not a
production Next server or the launcher. Default HTTP still has the demonstrated
browser pool limit. `startPoolFixture`, `openEventStreams`, `createTestTls` and
`bounded` are exported for the separate Next forwarding check.

Self-signed certificates live only in the temporary directory and are ignored
only by the isolated HTTPS test contexts, never installed into system trust.
Each scenario closes EventSources, contexts, HTTP/2 sessions and server sockets.
A 90s whole-script deadline enters `finally` cleanup; an additional 15s cleanup
watchdog bounds hangs. Temporary certificates/home are removed on success or
failure. No generated output or certificate belongs in the repository.

## Production HTTPS launcher acceptance (standalone)

```sh
PLAYWRIGHT_BROWSERS_PATH=/path/to/existing/ms-playwright \
E2E_GATEWAY_PACKAGE_DIR=/tmp/candidate-pi-web/package \
E2E_GATEWAY_ARTIFACTS=/tmp/pi-web-gateway-evidence \
node e2e/http2-gateway.mjs
```

Requires an **existing published/build artifact** with `.next/BUILD_ID`, its
runtime dependencies, cached Chromium and `openssl`. Prepare an isolated,
disposable candidate package before running: its `bin/*.js` copies must match
this checkout's candidate files. The script verifies every candidate bin file
using SHA-256 before startup and saves the hash manifest. This validates CLI
identity, not whether a prebuilt application bundle reflects source changes;
use an application artifact compatible with the candidate. Do not point it at
an installed instance: the real CLI rotates preview secrets in that package's
`.next` directory. The script never builds, installs dependencies or downloads
fonts/browsers. If `E2E_GATEWAY_PACKAGE_DIR` is omitted, it uses this checkout
and clearly refuses to start when `.next/BUILD_ID` is absent.

It starts the actual `node <package>/bin/pi-web.js --port <available-port>
--hostname 127.0.0.1 --https-cert <temporary-cert> --https-key <temporary-key>
--no-open` from a temporary fixture project. The CLI owns the HTTPS gateway
and its private loopback **`next start`** backend; readiness is checked through
the public HTTPS API, allowing only bounded startup retries (including 503).
It does not start Next dev, exercise dev/HMR, use port 30141, or attach to an
existing instance.

Child processes use an explicit temporary-home/environment whitelist,
synthetic password/sessions, `PI_OFFLINE=1`, and disabled catalog/version
checks. An injected harness `NODE_OPTIONS` network guard is preserved; provider
credentials and personal agent configuration are not inherited. Browser
requests outside the fixture origin are blocked. PTY shells, when available,
use a temporary no-profile wrapper. No model prompt is sent and no native PTY
dependency is installed.

Node HTTP/2 requests trust only the temporary certificate via `ca` and explicitly
set `:authority` to the public URL's host, independent of TLS `servername`.
Coverage exercises actual application routes:

- Unauthenticated API 401 and public-origin login redirects; password login
  and Secure/HttpOnly cookies; authenticated GET.
- Same-origin POST with and without Fetch Metadata; malicious Origin/Host 403.
- Normal file reads and outside/traversal 403.
- Two no-prompt agent SSE connections, short GET while held, and cancellation
  cleanup verified by the debug API.
- Real temporary PTY echo, reconnect offsets and deletion, or an explicit
  missing-native-binary gap.
- The launcher's run record and actual `pi-web status`: public HTTPS URL/port,
  HTTPS scheme and no advertised private backend URL.

The browser uses the **real hydrated login page and password submit button**,
without cookie injection or application-route stubs, and navigates to
`/api/sessions`. It checks actual navigation `nextHopProtocol=h2`, the
Secure/HttpOnly cookie, authenticated GET and same-origin POST, DELETE logout,
and logged-out redirects that stay on the public origin. Production assets and
fonts are served unchanged from the existing build; font rendering itself is
not asserted. Browser JS errors and asset statuses are logged. Failures exit
nonzero; `E2E_GATEWAY_DIAGNOSTICS=origin` stops after the earlier Node
security checks and never claims complete launcher/browser acceptance.

JSON lines report individual checks and a final grouped summary.
`launcherValidated=true` requires complete browser/API coverage and successful
cleanup checks, not just a listening gateway. The external artifact directory
(default: a newly created temporary log directory) retains
`production-launcher.log`, `candidate-hashes.json` and `checks.json`; redirect
stdout/stderr outside the checkout to retain browser diagnostics and thrown
errors too. Cookie/password/key values are never printed.

The work deadline is 160s and the hard deadline is 180s including cleanup.
On normal completion or caught failure, `finally` closes request streams,
HTTP/2/browser resources and the test's own process group, then removes the
temporary home/certificates. SIGTERM shutdown checks the public/private sockets,
Next child exit and run-record removal. Fatal driver/process termination cannot
guarantee JavaScript `finally`; an external harness must inspect and clean its
own task processes in that case. This acceptance harness requires **Linux**
(process-group signalling and `/proc` checks); Windows is untested and rejected.
These standalone scripts are not added to the full E2E/CI runner and do not
claim a production performance guarantee.
