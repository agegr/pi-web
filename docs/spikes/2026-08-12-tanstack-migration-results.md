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

- `vite.tanstack.config.ts` accepts `PI_WEB_TANSTACK_OUTPUT_MODE` (`standalone` default | `publication`); both modes externalize the five process-sensitive packages (`traceDeps: EXTERNAL_PACKAGES` + `copyExternalPackages`) so the generated server loads them from node_modules with complete runtime resources. The publication stage drops the trace copy from the tarball and `dependencies` declares the packages, so npm install provides them with their resources.
- Standalone build: 23,707 files / 166 MB; all five process-sensitive packages resolve from `<output>/server/node_modules` with versions identical to the repo install.
- Publication build: server code carries external import edges for all five packages; the stage excludes `server/node_modules` (no duplication in the tarball).

### CLI

- `bin/pi-web.js` resolves `.output/server/index.mjs`, spawns Node with an argument array and `shell: false`, maps `NITRO_HOST`/`NITRO_PORT`/`PI_WEB_HOSTNAME`, keeps the two network warnings and platform browser openers, and matches Nitro's `Listening on|Server listening` readiness line.
- `lib/tanstack-cli.test.mjs` fake-entry test: `-H 0.0.0.0 -p 30222` maps all three env vars, the Basic Auth over HTTP warning appears on stderr, and `FAKE_EXIT_CODE=7` propagates exit 7.

### Staged package proof

- `scripts/stage-tanstack-package.mjs` copies publication output to `<stage>/.output` plus bin/docs/license, removes the traced `server/node_modules` copy (npm install provides declared dependencies), writes a staged manifest with `files: ["bin", ".output", "README*.md", "LICENSE", "package.json"]` and no scripts/devDependencies, and refuses relative/in-repository/populated stages.
- `scripts/pack-tanstack.mjs` builds publication mode into fresh external dirs, verifies, stages, packs with `npm pack --json`, runs the installed-package smoke, and prints tarball path/size/integrity.
- Tarball: `agegr-pi-web-0.8.8-beta.1.tgz`, 5,001,829 bytes compressed; no `.next`, no maps, no duplicated Pi/undici trees, no source/tests.
- Fresh install: `npm init -y` + `npm install --ignore-scripts <exact tarball>` in a temporary project; real `node_modules/.bin/pi-web` launched with `--no-open -H 127.0.0.1 -p 30147`; root (real AppShell marker), `/api/sessions` (no-store, arrays), manifest, service worker, untrusted root text 403, untrusted API JSON 403 all pass. The installed package carries no `.output/server/node_modules` copy and `@earendil-works/*` resolves from installed dependencies.
- Runtime versions from the installed package: undici 8.9.0, @earendil-works/pi-coding-agent 0.84.1, pi-agent-core 0.84.1, pi-ai 0.84.1, pi-tui 0.84.1, lucide-react 0.562.0 (production dependency, resolves after install).
- Confirmed no repository `.output` was created.

## Phase 4 — Functional Regression (Tasks 18–19)

Date: 2026-08-12 · Branch: `migration/tanstack-start`

### Task 18: 41-route safe smoke + method guard

- `src/api-methods.ts` restores the legacy 405 contract (TanStack renders the page shell for unmatched methods): `GET /api/default-cwd` → 405 `Allow: POST`, `POST /api/sessions` → 405 `Allow: GET`; `lib/tanstack-route-inventory.test.mjs` locks the table to the 41-adapter inventory.
- `scripts/tanstack-route-smoke.mjs` is the shared safe probe matrix (59 probes covering all 41 adapter URLs, no destructive writes); `PUT /api/models-config` is deliberately never performed (write with no validation — covered by unit tests only) and catalog 502 is recorded as an environment skip.
- Standalone, installed-package, and password-enabled smoke all pass with 59 route probes / 0 failures.
- `scripts/smoke-installed-package.mjs` spawns the server in its own process group and destroys pipes so the CLI's grandchild server cannot orphan and hang the script; SIGKILL fallback targets the group.

### Task 19: Functional matrix (isolated installed tarball, port 30148, `PI_CODING_AGENT_DIR` isolated)

| Group | Result | Notes |
|---|---|---|
| Session create (`ensure_session`) | PASS | 200, real session id, model/thinking state returned |
| Agent state / SSE connect | PASS | `GET /api/agent/{id}` 200; events SSE 200 with `connected` frame; running/events SSE 200 |
| Prompt streaming | PASS | real prompt completed through SSE in an isolated credential environment; no credential, session id, or response content retained |
| Bash-output | PASS | 400 documented (session not running) |
| Session delete | PASS with note | deleting a non-persisted session returns 500 (ENOENT) — same handler as before, no migration regression; persisted-session delete covered by 404/405 matrix |
| cwd browse/mkdir | PASS | list 200, mkdir 201, child browse 200 |
| Upload / conflict | PASS | multipart 200 `uploaded`, conflict 409, exact-byte read MATCH |
| Git status/diff | PASS | 200 on temporary git fixture |
| Project trust | PASS | GET round-trip 200 |
| Worktree create/list/remove | PASS | create 200, listed, removed via realpath-normalized path |
| Auth providers / API key | PASS | providers 39 listed, no raw key material in any response |
| API-key store/remove | PASS | store/remove lifecycle completed with isolated credentials; no key material retained |
| Models/config/plugins/skills/app-update | PASS | reads 200 with documented shapes; catalog 502 env skip; invalid payloads 400 |
| Security matrix | PASS | trusted/untrusted/401+headers/403 matrix identical to former `proxy.ts` contract (smoke) |
| Desktop 1280×800 | PASS | real AppShell: sidebar, project search, archived tab, settings, onboarding copy; no console errors |
| Mobile 390×844 | PASS | hamburger + overflow menu, responsive onboarding |
| `?cwd=` | PASS | loads and renders the selected project |
| PWA assets / versions | PASS | manifest/sw/offline/icons 200; client bundle carries 0.8.8-beta.1; app-update shape documented |


## Task 21 — Final Verification

- Final commit candidate: `d90e891` (docs), Windows-gate commit `276243e` (`.gitattributes` LF enforcement)
- Node v22.22.1 / npm 10.9.4; clean `npm ci` exit 0
- Tests: 587/587 pass, 0 fail; lint 0 errors / 9 warnings; `tsc --noEmit` clean; `git diff --check` clean
- Final standalone output `/tmp/pi-web-tanstack-final-standalone.IHuuUN`: verifier ok (23,707 files / 166.4 MB, all five package versions identical), smoke 59 route probes / 0 failures (31 sessions)
- Final tarball: `agegr-pi-web-0.8.8-beta.1.tgz`, 5,002,281 bytes, sha512 `b4f73095…c63119cf8`; installed-package smoke passes; no `.output` in repository
- Final 310-second SSE gate: 330,011 ms elapsed, 12 heartbeats (≥10), connected frame seen, exit 0
- Windows CI: run [31593861847](https://github.com/icekale/pi-web/actions/runs/31593861847) on `276243e` — success (quality gates, Windows build, pack/install/smoke). Earlier `d90e891` run failed on CRLF-checked-out sources (`end of file content block not found`); fixed by `.gitattributes` (`* text=lf eol=lf`), root cause reproduced locally (CRLF source → 3 fixture-locating tests fail, LF → pass)
- Protected files (`lib/rpc-manager.ts`, `lib/agent-event-stream.ts`, `lib/request-security.ts`, `lib/web-auth.ts`) unchanged vs `0f6a152`: diff exit 0
- No Next.js imports/refs (remaining `.next` matches are ignore-directory names, JS iterators, and anti-Next test assertions); no repository `.output`; no secret-bearing files tracked
- No merge, tag, npm publish, GitHub Release, or worktree deletion occurred

## Task 23 — Post-main Integration Verification

Date: 2026-08-12 · Branch: `migration/tanstack-start` · Integrated base: `main@e4ea976`

- Merge commit: `1de3e1a merge: integrate post-migration main fixes`; TanStack navigation and Web API responses remain in place while session relations, subagent grouping/hiding, activity indicators, and same-session navigation protection are included.
- Test compatibility commit: `f55acfe test: adapt session navigation assertion to TanStack`; only the removed Next Router source marker was replaced with the equivalent TanStack search marker.
- Fresh full suite: 592/592 pass, 0 fail; lint 0 errors / 9 warnings; `tsc --noEmit` clean; `git diff --check` clean.
- Fresh `pack:tanstack` on `f55acfe`: exit 0; publication build, external staging, tarball install, and installed CLI smoke all pass.
- Installed smoke: root/sessions/manifest/service worker/security pass; 59 route probes / 0 failures. `PUT /api/models-config` remains intentionally skipped because it writes configuration; `/api/models-config/catalog` remains an environment skip because upstream returned 502.
- Tarball: `agegr-pi-web-0.8.8-beta.1.tgz`, 5,003,752 bytes, sha512 `889e65ccceacd7ef472628d90c06ae38d8268564093769c7c00c56bcbb5cd705cccd67c50c4af9f71beb1dba9be2977ddfd7dad9de704023f354fa9951a6238a`.
- Release-readiness verification completed theme/language/settings browser interactions, API-key store/remove, and a real prompt SSE flow in an isolated credential environment; no credential, session id, response content, or sensitive temporary path was retained.
- No repository `.output`, npm publish, tag, GitHub Release, real-key copy, or primary checkout mutation occurred.

### Local main follow-up integration

- A final read-only ref check found local `main@79ee6ac` four commits ahead of `origin/main@e4ea976`: archived-project settings, reduced-motion activity, and serialized project-registry updates. Directly advancing the migration candidate would have omitted those committed changes.
- Merge commit `e8d5473 merge: integrate latest local main updates` includes all four commits. The sole content conflict was `app/api/projects/route.ts`; it preserves the new locked partial-update behavior while using framework-neutral `Response`.
- The new `PATCH /api/projects` method is wired through the TanStack adapter and 405 guard, locked by the 41-route inventory, and covered by a non-mutating invalid-payload smoke probe. Focused integration tests passed 18/18.
- Fresh full suite on `e8d5473`: 594/594 pass, 0 fail; lint 0 errors / 9 warnings; `tsc --noEmit` and `git diff --check` clean.
- Fresh `pack:tanstack`: exit 0; installed smoke root/sessions/manifest/service worker/security pass; 60 route probes / 0 failures.
- Latest tarball: `agegr-pi-web-0.8.8-beta.1.tgz`, 5,006,455 bytes, sha512 `43cbbf28bec928acf560c61b675ca30c391c047b2110ec3095e4c8738fdf681a419bea7f7c9775266d3944b48c2f221292aa2329cf682b1671826ddd4d839e04`.

### Main integration closeout

- A repository-external detached worktree fast-forwarded cleanly from `main@79ee6ac` to the migration candidate with `git merge --ff-only`.
- On the exact candidate after a clean `npm ci`: 594/594 tests passed; lint reported 0 errors / 9 warnings; `tsc --noEmit` and `git diff --check` passed; no repository `.output` existed.
- `origin/main` and `origin/migration/tanstack-start` were advanced by ordinary non-force pushes to the same verified lineage and checked with `git ls-remote`.
- npm was not published; no tag or GitHub Release was created. The migration worktree remains available for audit.

## Release-readiness security update

Date: 2026-08-12 · Branch: `migration/tanstack-start`

- After integration, Vite was upgraded from `8.0.14` to `8.2.1` and Mermaid from `11.14.0` to `11.16.1` as release-readiness security updates; `npm audit` reports 0 vulnerabilities.
- The stale pre-migration `bun.lock` was removed: it still declared Next.js, undici `8.5.0`, and the old dependency graph, while the repository, CI, README, and release pipeline exclusively use npm. `package-lock.json` is now the single authoritative lockfile.
- The first full suite after the dependency update passed 593/594 tests, with only the stale exact-Vite-version expectation failing. After synchronizing that assertion and passing its focused test, the established final count is 594/594.
- Browser theme/language/settings interactions, API-key store/remove, and real prompt SSE completion passed in an isolated credential environment. The models-config catalog remains an upstream 502 skip, and deleting a non-persisted session still returns 500.
- Vite `8.2.1` development SSR initially returned HTTP 200 with React's client-render fallback because `@lobehub/icons` publishes extensionless internal ESM imports that Node 22 cannot resolve when externalized. Adding only that package to `ssr.noExternal` restored real SSR: the root HTML contains 12 `codex-sidebar` markers and no fallback/module-resolution error; a focused config contract locks the fix.
- Final `pack:tanstack`: exit 0; external output 23,724 files / 167,251,646 bytes; tarball 5,194,550 bytes, sha512 `5470eb094e1cdd6dc376868a47d5dc913a01a1e1708a845455ffac3efc8c7f965607bc0c31fbe2fe72718ae8c84c41d60ba8929366fbae743d1175f1ce173088`.
- Fresh installed-package smoke passed root, sessions, PWA assets, security, dependency versions, and 60 route probes with 0 failures. The models-config catalog remained an upstream 502 skip.
