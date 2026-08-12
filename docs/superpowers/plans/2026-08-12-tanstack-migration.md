# Pi Web TanStack Start Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Next.js with TanStack Start while preserving all 41 API contracts, the Codex-style project workspace UI through `main@97ca430`, security, AppShell/PWA behavior, CLI behavior, and installable npm-package operation on macOS and Windows.

**Architecture:** Keep `app/api/**/route.ts` as internal standard Web `Request -> Response` handlers and expose them through thin file-route adapters in `src/routes/api/**`. Configure global request security in `src/start.ts`, keep dispatcher initialization at module evaluation in `src/server.ts`, move the single-page shell into the TanStack root/index routes, and build Nitro into external directories in separate standalone and publication modes. Publication is proven from a staged npm tarball installed into a fresh temporary project before Next artifacts are retired.

**Tech Stack:** Node.js 22.19+, TypeScript 5, React 19, TanStack Start 1.168.42, TanStack Router 1.170.25, Vite 8.0.14, Nitro 3.0 beta, Node test runner, ESLint, npm packaging, GitHub Actions.

---

## Execution Contract

Read `docs/superpowers/plans/2026-08-12-tanstack-migration-handoff.md` and `docs/spikes/2026-08-12-tanstack-start-spike-results.md` before executing this plan.

The four phases are sequential hard gates:

1. Phase 1: API routes, global security middleware, and server startup.
2. Phase 2: AppShell, root layout, metadata, fonts, and PWA.
3. Phase 3: Nitro publication output, CLI launcher, and npm package.
4. Phase 4: complete functional and cross-platform regression.

When any hard-gate command fails, stop immediately. Do not weaken a test, skip a platform check, or continue into the next phase. Record the exact command, exit code, sanitized relevant output, suspected cause, and smallest next experiment for review.

Never modify the main worktree at `/Users/kale/pi-web`. Never run `next build`. Never create `.output` in this worktree. Never stop the user process on port `30142`. Never log credentials, API keys, prompt text, or session file contents.

Protected files must remain byte-for-byte unchanged from the post-main-integration baseline `0f6a152`:

```text
lib/rpc-manager.ts
lib/agent-event-stream.ts
lib/request-security.ts
lib/web-auth.ts
```

Use this check at every phase gate:

```bash
git diff --exit-code 0f6a152 -- \
  lib/rpc-manager.ts \
  lib/agent-event-stream.ts \
  lib/request-security.ts \
  lib/web-auth.ts
```

Expected: exit 0 and no output.

## File Responsibility Map

### Existing files retained and modified

| File or group | Responsibility after migration |
| --- | --- |
| `app/api/**/route.ts` | internal framework-neutral HTTP handlers; no imports from `next/*` |
| `src/server.ts` | server entry; configures the HTTP dispatcher at module evaluation |
| `src/router.tsx` | creates the TanStack Router from the generated route tree |
| `src/routes/__root.tsx` | HTML document, metadata, global CSS, theme bootstrap, PWA registration |
| `src/routes/index.tsx` | `/` route, search validation, AppShell mount |
| `components/AppShell.tsx` | application orchestration and TanStack navigation/search usage |
| `components/CodexSidebar.tsx` | project registry actions, running-session SSE, unread state, and Codex-style project activity |
| `components/SettingsPage.tsx` | consolidated general/project/model/skill/plugin settings experience |
| `app/globals.css` | existing design plus local font variable |
| `components/PwaRegistration.tsx` | production service-worker registration and versioned script URL |
| `public/sw.js` | offline/navigation behavior and Vite asset caching |
| `vite.tanstack.config.ts` | Start/Vite/Nitro config, version defines, route rules, output modes |
| `bin/pi-web.js` | published CLI that starts Nitro and opens the browser when ready |
| `package.json` | TanStack scripts, dependencies, package file list, release entry points |
| `tsconfig.json` | TypeScript config without Next plugin or `.next` includes |
| `eslint.config.mjs` | framework-neutral React/TypeScript lint config |
| `.github/workflows/tanstack-spike-windows.yml` | full Windows build/package/runtime gate |

### New files

| File or group | Responsibility |
| --- | --- |
| `src/routes/api/**` | 41 thin method/parameter adapters |
| `src/request-security.ts` | testable framework bridge that returns rejection responses or `undefined` |
| `src/start.ts` | global Start request middleware and explicit server-function CSRF middleware |
| `public/manifest.webmanifest` | static PWA manifest copied from the former Next manifest |
| `lib/tanstack-route-inventory.test.mjs` | guards 41 handler files, 41 adapters, methods, and no Next API use |
| `lib/tanstack-request-security.test.mjs` | locks security response behavior before middleware integration |
| `lib/tanstack-app-shell.test.mjs` | locks route search and replacement-navigation behavior |
| `lib/tanstack-root.test.mjs` | locks metadata, font, theme bootstrap, PWA, and cache rules |
| `lib/tanstack-cli.test.mjs` | locks Nitro spawn arguments/environment and readiness/exit behavior |
| `scripts/sse-tanstack-output.mjs` | repeatable 310-second real-session SSE gate |
| `scripts/stage-tanstack-package.mjs` | copies publication output and package metadata into an external staging directory |
| `scripts/pack-tanstack.mjs` | builds publication output externally and creates a staged tarball |
| `scripts/smoke-installed-package.mjs` | installs a tarball fresh and probes its real `pi-web` executable |
| `scripts/release-tanstack.mjs` | publishes only an explicit reviewed tarball path; never runs during this plan |
| `docs/spikes/2026-08-12-tanstack-migration-results.md` | sanitized final evidence ledger |

### Files removed only after replacement behavior passes

```text
app/layout.tsx
app/page.tsx
app/manifest.ts
instrumentation.ts
proxy.ts
next.config.ts
lib/next-config.test.mjs
lib/next-config-esm.test.mjs
```

`src/routeTree.gen.ts` is generated by TanStack Router. Commit its generated changes but never edit it manually.

## Complete API Route Inventory

This table accounts for all 41 existing `app/api/**/route.ts` files at integration baseline `0f6a152`. The adapter route string passed to `createFileRoute()` is the URL column. Each adapter imports the listed handler and uses the invocation exactly as shown.

| # | Internal handler | TanStack adapter | URL | Methods and invocation |
| ---: | --- | --- | --- | --- |
| 1 | `app/api/agent/[id]/bash-output/route.ts` | `src/routes/api/agent/$id/bash-output.ts` | `/api/agent/$id/bash-output` | `GET(request, idParams)` |
| 2 | `app/api/agent/[id]/events/route.ts` | `src/routes/api/agent/$id/events.ts` | `/api/agent/$id/events` | `GET(request, idParams)` |
| 3 | `app/api/agent/[id]/route.ts` | `src/routes/api/agent/$id.ts` | `/api/agent/$id` | `GET(request, idParams)`, `POST(request, idParams)` |
| 4 | `app/api/agent/new/route.ts` | `src/routes/api/agent/new.ts` | `/api/agent/new` | `POST(request)` |
| 5 | `app/api/agent/running/events/route.ts` | `src/routes/api/agent/running/events.ts` | `/api/agent/running/events` | `GET(request)` |
| 6 | `app/api/agent/running/route.ts` | `src/routes/api/agent/running.ts` | `/api/agent/running` | `GET()` |
| 7 | `app/api/app-update/route.ts` | `src/routes/api/app-update.ts` | `/api/app-update` | `GET()` |
| 8 | `app/api/auth/all-providers/route.ts` | `src/routes/api/auth/all-providers.ts` | `/api/auth/all-providers` | `GET()` |
| 9 | `app/api/auth/api-key/[provider]/route.ts` | `src/routes/api/auth/api-key/$provider.ts` | `/api/auth/api-key/$provider` | `GET(request, providerParams)`, `POST(request, providerParams)`, `DELETE(request, providerParams)` |
| 10 | `app/api/auth/login/[provider]/route.ts` | `src/routes/api/auth/login/$provider.ts` | `/api/auth/login/$provider` | `GET(request, providerParams)`, `POST(request, providerParams)` |
| 11 | `app/api/auth/logout/[provider]/route.ts` | `src/routes/api/auth/logout/$provider.ts` | `/api/auth/logout/$provider` | `POST(request, providerParams)` |
| 12 | `app/api/auth/providers/route.ts` | `src/routes/api/auth/providers.ts` | `/api/auth/providers` | `GET()` |
| 13 | `app/api/cwd/browse/route.ts` | `src/routes/api/cwd/browse.ts` | `/api/cwd/browse` | `GET(request)`, `POST(request)` |
| 14 | `app/api/cwd/validate/route.ts` | `src/routes/api/cwd/validate.ts` | `/api/cwd/validate` | `POST(request)` |
| 15 | `app/api/default-cwd/route.ts` | `src/routes/api/default-cwd.ts` | `/api/default-cwd` | `POST()` |
| 16 | `app/api/file-index/route.ts` | `src/routes/api/file-index.ts` | `/api/file-index` | `GET(request)` |
| 17 | `app/api/files/[...path]/route.ts` | `src/routes/api/files/$.ts` | `/api/files/$` | `GET(request, pathParams)`, `POST(request, pathParams)` |
| 18 | `app/api/git/diff/route.ts` | `src/routes/api/git/diff.ts` | `/api/git/diff` | `GET(request)` |
| 19 | `app/api/git/status/route.ts` | `src/routes/api/git/status.ts` | `/api/git/status` | `GET(request)` |
| 20 | `app/api/home/route.ts` | `src/routes/api/home.ts` | `/api/home` | `GET()` |
| 21 | `app/api/models-config/catalog/route.ts` | `src/routes/api/models-config/catalog.ts` | `/api/models-config/catalog` | `GET(request)` |
| 22 | `app/api/models-config/discover/route.ts` | `src/routes/api/models-config/discover.ts` | `/api/models-config/discover` | `POST(request)` |
| 23 | `app/api/models-config/route.ts` | `src/routes/api/models-config.ts` | `/api/models-config` | `GET()`, `PUT(request)` |
| 24 | `app/api/models-config/test/route.ts` | `src/routes/api/models-config/test.ts` | `/api/models-config/test` | `POST(request)` |
| 25 | `app/api/models/route.ts` | `src/routes/api/models.ts` | `/api/models` | `GET(request)` |
| 26 | `app/api/plugins/route.ts` | `src/routes/api/plugins.ts` | `/api/plugins` | `GET(request)`, `POST(request)` |
| 27 | `app/api/project-trust/route.ts` | `src/routes/api/project-trust.ts` | `/api/project-trust` | `GET(request)`, `POST(request)` |
| 28 | `app/api/projects/route.ts` | `src/routes/api/projects.ts` | `/api/projects` | `GET()`, `PUT(request)` |
| 29 | `app/api/sessions/[id]/auto-name/route.ts` | `src/routes/api/sessions/$id/auto-name.ts` | `/api/sessions/$id/auto-name` | `POST(request, idParams)` |
| 30 | `app/api/sessions/[id]/context/route.ts` | `src/routes/api/sessions/$id/context.ts` | `/api/sessions/$id/context` | `GET(request, idParams)` |
| 31 | `app/api/sessions/[id]/entries/[entryId]/thinking/route.ts` | `src/routes/api/sessions/$id/entries/$entryId/thinking.ts` | `/api/sessions/$id/entries/$entryId/thinking` | `GET(request, idEntryParams)` |
| 32 | `app/api/sessions/[id]/export/route.ts` | `src/routes/api/sessions/$id/export.ts` | `/api/sessions/$id/export` | `GET(request, idParams)` |
| 33 | `app/api/sessions/[id]/route.ts` | `src/routes/api/sessions/$id.ts` | `/api/sessions/$id` | `GET(request, idParams)`, `PATCH(request, idParams)`, `DELETE(request, idParams)` |
| 34 | `app/api/sessions/[id]/state/route.ts` | `src/routes/api/sessions/$id/state.ts` | `/api/sessions/$id/state` | `GET(request, idParams)` |
| 35 | `app/api/sessions/route.ts` | `src/routes/api/sessions.ts` | `/api/sessions` | `GET(request)` |
| 36 | `app/api/skills/check/route.ts` | `src/routes/api/skills/check.ts` | `/api/skills/check` | `POST(request)` |
| 37 | `app/api/skills/install/route.ts` | `src/routes/api/skills/install.ts` | `/api/skills/install` | `POST(request)` |
| 38 | `app/api/skills/route.ts` | `src/routes/api/skills.ts` | `/api/skills` | `GET(request)`, `PATCH(request)` |
| 39 | `app/api/skills/search/route.ts` | `src/routes/api/skills/search.ts` | `/api/skills/search` | `POST(request)` |
| 40 | `app/api/skills/update/route.ts` | `src/routes/api/skills/update.ts` | `/api/skills/update` | `POST(request)` |
| 41 | `app/api/worktrees/route.ts` | `src/routes/api/worktrees.ts` | `/api/worktrees` | `GET(request)`, `POST(request)`, `DELETE(request)` |

Parameter bridges used in the table:

```ts
const idParams = { params: Promise.resolve({ id: params.id }) };
const providerParams = { params: Promise.resolve({ provider: params.provider }) };
const idEntryParams = {
  params: Promise.resolve({ id: params.id, entryId: params.entryId }),
};
const pathParams = {
  params: Promise.resolve({ path: (params._splat ?? "").split("/") }),
};
```

# Phase 1: API Routes, Security, And Startup

### Task 1: Establish The Migration Baseline

**Files:**
- Read: `docs/superpowers/plans/2026-08-12-tanstack-migration-handoff.md`
- Read: `docs/spikes/2026-08-12-tanstack-start-spike-results.md`
- Verify: repository, branch, dependencies, tests, and protected files

- [ ] **Step 1: Confirm worktree identity and cleanliness**

Run:

```bash
cd /Users/kale/pi-web-worktrees/migration-tanstack-start
git status --short --branch
git rev-parse HEAD
git merge-base --is-ancestor 0f6a152 HEAD
test ! -e .output
```

Expected: branch is `migration/tanstack-start`, status contains no changed files, `0f6a152` is an ancestor, and `.output` is absent. Do not merge or rebase a newer `main`; the plan is scoped through `main@97ca430`.

- [ ] **Step 2: Install the locked dependencies without ambient production mode**

Run:

```bash
env -u NODE_ENV npm ci
```

Expected: exit 0 and the exact `package-lock.json` dependency graph is installed, including dev dependencies.

- [ ] **Step 3: Run the baseline regression suite**

Run:

```bash
set +e
env -u NODE_ENV -u PI_WEB_PASSWORD npm test
PI_WEB_BASELINE_TEST_STATUS=$?
set -e
test "$PI_WEB_BASELINE_TEST_STATUS" -eq 1
npm run lint
node_modules/.bin/tsc --noEmit
```

Expected at the start of execution: `npm test` exits 1 with 556 of 558 tests passing. The only failures must be the two `components/ExtensionWidgets.test.mjs` cases reporting `useI18n must be used inside I18nProvider`; no other test may fail. The explicit status assertion and type checking exit 0. Lint exits 0 with exactly 11 existing warnings: one `ChatInput.tsx` image-alt warning, nine `CodexSidebar.tsx` warnings, and one `src/routes/__root.tsx` Next-rule `<head>` warning. Do not use this expected-failure wrapper after Task 1A, and do not allow the warning count to increase.

- [ ] **Step 4: Verify the protected-file baseline**

Run:

```bash
git diff --exit-code 0f6a152 -- \
  lib/rpc-manager.ts \
  lib/agent-event-stream.ts \
  lib/request-security.ts \
  lib/web-auth.ts
```

Expected: exit 0 and no output. Do not create a commit for this task.

### Task 1A: Repair The Existing ExtensionWidgets Test Fixture

**Files:**
- Modify: `components/ExtensionWidgets.test.mjs`
- Preserve: `components/ExtensionWidgets.tsx`

- [ ] **Step 1: Confirm the two baseline failures**

Run:

```bash
node --experimental-strip-types --test components/ExtensionWidgets.test.mjs
```

Expected: exactly two failures, both `useI18n must be used inside I18nProvider`.

- [ ] **Step 2: Wrap the component in the real provider**

Import the existing provider next to `ExtensionWidgets`:

```js
const { I18nProvider } = await jiti.import("../hooks/useI18n.tsx");

function renderWidgets(props) {
  return renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(ExtensionWidgets, props),
    ),
  );
}
```

Replace both direct `renderToStaticMarkup(React.createElement(ExtensionWidgets, ...))` expressions with `renderWidgets({ widgets: [...] })`. Do not change production code or expected strings.

- [ ] **Step 3: Verify the fixture and full baseline**

Run:

```bash
node --experimental-strip-types --test components/ExtensionWidgets.test.mjs
env -u NODE_ENV -u PI_WEB_PASSWORD npm test
```

Expected: the focused file passes 2 of 2 and the full suite passes 558 of 558 with zero failures.

- [ ] **Step 4: Commit the baseline repair**

```bash
git add components/ExtensionWidgets.test.mjs
git diff --cached --check
git commit -m "test: provide i18n context to extension widgets"
```

Expected: a test-only commit. All subsequent phase gates require zero test failures.

### Task 2: Convert All Internal API Handlers To Standard Web APIs

**Files:**
- Create: `lib/tanstack-route-inventory.test.mjs`
- Modify: the 32 `app/api/**/route.ts` files still reported by the failure command below
- Preserve: the 9 handlers already using standard Web APIs

- [ ] **Step 1: Write the failing handler inventory test**

Create `lib/tanstack-route-inventory.test.mjs` with an explicit `EXPECTED_ROUTES` object containing the 41 internal-handler paths and method arrays from the route table above. The test must include these assertions:

```js
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import test from "node:test";

const ROOT = process.cwd();

async function filesNamedRoute(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return filesNamedRoute(path);
    return entry.name === "route.ts" ? [relative(ROOT, path)] : [];
  }));
  return nested.flat().sort();
}

test("the internal API inventory contains exactly the expected 41 routes", async () => {
  const actual = await filesNamedRoute(join(ROOT, "app", "api"));
  assert.equal(actual.length, 41);
  assert.deepEqual(actual, Object.keys(EXPECTED_ROUTES).sort());
});

test("every internal API handler uses standard Web APIs and exports the expected methods", async () => {
  for (const [file, expectedMethods] of Object.entries(EXPECTED_ROUTES)) {
    const source = await readFile(join(ROOT, file), "utf8");
    assert.doesNotMatch(source, /from ["']next\/server["']/, file);
    assert.doesNotMatch(source, /\bNextRequest\b|\bNextResponse\b|\.nextUrl\b/, file);
    const methods = [...source.matchAll(/^export\s+(?:async\s+)?function\s+([A-Z]+)/gm)]
      .map((match) => match[1]);
    assert.deepEqual(methods.sort(), [...expectedMethods].sort(), file);
  }
});
```

Define `EXPECTED_ROUTES` with this complete literal before the test declarations:

```js
const EXPECTED_ROUTES = {
  "app/api/agent/[id]/bash-output/route.ts": ["GET"],
  "app/api/agent/[id]/events/route.ts": ["GET"],
  "app/api/agent/[id]/route.ts": ["GET", "POST"],
  "app/api/agent/new/route.ts": ["POST"],
  "app/api/agent/running/events/route.ts": ["GET"],
  "app/api/agent/running/route.ts": ["GET"],
  "app/api/app-update/route.ts": ["GET"],
  "app/api/auth/all-providers/route.ts": ["GET"],
  "app/api/auth/api-key/[provider]/route.ts": ["DELETE", "GET", "POST"],
  "app/api/auth/login/[provider]/route.ts": ["GET", "POST"],
  "app/api/auth/logout/[provider]/route.ts": ["POST"],
  "app/api/auth/providers/route.ts": ["GET"],
  "app/api/cwd/browse/route.ts": ["GET", "POST"],
  "app/api/cwd/validate/route.ts": ["POST"],
  "app/api/default-cwd/route.ts": ["POST"],
  "app/api/file-index/route.ts": ["GET"],
  "app/api/files/[...path]/route.ts": ["GET", "POST"],
  "app/api/git/diff/route.ts": ["GET"],
  "app/api/git/status/route.ts": ["GET"],
  "app/api/home/route.ts": ["GET"],
  "app/api/models-config/catalog/route.ts": ["GET"],
  "app/api/models-config/discover/route.ts": ["POST"],
  "app/api/models-config/route.ts": ["GET", "PUT"],
  "app/api/models-config/test/route.ts": ["POST"],
  "app/api/models/route.ts": ["GET"],
  "app/api/plugins/route.ts": ["GET", "POST"],
  "app/api/project-trust/route.ts": ["GET", "POST"],
  "app/api/projects/route.ts": ["GET", "PUT"],
  "app/api/sessions/[id]/auto-name/route.ts": ["POST"],
  "app/api/sessions/[id]/context/route.ts": ["GET"],
  "app/api/sessions/[id]/entries/[entryId]/thinking/route.ts": ["GET"],
  "app/api/sessions/[id]/export/route.ts": ["GET"],
  "app/api/sessions/[id]/route.ts": ["DELETE", "GET", "PATCH"],
  "app/api/sessions/[id]/state/route.ts": ["GET"],
  "app/api/sessions/route.ts": ["GET"],
  "app/api/skills/check/route.ts": ["POST"],
  "app/api/skills/install/route.ts": ["POST"],
  "app/api/skills/route.ts": ["GET", "PATCH"],
  "app/api/skills/search/route.ts": ["POST"],
  "app/api/skills/update/route.ts": ["POST"],
  "app/api/worktrees/route.ts": ["DELETE", "GET", "POST"],
};
```

The final file must contain all 41 literal entries; do not derive expected values from the files being tested.

- [ ] **Step 2: Run the focused test and confirm the expected failure**

Run:

```bash
env -u PI_WEB_PASSWORD node --experimental-strip-types --test lib/tanstack-route-inventory.test.mjs
```

Expected: the count/method inventory passes and the Web API test fails on the first remaining `next/server`, `NextRequest`, `NextResponse`, or `.nextUrl` occurrence.

- [ ] **Step 3: Mechanically convert the 32 reported handlers**

Apply only these replacements, preserving all business logic and response initialization:

```ts
// Before
import { NextRequest, NextResponse } from "next/server";
export async function GET(request: NextRequest) {
  const value = request.nextUrl.searchParams.get("key");
  return NextResponse.json({ value }, { status: 200 });
}

// After
export async function GET(request: Request) {
  const value = new URL(request.url).searchParams.get("key");
  return Response.json({ value }, { status: 200 });
}
```

Use the source scan as the exact work list:

```bash
rg -l 'next/server|NextRequest|NextResponse|\.nextUrl' app/api --glob 'route.ts' | sort
```

Expected before editing at `0f6a152`: 32 files. Expected after editing: no output and exit 1 from `rg` because no matches remain.

Do not change exported method names, parameter object shapes, response payloads, status codes, headers, cache directives, stream bodies, filesystem operations, or Pi session behavior. Remove only imports made unused by these conversions.

- [ ] **Step 4: Run focused and existing handler tests**

Run:

```bash
env -u PI_WEB_PASSWORD node --experimental-strip-types --test \
  lib/tanstack-route-inventory.test.mjs \
  lib/provider-api-key-route.test.mjs \
  lib/project-trust.test.mjs \
  app/api/agent/events-route.test.mjs \
  app/api/files/upload-route.test.mjs \
  app/api/files/watch-route.test.mjs \
  app/api/sessions/runtime-route.test.mjs
```

Expected: all selected tests pass.

- [ ] **Step 5: Commit the Web API conversion**

Run:

```bash
git add app/api lib/tanstack-route-inventory.test.mjs
git diff --cached --check
git commit -m "refactor: make API handlers framework neutral"
```

Expected: one commit containing only the 32 mechanical handler conversions and the inventory test.

### Task 3: Add All 41 TanStack API Adapters

**Files:**
- Modify: `lib/tanstack-route-inventory.test.mjs`
- Create: the 38 missing adapter files listed in the complete route inventory
- Modify (generated): `src/routeTree.gen.ts`
- Preserve: the 3 spike adapters already present

- [ ] **Step 1: Extend the inventory test to require every adapter and method**

Add an explicit `EXPECTED_ADAPTERS` object with all 41 adapter paths, route IDs, and methods from the table. Add this test:

```js
test("every API handler has a thin TanStack adapter with the expected route and methods", async () => {
  assert.equal(Object.keys(EXPECTED_ADAPTERS).length, 41);
  for (const [file, expected] of Object.entries(EXPECTED_ADAPTERS)) {
    const source = await readFile(join(ROOT, file), "utf8");
    assert.ok(source.includes(`createFileRoute(${JSON.stringify(expected.route)})`), file);
    for (const method of expected.methods) {
      assert.match(source, new RegExp(`\\b${method}:`), `${file} ${method}`);
    }
  }
});
```

Use this complete literal:

```js
const EXPECTED_ADAPTERS = {
  "src/routes/api/agent/$id/bash-output.ts": { route: "/api/agent/$id/bash-output", methods: ["GET"] },
  "src/routes/api/agent/$id/events.ts": { route: "/api/agent/$id/events", methods: ["GET"] },
  "src/routes/api/agent/$id.ts": { route: "/api/agent/$id", methods: ["GET", "POST"] },
  "src/routes/api/agent/new.ts": { route: "/api/agent/new", methods: ["POST"] },
  "src/routes/api/agent/running/events.ts": { route: "/api/agent/running/events", methods: ["GET"] },
  "src/routes/api/agent/running.ts": { route: "/api/agent/running", methods: ["GET"] },
  "src/routes/api/app-update.ts": { route: "/api/app-update", methods: ["GET"] },
  "src/routes/api/auth/all-providers.ts": { route: "/api/auth/all-providers", methods: ["GET"] },
  "src/routes/api/auth/api-key/$provider.ts": { route: "/api/auth/api-key/$provider", methods: ["DELETE", "GET", "POST"] },
  "src/routes/api/auth/login/$provider.ts": { route: "/api/auth/login/$provider", methods: ["GET", "POST"] },
  "src/routes/api/auth/logout/$provider.ts": { route: "/api/auth/logout/$provider", methods: ["POST"] },
  "src/routes/api/auth/providers.ts": { route: "/api/auth/providers", methods: ["GET"] },
  "src/routes/api/cwd/browse.ts": { route: "/api/cwd/browse", methods: ["GET", "POST"] },
  "src/routes/api/cwd/validate.ts": { route: "/api/cwd/validate", methods: ["POST"] },
  "src/routes/api/default-cwd.ts": { route: "/api/default-cwd", methods: ["POST"] },
  "src/routes/api/file-index.ts": { route: "/api/file-index", methods: ["GET"] },
  "src/routes/api/files/$.ts": { route: "/api/files/$", methods: ["GET", "POST"] },
  "src/routes/api/git/diff.ts": { route: "/api/git/diff", methods: ["GET"] },
  "src/routes/api/git/status.ts": { route: "/api/git/status", methods: ["GET"] },
  "src/routes/api/home.ts": { route: "/api/home", methods: ["GET"] },
  "src/routes/api/models-config/catalog.ts": { route: "/api/models-config/catalog", methods: ["GET"] },
  "src/routes/api/models-config/discover.ts": { route: "/api/models-config/discover", methods: ["POST"] },
  "src/routes/api/models-config.ts": { route: "/api/models-config", methods: ["GET", "PUT"] },
  "src/routes/api/models-config/test.ts": { route: "/api/models-config/test", methods: ["POST"] },
  "src/routes/api/models.ts": { route: "/api/models", methods: ["GET"] },
  "src/routes/api/plugins.ts": { route: "/api/plugins", methods: ["GET", "POST"] },
  "src/routes/api/project-trust.ts": { route: "/api/project-trust", methods: ["GET", "POST"] },
  "src/routes/api/projects.ts": { route: "/api/projects", methods: ["GET", "PUT"] },
  "src/routes/api/sessions/$id/auto-name.ts": { route: "/api/sessions/$id/auto-name", methods: ["POST"] },
  "src/routes/api/sessions/$id/context.ts": { route: "/api/sessions/$id/context", methods: ["GET"] },
  "src/routes/api/sessions/$id/entries/$entryId/thinking.ts": { route: "/api/sessions/$id/entries/$entryId/thinking", methods: ["GET"] },
  "src/routes/api/sessions/$id/export.ts": { route: "/api/sessions/$id/export", methods: ["GET"] },
  "src/routes/api/sessions/$id.ts": { route: "/api/sessions/$id", methods: ["DELETE", "GET", "PATCH"] },
  "src/routes/api/sessions/$id/state.ts": { route: "/api/sessions/$id/state", methods: ["GET"] },
  "src/routes/api/sessions.ts": { route: "/api/sessions", methods: ["GET"] },
  "src/routes/api/skills/check.ts": { route: "/api/skills/check", methods: ["POST"] },
  "src/routes/api/skills/install.ts": { route: "/api/skills/install", methods: ["POST"] },
  "src/routes/api/skills.ts": { route: "/api/skills", methods: ["GET", "PATCH"] },
  "src/routes/api/skills/search.ts": { route: "/api/skills/search", methods: ["POST"] },
  "src/routes/api/skills/update.ts": { route: "/api/skills/update", methods: ["POST"] },
  "src/routes/api/worktrees.ts": { route: "/api/worktrees", methods: ["DELETE", "GET", "POST"] },
};
```

The final object must remain at exactly 41 entries.

- [ ] **Step 2: Run the focused test and confirm adapters are missing**

Run:

```bash
env -u PI_WEB_PASSWORD node --experimental-strip-types --test lib/tanstack-route-inventory.test.mjs
```

Expected: failure with `ENOENT` for the first missing adapter; the three spike adapters remain valid.

- [ ] **Step 3: Add static adapters**

For table rows whose invocation is only `METHOD(request)`, use this complete shape with aliases matching the imported methods:

```ts
import { createFileRoute } from "@tanstack/react-router";
import { GET as getHandler, POST as postHandler } from "@/app/api/example/route";

export const Route = createFileRoute("/api/example")({
  server: {
    handlers: {
      GET: ({ request }) => getHandler(request),
      POST: ({ request }) => postHandler(request),
    },
  },
});
```

For methods whose table invocation is `METHOD()`, omit the request argument:

```ts
GET: () => getHandler(),
```

Create every static adapter from rows 4-8, 12-16, 18-28, and 35-41 that does not already exist. Include every method shown in the table; multi-method files must delegate each method to the same internal module. In particular, `/api/cwd/browse` delegates both `GET` and `POST`, while `/api/projects` delegates `GET()` and `PUT(request)`.

- [ ] **Step 4: Add dynamic and catch-all adapters**

Use these exact bridge forms:

```ts
// One id parameter
GET: ({ request, params }) => getHandler(request, {
  params: Promise.resolve({ id: params.id }),
}),

// One provider parameter
POST: ({ request, params }) => postHandler(request, {
  params: Promise.resolve({ provider: params.provider }),
}),

// Nested id and entryId parameters
GET: ({ request, params }) => getHandler(request, {
  params: Promise.resolve({ id: params.id, entryId: params.entryId }),
}),

// Catch-all path parameter
GET: ({ request, params }) => getHandler(request, {
  params: Promise.resolve({ path: (params._splat ?? "").split("/") }),
}),
```

Create rows 1-3, 9-11, and 29-34, and add the missing `GET` method to the existing `src/routes/api/files/$.ts` adapter. Preserve the already-passing sessions and per-session events adapters.

- [ ] **Step 5: Generate the route tree in an external build**

Run:

```bash
export PI_WEB_TANSTACK_OUTPUT_DIR="$(mktemp -d /tmp/pi-web-tanstack-routes.XXXXXX)"
npm run build:tanstack
```

Expected: build exits 0; `src/routeTree.gen.ts` is regenerated with `/`, all 41 API routes, and no duplicate/conflicting route errors; no `.output` exists in the worktree.

- [ ] **Step 6: Verify inventory and type safety**

Run:

```bash
env -u PI_WEB_PASSWORD node --experimental-strip-types --test \
  lib/tanstack-route-inventory.test.mjs \
  lib/tanstack-agent-events-route.test.mjs \
  lib/tanstack-sessions-route.test.mjs
node_modules/.bin/tsc --noEmit
test "$(find src/routes/api -name '*.ts' -print | wc -l | tr -d ' ')" = "41"
test ! -e .output
```

Expected: all tests and type checking pass; the adapter count is exactly 41; `.output` is absent.

- [ ] **Step 7: Commit the full adapter layer**

Run:

```bash
git add src/routes/api src/routeTree.gen.ts lib/tanstack-route-inventory.test.mjs
git diff --cached --check
git commit -m "feat: expose all API routes through TanStack Start"
```

Expected: one commit containing the 38 new adapters, the completed existing files, generated route tree, and adapter inventory assertions.

### Task 4: Install Global Security Middleware

**Files:**
- Create: `src/request-security.ts`
- Create: `src/start.ts`
- Create: `lib/tanstack-request-security.test.mjs`
- Preserve unchanged: `proxy.ts`, `lib/request-security.ts`, `lib/web-auth.ts` until Phase 3 cleanup

- [ ] **Step 1: Write failing security response tests**

Create `lib/tanstack-request-security.test.mjs`. Import `getRequestSecurityRejection` through `jiti`, temporarily restore `PI_WEB_PASSWORD` after each password test, and cover this exact matrix:

```js
const cases = [
  {
    name: "rejects an untrusted API host as JSON",
    request: new Request("http://localhost:30141/api/sessions", {
      headers: { host: "attacker.example:30141", origin: "http://attacker.example:30141" },
    }),
    status: 403,
    contentType: "application/json",
    body: { error: "Untrusted API request" },
  },
  {
    name: "rejects an untrusted root host as text",
    request: new Request("http://localhost:30141/", {
      headers: { host: "attacker.example:30141" },
    }),
    status: 403,
    contentType: "text/plain",
    body: "Untrusted request",
  },
];
```

Also test:

```js
process.env.PI_WEB_PASSWORD = "correct horse battery staple";
const response = getRequestSecurityRejection(new Request("http://localhost:30141/", {
  headers: { host: "localhost:30141" },
}));
assert.equal(response.status, 401);
assert.equal(response.headers.get("cache-control"), "no-store");
assert.equal(
  response.headers.get("www-authenticate"),
  'Basic realm="Pi Web", charset="UTF-8"',
);
assert.equal(await response.text(), "Authentication required");
```

Add trusted root, trusted API, and valid Basic Auth cases that assert the function returns `undefined`. Also add `/sw.js`, `/manifest.webmanifest`, `/offline.html`, `/icons/icon-192.png`, and `/_build/app.js` cases with an untrusted Host and enabled password; each must return `undefined`, matching the former proxy matcher boundary.

- [ ] **Step 2: Run the test and confirm the module is absent**

Run:

```bash
env -u PI_WEB_PASSWORD node --experimental-strip-types --test lib/tanstack-request-security.test.mjs
```

Expected: failure because `src/request-security.ts` does not exist.

- [ ] **Step 3: Implement the minimal framework-neutral rejection bridge**

Create `src/request-security.ts`:

```ts
import {
  isApiRequestAllowed,
  isApiRequestHostAllowed,
} from "@/lib/request-security";
import {
  isValidBasicAuthorization,
  isWebPasswordEnabled,
} from "@/lib/web-auth";

export function getRequestSecurityRejection(request: Request): Response | undefined {
  const pathname = new URL(request.url).pathname;
  if (pathname !== "/" && pathname !== "/api" && !pathname.startsWith("/api/")) {
    return undefined;
  }
  const isApiRequest = pathname === "/api" || pathname.startsWith("/api/");
  const isTrustedRequest = isApiRequest
    ? isApiRequestAllowed(request)
    : isApiRequestHostAllowed(request);

  if (!isTrustedRequest) {
    return isApiRequest
      ? Response.json({ error: "Untrusted API request" }, { status: 403 })
      : new Response("Untrusted request", { status: 403 });
  }

  const password = process.env.PI_WEB_PASSWORD;
  if (
    isWebPasswordEnabled(password)
    && !isValidBasicAuthorization(request.headers.get("authorization"), password)
  ) {
    return new Response("Authentication required", {
      status: 401,
      headers: {
        "Cache-Control": "no-store",
        "WWW-Authenticate": 'Basic realm="Pi Web", charset="UTF-8"',
      },
    });
  }

  return undefined;
}
```

- [ ] **Step 4: Run the security unit tests**

Run:

```bash
env -u PI_WEB_PASSWORD node --experimental-strip-types --test \
  lib/request-security.test.mjs \
  lib/web-auth.test.mjs \
  lib/tanstack-request-security.test.mjs
```

Expected: all tests pass.

- [ ] **Step 5: Register global request middleware and explicit filtered CSRF**

Create `src/start.ts`:

```ts
import {
  createCsrfMiddleware,
  createMiddleware,
  createStart,
} from "@tanstack/react-start";
import { getRequestSecurityRejection } from "./request-security";

const requestSecurityMiddleware = createMiddleware().server(async ({ next, request }) => {
  const rejection = getRequestSecurityRejection(request);
  return rejection ?? next();
});

const serverFunctionCsrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
});

export const startInstance = createStart(() => ({
  requestMiddleware: [requestSecurityMiddleware, serverFunctionCsrfMiddleware],
}));
```

Add source assertions to `lib/tanstack-request-security.test.mjs` that `src/start.ts` contains `requestMiddleware`, contains `handlerType === "serverFn"`, and places `requestSecurityMiddleware` before `serverFunctionCsrfMiddleware`.

- [ ] **Step 6: Build and smoke security through Nitro**

Run:

```bash
export PI_WEB_TANSTACK_OUTPUT_DIR="$(mktemp -d /tmp/pi-web-tanstack-security.XXXXXX)"
npm run build:tanstack
node scripts/verify-tanstack-output.mjs "$PI_WEB_TANSTACK_OUTPUT_DIR"
env -u PI_WEB_PASSWORD PI_WEB_TANSTACK_SMOKE_PORT=30147 \
  node scripts/smoke-tanstack-output.mjs "$PI_WEB_TANSTACK_OUTPUT_DIR"
```

Expected: build/verifier/smoke exit 0; root and sessions return 200 for trusted requests.

Extend `scripts/smoke-tanstack-output.mjs` before rerunning so it uses `node:http` to assert an explicit `Host: attacker.example` receives root text 403 and API JSON 403. When `PI_WEB_PASSWORD` is set, the script must wait for readiness with a valid Basic header and additionally assert an unauthenticated root request returns 401 with the two required headers.

Run the password case:

```bash
PI_WEB_PASSWORD='tanstack-smoke-only' PI_WEB_TANSTACK_SMOKE_PORT=30147 \
  node scripts/smoke-tanstack-output.mjs "$PI_WEB_TANSTACK_OUTPUT_DIR"
```

Expected: exit 0; authenticated root/sessions, untrusted host/API, and unauthenticated Basic Auth checks all pass.

- [ ] **Step 7: Commit global security**

Run:

```bash
git add src/start.ts src/request-security.ts \
  lib/tanstack-request-security.test.mjs scripts/smoke-tanstack-output.mjs
git diff --cached --check
git commit -m "feat: enforce request security in TanStack Start"
```

Expected: one commit with the security bridge, global middleware, focused tests, and runtime smoke assertions.

### Task 5: Repeat The Long-Lived SSE Gate Through Middleware

**Files:**
- Create: `scripts/sse-tanstack-output.mjs`
- Modify: `docs/spikes/2026-08-12-tanstack-migration-results.md`

- [ ] **Step 1: Write a runtime SSE gate script**

Create `scripts/sse-tanstack-output.mjs` using `spawn`, `fetch`, `AbortController`, and `TextDecoder`. It must:

```text
1. require an absolute external output directory argument;
2. start server/index.mjs on PI_WEB_TANSTACK_SMOKE_PORT or 30147;
3. GET /api/sessions and choose the first non-transient session id without printing its id or data;
4. fetch /api/agent/<encoded-id>/events with an AbortController;
5. require status 200 and the four headers content-type=text/event-stream,
   cache-control=no-cache, no-transform, connection=keep-alive,
   x-accel-buffering=no;
6. read for at least 310000 milliseconds;
7. count a connected frame and lines equal to a single colon;
8. abort after the duration and require at least 10 heartbeats;
9. terminate the child in finally, propagating any failure;
10. print only duration, heartbeat count, and pass/fail, never the session id or frames.
```

Use these acceptance assertions in the script:

```js
assert.ok(elapsedMs >= 310_000, `SSE ended after ${elapsedMs}ms`);
assert.ok(sawConnected, "connected frame was not observed");
assert.ok(heartbeatCount >= 10, `only ${heartbeatCount} heartbeats were observed`);
```

- [ ] **Step 2: Build fresh and run the 310-second gate**

Run:

```bash
export PI_WEB_TANSTACK_OUTPUT_DIR="$(mktemp -d /tmp/pi-web-tanstack-sse.XXXXXX)"
npm run build:tanstack
env -u PI_WEB_PASSWORD PI_WEB_TANSTACK_SMOKE_PORT=30147 \
  node scripts/sse-tanstack-output.mjs "$PI_WEB_TANSTACK_OUTPUT_DIR"
```

Expected: after at least 310 seconds, exit 0, a connected frame was seen, and at least 10 heartbeats were counted. If there is no persisted local Pi session, stop and report that environmental blocker rather than substituting a mock for this gate.

- [ ] **Step 3: Record sanitized Phase 1 runtime evidence**

Create `docs/spikes/2026-08-12-tanstack-migration-results.md` with the date, commit tested, Node/npm versions, output mode, build/verifier/smoke exit results, security matrix result, SSE duration, heartbeat count, and a statement that no sensitive content was recorded. Do not include session ids, paths outside the repository, message content, credentials, or API keys.

- [ ] **Step 4: Commit the repeatable SSE gate and evidence**

Run:

```bash
git add scripts/sse-tanstack-output.mjs \
  docs/spikes/2026-08-12-tanstack-migration-results.md
git diff --cached --check
git commit -m "test: gate TanStack middleware with long-lived SSE"
```

Expected: one commit with the reusable gate and sanitized evidence.

### Task 6: Phase 1 Hard Gate

**Files:**
- Verify: all Phase 1 changes
- Modify only if evidence values changed: `docs/spikes/2026-08-12-tanstack-migration-results.md`

- [ ] **Step 1: Verify the route counts and framework neutrality**

Run:

```bash
test "$(find app/api -name route.ts -print | wc -l | tr -d ' ')" = "41"
test "$(find src/routes/api -name '*.ts' -print | wc -l | tr -d ' ')" = "41"
! rg -n 'next/server|NextRequest|NextResponse|\.nextUrl' app/api --glob 'route.ts'
env -u PI_WEB_PASSWORD node --experimental-strip-types --test \
  lib/tanstack-route-inventory.test.mjs \
  lib/tanstack-request-security.test.mjs
```

Expected: both counts are exactly 41, `rg` finds nothing, and all focused tests pass.

- [ ] **Step 2: Run the full local quality gate**

Run:

```bash
env -u NODE_ENV -u PI_WEB_PASSWORD npm test
npm run lint
node_modules/.bin/tsc --noEmit
git diff --check
```

Expected: every command exits 0 with no test failures or new lint warnings.

- [ ] **Step 3: Run a clean standalone build and runtime checks**

Run:

```bash
export PI_WEB_TANSTACK_OUTPUT_DIR="$(mktemp -d /tmp/pi-web-tanstack-phase1.XXXXXX)"
npm run build:tanstack
node scripts/verify-tanstack-output.mjs "$PI_WEB_TANSTACK_OUTPUT_DIR"
env -u PI_WEB_PASSWORD PI_WEB_TANSTACK_SMOKE_PORT=30147 \
  node scripts/smoke-tanstack-output.mjs "$PI_WEB_TANSTACK_OUTPUT_DIR"
test ! -e .output
```

Expected: build, externalization verifier, route/security smoke all pass and no repository output exists.

- [ ] **Step 4: Verify startup order and protected files**

Run:

```bash
env -u PI_WEB_PASSWORD node --experimental-strip-types --test \
  lib/tanstack-server-startup.test.mjs \
  lib/http-dispatcher.test.mjs
git diff --exit-code 0f6a152 -- \
  lib/rpc-manager.ts \
  lib/agent-event-stream.ts \
  lib/request-security.ts \
  lib/web-auth.ts
```

Expected: tests pass and protected-file diff is empty.

- [ ] **Step 5: Stop at the Phase 1 checkpoint**

Run:

```bash
git status --short --branch
git log --oneline 0f6a152..HEAD
```

Expected: only an intentional evidence update may be uncommitted; commit it with `docs: record TanStack Phase 1 gate` before proceeding. Review all Phase 1 commits. Do not begin Phase 2 unless every preceding gate passed.

# Phase 2: AppShell, Root Layout, Metadata, Font, And PWA

### Task 7: Lock And Migrate AppShell Navigation

**Files:**
- Create: `lib/tanstack-app-shell.test.mjs`
- Modify: `src/routes/index.tsx`
- Modify: `components/AppShell.tsx`
- Preserve: `lib/initial-navigation.ts`, `lib/initial-navigation.test.mjs`

- [ ] **Step 1: Write failing source-contract tests for the new router boundary**

Create `lib/tanstack-app-shell.test.mjs` with these assertions:

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appShell = await readFile(new URL("../components/AppShell.tsx", import.meta.url), "utf8");
const indexRoute = await readFile(new URL("../src/routes/index.tsx", import.meta.url), "utf8");

test("AppShell uses TanStack navigation instead of next/navigation", () => {
  assert.doesNotMatch(appShell, /next\/navigation|useSearchParams|router\.replace/);
  assert.match(appShell, /useNavigate/);
  assert.match(appShell, /replace:\s*true/);
  assert.match(appShell, /resetScroll:\s*false/);
});

test("the migrated shell preserves the integrated project workspace", () => {
  assert.match(appShell, /import \{ CodexSidebar \} from "\.\/CodexSidebar"/);
  assert.match(appShell, /import \{ SettingsPage \} from "\.\/SettingsPage"/);
  assert.match(appShell, /<CodexSidebar/);
  assert.match(appShell, /<SettingsPage/);
});

test("the index route validates optional session and cwd search strings", () => {
  assert.match(indexRoute, /validateSearch/);
  assert.match(indexRoute, /typeof search\.session === ["']string["']/);
  assert.match(indexRoute, /typeof search\.cwd === ["']string["']/);
  assert.match(indexRoute, /<AppShell/);
  assert.match(indexRoute, /<I18nProvider>/);
});
```

Also assert that `AppShell` uses the root route's typed search hook and that exactly seven navigation call sites exist. The seven existing behaviors are three root clears and four session replacements; count them explicitly so none is silently lost.

- [ ] **Step 2: Run the focused tests and confirm they fail on Next navigation**

Run:

```bash
node --experimental-strip-types --test \
  lib/tanstack-app-shell.test.mjs \
  lib/initial-navigation.test.mjs
```

Expected: existing initial-navigation tests pass; new source-contract tests fail because the index is still a spike page and AppShell imports `next/navigation`.

- [ ] **Step 3: Make `/` validate search and mount the real app**

Replace `src/routes/index.tsx` with this route shape:

```tsx
import { Suspense } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { I18nProvider } from "@/hooks/useI18n";

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>) => ({
    session: typeof search.session === "string" ? search.session : undefined,
    cwd: typeof search.cwd === "string" ? search.cwd : undefined,
  }),
  component: Home,
});

function Home() {
  return (
    <Suspense>
      <I18nProvider>
        <AppShell />
      </I18nProvider>
    </Suspense>
  );
}
```

- [ ] **Step 4: Replace Next navigation in AppShell**

Import TanStack hooks:

```ts
import { useNavigate, useSearch } from "@tanstack/react-router";
```

At component initialization:

```ts
const navigate = useNavigate({ from: "/" });
const search = useSearch({ from: "/" });
const [initialNavigation] = useState(() => getInitialNavigation(
  new URLSearchParams(Object.entries(search).flatMap(([key, value]) =>
    value === undefined ? [] : [[key, value]],
  )),
));
```

Replace each session URL update with:

```ts
void navigate({
  to: "/",
  search: { session: session.id },
  replace: true,
  resetScroll: false,
});
```

Use the applicable id variable at each of the four session call sites (`s.id`, `session.id`, or `newSessionId`). Replace each of the three root clears with:

```ts
void navigate({
  to: "/",
  search: {},
  replace: true,
  resetScroll: false,
});
```

Update hook dependency arrays from `router` to `navigate`. Preserve the special restore branch that avoids rewriting a URL already containing the restored session. Do not change workspace/session state logic.

Do not import `src/routes/index.tsx` into `AppShell`; the index route already imports `AppShell`, so that would create a circular dependency. The direct typed `useSearch({ from: "/" })` call above is the intended boundary.

- [ ] **Step 5: Run navigation and AppShell regression tests**

Run:

```bash
node --experimental-strip-types --test \
  lib/tanstack-app-shell.test.mjs \
  lib/initial-navigation.test.mjs \
  components/AppShell.auto-name.test.mjs \
  components/AppShell.file-viewer-state.test.mjs \
  components/AppShell.mobile-toolbar.test.mjs \
  components/AppShell.workspace-memory.test.mjs \
  components/CodexSidebar.test.mjs \
  components/SettingsPage.test.mjs \
  lib/project-registry.test.mjs
node_modules/.bin/tsc --noEmit
```

Expected: all tests and type checking pass. Use `search: () => ({})` for the three root clears if the generated route type requires a callback; apply that form consistently and update the source-contract test to count it. Do not reintroduce `window.history` or an untyped wrapper.

- [ ] **Step 6: Commit AppShell navigation**

Run:

```bash
git add components/AppShell.tsx src/routes/index.tsx \
  lib/tanstack-app-shell.test.mjs src/routeTree.gen.ts
git diff --cached --check
git commit -m "feat: mount AppShell with TanStack navigation"
```

Expected: one focused commit; no unrelated component or business-logic changes.

### Task 8: Migrate Root Document, Metadata, Local Font, And Version Defines

**Files:**
- Create: `lib/tanstack-root.test.mjs`
- Modify: `src/routes/__root.tsx`
- Modify: `app/globals.css`
- Modify: `vite.tanstack.config.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Write failing root-document and config tests**

Create `lib/tanstack-root.test.mjs` and assert:

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = await readFile(new URL("../src/routes/__root.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const vite = await readFile(new URL("../vite.tanstack.config.ts", import.meta.url), "utf8");
const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

test("the TanStack root owns global document behavior", () => {
  for (const marker of [
    "Pi Web interface for the pi coding agent",
    "/manifest.webmanifest",
    "/icons/icon-192.png",
    "/icons/apple-touch-icon.png",
    "viewport-fit=cover",
    "interactive-widget=resizes-content",
    "apple-mobile-web-app-capable",
    "format-detection",
    "google",
    "notranslate",
    "pi-theme",
    "PwaRegistration",
    "katex/dist/katex.min.css",
    "@/app/globals.css",
  ]) assert.match(root, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("Noto Sans Mono is local and keeps the existing CSS variable", () => {
  assert.equal(pkg.dependencies["@fontsource-variable/noto-sans-mono"], "5.3.0");
  assert.match(root, /@fontsource-variable\/noto-sans-mono/);
  assert.match(css, /--font-noto-mono/);
});

test("Vite defines the two existing public version variables", () => {
  assert.match(vite, /process\.env\.NEXT_PUBLIC_APP_VERSION/);
  assert.match(vite, /process\.env\.NEXT_PUBLIC_PI_VERSION/);
});
```

- [ ] **Step 2: Run the test and confirm missing root behavior**

Run:

```bash
node --experimental-strip-types --test lib/tanstack-root.test.mjs
```

Expected: failures for metadata, PWA registration, font dependency/import, and version defines.

- [ ] **Step 3: Add the pinned local font dependency**

Run:

```bash
env -u NODE_ENV npm install --save-exact @fontsource-variable/noto-sans-mono@5.3.0
```

Expected: `package.json` and `package-lock.json` include exactly version `5.3.0` under dependencies.

- [ ] **Step 4: Move layout and metadata into the TanStack root**

In `src/routes/__root.tsx`:

```tsx
import "@fontsource-variable/noto-sans-mono";
import "katex/dist/katex.min.css";
import "@/app/globals.css";
import { PwaRegistration } from "@/components/PwaRegistration";
```

Expand `head()` to emit literal equivalents of every `metadata` and `viewport` value from `app/layout.tsx`, including title, description, application name, manifest, viewport fit, interactive widget, two theme colors with media attributes, icon/apple links, Apple PWA tags, and telephone format detection. Use TanStack head `meta` and `links`; do not use `next` metadata types.

Apply existing document attributes and script:

```tsx
<html
  lang="en"
  translate="no"
  className="notranslate"
  suppressHydrationWarning
>
  <head>
    <HeadContent />
    <script dangerouslySetInnerHTML={{ __html: THE_EXISTING_THEME_SCRIPT }} />
  </head>
  <body translate="no" className="notranslate" suppressHydrationWarning>
    {children}
    <PwaRegistration />
    <Scripts />
  </body>
</html>
```

Copy the exact theme-script body from `app/layout.tsx`; do not rewrite its behavior.

In `app/globals.css`, define the preserved variable using the package family:

```css
:root {
  --font-noto-mono: "Noto Sans Mono Variable";
  --font-mono: var(--font-noto-mono), 'JetBrains Mono', 'Fira Code', 'Consolas', ui-monospace, 'PingFang SC', 'Microsoft YaHei', monospace;
}
```

- [ ] **Step 5: Define existing public version expressions at build time**

In `vite.tanstack.config.ts`, read `package.json` and the installed Pi package using structured JSON reads, then add:

```ts
define: {
  "process.env.NEXT_PUBLIC_APP_VERSION": JSON.stringify(appPackage.version),
  "process.env.NEXT_PUBLIC_PI_VERSION": JSON.stringify(piPackage.version),
},
```

Resolve both paths from the config module or `process.cwd()` consistently. Do not introduce new public variable names during this migration. `process.env.NODE_ENV` remains supplied by Vite's existing production replacement.

- [ ] **Step 6: Run focused tests, typecheck, and an external build**

Run:

```bash
node --experimental-strip-types --test \
  lib/tanstack-root.test.mjs \
  components/MobilePwaLayout.test.mjs \
  components/CodexSidebar.test.mjs \
  components/SettingsPage.test.mjs \
  lib/project-registry.test.mjs \
  components/ChatWindow.process-details.test.mjs
node_modules/.bin/tsc --noEmit
export PI_WEB_TANSTACK_OUTPUT_DIR="$(mktemp -d /tmp/pi-web-tanstack-root.XXXXXX)"
npm run build:tanstack
rg -n '0\.8\.8-beta\.1|0\.84\.1' "$PI_WEB_TANSTACK_OUTPUT_DIR/public" \
  "$PI_WEB_TANSTACK_OUTPUT_DIR/server"
```

Expected: tests/typecheck/build pass; generated assets contain both current versions. If the package versions have legitimately advanced before execution, search for the actual two values reported by Node instead:

```bash
node -e 'console.log(require("./package.json").version, require("@earendil-works/pi-coding-agent/package.json").version)'
```

- [ ] **Step 7: Commit the root document migration**

Run:

```bash
git add src/routes/__root.tsx app/globals.css vite.tanstack.config.ts \
  package.json package-lock.json lib/tanstack-root.test.mjs
git diff --cached --check
git commit -m "feat: migrate root metadata and local font"
```

Expected: one commit containing only document metadata, styles, version defines, and pinned font files in the lockfile.

### Task 9: Migrate Manifest, Service Worker, And Cache Headers

**Files:**
- Create: `public/manifest.webmanifest`
- Modify: `public/sw.js`
- Modify: `public/sw.test.mjs`
- Modify: `vite.tanstack.config.ts`
- Modify: `lib/tanstack-root.test.mjs`
- Modify: `scripts/smoke-tanstack-output.mjs`

- [ ] **Step 1: Add failing static-PWA and cache-header assertions**

Extend `lib/tanstack-root.test.mjs` to parse `public/manifest.webmanifest` and deep-equal this object:

```js
{
  id: "/",
  name: "Pi Web",
  short_name: "Pi Web",
  description: "Local web interface for the pi coding agent",
  start_url: "/",
  scope: "/",
  display: "standalone",
  background_color: "#1a1a1a",
  theme_color: "#1a1a1a",
  categories: ["developer", "productivity"],
  lang: "en",
  icons: [
    { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
    { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
  ],
}
```

Assert `vite.tanstack.config.ts` contains route rules for `/`, `/sw.js`, and `/manifest.webmanifest` with these exact headers:

```text
/: Cache-Control = private, no-cache, max-age=0, must-revalidate
/sw.js: Cache-Control = public, max-age=0, must-revalidate
/sw.js: Service-Worker-Allowed = /
/manifest.webmanifest: Cache-Control = public, max-age=0, must-revalidate
```

Extend `public/sw.test.mjs` to require the service worker's static-asset test to accept TanStack Start client assets under `/_build/` and reject the obsolete `/_next/static/` marker.

- [ ] **Step 2: Run focused tests and confirm failures**

Run:

```bash
node --experimental-strip-types --test \
  lib/tanstack-root.test.mjs \
  public/sw.test.mjs
```

Expected: failures because the static manifest and Nitro rules are absent and the service worker still references Next assets.

- [ ] **Step 3: Add the static manifest and update service-worker asset matching**

Create `public/manifest.webmanifest` with the exact JSON object above.

In `public/sw.js`, replace only:

```js
url.pathname.startsWith("/_next/static/")
```

with:

```js
url.pathname.startsWith("/_build/")
```

Keep API bypass, notification behavior, navigation fallback, precache URLs, cache versioning, and cache cleanup unchanged.

- [ ] **Step 4: Add Nitro route rules**

Inside the existing `nitro({ ... })` call in `vite.tanstack.config.ts`, add:

```ts
routeRules: {
  "/": {
    headers: {
      "Cache-Control": "private, no-cache, max-age=0, must-revalidate",
    },
  },
  "/sw.js": {
    headers: {
      "Cache-Control": "public, max-age=0, must-revalidate",
      "Service-Worker-Allowed": "/",
    },
  },
  "/manifest.webmanifest": {
    headers: {
      "Cache-Control": "public, max-age=0, must-revalidate",
    },
  },
},
```

- [ ] **Step 5: Extend runtime smoke to verify the static PWA surface**

Add checks to `scripts/smoke-tanstack-output.mjs`:

```text
GET / returns root Cache-Control exactly.
GET /sw.js returns 200, JavaScript, its exact Cache-Control, and Service-Worker-Allowed: /.
GET /manifest.webmanifest returns 200, its exact Cache-Control, and JSON with name Pi Web.
GET /offline.html returns 200 and contains Pi Web.
GET /icons/icon-192.png returns 200 and image/png.
```

- [ ] **Step 6: Run tests and runtime PWA checks**

Run:

```bash
node --experimental-strip-types --test \
  lib/tanstack-root.test.mjs \
  public/sw.test.mjs
export PI_WEB_TANSTACK_OUTPUT_DIR="$(mktemp -d /tmp/pi-web-tanstack-pwa.XXXXXX)"
npm run build:tanstack
env -u PI_WEB_PASSWORD PI_WEB_TANSTACK_SMOKE_PORT=30147 \
  node scripts/smoke-tanstack-output.mjs "$PI_WEB_TANSTACK_OUTPUT_DIR"
```

Expected: all tests pass and every runtime PWA/header assertion succeeds.

- [ ] **Step 7: Commit the PWA migration**

Run:

```bash
git add public/manifest.webmanifest public/sw.js public/sw.test.mjs \
  vite.tanstack.config.ts lib/tanstack-root.test.mjs \
  scripts/smoke-tanstack-output.mjs
git diff --cached --check
git commit -m "feat: migrate PWA assets and cache rules"
```

Expected: one PWA-focused commit.

### Task 10: Phase 2 Hard Gate

**Files:**
- Verify: all Phase 2 changes
- Preserve for later removal: old Next framework files

- [ ] **Step 1: Verify the AppShell and root source contracts**

Run:

```bash
node --experimental-strip-types --test \
  lib/tanstack-app-shell.test.mjs \
  lib/tanstack-root.test.mjs \
  lib/initial-navigation.test.mjs \
  public/sw.test.mjs
! rg -n 'from ["'"']next/(navigation|font|server)["'"']|NextRequest|NextResponse|\.nextUrl' \
  app/api components src --glob '*.{ts,tsx}'
```

Expected: focused tests pass and no migrated runtime source imports those Next APIs. Old `app/layout.tsx` is deliberately excluded until Phase 3 retirement.

- [ ] **Step 2: Run full tests, lint, and typecheck**

Run:

```bash
env -u NODE_ENV -u PI_WEB_PASSWORD npm test
npm run lint
node_modules/.bin/tsc --noEmit
git diff --check
```

Expected: all commands exit 0 and no new warnings are introduced.

- [ ] **Step 3: Run the real AppShell/PWA build smoke**

Run:

```bash
export PI_WEB_TANSTACK_OUTPUT_DIR="$(mktemp -d /tmp/pi-web-tanstack-phase2.XXXXXX)"
npm run build:tanstack
node scripts/verify-tanstack-output.mjs "$PI_WEB_TANSTACK_OUTPUT_DIR"
env -u PI_WEB_PASSWORD PI_WEB_TANSTACK_SMOKE_PORT=30147 \
  node scripts/smoke-tanstack-output.mjs "$PI_WEB_TANSTACK_OUTPUT_DIR"
curl --fail --silent --show-error --max-time 10 \
  "http://127.0.0.1:30147/?session=nonexistent-smoke-id" >/dev/null || true
test ! -e .output
```

The smoke script owns server startup/teardown, so the standalone curl is informational unless a server is deliberately kept running. Required automated proof is the smoke script's AppShell marker, static PWA surface, version values, and header assertions.

Expected: build/verifier/smoke pass and `.output` is absent.

- [ ] **Step 4: Manually inspect the running AppShell at desktop and mobile widths**

Start a fresh output on port 30147. Choose a local non-sensitive session from the UI and a disposable cwd, then inspect `/`, its generated `/?session=...` URL, and its generated `/?cwd=...` URL in a browser. Confirm:

```text
AppShell renders rather than the spike heading.
Existing session deep link restores that session.
cwd takes precedence if both parameters exist.
Selecting a session replaces, rather than pushes, history.
Theme is applied before paint without a light/dark flash.
No hydration error appears in the console.
Manifest and service worker register in a production build.
Desktop and narrow mobile layouts remain usable without overlap.
CodexSidebar lists projects and persists pin, order, rename, archive, restore, and remove actions.
The consolidated SettingsPage opens and retains General, Project, Models, Skills, and Plugins sections.
Creating a folder through DirectoryPicker uses POST /api/cwd/browse and navigates into the new folder.
A running background session shows the project-row spinner through /api/agent/running/events; completion removes it and produces an unread marker only for a background session.
```

Use a local non-sensitive test session/path. Do not put its identifier or contents in the evidence document.

- [ ] **Step 5: Verify protected files and stop at checkpoint**

Run:

```bash
git diff --exit-code 0f6a152 -- \
  lib/rpc-manager.ts \
  lib/agent-event-stream.ts \
  lib/request-security.ts \
  lib/web-auth.ts
git status --short --branch
git log --oneline 0f6a152..HEAD
```

Expected: protected files unchanged and worktree clean after committing any evidence update as `docs: record TanStack Phase 2 gate`. Do not begin Phase 3 unless every Phase 2 item passed.

# Phase 3: Nitro Publication Output, CLI, And npm Package

### Task 11: Introduce Explicit Standalone And Publication Output Modes

**Files:**
- Modify: `vite.tanstack.config.ts`
- Modify: `lib/tanstack-spike-config.test.mjs`
- Modify: `lib/tanstack-output.test.mjs`
- Modify: `scripts/verify-tanstack-output.mjs`

- [ ] **Step 1: Add failing output-mode tests**

Extend `lib/tanstack-spike-config.test.mjs` to assert the config:

```text
accepts PI_WEB_TANSTACK_OUTPUT_MODE;
supports only standalone and publication;
defaults to standalone;
runs copyExternalPackages only for standalone;
retains exportConditions with node, import, production, default;
still rejects missing, relative, or in-repository output directories for builds.
```

Extend `lib/tanstack-output.test.mjs` or `scripts/verify-tanstack-output.mjs` so `--mode standalone` requires all five packages to resolve from `<output>/server/node_modules`, while `--mode publication` requires:

```text
the generated server has runtime import edges for all five packages;
<output>/server/node_modules/@earendil-works does not exist;
<output>/server/node_modules/undici does not exist;
```

Keep the five server-sensitive packages unchanged in the externalization/copy set. Separately require `lucide-react` to remain a production dependency and resolve after staging/installing the publication package. It is a client-source dependency used by CodexSidebar, SettingsPage, and the activity spinner; do not add it to `ssr.external`, `traceDeps`, or `copyExternalPackages` unless a generated server runtime import proves that necessary.

In publication mode, do not attempt to import the server until the output is staged with installed dependencies; the installed-package smoke performs that proof.

- [ ] **Step 2: Run focused tests and confirm publication mode is absent**

Run:

```bash
node --experimental-strip-types --test \
  lib/tanstack-spike-config.test.mjs \
  lib/tanstack-output.test.mjs
```

Expected: output-mode assertions fail.

- [ ] **Step 3: Implement the two-mode config with validation**

In `vite.tanstack.config.ts`:

```ts
const outputMode = process.env.PI_WEB_TANSTACK_OUTPUT_MODE?.trim() || "standalone";
if (outputMode !== "standalone" && outputMode !== "publication") {
  throw new Error("PI_WEB_TANSTACK_OUTPUT_MODE must be standalone or publication");
}
```

Keep `ssr.external`, `exportConditions`, absolute external output validation, and route rules in both modes. Set `traceDeps: outputMode === "standalone" ? EXTERNAL_PACKAGES : []`; Nitro uses `traceDeps` to include dependencies in build output, so publication must leave it empty. Make the plugins array conditional without duplicating the entire config:

```ts
plugins: [
  tanstackStart({ srcDirectory: "src" }),
  nitro({ /* existing shared config */ }),
  viteReact(),
  outputMode === "standalone" ? copyExternalPackages(outputDir) : undefined,
].filter(Boolean),
```

Use a typed helper or `PluginOption[]` if TypeScript requires it. Do not remove `copyExternalPackages` or change standalone behavior.

- [ ] **Step 4: Build and verify both modes externally**

Run:

```bash
export PI_WEB_TANSTACK_OUTPUT_DIR="$(mktemp -d /tmp/pi-web-standalone.XXXXXX)"
PI_WEB_TANSTACK_OUTPUT_MODE=standalone npm run build:tanstack
node scripts/verify-tanstack-output.mjs --mode standalone "$PI_WEB_TANSTACK_OUTPUT_DIR"

export PI_WEB_TANSTACK_OUTPUT_DIR="$(mktemp -d /tmp/pi-web-publication.XXXXXX)"
PI_WEB_TANSTACK_OUTPUT_MODE=publication npm run build:tanstack
node scripts/verify-tanstack-output.mjs --mode publication "$PI_WEB_TANSTACK_OUTPUT_DIR"

test ! -e .output
```

Expected: both builds pass; standalone resolves copied packages; publication has runtime imports but no duplicated Pi/undici package directories; `.output` is absent.

- [ ] **Step 5: Commit the build modes**

Run:

```bash
git add vite.tanstack.config.ts scripts/verify-tanstack-output.mjs \
  lib/tanstack-spike-config.test.mjs lib/tanstack-output.test.mjs
git diff --cached --check
git commit -m "build: separate standalone and publication outputs"
```

Expected: one build-only commit.

### Task 12: Stage And Pack Publication Output Outside The Repository

**Files:**
- Create: `scripts/stage-tanstack-package.mjs`
- Create: `scripts/pack-tanstack.mjs`
- Create: `lib/tanstack-package.test.mjs`
- Modify later in this task: `package.json`

- [ ] **Step 1: Write failing package-staging tests**

Create `lib/tanstack-package.test.mjs`. Test the staging script in a temporary fixture and assert:

```text
stage and output arguments must be absolute;
stage must be outside the repository;
the stage directory receives .output, bin, package.json, README.md, README.zh-CN.md, README.ja.md, README.ru.md, LICENSE;
the stage directory does not receive a second source public directory because .output/public is complete;
the staged package.json keeps name, version, bin, engines, and production dependencies;
the staged package.json files list contains .output and excludes .next/next.config.ts;
scripts intended only for repository development are absent from the staged manifest;
the repository never receives .output.
```

The fixture should invoke the script through `spawnSync(process.execPath, [...])`, not import private functions.

- [ ] **Step 2: Run the focused test and confirm staging scripts are absent**

Run:

```bash
node --experimental-strip-types --test lib/tanstack-package.test.mjs
```

Expected: failure because `scripts/stage-tanstack-package.mjs` does not exist.

- [ ] **Step 3: Implement external staging**

Create `scripts/stage-tanstack-package.mjs`. Use only Node standard-library structured/file APIs. Required CLI:

```text
node scripts/stage-tanstack-package.mjs <absolute-publication-output> <absolute-stage-dir>
```

Implementation requirements:

```js
const INCLUDED_FILES = [
  "bin",
  "README.md",
  "README.zh-CN.md",
  "README.ja.md",
  "README.ru.md",
  "LICENSE",
];
```

Copy publication output to `<stage>/.output`; copy `INCLUDED_FILES`; parse root `package.json`; write a staged manifest preserving package identity, metadata, engines, bin, dependencies, and optionalDependencies, with:

```json
{
  "files": ["bin", ".output", "README*.md", "LICENSE", "package.json"]
}
```

Do not include repository scripts, devDependencies, `.git`, source, tests, `.next`, or `next.config.ts`. Fail if stage is inside the repo or equals the repo. The caller must provide a fresh/nonexistent stage directory; fail rather than overwrite an existing populated directory.

- [ ] **Step 4: Implement a pack orchestrator**

Create `scripts/pack-tanstack.mjs`. It must:

```text
1. create fresh output and stage directories with mkdtemp under os.tmpdir();
2. spawn npm run build:tanstack with PI_WEB_TANSTACK_OUTPUT_MODE=publication and the external output path;
3. run verify-tanstack-output.mjs --mode publication;
4. run stage-tanstack-package.mjs;
5. run npm pack --json in the stage directory;
6. print JSON containing outputDir, stageDir, absolute tarball path, filename, size, and integrity;
7. preserve child stdio on failure and exit non-zero;
8. never copy output back into the repository.
```

Use `spawnSync`/`spawn` with argument arrays and `shell: false`.

- [ ] **Step 5: Add repository scripts without changing default publication yet**

Add to root `package.json`:

```json
{
  "scripts": {
    "build:tanstack:standalone": "PI_WEB_TANSTACK_OUTPUT_MODE=standalone vite build --configLoader runner --config vite.tanstack.config.ts",
    "build:tanstack:publication": "PI_WEB_TANSTACK_OUTPUT_MODE=publication vite build --configLoader runner --config vite.tanstack.config.ts",
    "pack:tanstack": "node scripts/pack-tanstack.mjs"
  }
}
```

Keep `build`, `release`, and the root `files` list unchanged in this task. The POSIX environment-prefix scripts are for local macOS/Linux use; Windows CI continues to set variables in PowerShell before calling `npm run build:tanstack`.

- [ ] **Step 6: Run tests and create a real staged tarball**

Run:

```bash
node --experimental-strip-types --test lib/tanstack-package.test.mjs
npm run pack:tanstack
test ! -e .output
git status --short
```

Expected: tests pass; pack command emits one absolute `.tgz` path under a temporary staging directory; `.output` is absent; only intended source/doc changes are visible.

- [ ] **Step 7: Audit tarball contents and size**

Using the `stageDir` emitted by the prior command, set one shell variable and audit it:

```bash
export PI_WEB_TANSTACK_STAGE_DIR="/the/absolute/stageDir/from-pack-output"
npm pack --dry-run --json "$PI_WEB_TANSTACK_STAGE_DIR"
tar -tf "$PI_WEB_TANSTACK_STAGE_DIR"/agegr-pi-web-*.tgz | sort
```

Expected: tarball includes `package/.output/server/index.mjs`, built public assets, `bin`, manifest/docs/license; excludes `.next`, source, tests, `.git`, maps explicitly excluded by the staging policy, and duplicated `package/.output/server/node_modules/@earendil-works`. Record compressed and unpacked sizes in the evidence document; do not invent a size threshold before measuring the functional artifact.

- [ ] **Step 8: Commit external package staging**

Run:

```bash
git add scripts/stage-tanstack-package.mjs scripts/pack-tanstack.mjs \
  lib/tanstack-package.test.mjs package.json
git diff --cached --check
git commit -m "build: stage TanStack publication packages externally"
```

Expected: one commit; root `.next` publication remains intact for now.

### Task 13: Migrate The CLI To Nitro And Test Real Process Behavior

**Files:**
- Create: `lib/tanstack-cli.test.mjs`
- Modify: `bin/pi-web.js`
- Preserve: `bin/pi-web-options.js`, `lib/pi-web-options.test.mjs`

- [ ] **Step 1: Write a failing CLI process test**

Create `lib/tanstack-cli.test.mjs`. Build a temporary fake package containing the real `bin/pi-web.js`, `bin/pi-web-options.js`, and a fake `.output/server/index.mjs`. The fake entry should:

```js
console.log(JSON.stringify({
  host: process.env.NITRO_HOST,
  port: process.env.NITRO_PORT,
  piWebHostname: process.env.PI_WEB_HOSTNAME,
}));
console.log("Listening on http://" + process.env.NITRO_HOST + ":" + process.env.NITRO_PORT);
process.exit(Number(process.env.FAKE_EXIT_CODE || 0));
```

Spawn the copied CLI with `--no-open -H 0.0.0.0 -p 30222` and `PI_WEB_PASSWORD` set. Assert:

```text
stdout reports NITRO_HOST=0.0.0.0, NITRO_PORT=30222, PI_WEB_HOSTNAME=0.0.0.0;
stderr contains the Basic Auth over HTTP warning;
the child exit code propagates for FAKE_EXIT_CODE=7;
the CLI source resolves .output/server/index.mjs;
the CLI source does not contain next/dist/bin/next or shell: true;
readiness detection accepts the Nitro "Listening on" output;
```

Keep the existing option parser tests as the authoritative port/host/no-open tests.

- [ ] **Step 2: Run CLI tests and confirm the launcher still targets Next**

Run:

```bash
node --experimental-strip-types --test \
  lib/tanstack-cli.test.mjs \
  lib/pi-web-options.test.mjs
```

Expected: new tests fail because `bin/pi-web.js` still resolves and spawns Next.

- [ ] **Step 3: Change only the server spawn and readiness behavior**

In `bin/pi-web.js`, replace Next resolution/arguments with:

```js
const serverEntry = path.join(packageRoot, ".output", "server", "index.mjs");
if (!fs.existsSync(serverEntry)) {
  console.error(`Pi Web server output not found: ${serverEntry}`);
  process.exit(1);
}

const server = spawn(process.execPath, [serverEntry], {
  stdio: ["inherit", "pipe", "pipe"],
  shell: false,
  env: {
    ...process.env,
    NITRO_HOST: hostname,
    NITRO_PORT: port,
    PI_WEB_HOSTNAME: hostname,
  },
});
```

Adapt readiness to match Nitro's actual verified startup line, with one narrow expression such as `/Listening on|Server listening/`. Do not open the browser on arbitrary output. Preserve warning text, opener platform branches, signal forwarding, error reporting, and exit-code propagation.

- [ ] **Step 4: Run CLI and option tests**

Run:

```bash
node --experimental-strip-types --test \
  lib/tanstack-cli.test.mjs \
  lib/pi-web-options.test.mjs \
  lib/node-version.test.mjs
```

Expected: all tests pass, including fake child exit code 7.

- [ ] **Step 5: Commit the CLI migration**

Run:

```bash
git add bin/pi-web.js lib/tanstack-cli.test.mjs
git diff --cached --check
git commit -m "feat: launch Nitro from the pi-web CLI"
```

Expected: one CLI-focused commit; `bin/pi-web-options.js` remains unchanged unless a failing existing test proves a change is required.

### Task 14: Prove The Exact Tarball In A Fresh Install

**Files:**
- Create: `scripts/smoke-installed-package.mjs`
- Modify: `scripts/pack-tanstack.mjs`
- Modify: `lib/tanstack-package.test.mjs`
- Modify: `docs/spikes/2026-08-12-tanstack-migration-results.md`

- [ ] **Step 1: Add failing installed-package test requirements**

Extend `lib/tanstack-package.test.mjs` to source-check that `scripts/smoke-installed-package.mjs`:

```text
requires an absolute .tgz path;
creates a fresh temporary npm project;
runs npm init -y and npm install <exact-tarball>;
spawns node_modules/.bin/pi-web on POSIX and pi-web.cmd on Windows;
sets --no-open -H 127.0.0.1 -p from PI_WEB_TANSTACK_SMOKE_PORT or 30147;
waits for HTTP readiness rather than trusting log text alone;
probes root, sessions, manifest, service worker, and security rejection;
checks runtime resolution of all five sensitive dependencies from the installed package;
checks `lucide-react` is listed under staged production dependencies and resolves from the installed package;
terminates the CLI in finally and propagates failures.
```

- [ ] **Step 2: Implement the installed-package smoke**

Create `scripts/smoke-installed-package.mjs`. Required invocation:

```text
node scripts/smoke-installed-package.mjs /absolute/path/to/@agegr-pi-web-x.y.z.tgz
```

Use `mkdtemp(join(tmpdir(), "pi-web-installed-"))`, create a minimal package with `npm init -y`, and install the exact tarball with:

```bash
npm install --ignore-scripts /absolute/path/to/tarball.tgz
```

Do not use `npm link` or the repository's `node_modules`. Spawn the installed bin with an argument array and `shell: false`. Probe:

```text
GET / -> 200 and real AppShell marker, not only a generic Pi Web title;
GET /api/sessions -> 200, no-store, arrays for sessions and runningSessionIds;
GET /manifest.webmanifest -> 200 and name Pi Web;
GET /sw.js -> 200 and Service-Worker-Allowed /;
untrusted Host root -> text 403;
untrusted Host API -> JSON 403;
```

Resolve each package from the installed package root with `createRequire(join(installedPackage, "package.json"))`, read its package version, and compare to the staged package dependencies:

```text
undici
@earendil-works/pi-coding-agent
@earendil-works/pi-agent-core
@earendil-works/pi-ai
@earendil-works/pi-tui
lucide-react
```

The first five versions prove the existing server-sensitive externalization contract. `lucide-react` is the separate production-manifest/installability check; it need not appear as a server runtime import after Vite bundles client code.

Print only temporary directory, versions, endpoint statuses, and pass/fail.

- [ ] **Step 3: Make pack orchestration run the installed smoke**

After `npm pack` succeeds, have `scripts/pack-tanstack.mjs` run:

```text
node scripts/smoke-installed-package.mjs <absolute-tarball-path>
```

Only print the final JSON result after the installed smoke passes. On failure, retain the temp paths in the error output for inspection and exit non-zero.

- [ ] **Step 4: Run the complete publication proof**

Run:

```bash
PI_WEB_TANSTACK_SMOKE_PORT=30147 npm run pack:tanstack
test ! -e .output
```

Expected sequence, all exit 0:

```text
publication build -> publication verifier -> external stage -> npm pack
-> fresh npm project -> install exact tarball -> real pi-web bin
-> root/API/PWA/security smoke -> dependency version verification
```

- [ ] **Step 5: Record the package evidence**

Append to `docs/spikes/2026-08-12-tanstack-migration-results.md`:

```text
tested commit;
tarball filename/version;
compressed and unpacked sizes;
file count;
fresh install success;
CLI startup/status results;
five server-sensitive dependency versions plus the separately resolved `lucide-react` version;
confirmation that .output/server/node_modules did not duplicate Pi packages;
confirmation that no repository .output was created.
```

Do not record temporary home paths or sensitive session data.

- [ ] **Step 6: Commit installed-package verification**

Run:

```bash
git add scripts/smoke-installed-package.mjs scripts/pack-tanstack.mjs \
  lib/tanstack-package.test.mjs \
  docs/spikes/2026-08-12-tanstack-migration-results.md
git diff --cached --check
git commit -m "test: verify the installed TanStack package"
```

Expected: one commit with the repeatable end-to-end package proof and evidence.

### Task 15: Retire Next And Switch Default Scripts Only After Tarball Proof

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `tsconfig.json`
- Modify: `eslint.config.mjs`
- Modify: `lib/tanstack-spike-config.test.mjs`
- Modify: `lib/tanstack-package.test.mjs`
- Create: `scripts/release-tanstack.mjs`
- Delete: `app/layout.tsx`
- Delete: `app/page.tsx`
- Delete: `app/manifest.ts`
- Delete: `instrumentation.ts`
- Delete: `proxy.ts`
- Delete: `next.config.ts`
- Delete: `lib/next-config.test.mjs`
- Delete: `lib/next-config-esm.test.mjs`

- [ ] **Step 1: Change config tests to describe the final framework**

Update `lib/tanstack-spike-config.test.mjs` assertions from parallel-spike behavior to final behavior:

```js
assert.match(pkg.scripts.dev, /vite dev --configLoader runner --config vite\.tanstack\.config\.ts/);
assert.match(pkg.scripts.build, /pack-tanstack|build:tanstack:publication/);
assert.doesNotMatch(JSON.stringify(pkg.scripts), /next (dev|build|start)/);
assert.equal(pkg.dependencies.next, undefined);
assert.ok(pkg.files.includes(".output"));
assert.ok(!pkg.files.includes(".next"));
```

Add checks that `tsconfig.json` contains neither the Next plugin nor `.next` includes, and `eslint.config.mjs` contains no `eslint-config-next` import.

- [ ] **Step 2: Run focused tests and confirm the old defaults fail**

Run:

```bash
node --experimental-strip-types --test lib/tanstack-spike-config.test.mjs
```

Expected: failures for Next scripts/dependencies/files/config.

- [ ] **Step 3: Switch scripts and root package file policy**

Set root scripts to the verified TanStack commands:

```json
{
  "dev": "vite dev --configLoader runner --config vite.tanstack.config.ts --host 127.0.0.1 --port 30141",
  "dev:lan": "vite dev --configLoader runner --config vite.tanstack.config.ts --host 0.0.0.0 --port 30141",
  "build": "node scripts/pack-tanstack.mjs",
  "start": "node bin/pi-web.js --no-open -H 127.0.0.1 -p 30141",
  "start:lan": "node bin/pi-web.js --no-open -H 0.0.0.0 -p 30141"
}
```

Change root `files` from `.next`/`next.config.ts` to `.output`, preserving `bin` and package metadata/docs/license. Do not retain source `public`; Nitro has already copied it into `.output/public`. Keep the external staging path as the release implementation because root builds still may not write `.output` into the repo. Keep `release` capable of publishing, but require an explicit tarball path produced by the verified pack flow: `node scripts/release-tanstack.mjs /absolute/path/to/reviewed-package.tgz`. That small script must reject a missing/non-absolute/non-`.tgz` path and then spawn `npm publish <exact-path> --access public` with `shell: false`. Add its input-validation tests to `lib/tanstack-package.test.mjs`. Do not call the release script while executing this migration plan.

Do not run `npm publish` or `npm run release`.

- [ ] **Step 4: Remove Next dependencies and framework config**

Run:

```bash
env -u NODE_ENV npm uninstall next eslint-config-next
```

Then remove the eight obsolete files listed for this task with a normal patch. Do not remove `app/api` or `app/globals.css`; they remain intentional internal implementation paths.

In `tsconfig.json`, remove the Next plugin and `.next` include entries. Keep strictness, bundler resolution, aliases, DOM libs, and `noEmit`.

Install direct dev dependencies `@eslint/js`, `typescript-eslint`, and `eslint-plugin-react-hooks` at the versions already present in the lockfile when this plan was written (`9.39.4`, `8.57.1`, and `7.0.1`). Replace the Next presets with flat configs `@eslint/js` recommended, `typescript-eslint` recommended, and `eslint-plugin-react-hooks` flat recommended. Preserve the three explicit disabled React-hook rules and existing generated/output ignores. Do not perform a broader lint-policy rewrite; if version resolution has changed, use the exact compatible versions selected by npm and record them in the evidence document.

- [ ] **Step 5: Prove no Next references remain in runtime/build configuration**

Run:

```bash
! rg -n 'from ["'"']next/|next (dev|build|start)|next/dist|\.next' \
  app components hooks lib src bin scripts package.json tsconfig.json eslint.config.mjs \
  --glob '!docs/**' --glob '!*.test.mjs'
node --experimental-strip-types --test \
  lib/tanstack-spike-config.test.mjs \
  lib/tanstack-package.test.mjs \
  lib/tanstack-cli.test.mjs
node_modules/.bin/tsc --noEmit
npm run lint
```

Expected: source scan finds no Next runtime/build references, focused tests/typecheck/lint pass. Test names containing historical `next` text are allowed only where they assert absence; obsolete Next tests were deleted.

- [ ] **Step 6: Repeat the exact tarball proof after Next removal**

Run:

```bash
PI_WEB_TANSTACK_SMOKE_PORT=30147 npm run pack:tanstack
env -u NODE_ENV -u PI_WEB_PASSWORD npm test
test ! -e .output
```

Expected: fresh package build/install/CLI smoke passes without Next installed; full tests pass; no repository output exists.

- [ ] **Step 7: Commit final framework retirement**

Run:

```bash
git add -A package.json package-lock.json tsconfig.json eslint.config.mjs \
  app/layout.tsx app/page.tsx app/manifest.ts instrumentation.ts proxy.ts \
  next.config.ts lib/next-config.test.mjs lib/next-config-esm.test.mjs \
  lib/tanstack-spike-config.test.mjs lib/tanstack-package.test.mjs \
  scripts/release-tanstack.mjs
git diff --cached --check
git commit -m "build: retire Next.js after TanStack package verification"
```

Expected: one reviewable retirement commit. No API handlers, protected libraries, or unrelated frontend logic belong in it.

### Task 16: Expand Windows CI To The Final Package Gate

**Files:**
- Modify: `.github/workflows/tanstack-spike-windows.yml`
- Modify: `docs/spikes/2026-08-12-tanstack-migration-results.md`

- [ ] **Step 1: Rename and expand the Windows workflow**

Update the workflow display name/job to final migration terminology while keeping `windows-latest`, Node `22.19.0`, `npm ci`, and the branch trigger. In PowerShell:

```powershell
$env:PI_WEB_TANSTACK_OUTPUT_DIR = Join-Path $env:RUNNER_TEMP "pi-web-tanstack-output"
$env:PI_WEB_TANSTACK_OUTPUT_MODE = "standalone"
npm run build:tanstack
node scripts/verify-tanstack-output.mjs --mode standalone $env:PI_WEB_TANSTACK_OUTPUT_DIR
$env:PI_WEB_TANSTACK_SMOKE_PORT = "30147"
node scripts/smoke-tanstack-output.mjs $env:PI_WEB_TANSTACK_OUTPUT_DIR
npm run pack:tanstack
```

Add `npm test`, `npm run lint`, and `node_modules/.bin/tsc --noEmit` before packaging. The package script itself must run the fresh install and `.cmd` launcher smoke on Windows.

- [ ] **Step 2: Validate workflow syntax locally**

Run:

```bash
node -e 'const fs=require("node:fs"); const s=fs.readFileSync(".github/workflows/tanstack-spike-windows.yml","utf8"); for (const x of ["windows-latest","22.19.0","npm ci","pack:tanstack","smoke-installed-package"]) { if (!s.includes(x)) throw new Error(x); }'
git diff --check
```

Expected: exit 0.

- [ ] **Step 3: Commit and push the Windows gate**

Run:

```bash
git add .github/workflows/tanstack-spike-windows.yml
git commit -m "ci: verify the installed TanStack package on Windows"
git push origin migration/tanstack-start
```

Expected: push succeeds and a Windows workflow run starts for the new commit.

- [ ] **Step 4: Wait for and inspect the exact workflow run**

Resolve the run id for the exact pushed commit, then watch it:

```bash
export PI_WEB_GH_RUN_ID="$(gh run list --branch migration/tanstack-start \
  --workflow tanstack-spike-windows.yml --limit 1 --json databaseId \
  --jq '.[0].databaseId')"
test -n "$PI_WEB_GH_RUN_ID"
gh run watch "$PI_WEB_GH_RUN_ID" --exit-status
gh run view "$PI_WEB_GH_RUN_ID" --log-failed
```

Expected: workflow exits success. `--log-failed` prints no failed-step logs. If CI fails, stop Phase 3, fix in a new focused commit, rerun all affected local gates, push, and wait for the replacement run.

- [ ] **Step 5: Record Windows evidence**

Append the exact commit, Actions run URL/id, Node version, standalone result, package/install result, and smoke result to `docs/spikes/2026-08-12-tanstack-migration-results.md`. Commit:

```bash
git add docs/spikes/2026-08-12-tanstack-migration-results.md
git commit -m "docs: record TanStack Windows package evidence"
```

Expected: evidence commit only.

### Task 17: Phase 3 Hard Gate

**Files:**
- Verify: build modes, staged package, CLI, Next retirement, Windows run

- [ ] **Step 1: Run complete local tests**

Run:

```bash
env -u NODE_ENV -u PI_WEB_PASSWORD npm test
npm run lint
node_modules/.bin/tsc --noEmit
git diff --check
```

Expected: all commands pass with no new warnings.

- [ ] **Step 2: Verify standalone output still works**

Run:

```bash
export PI_WEB_TANSTACK_OUTPUT_DIR="$(mktemp -d /tmp/pi-web-tanstack-phase3-standalone.XXXXXX)"
PI_WEB_TANSTACK_OUTPUT_MODE=standalone npm run build:tanstack
node scripts/verify-tanstack-output.mjs --mode standalone "$PI_WEB_TANSTACK_OUTPUT_DIR"
env -u PI_WEB_PASSWORD PI_WEB_TANSTACK_SMOKE_PORT=30147 \
  node scripts/smoke-tanstack-output.mjs "$PI_WEB_TANSTACK_OUTPUT_DIR"
```

Expected: all commands pass.

- [ ] **Step 3: Recreate, install, and launch the final publication tarball**

Run:

```bash
PI_WEB_TANSTACK_SMOKE_PORT=30147 npm run pack:tanstack
test ! -e .output
```

Expected: publication build, file audit, fresh install, real CLI launch, endpoints, security, PWA, and sensitive dependency versions all pass from the exact tarball.

- [ ] **Step 4: Verify Next is absent and protected files remain unchanged**

Run:

```bash
npm ls next eslint-config-next --depth=0 >/tmp/pi-web-next-ls.txt 2>&1; test "$?" -ne 0
! rg -n 'from ["'"']next/|next (dev|build|start)|next/dist|\.next' \
  app components hooks lib src bin scripts package.json tsconfig.json eslint.config.mjs \
  --glob '!docs/**' --glob '!*.test.mjs'
git diff --exit-code 0f6a152 -- \
  lib/rpc-manager.ts \
  lib/agent-event-stream.ts \
  lib/request-security.ts \
  lib/web-auth.ts
test ! -e .output
```

Expected: Next packages/config references are absent, protected files are unchanged, and repository output is absent.

- [ ] **Step 5: Confirm Windows passed and stop at checkpoint**

Run:

```bash
gh run list --branch migration/tanstack-start --limit 5
git status --short --branch
```

Expected: the exact Phase 3 commit has a successful Windows run and the worktree is clean. Do not begin Phase 4 if the run is pending or failed.

# Phase 4: Functional And Cross-Platform Regression

### Task 18: Expand Runtime Smoke Across All 41 Routes Without Destructive Side Effects

**Files:**
- Modify: `scripts/smoke-tanstack-output.mjs`
- Modify: `scripts/smoke-installed-package.mjs`
- Modify: `lib/tanstack-route-inventory.test.mjs`

- [ ] **Step 1: Add route reachability expectations**

Extend the route inventory test so every adapter's URL has a safe smoke probe specification. Use GET for read endpoints. For write-only endpoints, send an intentionally invalid body or missing required field and assert the documented 400/401/404 response rather than mutating user state. Never invoke successful delete, install, update, login, logout, API-key write, session command, worktree mutation, or file write during broad smoke.

The safe probe matrix must at least cover:

```text
sessions/list and an existing session read/state/context/export;
agent/running and both SSE endpoint headers with immediate abort;
home, cwd browse with home, cwd browse POST invalid body, cwd validate invalid input, default-cwd method rejection only;
file-index validation and files read for a bounded fixture;
git status/diff against a temporary git fixture;
auth provider listing and API-key status without returning secrets;
models and models-config reads/catalog; invalid discover/test payloads;
plugins read; project-trust read with a temporary path; projects GET and invalid PUT without modifying the real registry;
skills read/search/check invalid input; worktrees read on a temporary git fixture;
app-update response shape.
```

Create all fixtures under a new temporary directory, authorize them through existing public API flows where required, and clean them in `finally`. Do not inspect or modify unrelated user projects.

- [ ] **Step 2: Implement the safe route matrix in standalone smoke**

Add a `probe(method, path, expectedStatuses, init)` helper that records only method/path/status. For dynamic session endpoints, obtain an existing id from `/api/sessions` but redact it from output; if no session exists, mark only those read probes as environment-skipped and keep the separate real SSE gate required. For all other paths, require one of the explicit expected statuses.

Require that the probe specification accounts for exactly all 41 adapter URLs from the inventory test. It may combine methods for a URL but cannot omit a route. Include safe invalid-body probes for `PUT /api/projects` and `POST /api/cwd/browse`; do not overwrite the user's project registry or create a folder outside a temporary fixture.

- [ ] **Step 3: Reuse the same safe probe module for installed-package smoke**

Create `scripts/tanstack-route-smoke.mjs` as the shared route-matrix module so standalone and installed-package smoke use the identical 41-route specification. It must accept an origin and fixture context and must not own process startup. Keep this as the sole new abstraction and do not move unrelated smoke logic.

- [ ] **Step 4: Run the expanded smoke against both artifact forms**

Run:

```bash
export PI_WEB_TANSTACK_OUTPUT_DIR="$(mktemp -d /tmp/pi-web-tanstack-allroutes.XXXXXX)"
PI_WEB_TANSTACK_OUTPUT_MODE=standalone npm run build:tanstack
env -u PI_WEB_PASSWORD PI_WEB_TANSTACK_SMOKE_PORT=30147 \
  node scripts/smoke-tanstack-output.mjs "$PI_WEB_TANSTACK_OUTPUT_DIR"
PI_WEB_TANSTACK_SMOKE_PORT=30147 npm run pack:tanstack
```

Expected: both standalone and freshly installed publication package account for all 41 routes; no destructive mutation is performed.

- [ ] **Step 5: Commit expanded route smoke**

Run:

```bash
git add scripts/smoke-tanstack-output.mjs scripts/smoke-installed-package.mjs \
  scripts/tanstack-route-smoke.mjs lib/tanstack-route-inventory.test.mjs
git diff --cached --check
git commit -m "test: smoke all TanStack API routes"
```

If the shared module was unnecessary, omit its path from `git add`. Expected: one test-only commit.

### Task 19: Execute The Functional Regression Matrix

**Files:**
- Modify: `docs/spikes/2026-08-12-tanstack-migration-results.md`
- Verify: installed publication package in a temporary project

- [ ] **Step 1: Start the exact installed tarball with isolated Pi and browser state**

Run `npm run pack:tanstack`, retain its emitted fresh-install directory, and create isolated state:

```bash
export PI_WEB_REGRESSION_ROOT="$(mktemp -d /tmp/pi-web-regression.XXXXXX)"
export PI_CODING_AGENT_DIR="$PI_WEB_REGRESSION_ROOT/agent"
mkdir -p "$PI_CODING_AGENT_DIR"
```

Start that installed `pi-web` on `127.0.0.1:30147` with `--no-open` in the same environment so the child inherits `PI_CODING_AGENT_DIR`. Use a temporary browser profile rooted under `$PI_WEB_REGRESSION_ROOT/browser` and a temporary non-sensitive git repository under `$PI_WEB_REGRESSION_ROOT/project` for mutation workflows. Do not use the migration worktree or the user's normal agent directory as a file-delete, registry-write, trust-write, model-write, skill-write, or worktree-delete target. Remove only `$PI_WEB_REGRESSION_ROOT` in `finally` after confirming the variable is non-empty and begins with `/tmp/pi-web-regression.`.

Expected: installed CLI reports ready, root loads the real AppShell, and all registry/config writes resolve beneath `$PI_CODING_AGENT_DIR`.

- [ ] **Step 2: Verify session and agent workflows**

Check each item and record pass/fail only:

```text
Session list loads and force refresh works.
Existing session opens; context/branch navigation loads the selected leaf.
Session rename persists; export downloads valid HTML.
A temporary session can be deleted without affecting other sessions.
New temporary session starts in the chosen cwd.
Sending a harmless prompt returns streamed events and a completed response.
Per-session SSE reconnects after page refresh during/after a run.
Running-session SSE updates the sidebar state.
The project row shows a spinner while any contained session is running, clears it on completion, and marks only completed background sessions unread.
Bash-output endpoint returns its documented state for the test session.
```

Do not record prompt or model output content.

- [ ] **Step 3: Verify file, git, trust, and worktree workflows**

Using only temporary fixtures:

```text
Browse and validate cwd; default cwd response is valid.
Create a child folder through the directory picker inside the temporary fixture and enter it.
File tree/index loads.
Text file preview/download returns exact bytes.
Multipart upload succeeds; conflict=error and size limits behave as tested.
File watch stream connects and aborts cleanly.
Git status and diff reflect a known temporary edit.
Project trust GET/POST round-trip works in the fixture.
Create/list/remove a clean temporary worktree.
Dirty worktree removal returns 409 until explicitly forced in the test fixture.
Project registry GET/PUT round-trips pin, order, rename, archive, restore, and remove under `$PI_CODING_AGENT_DIR`; the user's normal registry is never read or written.
```

- [ ] **Step 4: Verify auth, model, plugin, skill, and update workflows**

Use test credentials/providers only when available; never print/store secrets in evidence:

```text
OAuth provider list and API-key provider list load without duplicates.
API-key status never returns raw key material.
For a designated test provider, API-key store/remove works; skip with reason if no test credential is authorized.
OAuth/device-code stream connects; complete login/logout only with an authorized test account, otherwise verify the non-secret pre-auth flow and record the limited scope.
Model list and models-config GET load; PUT round-trip uses a backed-up temporary config and restores it in finally.
Catalog, discovery, and model test return documented shapes.
Plugin list loads; install/remove is exercised only with an approved disposable package, otherwise record read-only verification.
Skill list/search/check load; install/update/toggle is exercised only in a disposable project fixture and cleaned afterward.
App-update endpoint returns its documented current/latest/updateAvailable shape.
```

Any skipped credentialed/external mutation must be explicitly recorded as residual manual risk; do not call the entire phase complete if a required acceptance behavior remains unverified.

- [ ] **Step 5: Verify security matrix against the installed package**

Run equivalent HTTP requests for:

```text
trusted loopback root and API -> allowed;
untrusted root Host -> text 403;
untrusted API Host/Origin -> JSON 403;
PI_WEB_PASSWORD enabled, missing/wrong auth -> 401 + no-store + WWW-Authenticate;
PI_WEB_PASSWORD enabled, correct Basic auth -> root and API allowed;
cross-site/API request cases from lib/request-security.test.mjs remain rejected;
```

Expected: exact statuses, bodies, and headers match `proxy.ts`'s former contract.

- [ ] **Step 6: Verify frontend, PWA, and offline behavior**

In desktop and narrow mobile viewports:

```text
/?session=<existing> restores the session.
/?cwd=<encoded-path> starts in that cwd and wins over session when both exist.
Back/forward history is not polluted by session replacements.
The consolidated settings page exposes General, Project, Models, Skills, and Plugins; theme, locale, sound, project trust, model, skill, and plugin controls work.
CodexSidebar project actions, drag/keyboard ordering, archived-project view, and running-project activity remain usable at desktop and narrow mobile widths.
Version display shows current web and Pi versions.
Manifest is installable and icons load.
Service worker registers from /sw.js with scope /.
After one online load, offline navigation serves /offline.html.
API and SSE requests are not served from service-worker cache.
No hydration, route, service-worker, or uncaught errors appear in the console.
```

- [ ] **Step 7: Record functional evidence**

Append a table to `docs/spikes/2026-08-12-tanstack-migration-results.md` with each matrix group, artifact tested, platform, result, and sanitized note. Include any explicit skip as `NOT VERIFIED` rather than `PASS`.

Commit only after all required rows pass:

```bash
git add docs/spikes/2026-08-12-tanstack-migration-results.md
git commit -m "docs: record TanStack functional regression"
```

### Task 20: Update Development And Release Documentation

**Files:**
- Modify: `AGENTS.md`
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `docs/release.md`

- [ ] **Step 1: Find obsolete framework/build instructions**

Run:

```bash
rg -n 'Next\.js|Next.js|next build|\.next|next start|Next server|App Router' \
  AGENTS.md README.md README.zh-CN.md docs/release.md
```

Expected: current Next architecture and build guidance is listed.

- [ ] **Step 2: Update only verified commands and architecture names**

Document:

```text
npm run dev starts TanStack/Vite on 30141;
normal development must not run production packaging;
all build output is external and .output must not appear in the worktree;
npm run pack:tanstack builds, stages, packs, installs, and smokes a temporary tarball;
release requires reviewing the emitted exact tarball before a separate npm publish action;
the server is TanStack Start/Nitro and app/api contains internal framework-neutral handlers;
src/routes/api contains transport adapters;
src/start.ts owns global request security;
src/server.ts owns dispatcher startup ordering.
```

Keep user-facing install and CLI instructions unchanged because the package name and CLI syntax are unchanged. Do not claim a package has been released.

- [ ] **Step 3: Verify documentation and commands agree**

Run:

```bash
! rg -n 'next build|\.next|next start|Next server|App Router' \
  AGENTS.md README.md README.zh-CN.md docs/release.md
node -e 'const p=require("./package.json"); for (const x of ["dev","build","pack:tanstack","test","lint"]) if (!p.scripts[x]) throw new Error(x)'
git diff --check
```

Expected: obsolete operational text is gone, referenced scripts exist, and Markdown has no whitespace errors.

- [ ] **Step 4: Commit documentation**

Run:

```bash
git add AGENTS.md README.md README.zh-CN.md docs/release.md
git commit -m "docs: document TanStack development and packaging"
```

Expected: documentation-only commit.

### Task 21: Final Local, Installed-Package, And Windows Verification

**Files:**
- Modify: `docs/spikes/2026-08-12-tanstack-migration-results.md`
- Verify: entire branch

- [ ] **Step 1: Run the complete repository quality suite from clean dependencies**

Run:

```bash
env -u NODE_ENV npm ci
env -u NODE_ENV -u PI_WEB_PASSWORD npm test
npm run lint
node_modules/.bin/tsc --noEmit
git diff --check
```

Expected: dependency install and all quality gates pass. Record the exact test count; do not assume it remains 554 after new tests are added.

- [ ] **Step 2: Run final standalone output verification**

Run:

```bash
export PI_WEB_TANSTACK_OUTPUT_DIR="$(mktemp -d /tmp/pi-web-tanstack-final-standalone.XXXXXX)"
PI_WEB_TANSTACK_OUTPUT_MODE=standalone npm run build:tanstack
node scripts/verify-tanstack-output.mjs --mode standalone "$PI_WEB_TANSTACK_OUTPUT_DIR"
env -u PI_WEB_PASSWORD PI_WEB_TANSTACK_SMOKE_PORT=30147 \
  node scripts/smoke-tanstack-output.mjs "$PI_WEB_TANSTACK_OUTPUT_DIR"
```

Expected: external build, runtime-package verifier, all-route smoke, security, AppShell, and PWA checks pass.

- [ ] **Step 3: Run final publication tarball verification**

Run:

```bash
PI_WEB_TANSTACK_SMOKE_PORT=30147 npm run pack:tanstack
test ! -e .output
```

Expected: the final exact tarball builds, audits, installs into a new temporary project, launches through the installed executable, passes all endpoint/PWA/security/dependency checks, and leaves the repo clean of output.

- [ ] **Step 4: Repeat the 310-second SSE gate on final standalone output**

Run:

```bash
env -u PI_WEB_PASSWORD PI_WEB_TANSTACK_SMOKE_PORT=30147 \
  node scripts/sse-tanstack-output.mjs "$PI_WEB_TANSTACK_OUTPUT_DIR"
```

Expected: duration at least 310 seconds, connected frame seen, at least 10 heartbeats, exit 0.

- [ ] **Step 5: Push final verification candidate and require Windows success**

Run:

```bash
git status --short --branch
git push origin migration/tanstack-start
export PI_WEB_GH_RUN_ID="$(gh run list --branch migration/tanstack-start \
  --workflow tanstack-spike-windows.yml --limit 1 --json databaseId \
  --jq '.[0].databaseId')"
test -n "$PI_WEB_GH_RUN_ID"
gh run watch "$PI_WEB_GH_RUN_ID" --exit-status
```

Expected: worktree was clean before push and the workflow for the exact pushed HEAD succeeds.

- [ ] **Step 6: Verify protected files, no Next, no output, and no sensitive artifacts**

Run:

```bash
git diff --exit-code 0f6a152 -- \
  lib/rpc-manager.ts \
  lib/agent-event-stream.ts \
  lib/request-security.ts \
  lib/web-auth.ts
! rg -n 'from ["'"']next/|next (dev|build|start)|next/dist|\.next' \
  app components hooks lib src bin scripts package.json tsconfig.json eslint.config.mjs \
  --glob '!docs/**' --glob '!*.test.mjs'
test ! -e .output
! git ls-files | rg '(^|/)(\.env($|\.)|credentials?|secrets?|auth\.json$)'
```

Expected: all commands exit 0; protected files unchanged; no Next runtime/build references; no repository output; no newly tracked secret-bearing files.

- [ ] **Step 7: Finalize the evidence ledger**

Update `docs/spikes/2026-08-12-tanstack-migration-results.md` with:

```text
exact final commit candidate;
Node/npm and dependency versions;
test/lint/typecheck results;
standalone verifier file count/size and runtime versions;
installed tarball filename, size, file count, endpoint matrix, and runtime versions;
final 310-second SSE duration/heartbeat count;
Windows run URL and result;
functional matrix result;
protected-file and no-output checks;
explicit statement that no merge, tag, publish, or release occurred.
```

Commit:

```bash
git add docs/spikes/2026-08-12-tanstack-migration-results.md
git commit -m "docs: conclude TanStack Start migration verification"
```

- [ ] **Step 8: Run verification once more for the evidence-only commit where relevant**

Run:

```bash
git diff --check HEAD^ HEAD
env -u NODE_ENV -u PI_WEB_PASSWORD npm test
npm run lint
node_modules/.bin/tsc --noEmit
git status --short --branch
```

Expected: all commands pass and worktree is clean.

### Task 22: Handoff The Completed Branch Without Integration

**Files:**
- Verify: git history and final evidence
- Do not modify or create release artifacts in the repository

- [ ] **Step 1: Produce the final review summary**

Run:

```bash
git rev-parse HEAD
git log --oneline 0f6a152..HEAD
git diff --stat 0f6a152..HEAD
git status --short --branch
```

Expected: coherent focused commits, clean worktree, and an exact final commit hash.

- [ ] **Step 2: Report review artifacts**

Provide the reviewer:

```text
branch name and final commit;
this implementation plan and handoff document;
final evidence document;
Windows Actions run URL;
exact test/lint/typecheck results;
tarball filename and measured sizes from the temporary staging run;
any residual NOT VERIFIED row, which blocks completion until resolved;
confirmation that no merge, tag, npm publish, GitHub Release, or worktree deletion occurred.
```

- [ ] **Step 3: Stop**

Do not merge into `main`, rebase onto new unreviewed work, create a PR unless the user asks, tag a release, run `npm publish`, create a GitHub Release, or delete the worktree. Integration is a separate user decision after review.

## Final Acceptance Checklist

- [ ] All 41 internal handlers use standard Web APIs and all 41 TanStack adapters exist.
- [ ] API paths, methods, bodies, status codes, headers, SSE, upload, and download behavior are unchanged.
- [ ] Global request security covers root SSR and every server route with the exact legacy response matrix.
- [ ] Explicit CSRF protection remains for possible server functions.
- [ ] Dispatcher initialization runs before the first request.
- [ ] Per-session SSE survives at least 310 seconds through middleware with at least 10 heartbeats.
- [ ] AppShell, `?session=`, `?cwd=`, replacement navigation, and responsive behavior pass.
- [ ] CodexSidebar project persistence, consolidated SettingsPage, folder creation, cache-hit statistics, extension-widget title/actions, and live project activity are preserved.
- [ ] Metadata, theme bootstrap, local Noto Sans Mono, versions, manifest, service worker, cache headers, and offline page pass.
- [ ] Standalone external output resolves complete Pi packages on macOS and Windows.
- [ ] `lucide-react` remains a production dependency and resolves in the freshly installed publication package.
- [ ] Publication output avoids duplicated Pi package trees.
- [ ] The exact staged tarball installs fresh and its real `pi-web` executable passes smoke.
- [ ] CLI defaults/options, network warnings, browser readiness, signals, and exit codes are preserved.
- [ ] Next dependencies, configs, scripts, imports, and artifacts are absent only after installed-tarball proof.
- [ ] Full tests, lint, typecheck, build verifier, route smoke, installed-package smoke, and Windows CI pass.
- [ ] Protected core files are unchanged from `0f6a152`, preserving the integrated extension-command/widget-title behavior.
- [ ] No `.output`, credentials, unrelated edits, or sensitive evidence is present in the repository.
- [ ] Documentation reflects verified TanStack development and packaging commands.
- [ ] No automatic merge, tag, npm publish, GitHub Release, or worktree deletion occurred.
