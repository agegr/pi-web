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

Recorded in Task 9 (GitHub Actions run URL and results below).

## Conclusion

PASS - authorize separate Phase 1 design
