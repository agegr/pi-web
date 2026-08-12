# TanStack Start Migration Spike Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove that pi-web's JSON, SSE, and multipart workloads build and run on TanStack Start v1 with Nitro on macOS and Windows without disrupting the working Next.js application.

**Architecture:** Keep Next.js operational while adding a root-level TanStack Start application with separate commands and an external build directory. Convert the three representative Next handlers to standard Web `Request`/`Response` APIs, then make TanStack server routes delegate to those same handlers through thin parameter adapters. Pin the toolchain, externalize the five process-sensitive packages, configure Undici before the Start handler receives any request, and stop after the spike evidence is recorded.

**Tech Stack:** Node.js 22.19+, React 19, Next.js 16.2.12 (retained), TanStack Start 1.168.42, TanStack Router 1.170.25, Vite 8.0.14, Nitro 3.0.260311-beta, Node test runner, GitHub Actions `windows-latest`.

---

## Guardrails

- Work only in `/Users/kale/pi-web-worktrees/migration-tanstack-start` on branch `migration/tanstack-start`.
- Keep the original Next `dev`, `build`, `start`, release scripts, dependencies, routes, and `.next` publication entries operational.
- Never run `next build` during this spike.
- Put every TanStack production build in a fresh absolute directory outside the worktree through `PI_WEB_TANSTACK_OUTPUT_DIR`.
- Do not modify `lib/rpc-manager.ts`, `lib/agent-event-stream.ts`, `lib/request-security.ts`, or `lib/web-auth.ts`.
- Do not begin migration of the other 37 API routes, AppShell, PWA, proxy middleware, or `bin/pi-web.js`.
- Stop at the first hard-gate failure and record the command and logs. Do not weaken externalization, SSE duration, multipart parity, or Windows runtime criteria.

## File Map

**Create:**

- `vite.tanstack.config.ts` - parallel Vite, TanStack Start, Nitro, external-output, and dependency-externalization configuration.
- `src/router.tsx` - minimal TanStack Router factory.
- `src/server.ts` - server entry that configures the HTTP dispatcher before delegating to Start.
- `src/routes/__root.tsx` - minimal document shell.
- `src/routes/index.tsx` - root health surface.
- `src/routes/api/sessions.ts` - TanStack adapter for the existing sessions handler.
- `src/routes/api/agent/$id/events.ts` - TanStack adapter for the existing SSE handler.
- `src/routes/api/files/$.ts` - TanStack splat adapter for the existing upload handler.
- `src/routeTree.gen.ts` - generated route tree; commit it but never edit it manually.
- `scripts/start-tanstack-output.mjs` - cross-platform launcher for an explicitly selected external build.
- `scripts/verify-tanstack-output.mjs` - validates output layout and traced runtime packages.
- `scripts/smoke-tanstack-output.mjs` - starts the generated server and probes root and sessions endpoints.
- `.github/workflows/tanstack-spike-windows.yml` - Windows build/start/runtime gate.
- `docs/spikes/2026-08-12-tanstack-start-spike-results.md` - exact macOS and Windows evidence and final pass/fail conclusion.
- `lib/tanstack-spike-config.test.mjs` - dual-framework/package/config guard tests.
- `lib/tanstack-server-startup.test.mjs` - dispatcher ordering contract.
- `lib/tanstack-sessions-route.test.mjs` - sessions Web API and adapter parity.
- `lib/tanstack-agent-events-route.test.mjs` - SSE adapter, headers, streaming, and abort cleanup.
- `app/api/files/upload-route.test.mjs` - multipart handler and TanStack splat adapter parity.
- `lib/tanstack-output.test.mjs` - output utility and Windows workflow contract.

**Modify:**

- `package.json` - add pinned TanStack/Vite/Nitro dependencies and separate spike commands only.
- `package-lock.json` - lock the exact spike dependency graph.
- `app/api/sessions/route.ts` - replace `NextResponse.json` with `Response.json`.
- `app/api/files/[...path]/route.ts` - replace Next request/response helpers with standard Web APIs while preserving all GET and POST behavior.

**Must remain byte-for-byte unchanged:**

- `lib/rpc-manager.ts`
- `lib/agent-event-stream.ts`
- `lib/request-security.ts`
- `lib/web-auth.ts`
- `bin/pi-web.js`

---

### Task 1: Pin The Parallel Toolchain Without Replacing Next

**Files:**

- Create: `lib/tanstack-spike-config.test.mjs`
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Write the failing dual-framework package contract**

Create `lib/tanstack-spike-config.test.mjs`:

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

test("pins the TanStack spike toolchain without replacing Next", () => {
  assert.equal(pkg.dependencies.next, "16.2.12");
  assert.equal(pkg.dependencies["@tanstack/react-start"], "1.168.42");
  assert.equal(pkg.dependencies["@tanstack/react-router"], "1.170.25");
  assert.equal(pkg.devDependencies.vite, "8.0.14");
  assert.equal(pkg.devDependencies["@vitejs/plugin-react"], "6.0.5");
  assert.equal(pkg.devDependencies.nitro, "3.0.260311-beta");
});

test("keeps Next commands and publication files while adding spike commands", () => {
  assert.equal(pkg.scripts.dev, "next dev -H 127.0.0.1 -p 30141");
  assert.equal(pkg.scripts.build, "next build --webpack");
  assert.equal(pkg.scripts.start, "next start -H 127.0.0.1 -p 30141");
  assert.equal(pkg.scripts["dev:tanstack"], "vite dev --config vite.tanstack.config.ts --host 127.0.0.1 --port 30142");
  assert.equal(pkg.scripts["build:tanstack"], "vite build --config vite.tanstack.config.ts");
  assert.equal(pkg.scripts["start:tanstack"], "node scripts/start-tanstack-output.mjs");
  assert.ok(pkg.files.includes(".next"));
  assert.ok(!pkg.files.includes(".output"));
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
node --test lib/tanstack-spike-config.test.mjs
```

Expected: FAIL because the TanStack dependencies and spike scripts are absent.

- [ ] **Step 3: Install the exact runtime packages**

Run:

```bash
npm install --save-exact @tanstack/react-start@1.168.42 @tanstack/react-router@1.170.25
```

Expected: `package.json` and `package-lock.json` add the two exact dependency versions without changing `next`, `react`, or `react-dom` versions.

- [ ] **Step 4: Install the exact build packages**

Run:

```bash
npm install --save-dev --save-exact @vitejs/plugin-react@6.0.5 nitro@3.0.260311-beta vite@8.0.14
```

Expected: the lockfile resolves the exact Vite/Nitro versions and npm completes without a fatal peer-dependency error. Existing React 19 peer warnings may remain warnings only.

- [ ] **Step 5: Add only the three parallel scripts**

Add these entries to `package.json#scripts` without changing existing entries:

```json
"dev:tanstack": "vite dev --config vite.tanstack.config.ts --host 127.0.0.1 --port 30142",
"build:tanstack": "vite build --config vite.tanstack.config.ts",
"start:tanstack": "node scripts/start-tanstack-output.mjs"
```

Do not add `"type": "module"`; `bin/pi-web.js` and its helpers are intentionally CommonJS.

- [ ] **Step 6: Run the focused and full baseline tests**

Run:

```bash
node --test lib/tanstack-spike-config.test.mjs
npm test
```

Expected: the focused test passes and the existing suite remains at 539 passing tests plus the 2 new tests, with zero failures.

- [ ] **Step 7: Commit the pinned parallel toolchain**

```bash
git add package.json package-lock.json lib/tanstack-spike-config.test.mjs
git commit -m "build: pin TanStack Start spike toolchain"
```

---

### Task 2: Add The Minimal Start Skeleton And External Build Contract

**Files:**

- Modify: `lib/tanstack-spike-config.test.mjs`
- Create: `vite.tanstack.config.ts`
- Create: `src/router.tsx`
- Create: `src/routes/__root.tsx`
- Create: `src/routes/index.tsx`
- Generate: `src/routeTree.gen.ts`

- [ ] **Step 1: Extend the failing config test**

Append to `lib/tanstack-spike-config.test.mjs`:

```js
const viteConfig = await readFile(new URL("../vite.tanstack.config.ts", import.meta.url), "utf8");

test("requires an external production output and externalizes process-sensitive packages", () => {
  assert.match(viteConfig, /PI_WEB_TANSTACK_OUTPUT_DIR/);
  assert.match(viteConfig, /isAbsolute/);
  assert.match(viteConfig, /ssr:\s*\{[\s\S]*external: EXTERNAL_PACKAGES/);
  assert.match(viteConfig, /traceDeps: EXTERNAL_PACKAGES/);
  assert.match(viteConfig, /output:\s*\{\s*dir: outputDir/);
  assert.doesNotMatch(viteConfig, /\.output/);
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
node --test lib/tanstack-spike-config.test.mjs
```

Expected: FAIL with `ENOENT` for `vite.tanstack.config.ts`.

- [ ] **Step 3: Create the Vite/TanStack/Nitro configuration**

Create `vite.tanstack.config.ts`:

```ts
import { isAbsolute, join, relative, sep } from "node:path";
import { tmpdir } from "node:os";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

const EXTERNAL_PACKAGES = [
  "undici",
  "@earendil-works/pi-coding-agent",
  "@earendil-works/pi-agent-core",
  "@earendil-works/pi-ai",
  "@earendil-works/pi-tui",
];

export default defineConfig(({ command }) => {
  const configuredOutputDir = process.env.PI_WEB_TANSTACK_OUTPUT_DIR?.trim();
  const relativeOutputDir = configuredOutputDir
    ? relative(process.cwd(), configuredOutputDir)
    : "";
  const outputIsOutsideRepository = relativeOutputDir === ".."
    || relativeOutputDir.startsWith(`..${sep}`);
  if (
    command === "build"
    && (!configuredOutputDir || !isAbsolute(configuredOutputDir) || !outputIsOutsideRepository)
  ) {
    throw new Error("PI_WEB_TANSTACK_OUTPUT_DIR must be an absolute path outside the repository");
  }
  const outputDir = configuredOutputDir || join(tmpdir(), "pi-web-tanstack-dev");

  return {
    resolve: { tsconfigPaths: true },
    ssr: { external: EXTERNAL_PACKAGES },
    plugins: [
      tanstackStart({ srcDirectory: "src" }),
      nitro({
        preset: "node-server",
        output: { dir: outputDir },
        traceDeps: EXTERNAL_PACKAGES,
      }),
      viteReact(),
    ],
  };
});
```

- [ ] **Step 4: Add the router factory**

Create `src/router.tsx`:

```tsx
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
  return createRouter({ routeTree });
}
```

- [ ] **Step 5: Add the minimal document shell**

Create `src/routes/__root.tsx`:

```tsx
import type { ReactNode } from "react";
import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
} from "@tanstack/react-router";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Pi Web" },
    ],
  }),
  component: RootComponent,
});

function RootComponent() {
  return (
    <RootDocument>
      <Outlet />
    </RootDocument>
  );
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
```

- [ ] **Step 6: Add the root health surface**

Create `src/routes/index.tsx`:

```tsx
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return <main><h1>Pi Web</h1></main>;
}
```

- [ ] **Step 7: Verify an in-repository production build is rejected**

Run:

```bash
npm run build:tanstack
```

Expected: FAIL before output is written, with `PI_WEB_TANSTACK_OUTPUT_DIR must be an absolute path outside the repository`.

- [ ] **Step 8: Build to a fresh external directory and generate the route tree**

Run:

```bash
SPIKE_OUTPUT_DIR=$(mktemp -d /tmp/pi-web-tanstack-skeleton.XXXXXX)
PI_WEB_TANSTACK_OUTPUT_DIR="$SPIKE_OUTPUT_DIR" npm run build:tanstack
test -f "$SPIKE_OUTPUT_DIR/server/index.mjs"
test -f src/routeTree.gen.ts
test ! -e .output
```

Expected: build succeeds, the external server entry and generated route tree exist, and no `.output` appears in the worktree.

- [ ] **Step 9: Run tests, lint, and type checking**

Run:

```bash
node --test lib/tanstack-spike-config.test.mjs
npm run lint
node_modules/.bin/tsc --noEmit
```

Expected: all commands pass. If generated `src/routeTree.gen.ts` is not self-excluded from lint, use its generated header rather than adding a repository-wide lint exception.

- [ ] **Step 10: Commit the minimal skeleton**

```bash
git add vite.tanstack.config.ts src/router.tsx src/routes/__root.tsx src/routes/index.tsx src/routeTree.gen.ts lib/tanstack-spike-config.test.mjs
git commit -m "feat: add parallel TanStack Start skeleton"
```

---

### Task 3: Configure The HTTP Dispatcher Before Request Handling

**Files:**

- Create: `lib/tanstack-server-startup.test.mjs`
- Create: `src/server.ts`

- [ ] **Step 1: Write the failing startup-order contract**

Create `lib/tanstack-server-startup.test.mjs`:

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../src/server.ts", import.meta.url), "utf8");

test("configures the HTTP dispatcher before exposing the Start fetch handler", () => {
  const configureCall = source.indexOf("configureHttpDispatcher();");
  const entryCreation = source.indexOf("createServerEntry({");
  const handlerCall = source.indexOf("handler.fetch(request)");
  assert.ok(configureCall >= 0);
  assert.ok(entryCreation > configureCall);
  assert.ok(handlerCall > configureCall);
  assert.doesNotMatch(source, /fetch\(request\)[\s\S]*configureHttpDispatcher/);
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
node --test lib/tanstack-server-startup.test.mjs
```

Expected: FAIL with `ENOENT` for `src/server.ts`.

- [ ] **Step 3: Create the server entry**

Create `src/server.ts`:

```ts
import handler, { createServerEntry } from "@tanstack/react-start/server-entry";
import { configureHttpDispatcher } from "@/lib/http-dispatcher";

configureHttpDispatcher();

export default createServerEntry({
  fetch(request) {
    return handler.fetch(request);
  },
});
```

Do not move initialization into `fetch()`. Module evaluation must configure Undici once before Nitro can deliver the first request.

- [ ] **Step 4: Run focused and dispatcher behavior tests**

Run:

```bash
node --test lib/tanstack-server-startup.test.mjs lib/http-dispatcher.test.mjs
```

Expected: both tests pass, including proxy and idempotency behavior.

- [ ] **Step 5: Rebuild externally**

Run:

```bash
SPIKE_OUTPUT_DIR=$(mktemp -d /tmp/pi-web-tanstack-startup.XXXXXX)
PI_WEB_TANSTACK_OUTPUT_DIR="$SPIKE_OUTPUT_DIR" npm run build:tanstack
test -f "$SPIKE_OUTPUT_DIR/server/index.mjs"
```

Expected: build succeeds with the custom server entry.

- [ ] **Step 6: Commit startup ordering**

```bash
git add src/server.ts lib/tanstack-server-startup.test.mjs
git commit -m "feat: configure dispatcher in Start server entry"
```

---

### Task 4: Expose The Sessions JSON Handler Through Both Frameworks

**Files:**

- Create: `lib/tanstack-sessions-route.test.mjs`
- Modify: `app/api/sessions/route.ts`
- Create: `src/routes/api/sessions.ts`
- Regenerate: `src/routeTree.gen.ts`

- [ ] **Step 1: Write the failing standard-Web and adapter test**

Create `lib/tanstack-sessions-route.test.mjs`:

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const nextSource = await readFile(new URL("../app/api/sessions/route.ts", import.meta.url), "utf8");
const adapterSource = await readFile(new URL("../src/routes/api/sessions.ts", import.meta.url), "utf8");
const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() }, moduleCache: false });

test("sessions handler uses only standard Web response APIs", () => {
  assert.doesNotMatch(nextSource, /next\/server|NextResponse/);
  assert.match(nextSource, /Response\.json/);
});

test("TanStack sessions route delegates to the existing handler", () => {
  assert.match(adapterSource, /GET: \(\{ request \}\) => getSessions\(request\)/);
});

test("sessions handler preserves JSON shape and cache headers", async () => {
  const { GET } = await jiti.import("../app/api/sessions/route.ts");
  const response = await GET(new Request("http://localhost/api/sessions?force=1"));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.ok(Array.isArray(body.sessions));
  assert.ok(Array.isArray(body.runningSessionIds));
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
node --test lib/tanstack-sessions-route.test.mjs
```

Expected: FAIL because the adapter is missing and the existing route imports `NextResponse`.

- [ ] **Step 3: Convert only the sessions response helper**

In `app/api/sessions/route.ts`:

```ts
// Remove this import:
// import { NextResponse } from "next/server";

// Replace both calls without changing bodies, status, or headers:
return Response.json(
  { sessions, runningSessionIds: getRunningRpcSessionIds() },
  { headers: { "Cache-Control": "no-store" } },
);

return Response.json(
  { error: String(error) },
  { status: 500, headers: { "Cache-Control": "no-store" } },
);
```

- [ ] **Step 4: Add the TanStack sessions adapter**

Create `src/routes/api/sessions.ts`:

```ts
import { createFileRoute } from "@tanstack/react-router";
import { GET as getSessions } from "@/app/api/sessions/route";

export const Route = createFileRoute("/api/sessions")({
  server: {
    handlers: {
      GET: ({ request }) => getSessions(request),
    },
  },
});
```

- [ ] **Step 5: Run focused and existing sessions tests**

Run:

```bash
node --test lib/tanstack-sessions-route.test.mjs app/api/sessions/runtime-route.test.mjs
```

Expected: all sessions tests pass with unchanged response behavior.

- [ ] **Step 6: Rebuild and regenerate routes**

Run:

```bash
SPIKE_OUTPUT_DIR=$(mktemp -d /tmp/pi-web-tanstack-sessions.XXXXXX)
PI_WEB_TANSTACK_OUTPUT_DIR="$SPIKE_OUTPUT_DIR" npm run build:tanstack
rg -n 'api/sessions' src/routeTree.gen.ts
```

Expected: build succeeds and the generated tree contains `/api/sessions`.

- [ ] **Step 7: Commit the sessions route**

```bash
git add app/api/sessions/route.ts src/routes/api/sessions.ts src/routeTree.gen.ts lib/tanstack-sessions-route.test.mjs
git commit -m "feat: expose sessions through TanStack Start"
```

---

### Task 5: Expose And Exercise The SSE Handler

**Files:**

- Create: `lib/tanstack-agent-events-route.test.mjs`
- Create: `src/routes/api/agent/$id/events.ts`
- Regenerate: `src/routeTree.gen.ts`

- [ ] **Step 1: Write the failing adapter and stream integration test**

Create `lib/tanstack-agent-events-route.test.mjs`:

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const adapterSource = await readFile(new URL("../src/routes/api/agent/$id/events.ts", import.meta.url), "utf8");
const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() }, moduleCache: false });

test("TanStack event route adapts plain params to the existing handler", () => {
  assert.match(adapterSource, /params: Promise\.resolve\(\{ id: params\.id \}\)/);
});

test("event handler preserves headers and abort cleanup", async (t) => {
  const previous = globalThis.__piSessions;
  let unsubscribeCount = 0;
  const id = "tanstack-sse-test";
  globalThis.__piSessions = new Map([[id, {
    isAlive: () => true,
    isStreaming: false,
    streamingMessage: undefined,
    onEvent() {
      return () => { unsubscribeCount += 1; };
    },
  }]]);
  t.after(() => { globalThis.__piSessions = previous; });

  const { GET } = await jiti.import("../app/api/agent/[id]/events/route.ts");
  const controller = new AbortController();
  const response = await GET(
    new Request(`http://localhost/api/agent/${id}/events`, { signal: controller.signal }),
    { params: Promise.resolve({ id }) },
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "text/event-stream");
  assert.equal(response.headers.get("cache-control"), "no-cache, no-transform");
  assert.equal(response.headers.get("connection"), "keep-alive");
  assert.equal(response.headers.get("x-accel-buffering"), "no");

  const reader = response.body.getReader();
  const first = await reader.read();
  assert.equal(new TextDecoder().decode(first.value), ":\n\n");
  controller.abort();
  assert.equal((await reader.read()).done, true);
  assert.equal(unsubscribeCount, 1);
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
node --test lib/tanstack-agent-events-route.test.mjs
```

Expected: FAIL with `ENOENT` for the TanStack adapter.

- [ ] **Step 3: Add the TanStack SSE adapter**

Create `src/routes/api/agent/$id/events.ts`:

```ts
import { createFileRoute } from "@tanstack/react-router";
import { GET as getAgentEvents } from "@/app/api/agent/[id]/events/route";

export const Route = createFileRoute("/api/agent/$id/events")({
  server: {
    handlers: {
      GET: ({ request, params }) => getAgentEvents(request, {
        params: Promise.resolve({ id: params.id }),
      }),
    },
  },
});
```

- [ ] **Step 4: Run all focused SSE tests**

Run:

```bash
node --test lib/tanstack-agent-events-route.test.mjs app/api/agent/events-route.test.mjs lib/agent-event-stream.test.mjs
```

Expected: adapter, headers, heartbeat startup, snapshots, cancellation, and unsubscribe tests all pass.

- [ ] **Step 5: Rebuild and inspect the route tree**

Run:

```bash
SPIKE_OUTPUT_DIR=$(mktemp -d /tmp/pi-web-tanstack-sse.XXXXXX)
PI_WEB_TANSTACK_OUTPUT_DIR="$SPIKE_OUTPUT_DIR" npm run build:tanstack
rg -n 'api/agent/.+events' src/routeTree.gen.ts
```

Expected: build succeeds and the dynamic SSE path is present.

- [ ] **Step 6: Commit the SSE adapter**

```bash
git add 'src/routes/api/agent/$id/events.ts' src/routeTree.gen.ts lib/tanstack-agent-events-route.test.mjs
git commit -m "feat: expose agent events through TanStack Start"
```

---

### Task 6: Convert And Expose Multipart Uploads Without Duplicating Logic

**Files:**

- Create: `app/api/files/upload-route.test.mjs`
- Modify: `app/api/files/[...path]/route.ts`
- Create: `src/routes/api/files/$.ts`
- Regenerate: `src/routeTree.gen.ts`

- [ ] **Step 1: Write the failing Web API, multipart, and adapter tests**

Create `app/api/files/upload-route.test.mjs`:

```js
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const routeSource = await readFile(new URL("./[...path]/route.ts", import.meta.url), "utf8");
const adapterSource = await readFile(new URL("../../../src/routes/api/files/$.ts", import.meta.url), "utf8");
const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() }, moduleCache: false });

function segmentsFor(filePath) {
  return filePath.replace(/\\/g, "/").split("/").filter(Boolean);
}

function uploadRequest(directory, name, content, conflict = "error") {
  const form = new FormData();
  form.append("files", new File([content], name));
  return new Request(`http://localhost/api/files/${segmentsFor(directory).join("/")}?type=upload&conflict=${conflict}`, {
    method: "POST",
    headers: { host: "localhost" },
    body: form,
  });
}

test("files route uses standard Web request and response APIs", () => {
  assert.doesNotMatch(routeSource, /next\/server|NextRequest|NextResponse|\.nextUrl/);
  assert.match(routeSource, /Response\.json/);
  assert.match(routeSource, /new URL\(request\.url\)\.searchParams/);
});

test("TanStack files route adapts the splat to decoded path segments", () => {
  assert.match(adapterSource, /params\._splat\.split\("\/"\)/);
  assert.match(adapterSource, /postFiles\(request/);
});

test("multipart upload preserves success, conflict, and size responses", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-tanstack-upload-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const { allowFileRoot } = await jiti.import("../../../lib/file-access.ts");
  const { POST } = await jiti.import("./[...path]/route.ts");
  allowFileRoot(root);

  const context = { params: Promise.resolve({ path: segmentsFor(root) }) };
  const created = await POST(uploadRequest(root, "proof.txt", "tanstack"), context);
  assert.equal(created.status, 200);
  assert.deepEqual(await created.json(), { uploaded: ["proof.txt"], skipped: [], errors: [] });
  assert.equal(fs.readFileSync(path.join(root, "proof.txt"), "utf8"), "tanstack");

  const conflict = await POST(uploadRequest(root, "proof.txt", "replacement"), context);
  assert.equal(conflict.status, 409);
  assert.deepEqual(await conflict.json(), {
    error: "One or more files already exist",
    conflicts: ["proof.txt"],
    nonReplaceable: [],
  });

  const oversized = new Request(`http://localhost/api/files/${segmentsFor(root).join("/")}?type=upload&conflict=error`, {
    method: "POST",
    headers: {
      host: "localhost",
      "content-type": "multipart/form-data; boundary=x",
      "content-length": String(101 * 1024 * 1024),
    },
    body: "--x--\r\n",
  });
  const rejected = await POST(oversized, context);
  assert.equal(rejected.status, 413);
  assert.deepEqual(await rejected.json(), { error: "Uploads must total 100MB or less" });
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
node --test app/api/files/upload-route.test.mjs
```

Expected: FAIL because the adapter is absent and the existing route still uses Next request/response helpers.

- [ ] **Step 3: Mechanically convert the existing files route to Web APIs**

Apply only these changes in `app/api/files/[...path]/route.ts`:

1. Remove `import { NextRequest, NextResponse } from "next/server";`.
2. Change both handler arguments from `NextRequest` to `Request`.
3. Change the helper union from `{ response: NextResponse }` to `{ response: Response }`.
4. Replace every `NextResponse.json(...)` with `Response.json(...)` without changing arguments.
5. In both `POST` and `GET`, add `const searchParams = new URL(request.url).searchParams;` at the start of the `try` block.
6. Replace every `request.nextUrl.searchParams` use with `searchParams`.

Verify the conversion is complete:

```bash
rg -n 'next/server|NextRequest|NextResponse|nextUrl' 'app/api/files/[...path]/route.ts'
```

Expected: no matches. Do not alter limits, validation, allowed-root logic, symlink resolution, conflict behavior, GET streaming, file watching, or response bodies.

- [ ] **Step 4: Add the TanStack splat adapter**

Create `src/routes/api/files/$.ts`:

```ts
import { createFileRoute } from "@tanstack/react-router";
import { POST as postFiles } from "@/app/api/files/[...path]/route";

export const Route = createFileRoute("/api/files/$")({
  server: {
    handlers: {
      POST: ({ request, params }) => postFiles(request, {
        params: Promise.resolve({ path: params._splat.split("/") }),
      }),
    },
  },
});
```

- [ ] **Step 5: Run upload and existing file-route tests**

Run:

```bash
node --test app/api/files/upload-route.test.mjs app/api/files/watch-route.test.mjs lib/bounded-form-data.test.mjs lib/file-upload.test.mjs lib/file-access.test.mjs
```

Expected: all multipart, limits, conflicts, symlink, allowed-root, and watch tests pass.

- [ ] **Step 6: Rebuild and inspect the splat route**

Run:

```bash
SPIKE_OUTPUT_DIR=$(mktemp -d /tmp/pi-web-tanstack-upload.XXXXXX)
PI_WEB_TANSTACK_OUTPUT_DIR="$SPIKE_OUTPUT_DIR" npm run build:tanstack
rg -n 'api/files' src/routeTree.gen.ts
```

Expected: build succeeds and the splat route is generated.

- [ ] **Step 7: Run the full repository test suite**

Run:

```bash
npm test
```

Expected: all original and newly added tests pass; no existing source-inspection test regresses.

- [ ] **Step 8: Commit the multipart adapter**

```bash
git add 'app/api/files/[...path]/route.ts' app/api/files/upload-route.test.mjs 'src/routes/api/files/$.ts' src/routeTree.gen.ts
git commit -m "feat: expose file uploads through TanStack Start"
```

---

### Task 7: Verify Externalized Output And macOS Runtime Behavior

**Files:**

- Create: `scripts/start-tanstack-output.mjs`
- Create: `scripts/verify-tanstack-output.mjs`
- Create: `scripts/smoke-tanstack-output.mjs`
- Create: `lib/tanstack-output.test.mjs`

- [ ] **Step 1: Write the failing output-tool contract**

Create `lib/tanstack-output.test.mjs`:

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const startSource = await readFile(new URL("../scripts/start-tanstack-output.mjs", import.meta.url), "utf8");
const verifySource = await readFile(new URL("../scripts/verify-tanstack-output.mjs", import.meta.url), "utf8");
const smokeSource = await readFile(new URL("../scripts/smoke-tanstack-output.mjs", import.meta.url), "utf8");

test("output tools require an explicit absolute build path", () => {
  for (const source of [startSource, verifySource, smokeSource]) {
    assert.match(source, /PI_WEB_TANSTACK_OUTPUT_DIR/);
    assert.match(source, /isAbsolute/);
  }
});

test("smoke test uses structured spawn and probes both required endpoints", () => {
  assert.match(smokeSource, /spawn\(process\.execPath, \[serverEntry\]/);
  assert.match(smokeSource, /fetch\(`\$\{origin\}\/`\)/);
  assert.match(smokeSource, /fetch\(`\$\{origin\}\/api\/sessions`\)/);
  assert.doesNotMatch(smokeSource, /shell:\s*true/);
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
node --test lib/tanstack-output.test.mjs
```

Expected: FAIL with `ENOENT` for the output scripts.

- [ ] **Step 3: Create the explicit-output launcher**

Create `scripts/start-tanstack-output.mjs`:

```js
import { existsSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";

const outputDir = process.env.PI_WEB_TANSTACK_OUTPUT_DIR?.trim();
if (!outputDir || !isAbsolute(outputDir)) {
  console.error("PI_WEB_TANSTACK_OUTPUT_DIR must be an absolute path");
  process.exit(1);
}

const serverEntry = join(outputDir, "server", "index.mjs");
if (!existsSync(serverEntry)) {
  console.error(`TanStack server entry not found: ${serverEntry}`);
  process.exit(1);
}

await import(pathToFileURL(serverEntry).href);
```

- [ ] **Step 4: Create the output/externalization verifier**

Create `scripts/verify-tanstack-output.mjs` using only Node standard library. It must:

```js
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, parse } from "node:path";
import { createRequire } from "node:module";

const outputDir = (process.argv[2] || process.env.PI_WEB_TANSTACK_OUTPUT_DIR || "").trim();
assert.ok(outputDir && isAbsolute(outputDir), "PI_WEB_TANSTACK_OUTPUT_DIR must be an absolute path");
assert.ok(existsSync(join(outputDir, "server", "index.mjs")), "server/index.mjs is missing");
assert.ok(existsSync(join(outputDir, "nitro.json")), "nitro.json is missing");

const packages = [
  "undici",
  "@earendil-works/pi-coding-agent",
  "@earendil-works/pi-agent-core",
  "@earendil-works/pi-ai",
  "@earendil-works/pi-tui",
];
const rootRequire = createRequire(new URL("../package.json", import.meta.url));
const tracedRequire = createRequire(join(outputDir, "server", "index.mjs"));
const versions = {};

function packageJsonFor(requireFrom, name) {
  let directory = dirname(requireFrom.resolve(name));
  const root = parse(directory).root;
  while (directory !== root) {
    const candidate = join(directory, "package.json");
    if (existsSync(candidate)) {
      const pkg = JSON.parse(readFileSync(candidate, "utf8"));
      if (pkg.name === name) return pkg;
    }
    directory = dirname(directory);
  }
  throw new Error(`package.json not found for ${name}`);
}

for (const name of packages) {
  const rootPackage = packageJsonFor(rootRequire, name);
  const tracedPackage = packageJsonFor(tracedRequire, name);
  assert.equal(tracedPackage.version, rootPackage.version, `${name} runtime version differs from the repository install`);
  versions[name] = tracedPackage.version;
}

function sizeOf(directory) {
  let files = 0;
  let bytes = 0;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = sizeOf(fullPath);
      files += nested.files;
      bytes += nested.bytes;
    } else {
      files += 1;
      bytes += statSync(fullPath).size;
    }
  }
  return { files, bytes };
}

const nitro = JSON.parse(readFileSync(join(outputDir, "nitro.json"), "utf8"));
const serverFiles = [];
function collectServerCode(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) collectServerCode(fullPath);
    else if (/\.[cm]?js$/.test(entry.name)) serverFiles.push(fullPath);
  }
}
collectServerCode(join(outputDir, "server"));
const runtimeImports = serverFiles
  .map((file) => readFileSync(file, "utf8"))
  .join("\n");
for (const name of packages) {
  assert.ok(runtimeImports.includes(name), `${name} has no runtime import edge in generated server code`);
}

console.log(JSON.stringify({ outputDir, nitro, versions, ...sizeOf(outputDir) }, null, 2));
```

This deliberately resolves each package from the generated server entry, including packages that do not export their `package.json`. Resolution must land in the traced output's `node_modules`, and the complete generated server module graph must retain an import edge naming every package. The complete graph is required because `pi-ai` may be referenced transitively by an external Pi package rather than directly by an application chunk. Together these checks prove runtime loading rather than merely finding a copied package directory.

- [ ] **Step 5: Create the cross-platform smoke runner**

Create `scripts/smoke-tanstack-output.mjs` with these exact behaviors:

```js
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { spawn } from "node:child_process";

const outputDir = (process.argv[2] || process.env.PI_WEB_TANSTACK_OUTPUT_DIR || "").trim();
assert.ok(outputDir && isAbsolute(outputDir), "PI_WEB_TANSTACK_OUTPUT_DIR must be an absolute path");
const serverEntry = join(outputDir, "server", "index.mjs");
assert.ok(existsSync(serverEntry), `server entry missing: ${serverEntry}`);

const port = Number(process.env.PI_WEB_TANSTACK_SMOKE_PORT || 30142);
const origin = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, [serverEntry], {
  cwd: outputDir,
  stdio: ["ignore", "pipe", "pipe"],
  env: {
    ...process.env,
    NITRO_HOST: "127.0.0.1",
    NITRO_PORT: String(port),
    PI_WEB_HOSTNAME: "127.0.0.1",
  },
});

let logs = "";
child.stdout.on("data", (chunk) => { logs += chunk; process.stdout.write(chunk); });
child.stderr.on("data", (chunk) => { logs += chunk; process.stderr.write(chunk); });

async function waitFor(url) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`server did not become ready: ${url}\n${logs}`);
}

try {
  const root = await waitFor(`${origin}/`);
  assert.match(await root.text(), /Pi Web/);
  const sessions = await fetch(`${origin}/api/sessions`);
  assert.equal(sessions.status, 200);
  assert.equal(sessions.headers.get("cache-control"), "no-store");
  const body = await sessions.json();
  assert.ok(Array.isArray(body.sessions));
  assert.ok(Array.isArray(body.runningSessionIds));
  console.log(JSON.stringify({ origin, sessions: body.sessions.length }));
} finally {
  child.kill();
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}
```

- [ ] **Step 6: Run the output-tool contract**

Run:

```bash
node --test lib/tanstack-output.test.mjs
```

Expected: both tests pass.

- [ ] **Step 7: Build, verify traced packages, and smoke test on macOS**

Run:

```bash
SPIKE_OUTPUT_DIR=$(mktemp -d /tmp/pi-web-tanstack-runtime.XXXXXX)
PI_WEB_TANSTACK_OUTPUT_DIR="$SPIKE_OUTPUT_DIR" npm run build:tanstack
node scripts/verify-tanstack-output.mjs "$SPIKE_OUTPUT_DIR"
PI_WEB_TANSTACK_OUTPUT_DIR="$SPIKE_OUTPUT_DIR" node scripts/smoke-tanstack-output.mjs "$SPIKE_OUTPUT_DIR"
```

Expected: verifier reports the repository-installed versions of all five packages, and smoke reports successful root and sessions responses.

- [ ] **Step 8: Exercise a real multipart upload through Nitro**

Run from zsh on macOS:

```bash
SPIKE_UPLOAD_DIR=$(mktemp -d /Users/kale/pi-cwd-20260807/.tanstack-upload.XXXXXX)
SPIKE_UPLOAD_SOURCE=$(mktemp /tmp/pi-web-upload-source.XXXXXX)
SPIKE_SERVER_LOG=$(mktemp /tmp/pi-web-tanstack-server.XXXXXX.log)
printf 'tanstack multipart proof\n' > "$SPIKE_UPLOAD_SOURCE"
NITRO_HOST=127.0.0.1 NITRO_PORT=30143 PI_WEB_HOSTNAME=127.0.0.1 PI_WEB_TANSTACK_OUTPUT_DIR="$SPIKE_OUTPUT_DIR" npm run start:tanstack >"$SPIKE_SERVER_LOG" 2>&1 &
SPIKE_SERVER_PID=$!
trap 'kill "$SPIKE_SERVER_PID" 2>/dev/null || true; rm -f "$SPIKE_UPLOAD_SOURCE"; rm -rf "$SPIKE_UPLOAD_DIR"' EXIT
for attempt in {1..60}; do curl -fsS http://127.0.0.1:30143/ >/dev/null && break; sleep 0.25; done
SPIKE_UPLOAD_PATH=${SPIKE_UPLOAD_DIR#/}
curl -fsS -X POST -F "files=@${SPIKE_UPLOAD_SOURCE};filename=proof.txt" "http://127.0.0.1:30143/api/files/${SPIKE_UPLOAD_PATH}?type=upload&conflict=error" | tee /tmp/pi-web-tanstack-upload-response.json
cmp "$SPIKE_UPLOAD_SOURCE" "$SPIKE_UPLOAD_DIR/proof.txt"
kill "$SPIKE_SERVER_PID"
wait "$SPIKE_SERVER_PID" || true
trap - EXIT
rm -f "$SPIKE_UPLOAD_SOURCE"
rm -rf "$SPIKE_UPLOAD_DIR"
```

Expected: response is `{"uploaded":["proof.txt"],"skipped":[],"errors":[]}`, `cmp` succeeds, and cleanup removes only the explicitly created temporary files.

- [ ] **Step 9: Commit output verification utilities**

```bash
git add scripts/start-tanstack-output.mjs scripts/verify-tanstack-output.mjs scripts/smoke-tanstack-output.mjs lib/tanstack-output.test.mjs
git commit -m "test: verify TanStack output and runtime"
```

---

### Task 8: Hold A Real SSE Connection For At Least 310 Seconds

**Files:**

- Create: `docs/spikes/2026-08-12-tanstack-start-spike-results.md`

- [ ] **Step 1: Build a fresh runtime artifact**

Run:

```bash
SPIKE_OUTPUT_DIR=$(mktemp -d /tmp/pi-web-tanstack-sse-runtime.XXXXXX)
PI_WEB_TANSTACK_OUTPUT_DIR="$SPIKE_OUTPUT_DIR" npm run build:tanstack
node scripts/verify-tanstack-output.mjs "$SPIKE_OUTPUT_DIR"
```

Expected: build and externalization verification pass.

- [ ] **Step 2: Start the server and select an existing real session**

Run:

```bash
SPIKE_SSE_SERVER_LOG=$(mktemp /tmp/pi-web-tanstack-sse-server.XXXXXX.log)
NITRO_HOST=127.0.0.1 NITRO_PORT=30144 PI_WEB_HOSTNAME=127.0.0.1 PI_WEB_TANSTACK_OUTPUT_DIR="$SPIKE_OUTPUT_DIR" npm run start:tanstack >"$SPIKE_SSE_SERVER_LOG" 2>&1 &
SPIKE_SSE_SERVER_PID=$!
trap 'kill "$SPIKE_SSE_SERVER_PID" 2>/dev/null || true' EXIT
for attempt in {1..60}; do curl -fsS http://127.0.0.1:30144/api/sessions >/tmp/pi-web-tanstack-sessions.json && break; sleep 0.25; done
SPIKE_SESSION_ID=$(node -e 'const fs=require("fs"); const body=JSON.parse(fs.readFileSync("/tmp/pi-web-tanstack-sessions.json","utf8")); process.stdout.write(body.sessions[0]?.id || "")')
test -n "$SPIKE_SESSION_ID"
```

Expected: a non-empty real session ID. If no session exists, pause the gate and ask the user to identify or create a local Pi session; do not substitute a mock for the 310-second runtime gate.

- [ ] **Step 3: Hold the SSE connection and validate heartbeats**

Run:

```bash
SPIKE_SSE_BODY=$(mktemp /tmp/pi-web-tanstack-sse-body.XXXXXX)
SPIKE_SSE_HEADERS=$(mktemp /tmp/pi-web-tanstack-sse-headers.XXXXXX)
SPIKE_SSE_STARTED=$(date +%s)
set +e
curl --no-buffer --silent --show-error --dump-header "$SPIKE_SSE_HEADERS" --output "$SPIKE_SSE_BODY" --max-time 310 "http://127.0.0.1:30144/api/agent/${SPIKE_SESSION_ID}/events"
SPIKE_CURL_STATUS=$?
set -e
SPIKE_SSE_ELAPSED=$(($(date +%s) - SPIKE_SSE_STARTED))
test "$SPIKE_CURL_STATUS" -eq 28
test "$SPIKE_SSE_ELAPSED" -ge 310
rg -i '^content-type: text/event-stream' "$SPIKE_SSE_HEADERS"
rg -i '^cache-control: no-cache, no-transform' "$SPIKE_SSE_HEADERS"
rg -i '^x-accel-buffering: no' "$SPIKE_SSE_HEADERS"
rg '^data: \{"type":"connected"' "$SPIKE_SSE_BODY"
SPIKE_HEARTBEATS=$(rg -c '^:$' "$SPIKE_SSE_BODY")
test "$SPIKE_HEARTBEATS" -ge 10
kill "$SPIKE_SSE_SERVER_PID"
wait "$SPIKE_SSE_SERVER_PID" || true
trap - EXIT
```

Expected: curl ends only because its own 310-second deadline is reached (`28`), elapsed time is at least 310 seconds, the required headers are present, a connected event was received, and at least 10 heartbeat lines were observed.

- [ ] **Step 4: Write the macOS evidence report**

Create `docs/spikes/2026-08-12-tanstack-start-spike-results.md` with:

```markdown
# TanStack Start Spike Results

## Versions

Record the exact Node, npm, TanStack Start, TanStack Router, Vite, Nitro, Undici, and Pi package versions printed by the executed commands.

## macOS Build And Runtime

Record the exact external output path, build exit status, verifier JSON, root status, sessions status, multipart response, and byte-comparison result.

## macOS SSE Gate

Record the session ID used, response headers, curl exit status, measured elapsed seconds, heartbeat count, and relevant server log lines. Do not include credentials, API keys, message content, or session file contents.

## Windows CI

Record the GitHub Actions run URL and the build, externalization, root, and sessions results after Task 9 runs.

## Conclusion

State either `PASS - authorize separate Phase 1 design` only when every gate passes, or `FAIL - stop before Phase 1` followed by the exact failed command and smallest next experiment.
```

Replace the instructional sentences with the captured values while executing this step; do not leave them in the committed results document.

- [ ] **Step 5: Commit the macOS evidence**

```bash
git add docs/spikes/2026-08-12-tanstack-start-spike-results.md
git commit -m "docs: record macOS TanStack spike evidence"
```

---

### Task 9: Add And Run The Windows Gate

**Files:**

- Modify: `lib/tanstack-output.test.mjs`
- Create: `.github/workflows/tanstack-spike-windows.yml`
- Modify: `docs/spikes/2026-08-12-tanstack-start-spike-results.md`

- [ ] **Step 1: Add a failing workflow contract**

Append to `lib/tanstack-output.test.mjs`:

```js
const workflow = await readFile(new URL("../.github/workflows/tanstack-spike-windows.yml", import.meta.url), "utf8");

test("Windows gate builds and runs the generated server on Windows", () => {
  assert.match(workflow, /windows-latest/);
  assert.match(workflow, /node-version: 22\.19\.0/);
  assert.match(workflow, /npm ci/);
  assert.match(workflow, /npm run build:tanstack/);
  assert.match(workflow, /verify-tanstack-output\.mjs/);
  assert.match(workflow, /smoke-tanstack-output\.mjs/);
});
```

- [ ] **Step 2: Run the contract and verify it fails**

Run:

```bash
node --test lib/tanstack-output.test.mjs
```

Expected: FAIL with `ENOENT` for the workflow.

- [ ] **Step 3: Add the Windows workflow**

Create `.github/workflows/tanstack-spike-windows.yml`:

```yaml
name: TanStack spike Windows

on:
  workflow_dispatch:
  push:
    branches:
      - migration/tanstack-start

jobs:
  windows-runtime:
    runs-on: windows-latest
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22.19.0
          cache: npm
      - run: npm ci
      - name: Build outside the checkout
        shell: pwsh
        run: |
          $env:PI_WEB_TANSTACK_OUTPUT_DIR = Join-Path $env:RUNNER_TEMP "pi-web-tanstack-output"
          npm run build:tanstack
          node scripts/verify-tanstack-output.mjs $env:PI_WEB_TANSTACK_OUTPUT_DIR
      - name: Start and probe generated server
        shell: pwsh
        run: |
          $env:PI_WEB_TANSTACK_OUTPUT_DIR = Join-Path $env:RUNNER_TEMP "pi-web-tanstack-output"
          $env:PI_WEB_TANSTACK_SMOKE_PORT = "30142"
          node scripts/smoke-tanstack-output.mjs $env:PI_WEB_TANSTACK_OUTPUT_DIR
```

- [ ] **Step 4: Run the local workflow contract and regression checks**

Run:

```bash
node --test lib/tanstack-output.test.mjs
npm run lint
node_modules/.bin/tsc --noEmit
```

Expected: all commands pass.

- [ ] **Step 5: Commit and push the workflow branch**

```bash
git add .github/workflows/tanstack-spike-windows.yml lib/tanstack-output.test.mjs
git commit -m "ci: verify TanStack spike on Windows"
git push -u origin migration/tanstack-start
```

Expected: the branch push triggers `TanStack spike Windows`. This push is part of the user-approved Windows CI gate; do not merge or open a pull request.

- [ ] **Step 6: Wait for the Windows run and inspect its logs**

Run:

```bash
gh run list --workflow tanstack-spike-windows.yml --branch migration/tanstack-start --limit 1
gh run watch --exit-status "$(gh run list --workflow tanstack-spike-windows.yml --branch migration/tanstack-start --limit 1 --json databaseId --jq '.[0].databaseId')"
```

Expected: workflow concludes `success`; logs show a Windows-local build, five resolved runtime packages, root response, and sessions JSON response. If the run fails, stop and record the run URL and failing step before changing code.

- [ ] **Step 7: Record Windows evidence**

Update `docs/spikes/2026-08-12-tanstack-start-spike-results.md` with the exact run URL, commit SHA, runner OS, Node version, external package versions, and smoke output. Do not write `PASS` yet unless the final regression task also passes.

- [ ] **Step 8: Commit Windows evidence**

```bash
git add docs/spikes/2026-08-12-tanstack-start-spike-results.md
git commit -m "docs: record Windows TanStack spike evidence"
```

---

### Task 10: Run The Final Gate And Stop Before Phase 1

**Files:**

- Modify: `docs/spikes/2026-08-12-tanstack-start-spike-results.md`

- [ ] **Step 1: Verify protected files and the Next launcher are unchanged**

Run:

```bash
git diff --exit-code 6a76151 -- lib/rpc-manager.ts lib/agent-event-stream.ts lib/request-security.ts lib/web-auth.ts bin/pi-web.js
```

Expected: exit 0 and no diff.

- [ ] **Step 2: Run all repository verification commands**

Run:

```bash
npm test
npm run lint
node_modules/.bin/tsc --noEmit
```

Expected: every original and spike test passes, lint passes, and TypeScript reports no errors.

- [ ] **Step 3: Produce and verify one final clean external build**

Run:

```bash
FINAL_SPIKE_OUTPUT_DIR=$(mktemp -d /tmp/pi-web-tanstack-final.XXXXXX)
PI_WEB_TANSTACK_OUTPUT_DIR="$FINAL_SPIKE_OUTPUT_DIR" npm run build:tanstack
node scripts/verify-tanstack-output.mjs "$FINAL_SPIKE_OUTPUT_DIR"
PI_WEB_TANSTACK_OUTPUT_DIR="$FINAL_SPIKE_OUTPUT_DIR" node scripts/smoke-tanstack-output.mjs "$FINAL_SPIKE_OUTPUT_DIR"
test ! -e .output
```

Expected: build, external resolution, root, and sessions checks pass; the repository contains no `.output` directory.

- [ ] **Step 4: Inspect current and future package file shapes**

Run:

```bash
PACK_REPORT=$(mktemp /tmp/pi-web-pack.XXXXXX.json)
npm pack --dry-run --json > "$PACK_REPORT"
node -e 'const fs=require("fs"); const pkg=require("./package.json"); const report=JSON.parse(fs.readFileSync(process.argv[1],"utf8"))[0]; if (!pkg.files.includes(".next")) throw new Error("current .next publication declaration missing"); if (pkg.files.includes(".output")) throw new Error(".output must not be published during the spike"); console.log(JSON.stringify({filename:report.filename,size:report.size,fileCount:report.files.length,publishDeclaration:pkg.files},null,2));' "$PACK_REPORT"
find "$FINAL_SPIKE_OUTPUT_DIR" -type f | sort > /tmp/pi-web-tanstack-output-files.txt
wc -l /tmp/pi-web-tanstack-output-files.txt
du -sh "$FINAL_SPIKE_OUTPUT_DIR"
```

Expected: the dry-run completes, `package.json#files` still declares `.next` and not `.output`, and the external Nitro output has a concrete file count and size for later Phase 3 package planning. A clean spike worktree has no built `.next` files, so the dry-run file list itself is not required to contain `.next/`. Do not change `package.json#files` in the spike.

- [ ] **Step 5: Finalize the results conclusion**

Update `docs/spikes/2026-08-12-tanstack-start-spike-results.md` with the final test count, lint result, typecheck result, clean-build verifier JSON, smoke result, npm dry-run summary, Nitro output file count/size, and protected-file diff result.

Write exactly one conclusion:

```text
PASS - authorize separate Phase 1 design
```

only if every macOS, 310-second SSE, Windows, externalization, multipart, regression, and protected-file gate passed. Otherwise write:

```text
FAIL - stop before Phase 1
```

and include the exact failed command, relevant log excerpt, suspected cause, and smallest next experiment.

- [ ] **Step 6: Commit the final spike conclusion**

```bash
git add docs/spikes/2026-08-12-tanstack-start-spike-results.md
git commit -m "docs: conclude TanStack Start migration spike"
git status --short --branch
```

Expected: clean worktree after the commit.

- [ ] **Step 7: Stop and hand off the result**

Report the branch, commits, macOS evidence, Windows Actions URL, and final conclusion. Do not migrate another API route and do not start Phase 1 until its design is separately reviewed and approved.
