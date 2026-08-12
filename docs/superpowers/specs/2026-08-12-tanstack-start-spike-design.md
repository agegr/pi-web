# TanStack Start Migration Spike Design

## Purpose

Prove that pi-web can run its highest-risk server workloads on TanStack Start v1, Vite, and Nitro before the full Next.js migration begins. The spike is a hard gate: full migration planning does not start until every acceptance criterion below passes.

The migration branch starts from committed `main` revision `6a76151`. Uncommitted work in the main worktree is deliberately excluded and may be incorporated later only through an explicit rebase or cherry-pick.

## Scope

The spike adds a parallel TanStack Start application at the repository root while preserving the working Next.js application.

It migrates only these representative endpoints:

1. `GET /api/sessions` for JSON responses and process-local session state.
2. `GET /api/agent/$id/events` for a long-lived SSE stream.
3. `POST /api/files/$` for bounded multipart file uploads through a catch-all route.

It also adds a minimal root health page or endpoint needed to prove that the TanStack application starts. It does not migrate AppShell, PWA behavior, global proxy middleware, the remaining 37 API routes, or the published CLI launcher.

The following core modules must not change:

- `lib/rpc-manager.ts`
- `lib/agent-event-stream.ts`
- `lib/request-security.ts`
- `lib/web-auth.ts`

The three spike routes reuse existing `lib/` behavior. Only framework adapters, route parameter access, URL query access, and response construction may change.

## Repository Layout

The existing Next.js files, dependencies, scripts, and `.next` package publication entries remain intact during the spike. TanStack Start route and configuration files live in their normal root-level locations so successful work can be extended during the later migration instead of rebuilt from a disposable subproject.

The spike adds separate commands such as `dev:tanstack`, `build:tanstack`, and `start:tanstack`. Existing `dev`, `build`, `start`, and release commands keep their Next.js behavior.

Production spike builds must write to an absolute directory outside the repository worktree. Test scripts create a temporary output directory and pass it to the build configuration. No `.output` directory may be generated inside the repository during development.

## Build And Runtime Architecture

The Vite SSR configuration and Nitro external configuration explicitly keep these packages as runtime dependencies:

- `undici`
- `@earendil-works/pi-coding-agent`
- `@earendil-works/pi-agent-core`
- `@earendil-works/pi-ai`
- `@earendil-works/pi-tui`

The built server must resolve them from `node_modules`; Vite or Rollup must not inline their implementations. Verification inspects the generated server bundle and starts the result with the repository dependencies available.

`configureHttpDispatcher()` runs from the TanStack/Nitro server startup path. A focused test or probe records that dispatcher initialization completes before the first API handler executes. Route-local lazy initialization is not acceptable because it can allow the first request to run with different global fetch behavior.

The built application starts by invoking Nitro's generated `server/index.mjs` with Node. Host and port are supplied through environment variables supported by the generated server. The spike records the exact environment variables and startup signal that the later `bin/pi-web.js` migration must use, but does not modify that launcher.

macOS and Windows each install dependencies and build from source on their own platform. They do not exchange generated server artifacts.

## Route Behavior

### Sessions JSON

`GET /api/sessions` keeps its current URL, status codes, response body, and `Cache-Control: no-store` behavior. It continues to combine persisted sessions with process-local RPC session snapshots. The only response change is replacing `NextResponse.json` with the standard `Response.json` API.

### Agent Event Stream

`GET /api/agent/$id/events` obtains `id` from the TanStack server route context and otherwise retains the existing implementation. It keeps the standard `Request`, `Response`, `ReadableStream`, session resolution, reconnect behavior, and these response headers:

- `Content-Type: text/event-stream`
- `Cache-Control: no-cache, no-transform`
- `Connection: keep-alive`
- `X-Accel-Buffering: no`

Client abort must propagate to the existing stream cleanup path. Nitro must neither buffer the response nor impose a timeout shorter than the 310-second acceptance connection.

### Multipart File Upload

`POST /api/files/$` obtains catch-all path segments from TanStack route context and query parameters from `new URL(request.url).searchParams`. It keeps the existing multipart parser, 25 MB per-file limit, 100 MB aggregate limit, conflict strategies, filename validation, symlink protection, allowed-root checks, response bodies, and status codes.

The route-local `isApiRequestAllowed()` check remains active. The spike does not migrate the global host allow-list or Basic Auth proxy; those belong to the full API migration after this gate passes.

## Verification

### Automated Route Checks

Focused tests cover the framework adapters without duplicating the existing business-logic suite:

- Sessions: status, JSON shape, and no-store cache header.
- SSE: required headers, stream creation, and abort cleanup.
- Upload: successful multipart write, conflict response, and request-size rejection.
- Startup: dispatcher configuration occurs before an API handler handles its first request.

Existing tests continue to run from their current locations during the spike. Tests that inspect the three migrated route source files may be updated to understand the parallel route locations, but the original Next route tests remain valid while Next is retained.

### macOS Runtime Gate

On macOS:

1. Install dependencies from the lockfile.
2. Build into a fresh temporary directory outside the worktree.
3. Start the generated `server/index.mjs` with Node.
4. Request the root health surface and `GET /api/sessions`.
5. Exercise a real multipart upload against an authorized temporary directory and verify the bytes written.
6. Connect to `GET /api/agent/:id/events` for an existing local Pi session and keep the connection open for at least 310 seconds.
7. Record that Nitro did not close or buffer the SSE response during that interval.

### Windows CI Gate

A GitHub Actions job on `windows-latest`:

1. Checks out the spike branch revision.
2. Installs the repository's supported Node version and runs `npm ci`.
3. Builds TanStack Start/Nitro into a fresh external temporary directory.
4. Starts the generated Node server using Windows paths.
5. Requests the root health surface and `GET /api/sessions`, requiring successful responses.
6. Inspects the server output to ensure the five external packages were not bundled.
7. Stops the server and fails on any non-zero build, startup, request, or teardown result.

Windows CI does not perform the 310-second real-session SSE test because the runner has no Pi session data or credentials. That behavior is gated on macOS, while Windows verifies its own build and runtime dependency resolution.

### Repository Regression Gate

At spike completion, all of these must pass:

- `npm test` with the full existing suite.
- `npm run lint`.
- `node_modules/.bin/tsc --noEmit`.
- A build-output inspection proving runtime externalization.
- A package dry-run or equivalent file-list inspection showing that the generated output can later be published, without changing `package.json#files` during the spike.

## Stop Conditions

The spike fails and work stops before full migration planning if any of these occurs:

- Any required Pi package or `undici` is inlined, or cannot be loaded from `node_modules` at runtime.
- Dispatcher configuration cannot be guaranteed before the first handler.
- The macOS SSE connection closes, buffers indefinitely, or otherwise fails before 310 seconds.
- Multipart status codes, response data, size limits, or filesystem behavior differ from the Next route.
- The generated server cannot build and start on either macOS or `windows-latest`.
- Existing tests, lint, or type checking regress.
- A required fix would materially change protected core modules or unrelated application code.

When a stop condition is reached, the branch records the failing command, relevant logs, suspected cause, and the smallest credible next experiment. It does not proceed by weakening the acceptance criteria.

## Deliverables And Handoff

A passing spike produces:

- The parallel TanStack Start skeleton and three representative routes.
- Focused route, startup-order, and externalization checks.
- A reproducible external-output build command.
- A Windows GitHub Actions verification job.
- macOS runtime evidence, including the 310-second SSE result.
- A short spike conclusion that lists exact versions, commands, output layout, startup environment variables, and any constraints discovered.

The spike is committed independently from the later migration. Passing it authorizes a separate design and implementation plan for the remaining API routes; it does not automatically begin that work.
