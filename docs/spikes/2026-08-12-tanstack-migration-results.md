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

## Phase 2 — AppShell, Root Layout, Metadata, Font, And PWA

Date: 2026-08-12 · Branch: `migration/tanstack-start` · Node: v22.22.1 · npm: 10.9.4

### AppShell navigation

- `src/routes/index.tsx` validates optional `session` and `cwd` search strings and mounts `<I18nProvider><AppShell/>`; `src/routes/__root.tsx` carries the document shell.
- `components/AppShell.tsx` replaced `next/navigation` (`useRouter`/`useSearchParams`) with TanStack `useNavigate({ from: "/" })` and `useSearch({ from: "/" })`; the seven navigation call sites are now three root clears and four session replacements, all `replace: true, resetScroll: false`.
- `lib/tanstack-app-shell.test.mjs` locks the source contracts; `lib/initial-navigation.test.mjs` still passes (cwd wins over session).

### Root document, metadata, font, versions

- `src/routes/__root.tsx` now emits title/description/application-name, manifest link, icons, Apple PWA tags, viewport with `viewport-fit=cover` + `interactive-widget=resizes-content`, two media-scoped theme colors, `format-detection`, `google`/`notranslate`, and the pre-hydration `pi-theme` script (moved into TanStack head `scripts`), renders `<PwaRegistration/>`, imports `katex.min.css` and `app/globals.css`.
- `@fontsource-variable/noto-sans-mono@5.3.0` added as an exact production dependency; `app/globals.css` defines `--font-noto-mono: "Noto Sans Mono Variable"` and keeps `--font-mono` derived from it.
- `vite.tanstack.config.ts` defines `process.env.NEXT_PUBLIC_APP_VERSION` (0.8.8-beta.1) and `process.env.NEXT_PUBLIC_PI_VERSION` (0.84.1) at build time; generated client/server assets contain both values.
- Tailwind v4 wired through the official `@tailwindcss/vite@4.2.2` dev plugin so `@import "tailwindcss"` resolves in the Vite pipeline.

### PWA assets and cache headers

- `public/manifest.webmanifest` contains the exact former Next manifest JSON (deep-equal locked in `lib/tanstack-root.test.mjs`).
- `public/sw.js` static-asset matcher now accepts `/_build/` and rejects the obsolete `/_next/static/` marker (locked in `public/sw.test.mjs`); precache, API bypass, notification, offline fallback, and cache versioning unchanged.
- Nitro `routeRules`: `/` → `Cache-Control: private, no-cache, max-age=0, must-revalidate`; `/sw.js` → `public, max-age=0, must-revalidate` + `Service-Worker-Allowed: /`; `/manifest.webmanifest` → `public, max-age=0, must-revalidate`.
- Runtime smoke verifies root/`sw.js`/manifest cache headers, manifest `name: Pi Web`, `/offline.html` containing `Pi Web`, and `/icons/icon-192.png` as `image/png`.

### Phase 2 quality gate

- Focused source-contract tests: 18/18 (AppShell, root, initial-navigation, service worker).
- `env -u NODE_ENV -u PI_WEB_PASSWORD npm test`: 578/578 pass.
- `npm run lint`: 0 errors, 11 warnings (unchanged from baseline).
- `node_modules/.bin/tsc --noEmit`: exit 0.
- Clean external standalone build + verifier + smoke (port 30147): all exit 0; rendered root HTML contains the real AppShell markers (`codex-sidebar`) and the theme bootstrap script; no `.output` in the worktree.
- No `next/(navigation|font|server)` imports remain in `app/api`, `components`, or `src` runtime sources (old `app/layout.tsx` retained until Phase 3 retirement).
- Protected files unchanged from `0f6a152`.
- Manual browser inspection of desktop/mobile widths is deferred to the Phase 4 functional regression matrix (Task 19).

## Phase 3 — Nitro Publication, CLI, And npm Package

Date: 2026-08-12 · Branch: `migration/tanstack-start` · Node: v22.22.1 · npm: 10.9.4

### Output modes

- `vite.tanstack.config.ts` accepts `PI_WEB_TANSTACK_OUTPUT_MODE` (`standalone` default | `publication`); `traceDeps` and `copyExternalPackages` run only in standalone mode; `exportConditions` and route rules are shared.
- Standalone build: 23,707 files / 166 MB; all five process-sensitive packages resolve from `<output>/server/node_modules` with versions identical to the repo install.
- Publication build: 347 files / 37 MB; runtime import edges for all five packages exist in generated server code while `server/node_modules/@earendil-works` and `server/node_modules/undici` are absent (no duplication).

### CLI

- `bin/pi-web.js` resolves `.output/server/index.mjs`, spawns Node with an argument array and `shell: false`, maps `NITRO_HOST`/`NITRO_PORT`/`PI_WEB_HOSTNAME`, keeps the two network warnings and platform browser openers, and matches Nitro's `Listening on|Server listening` readiness line.
- `lib/tanstack-cli.test.mjs` fake-entry test: `-H 0.0.0.0 -p 30222` maps all three env vars, the Basic Auth over HTTP warning appears on stderr, and `FAKE_EXIT_CODE=7` propagates exit 7.

### Staged package proof

- `scripts/stage-tanstack-package.mjs` copies publication output to `<stage>/.output` plus bin/docs/license, writes a staged manifest with `files: ["bin", ".output", "README*.md", "LICENSE", "package.json"]` and no scripts/devDependencies, and refuses relative/in-repository/populated stages.
- `scripts/pack-tanstack.mjs` builds publication mode into fresh external dirs, verifies, stages, packs with `npm pack --json`, runs the installed-package smoke, and prints tarball path/size/integrity.
- Tarball: `agegr-pi-web-0.8.8-beta.1.tgz`, 356 files, 8,532,922 bytes compressed, 37 MB unpacked; no `.next`, no maps, no duplicated Pi/undici trees, no source/tests.
- Fresh install: `npm init -y` + `npm install --ignore-scripts <exact tarball>` in a temporary project; real `node_modules/.bin/pi-web` launched with `--no-open -H 127.0.0.1 -p 30147`; root (real AppShell marker), `/api/sessions` (no-store, arrays), manifest, service worker, untrusted root text 403, untrusted API JSON 403 all pass.
- Runtime versions from the installed package: undici 8.9.0, @earendil-works/pi-coding-agent 0.84.1, pi-agent-core 0.84.1, pi-ai 0.84.1, pi-tui 0.84.1, lucide-react 0.562.0 (production dependency, resolves after install).
- Confirmed `.output/server/node_modules` did not duplicate Pi packages and no repository `.output` was created.
