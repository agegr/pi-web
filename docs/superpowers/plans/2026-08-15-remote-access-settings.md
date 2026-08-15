# Remote Access Settings Implementation Plan

> **For agentic workers:** Execute this plan task-by-task with test-driven development. Do not begin implementation until `docs/superpowers/specs/2026-08-15-remote-access-settings-design.md` is approved.

**Goal:** Add Settings → Remote access so an operator can bind exact public hostnames and a password for an existing reverse proxy, while Pi Web keeps listening on loopback and HTTP Basic Auth remains the gate.

**Architecture:** Persist `{agentDir}/pi-web.json` (`0600`, scrypt hash). Union file hosts with `PI_WEB_ALLOWED_HOSTS`. `PI_WEB_PASSWORD` wins over the file hash. Compare Origin to Host by host/port, ignoring scheme.

**Tech Stack:** TypeScript, React 19, existing settings tokens, Node `crypto.scrypt`, Node test runner, TanStack dual routes.

**Design Spec:** `docs/superpowers/specs/2026-08-15-remote-access-settings-design.md`

---

## Constraints

- Work on `cursor/remote-access-settings-b558`. Do not implement on `main`.
- Never run `npm run build` or `npm run pack:tanstack`.
- Tests that read `pi-web.json` must set `PI_CODING_AGENT_DIR` to a temp directory.
- Route inventory counts go from 47 to 48.

---

### Task 1: Config file, hostname rules, scrypt

**Files:** `lib/remote-access-config.ts`, `lib/remote-access-config.test.mjs`

- [ ] Hostname accept/reject matrix (URL, wildcard, IP, port, IDN).
- [ ] Write `0600` JSON; preserve unknown keys; snapshot never contains password/hash.
- [ ] Hash verify accepts the original password and rejects a wrong one.
- [ ] `password: null` rules: loopback + empty hosts or env password.
- [ ] Non-empty hosts require an effective password.

### Task 2: Auth + Host/Origin

**Files:** `lib/web-auth.ts`, `lib/request-security.ts`, `src/request-security.ts`, matching tests

- [ ] Env password still wins; file hash used when env is unset.
- [ ] Host allow-list unions file + env.
- [ ] Origin host match ignores scheme (#497).
- [ ] `sec-fetch-site: cross-site` still rejected.
- [ ] Export `isLoopbackApiRequest`.

### Task 3: GET/PUT `/api/remote-access`

**Files:** `app/api/remote-access/route.ts`, `src/routes/api/remote-access.ts`, inventory, `src/routeTree.gen.ts`, `src/api-methods.ts`

- [ ] Dual route + inventory 48.
- [ ] GET never returns secrets. PUT validation status/codes match the spec.

### Task 4: Settings UI + i18n + README

**Files:** `components/RemoteAccessConfig.tsx`, `components/SettingsPage.tsx`, CSS, `en.ts` / `zh-CN.ts`, README both languages

- [ ] Nav after General, `GlobeLock`, no project required.
- [ ] Dirty draft uses the existing discard dialog.
- [ ] README documents Settings first, keeps the env table.

### Task 5: Gates

```bash
env -u NODE_ENV -u PI_WEB_PASSWORD node --experimental-strip-types --test \
  lib/remote-access-config.test.mjs \
  app/api/remote-access/route.test.mjs \
  lib/web-auth.test.mjs \
  lib/request-security.test.mjs \
  lib/tanstack-request-security.test.mjs \
  lib/tanstack-route-inventory.test.mjs \
  lib/i18n/messages/remote-i18n.test.mjs \
  components/RemoteAccessConfig.test.mjs \
  components/SettingsPage.test.mjs
env -u NODE_ENV -u PI_WEB_PASSWORD node_modules/.bin/tsc --noEmit
env -u NODE_ENV -u PI_WEB_PASSWORD npm run lint
git diff --check
```
