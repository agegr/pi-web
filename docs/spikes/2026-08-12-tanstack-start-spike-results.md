# TanStack Start Spike Results

Date: 2026-08-12 · Branch: `migration/tanstack-start` · Repository: `/Users/kale/pi-web-worktrees/migration-tanstack-start`

## Versions

- Node: v22.22.1 · npm: 10.9.4
- TanStack Start: 1.168.42 · TanStack Router: 1.170.25 · Vite: 8.0.14 · Nitro: 3.0.260311-beta · @vitejs/plugin-react: 6.0.5
- undici: 8.9.0 · @earendil-works/pi-coding-agent: 0.84.1 · pi-agent-core: 0.84.1 · pi-ai: 0.84.1 · pi-tui: 0.84.1
- Next.js (retained): 16.2.12

## macOS Build And Runtime

- External output dir: `/tmp/pi-web-tanstack-fullpkg.d92q5g` (fresh, outside repository; no `.output` in worktree)
- Build: `npm run build:tanstack` exit 0
- Verifier: `scripts/verify-tanstack-output.mjs` — all five packages resolved from the generated server entry with versions identical to the repository install:
  `{"undici":"8.9.0","@earendil-works/pi-coding-agent":"0.84.1","@earendil-works/pi-agent-core":"0.84.1","@earendil-works/pi-ai":"0.84.1","@earendil-works/pi-tui":"0.84.1"}`; output size 3322 files / 19.9 MB
- Smoke: root `/` 200 matching `Pi Web`; `/api/sessions` 200 with `cache-control: no-store`, 20 sessions
- Multipart: `POST /api/files/<path>?type=upload&conflict=error` returned `{"uploaded":["proof.txt"],"skipped":[],"errors":[]}`, uploaded bytes identical to source (`cmp` OK)
- Runtime resource files: full package contents copied into the output `server/node_modules` (Nitro traces only the JS import graph; a `closeBundle` plugin copies complete packages so theme JSON/assets resolve at runtime)

## macOS SSE Gate

- Session: `019ff410-f8ec-72f4-ad23-6c6e86f47d7d` (real Pi session, port 30144)
- Response headers: `content-type: text/event-stream`, `cache-control: no-cache, no-transform`, `x-accel-buffering: no`, HTTP 200
- curl exit 28 (`Operation timed out after 310068 milliseconds`), elapsed ≥ 310 s
- `data: {"type":"connected","sessionId":"019ff410-f8ec-72f4-ad23-6c6e86f47d7d","isStreaming":false}` received
- Heartbeat lines (`:`): 11 (≥ 10 required; 30 s interval over 310 s)
- No credentials, API keys, message content, or session file contents recorded

## Windows CI

- Run URL: https://github.com/icekale/pi-web/actions/runs/31569406484
- Commit: `dee13b0` · Runner: `windows-latest` (x64) · Node 22.19.0
- Result: `windows-runtime` job succeeded in 2m27s; `npm ci`, external build, `verify-tanstack-output.mjs` (Traced 71 dependencies, 3366 files), and `smoke-tanstack-output.mjs` all passed
- Smoke: server listened on `http://127.0.0.1:30142/`; root and `/api/sessions` probes returned 200 (`sessions: 0` — runner has no local Pi sessions, expected)
- Note: checkout/setup-node actions emit a Node 20 deprecation warning only

## Final Regression (Task 10)

- Protected files (`lib/rpc-manager.ts`, `lib/agent-event-stream.ts`, `lib/request-security.ts`, `lib/web-auth.ts`, `bin/pi-web.js`) unchanged vs `6a76151`: `git diff --exit-code` clean
- `npm test`: 554 pass / 0 fail (including all spike contract tests)
- `npm run lint`: exit 0 (1 pre-existing warning: `@next/next/no-head-element` on `src/routes/__root.tsx`)
- `tsc --noEmit`: exit 0
- Final clean build `/tmp/pi-web-tanstack-final.ea1cku`: exit 0; verifier versions identical for all five packages; smoke root + sessions 200 (20 sessions); no `.output` in worktree
- `npm pack --dry-run`: `files` still declares `.next` and not `.output` (82 files / 66 KB in a clean worktree; external Nitro output is 23,268 files / 205 MB — input for Phase 3 package planning)
- Note: undici upgraded 8.5.0 → 8.9.0 (Task 7) to align with pi-coding-agent's nested undici and satisfy the runtime-version gate; its ProxyAgent no longer CONNECT-tunnels `http://` targets (absolute-form since undici 8.7), so `lib/http-dispatcher.test.mjs` assertions were updated to the new wire behavior — proxy routing, CONNECT for https, and NO_PROXY bypass semantics are all still verified

## Conclusion

PASS - authorize separate Phase 1 design
