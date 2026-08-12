# TanStack Start Full Migration Handoff

> Handoff target: an agent implementing the migration in a fresh execution session
> Date: 2026-08-12
> Status: latest product main through `97ca430` integrated; spike passed; migration Phases 1-4 are planned but not started
> Authoritative execution plan: `docs/superpowers/plans/2026-08-12-tanstack-migration.md`

## 1. Start Here

Work only in this existing isolated worktree:

```text
Repository: /Users/kale/pi-web-worktrees/migration-tanstack-start
Branch:     migration/tanstack-start
Execution/protected-file baseline: 0f6a152da3dd1795d23ad9342beb0b0775b09459
Integrated product main:             97ca4302f6aa424f1f0fd223fefe2f2c1b78158d
Spike baseline:                  6a76151
```

Execution starts from the documentation commit containing this handoff and the master plan; its exact hash is supplied in the handoff message. `0f6a152` is the immutable product/protected-file baseline. It is a merge commit with parents `8711345` (spike and plans) and `97ca430` (latest approved product main). Do not merge or rebase a newer moving `main` during execution.

The main worktree at `/Users/kale/pi-web` contains unrelated user changes. Do not edit it, clean it, reset it, or copy its uncommitted files into this branch.

Before changing anything:

```bash
cd /Users/kale/pi-web-worktrees/migration-tanstack-start
git status --short --branch
git rev-parse HEAD
git merge-base --is-ancestor 0f6a152 HEAD
```

Expected:

```text
## migration/tanstack-start
ancestor check exits 0
```

If the worktree is not clean, the ancestor check fails, or HEAD differs from the supplied documentation commit, inspect the new commits or changes before proceeding. Never discard changes that are not yours.

## 2. Objective And Boundaries

Replace Next.js 16.2.12 with TanStack Start v1, TanStack Router, Vite, and Nitro while preserving all externally visible behavior:

- all 41 API paths, methods, status codes, headers, JSON bodies, streams, uploads, and downloads;
- process-local `AgentSession` behavior and both SSE channels;
- root host validation, API host/origin validation, and Basic Auth;
- the single-page AppShell, `?session=` and `?cwd=` startup behavior;
- the CodexSidebar project registry, project actions/order/archive state, consolidated SettingsPage, folder creation, cache-hit statistics, extension widgets, and live project activity spinner;
- metadata, theme bootstrap, fonts, PWA installation, service worker, and offline page;
- the published `pi-web` CLI, including port/host parsing, network warnings, browser opening, and child exit codes;
- macOS and Windows build/runtime support.

This is a framework migration, not a business-logic refactor. Do not redesign API payloads, relocate unrelated modules, or add new user-facing features.

These files are protected and their core logic must remain unchanged:

```text
lib/rpc-manager.ts
lib/agent-event-stream.ts
lib/request-security.ts
lib/web-auth.ts
```

Import-only adjustments are allowed only if unavoidable. Every phase gate checks these files against `0f6a152`. This preserves the integrated `lib/rpc-manager.ts` extension `run_command`, widget-title transport, and related session event behavior; comparing to `58fb9c1` is invalid.

## 3. Spike Result

The spike is complete and passed. Its evidence is in:

- `docs/superpowers/specs/2026-08-12-tanstack-start-spike-design.md`
- `docs/superpowers/plans/2026-08-12-tanstack-start-spike.md`
- `docs/spikes/2026-08-12-tanstack-start-spike-results.md`

Verified facts:

- The post-integration spike contracts pass 12 of 12 and `tsc --noEmit` passes.
- The current full baseline passes 556 of 558 tests; the only two failures are `components/ExtensionWidgets.test.mjs` missing `I18nProvider`. Task 1A repairs that test fixture before migration work, after which every gate requires zero failures.
- Lint exits 0 with 11 existing warnings: one in `ChatInput.tsx`, nine in `CodexSidebar.tsx`, and one Next-rule false positive for the TanStack `<head>` in `src/routes/__root.tsx`. Migration work may not increase this count; final framework-neutral lint verification governs after the Next preset is removed.
- A real macOS SSE connection remained open for 310 seconds and delivered 11 heartbeats.
- `GET /api/sessions`, multipart upload, and the generated Nitro root worked.
- Windows build/start/smoke passed in GitHub Actions run `31569406484`.
- `undici` and four process-sensitive Pi packages loaded from runtime `node_modules` at the expected versions.
- `configureHttpDispatcher()` runs at module evaluation in `src/server.ts`, before requests.
- no `.output` directory was written into the repository.

The spike already added the parallel TanStack skeleton and three representative adapters:

```text
src/routes/api/sessions.ts
src/routes/api/agent/$id/events.ts
src/routes/api/files/$.ts
```

Do not redo the spike or replace its validated architecture without a failing test and a documented reason.

## 4. Frozen Architecture Decisions

### 4.1 API handlers and adapters

Keep `app/api/**/route.ts` as internal framework-neutral handler modules for the migration. Convert their remaining Next APIs mechanically:

```text
NextRequest                         -> Request
NextResponse.json(body, init)       -> Response.json(body, init)
request.nextUrl.searchParams        -> new URL(request.url).searchParams
```

Add thin TanStack server-route adapters under `src/routes/api/**`. They import the internal handler and only bridge methods and params. Do not bulk-move handlers into a new directory during this migration; a behaviorless move would increase review risk and invalidate path-sensitive tests without improving runtime behavior.

Canonical static adapter:

```ts
import { createFileRoute } from "@tanstack/react-router";
import { GET as getSessions } from "@/app/api/sessions/route";

export const Route = createFileRoute("/api/sessions")({
  server: { handlers: { GET: ({ request }) => getSessions(request) } },
});
```

Canonical dynamic-param bridge:

```ts
GET: ({ request, params }) => getHandler(request, {
  params: Promise.resolve({ id: params.id }),
})
```

Canonical catch-all bridge:

```ts
GET: ({ request, params }) => getFiles(request, {
  params: Promise.resolve({ path: (params._splat ?? "").split("/") }),
})
```

The complete 41-route map, including every method and adapter path, is in the master execution plan. Treat that table as the route inventory source of truth. Relative to the old plan, it adds `/api/projects` with GET/PUT and adds POST to `/api/cwd/browse`.

### 4.2 Global request security

Create `src/start.ts` and register global `requestMiddleware`. It must cover the root SSR request and every server route, not only server functions.

Preserve `proxy.ts` behavior exactly:

| Request/failure | Required response |
| --- | --- |
| API host/origin rejected | JSON `403`, `{ "error": "Untrusted API request" }` |
| Root host rejected | text `403`, `Untrusted request` |
| Basic Auth rejected | text `401`, `Cache-Control: no-store`, `WWW-Authenticate: Basic realm="Pi Web", charset="UTF-8"` |
| Trusted/authenticated | call `next()` unchanged |

Reuse `isApiRequestAllowed`, `isApiRequestHostAllowed`, `isWebPasswordEnabled`, and `isValidBasicAuthorization` from the protected libraries.

`proxy.ts` matched only `/` and `/api/:path*`. Preserve that boundary: static assets such as `/sw.js`, `/manifest.webmanifest`, `/offline.html`, icons, and TanStack's built `/_build/*` files bypass this application security bridge and remain publicly fetchable for PWA installation/offline startup. Do not accidentally apply Basic Auth or host rejection to those static paths.

Defining `src/start.ts` replaces TanStack Start's implicit defaults. Include explicit CSRF middleware filtered to server functions so possible future server functions retain Start's default protection without imposing different semantics on the existing API routes:

```ts
createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
})
```

Install the Pi security middleware before the filtered CSRF middleware. Repeat the real 310-second SSE gate after this middleware exists.

### 4.3 Startup ordering

Keep `src/server.ts` and its module-level call:

```ts
configureHttpDispatcher();
```

It must remain before `createServerEntry` handles any request. Do not move this into a route, hook, lazy import, or post-listen callback.

### 4.4 Frontend shell

`src/routes/index.tsx` becomes the real AppShell route. Use TanStack Router search validation for optional `session` and `cwd` strings, and replace the seven Next router replacements in `components/AppShell.tsx` with TanStack `useNavigate` calls. Preserve its current `CodexSidebar` and `SettingsPage` mounts; `SessionSidebar` was deleted on main and must not be recreated.

Required behavior:

- `?cwd=` wins when both `cwd` and `session` exist;
- a URL-encoded Windows path round-trips correctly;
- selecting/restoring a session writes only `?session=<id>`;
- starting a new session or clearing selection returns to `/`;
- router changes use replacement and do not reset scroll;
- the initial deep link is read once, preserving current restore semantics.

### 4.5 Metadata, versions, font, and PWA

Move layout behavior into `src/routes/__root.tsx`:

- import `app/globals.css` and `katex/dist/katex.min.css`;
- preserve all existing metadata, viewport entries, icons, translation attributes, hydration suppression, and the pre-hydration theme script;
- render `PwaRegistration` after route content;
- keep `--font-noto-mono` as the CSS variable name.

Use `@fontsource-variable/noto-sans-mono` version `5.3.0`. It is approximately 1.47 MB unpacked and avoids runtime Google font fetching. Set `--font-noto-mono` to the package's family name in CSS.

Keep existing `process.env.NEXT_PUBLIC_APP_VERSION` and `process.env.NEXT_PUBLIC_PI_VERSION` references during this migration. Define them at Vite build time from `package.json` and `@earendil-works/pi-coding-agent/package.json`; this minimizes component churn.

Convert `app/manifest.ts` to `public/manifest.webmanifest` with identical content. Keep `public/offline.html` and icons. Update `public/sw.js` to recognize TanStack/Vite static asset paths rather than `/_next/static/`. Configure exact root/service-worker/manifest cache headers with Nitro `routeRules`.

### 4.6 Build output and publication

The validated standalone spike output copied full external packages into `<output>/server/node_modules`, producing about 205 MB. About 180 MB is under `@earendil-works`. This is acceptable for standalone CI/runtime proof but duplicates dependencies in an installed npm package.

Implement two explicit output modes:

| Mode | Purpose | External-package copy |
| --- | --- | --- |
| `standalone` | spike-style external build and Windows runtime CI | copy full Pi/undici packages into output |
| `publication` | npm tarball installed with normal dependencies | do not copy packages into `.output/server/node_modules` |

Both modes must retain runtime external imports. Publication works because npm installs declared dependencies at the package root and Node resolves upward from `.output/server/index.mjs`. Set Nitro `traceDeps` only in standalone mode: Nitro defines `traceDeps` as dependencies to copy into build output, so enabling it in publication mode would recreate the duplication this mode exists to avoid.

All production builds must obey:

- `vite --configLoader runner`;
- Nitro `exportConditions: ["node", "import", "production", "default"]`;
- `PI_WEB_TANSTACK_OUTPUT_DIR` is an absolute directory outside the repository;
- `.output` is never created in the worktree;
- standalone mode keeps `copyExternalPackages` or an equivalent explicit mechanism.

Because `npm pack` only includes files under its package root, publication packaging must stage a temporary package directory outside the repository, copy the publication output there as `.output`, then run `npm pack` on that staging directory. Do not temporarily copy `.output` into the worktree. The generated `.output/public` already contains the complete static site; do not also copy the source `public/` directory into the npm package.

Do not replace `.next` in `package.json#files` until the staged tarball has been installed into a fresh temporary project and passed the full CLI smoke. The final commit may switch the file list only after that evidence exists.

### 4.7 CLI

`bin/pi-web.js` must spawn Node with `.output/server/index.mjs` using an argument array and `shell: false`. Map CLI options into Nitro environment variables:

```text
NITRO_HOST=<hostname>
NITRO_PORT=<port>
PI_WEB_HOSTNAME=<hostname>
```

Preserve:

- default port `30141`;
- `-H`/`--hostname`, `-p`/`--port`, `--no-open`;
- the two network warnings based on loopback and `PI_WEB_PASSWORD`;
- automatic browser opening only after the server is ready;
- Windows/macOS/Linux browser commands;
- SIGINT/SIGTERM behavior and exact child exit-code propagation;
- no `shell: true` for the server process.

## 5. Four Migration Phases

Execute the master plan strictly in order.

### Phase 1: API, security, startup

First repair the existing `ExtensionWidgets.test.mjs` provider fixture. Then convert all internal handlers to Web APIs, add all 41 TanStack adapters, install global security middleware, preserve startup ordering, expand runtime smoke coverage, and repeat the SSE gate.

Hard gate: route inventory is exactly 41, no Next API remains in `app/api`, security matrix passes, both SSE surfaces pass including the 310-second per-session stream, full tests/lint/typecheck/build/verifier/smoke pass, and protected files are unchanged from `0f6a152`. Stop on failure.

### Phase 2: AppShell and framework shell

Mount the real application, replace Next navigation, move metadata/layout/font/version/PWA behavior, validate cache headers, and remove obsolete Next framework files only after equivalent behavior passes.

Hard gate: deep links, current AppShell, CodexSidebar, SettingsPage, project persistence/folder creation, and live project activity work; metadata/PWA checks pass; no source imports from `next/*` remain; full tests/lint/typecheck/build/smoke pass; protected files are unchanged. Stop on failure.

### Phase 3: Nitro publication and CLI

Add output modes, package staging, Nitro CLI startup, installed-tarball smoke, and only then retire `.next`/Next package configuration.

Hard gate: `npm pack` of the external staging directory, fresh install of that exact tarball, `bin/pi-web` runtime smoke, runtime dependency resolution including production `lucide-react`, package file audit, Windows CI, full local gates, and protected files unchanged. Stop on failure. Do not publish.

### Phase 4: Functional and cross-platform regression

Run automated and manual workflows for sessions, agent commands/SSE, files, git, auth, models, skills, plugins, worktrees, project registry/actions, consolidated settings, folder creation, live project activity, update checks, security, PWA, offline behavior, and deep links. Update contributor/release documentation to the verified TanStack commands.

Hard gate: all acceptance items pass on the installed package, macOS and Windows evidence is recorded, worktree is clean, and final diff contains only migration-related changes. Do not merge, tag, publish, or release.

## 6. Environment Traps

The local shell may contain variables that invalidate tests or dependency installs:

```bash
env -u NODE_ENV npm install
env -u NODE_ENV -u PI_WEB_PASSWORD npm test
```

Use `node_modules/.bin/tsc --noEmit` for type checking.

Port `30142` is occupied by a user-managed process. Do not stop it. Use port `30147` for local smoke tests:

```bash
PI_WEB_TANSTACK_SMOKE_PORT=30147 node scripts/smoke-tanstack-output.mjs "$PI_WEB_TANSTACK_OUTPUT_DIR"
```

Other constraints:

- macOS does not provide GNU `timeout`; use `curl --max-time` or a Node harness;
- macOS `mktemp` requires the `XXXXXX` suffix at the end of the template;
- use `/usr/sbin/lsof` if `lsof` is absent from a reduced PATH;
- never run `next build`;
- never write `.output` into the repository;
- never stop unrelated pi-web processes;
- do not record credentials, API keys, prompt contents, or session file contents in logs/evidence.

## 7. Standard Verification Commands

Use a fresh external output directory for every gate:

```bash
export PI_WEB_TANSTACK_OUTPUT_DIR="$(mktemp -d /tmp/pi-web-tanstack.XXXXXX)"
npm run build:tanstack
node scripts/verify-tanstack-output.mjs "$PI_WEB_TANSTACK_OUTPUT_DIR"
PI_WEB_TANSTACK_SMOKE_PORT=30147 node scripts/smoke-tanstack-output.mjs "$PI_WEB_TANSTACK_OUTPUT_DIR"
env -u NODE_ENV -u PI_WEB_PASSWORD npm test
npm run lint
node_modules/.bin/tsc --noEmit
git diff --check
git diff --exit-code 0f6a152 -- \
  lib/rpc-manager.ts \
  lib/agent-event-stream.ts \
  lib/request-security.ts \
  lib/web-auth.ts
test ! -e .output
```

Expected: every command exits 0, all tests pass, and `.output` is absent.

## 8. Commit And Stop Policy

Use the commit boundaries specified in the master plan. Before each commit:

```bash
git status --short
git diff --check
git diff --stat
```

Do not combine a failing gate with later work. If a hard gate fails:

1. stop the phase immediately;
2. leave the failing code and evidence reviewable, without weakening tests;
3. record the exact command, exit code, relevant sanitized output, suspected cause, and smallest next experiment;
4. report the blocker to the user before starting another phase.

Do not automatically merge, rebase onto a moving main branch, open a release, create a tag, run `npm publish`, or delete the worktree. The handoff ends with a reviewed migration branch and reproducible verification evidence.

## 9. Definition Of Done

The migration is complete only when all of these are true:

- exactly 41 API routes are reachable through TanStack Start with unchanged contracts;
- both SSE streams work, and the real per-session stream survives at least 310 seconds through global middleware;
- the AppShell and its session/cwd deep links behave unchanged;
- CodexSidebar project actions/persistence, SettingsPage, folder creation, cache-hit statistics, extension widget behavior, and the running-project spinner remain intact;
- root/API security and Basic Auth match the response matrix;
- metadata, self-hosted font, service worker, manifest, offline page, and cache headers work;
- `configureHttpDispatcher()` is configured before the first request;
- standalone output starts on macOS and Windows;
- publication output is packed outside the repository, installed fresh, and launched through `pi-web`;
- tests, lint, typecheck, build verification, smoke tests, and `0f6a152` protected-file checks all pass;
- no `.output`, credentials, or unrelated changes are present in the worktree;
- no merge, tag, publication, or release has been performed.
