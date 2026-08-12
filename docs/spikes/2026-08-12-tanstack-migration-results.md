# TanStack Start Migration Results

> Sanitized evidence ledger for the Pi Web Next.js → TanStack Start migration.
> No session ids, message content, credentials, API keys, or private user paths are recorded in this document.

## Phase 1 — API Routes, Security, And Startup

Date: 2026-08-12 · Branch: `migration/tanstack-start` · Node: v22.22.1 · npm: 10.9.4

### Baseline repair

- `components/ExtensionWidgets.test.mjs` wrapped in the real `I18nProvider`; focused file passes 2/2 and the full suite passes 558/558 with zero failures (was 556/558).
- Commit: `test: provide i18n context to extension widgets`

### Handler conversion and adapters

- All 32 handlers that still used `next/server` converted to standard Web APIs (`Request`/`Response.json`, `new URL(request.url).searchParams`). `rg 'next/server|NextRequest|NextResponse|\.nextUrl' app/api --glob 'route.ts'` finds nothing.
- All 41 thin TanStack adapters exist under `src/routes/api/**` (3 spike adapters preserved, 38 added); `find src/routes/api -name '*.ts'` counts exactly 41.
- `lib/tanstack-route-inventory.test.mjs` locks the 41-handler inventory, Web API neutrality, and the 41-adapter route/method matrix.
- Build (external dir) exit 0; route tree regenerated; tsc clean.

### Security middleware

- `src/request-security.ts` returns the legacy rejection matrix: untrusted API host → JSON 403 `{"error":"Untrusted API request"}`; untrusted root host → text 403 `Untrusted request`; `PI_WEB_PASSWORD` enabled without valid Basic auth → text 401 `Authentication required` with `Cache-Control: no-store` and `WWW-Authenticate: Basic realm="Pi Web", charset="UTF-8"`.
- Static PWA assets (`/sw.js`, `/manifest.webmanifest`, `/offline.html`, `/icons/*`, `/_build/*`) bypass the bridge, matching the former `proxy.ts` matcher boundary.
- `src/start.ts` registers `requestMiddleware: [requestSecurityMiddleware, serverFunctionCsrfMiddleware]` with CSRF filtered to `handlerType === "serverFn"`; security middleware precedes CSRF.
- Security unit tests: `lib/request-security.test.mjs`, `lib/web-auth.test.mjs`, `lib/tanstack-request-security.test.mjs` — 21/21 pass.
- Runtime smoke (port 30147): trusted root and `/api/sessions` 200; untrusted Host root text 403; untrusted Host API JSON 403; with `PI_WEB_PASSWORD` set, unauthenticated root 401 with both required headers and authenticated root/sessions 200. Both no-password and password smoke runs exit 0.

### Long-lived SSE gate

- `scripts/sse-tanstack-output.mjs` runs a real persisted session stream through global middleware for at least 310 seconds.
- Result: elapsed 330010 ms, 12 heartbeats (≥ 10 required), connected frame observed, exit 0.
- Response headers verified: `content-type: text/event-stream`, `cache-control: no-cache, no-transform`, `connection: keep-alive`, `x-accel-buffering: no`.
- No sensitive content recorded.

### Phase 1 quality gate

- `env -u NODE_ENV -u PI_WEB_PASSWORD npm test`: 558/558 pass.
- `npm run lint`: 0 errors, 11 warnings (unchanged from baseline).
- `node_modules/.bin/tsc --noEmit`: exit 0.
- Protected files (`lib/rpc-manager.ts`, `lib/agent-event-stream.ts`, `lib/request-security.ts`, `lib/web-auth.ts`) unchanged from `0f6a152`.
- No `.output` in the worktree.
