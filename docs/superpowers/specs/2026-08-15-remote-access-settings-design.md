# Remote Access Settings Design

## Status

Locked for implementation after the 2026-08-15 design review. Settings configures reverse-proxy hostnames and a password; the process keeps listening on loopback; HTTP Basic Auth stays the gate.

## Objective

Let an operator bind a public hostname in **Settings → Remote access** so an existing reverse proxy (Caddy, nginx, Cloudflare, Synology, and similar) can reach Pi Web at `https://their.domain`, without teaching Pi Web to terminate TLS or spawn a tunnel.

The same page sets the access password. `PI_WEB_PASSWORD` and `PI_WEB_ALLOWED_HOSTS` remain valid overrides for systemd / Docker operators.

## Context

Pi Web already has the security machinery, but only via environment variables:

- Bind defaults to `127.0.0.1`. `bin/pi-web.js` refuses a non-loopback bind unless `PI_WEB_PASSWORD` is set.
- `lib/request-security.ts` allows loopback names, IP literals, `PI_WEB_HOSTNAME`, and exact names in `PI_WEB_ALLOWED_HOSTS`.
- `lib/web-auth.ts` enforces HTTP Basic Auth, username always `pi`.
- Settings has no Remote section. Operators who only use the UI cannot add a domain.
- HTTPS reverse proxies often disagree with Pi Web on URL scheme (`x-forwarded-proto` vs `Origin`), which is [#497](https://github.com/agegr/pi-web/issues/497). Exact Host allow-listing is the DNS-rebinding control; the scheme is not.

This slice does not run a reverse proxy, generate a Caddyfile, open a Cloudflare/Tailscale tunnel, or replace Basic Auth with a login cookie.

## Goals

- New Settings nav item, always enabled (global, no project required).
- Persist allowed hostnames and a password hash next to pi's agent data.
- Environment variables override the file for password, and contribute extra hostnames.
- Require a password whenever any file-configured hostname is present.
- Never echo the password or hash to the browser.
- Compare `Origin` to `Host` by host (and port), ignoring scheme, so HTTPS proxies work.
- English and Chinese copy stay in sync.
- README documents the Settings path and keeps the env table.

## Non-goals

- Do not expose bind address (`0.0.0.0`) in Settings. Reverse proxy talks to `127.0.0.1`.
- Do not change the CLI rule that a non-loopback bind still requires `PI_WEB_PASSWORD` in the environment.
- Do not add a login page, session cookie, CSRF token for Basic Auth, or multi-user accounts.
- Do not generate or apply Caddy/nginx snippets (help text only).
- Do not trust `X-Forwarded-For` / `X-Forwarded-Host` for allow-listing or auth.
- Do not allow wildcard hostnames (`*.example.com`).
- Do not rewrite the SSE `connected` handshake ([#492](https://github.com/agegr/pi-web/issues/492) stays out of scope). Help text tells operators to disable proxy buffering.

## Approaches considered

1. **Settings over the existing Host allow-list + Basic Auth (chosen).** Smallest change that matches the request: existing proxy, fill in the domain, keep password protection.
2. **Login page + HttpOnly session cookie.** Better remote UX and logout; larger auth surface (CSRF, cookie flags, session store). Deferred.
3. **Same as (1) plus copy-paste Caddy/nginx snippets.** Declined for this slice; a short help paragraph is enough.

## Architecture

```
Browser Settings
  RemoteAccessConfig
        │
        ▼
GET/PUT /api/remote-access
        │
        ▼
lib/remote-access-config.ts     file parse/serialize, hostname rules, scrypt
lib/web-auth.ts                 env plaintext OR file hash
lib/request-security.ts         Host allow-list + Origin host match
src/request-security.ts         middleware (unchanged call shape)
        │
        ▼
{agentDir}/pi-web.json          0600, passwordHash only
```

`getAgentDir()` is the same directory as `models.json` (`~/.pi/agent` unless `PI_CODING_AGENT_DIR` is set). File name: `pi-web.json`.

Runtime resolution:

| Input | Password used for Basic Auth | Hostnames allowed in addition to loopback / IP literals / `PI_WEB_HOSTNAME` |
|---|---|---|
| File only | scrypt verify against `passwordHash` | `allowedHosts` from the file |
| `PI_WEB_PASSWORD` set | env plaintext (file hash ignored) | file hosts ∪ env `PI_WEB_ALLOWED_HOSTS` |
| `PI_WEB_ALLOWED_HOSTS` set, no env password | file hash if present | file hosts ∪ env hosts |
| Neither | auth off | file hosts rejected on write if non-empty; runtime file hosts still require a password source |

`bin/pi-web.js` continues to inspect only `PI_WEB_PASSWORD` when deciding whether a non-loopback bind is allowed. This feature assumes loopback + reverse proxy.

## Persistence

Canonical file: `{getAgentDir()}/pi-web.json`.

```json
{
  "schemaVersion": 1,
  "allowedHosts": ["pi.example.com"],
  "passwordHash": "scrypt$16384$8$1$<saltB64>$<hashB64>"
}
```

Rules:

- Create the agent dir as `0700` if missing; write the file with `writePrivateFileAtomicSync` (`0600`).
- Unknown JSON keys are preserved on write so a hand-edited file is not flattened.
- `passwordHash` omitted or empty means no file password.
- GET snapshots never include `passwordHash` or any password field.
- Corrupt JSON: runtime treat as no file hosts and no file password (fail closed for extra hosts). GET still succeeds and sets `configError` so Settings can overwrite the file.
- Cache parsed hosts and the hash record in memory; invalidate on successful PUT and when mtime/inode changes.

Password hashing: Node `crypto.scrypt` with `N=16384`, `r=8`, `p=1`, 16-byte random salt, 32-byte key. Do not add argon2 or another dependency.

Basic Auth hits every API call (sidebar poll, SSE). scrypt on every request is too slow. Keep an in-memory map from `sha256(passwordUtf8) + passwordHashRecord` to a boolean; invalidate when the hash record changes. Env-password verification stays the existing timing-safe SHA-256 compare of plaintext (no scrypt). Failed guesses still pay scrypt once per unique password until the hash record changes.

## Hostname rules

Settings stores **exact DNS hostnames**, not URLs.

Accept:

- `pi.example.com`
- IDN that `url.domainToASCII` can convert; store the ASCII form
- Names already passing `hostnameFromAuthority` in `lib/request-security.ts` (no userinfo, path, query, or hash)

Reject with `400` and the offending value:

- Empty / whitespace-only
- Scheme (`https://…`)
- Path, query, or fragment
- Port (`pi.example.com:443`)
- Wildcard (`*.example.com`, `*`)
- IP literals (IPv4/IPv6). Those already pass `isApiRequestHostAllowed` globally; this field is for domains.
- More than 253 characters after ASCII conversion

Deduplicate case-insensitively after normalize. Runtime Host check stays exact-string on the normalized hostname (existing helper).

## Password rules

- Username remains `pi`. Settings shows it; it is not editable.
- Minimum 12 characters, maximum 256. No extra complexity class.
- PUT `password` omitted: leave the stored hash unchanged.
- PUT `password` non-empty string: replace the hash.
- PUT `password: null`: clear the file hash. Allowed only when **all** of:
  1. Request `Host` is loopback (`localhost`, `*.localhost`, `127.0.0.1`, `::1`).
  2. After the write, `allowedHosts` is empty **or** `PI_WEB_PASSWORD` is set.
- Saving a non-empty `allowedHosts` requires an effective password: new `password` in the body, or an existing file hash (and not clearing it), or `PI_WEB_PASSWORD` in the environment.
- Clearing the last hostname does not require clearing the password.
- Empty-string `password` is invalid (`password_invalid`), not “keep”.

A non-loopback client cannot turn auth off. Loopback can, and only when no file hosts remain (unless env still supplies a password).

## Request security changes

Keep the existing Host allow-list (loopback, IP literals, configured names). Configured names become **env ∪ file**, not env alone.

Change `isApiRequestOriginAllowed` so that when `Origin` is present and `sec-fetch-site` is not `cross-site`, compare `new URL(origin).host` to the request `Host` header after the same hostname normalization used today. Ignore URL scheme. Invalid `Origin` (including `null`) still fails.

This makes the Azure Dev Tunnels / HTTPS proxy case in #497 pass without trusting `X-Forwarded-*` for identity. DNS rebinding stays blocked because `Host` must still be loopback, an IP literal, or an operator-configured name.

`src/request-security.ts` keeps calling `isWebPasswordEnabled` / `isValidBasicAuthorization`. Those functions grow a file-hash path when env is unset. Middleware must not read the password from the request body or log Authorization.

## UI

Visual register: existing settings tokens (`--bg`, `--bg-panel`, `--border`, `--text`, `--text-muted`, `--accent`). Same `settings-form-page` / `settings-form-section` patterns as General.

### Nav

Insert **远程访问 / Remote access** after General. Icon: `GlobeLock`. Enabled even when `cwd` is null.

### Main column

1. Warning banner: exposing Pi Web through a proxy exposes an agent that can run tools on this machine. TLS belongs on the proxy. Pi Web still listens on loopback.
2. **Listen address** (read-only): current `PI_WEB_HOSTNAME` / default `127.0.0.1` and port. Not editable.
3. **Allowed hostnames**: chip list + text field + add. Helper: enter `pi.example.com`, not a URL. Env-provided hosts render as read-only chips labeled as coming from `PI_WEB_ALLOWED_HOSTS`.
4. **Password**: username shown as `pi`. If unset: password + confirm. If file-configured: status 已设置 / Password set, plus change fields (empty = keep). If `PI_WEB_PASSWORD` is set: banner that the environment variable currently authenticates and the file hash is unused until the env var is removed. File password set/change remains available as a fallback stored in `pi-web.json`; do not disable those fields.
5. **保存设置 / Save** (primary) + **重新加载 / Reload** (outline), same pill pattern as Vision.
6. Short help: point the reverse proxy at `http://127.0.0.1:<port>`, preserve `Host`, terminate HTTPS at the proxy, disable response buffering so SSE stays live. No full Caddyfile.

Dirty drafts use the existing Settings discard dialog (same path as Models and Vision). Reload discards the draft and re-GETs.

After the first save that **enables** a password, the next request will 401 until the browser Basic Auth prompt is filled with `pi` and that password. The success message must say so.

### States

| State | User sees |
|---|---|
| Loading | Content pane loading copy |
| Empty file | No host chips, password unset. Save allowed for password-only. Save with hostnames requires an effective password (body, file hash, or env). |
| File configured | Host chips, password status 已设置 |
| Env password | Env-wins banner; host list still editable |
| Env hosts | Extra read-only chips |
| Validation error | Red alert, focus stays on the field |
| Save success | 设置已保存并立即生效, plus Basic Auth hint when a password was just enabled |
| Save error | Red alert with server `error` string (no hash, no password) |
| Corrupt file | `configError` banner; Save overwrites the file |
| Unsaved navigate / close | Existing discard dialog |

Mobile: single column, 44px targets, no horizontal overflow at 390×844 or 320×568.

## API

Mutating routes require `isApiRequestAllowed` + JSON content type, same as `/api/models-config` and `/api/vision-toolkit`.

### `GET /api/remote-access`

```ts
{
  schemaVersion: 1
  configPath: string
  bindHostname: string
  bindPort: string
  allowedHosts: string[]          // from file only
  envAllowedHosts: string[]       // from PI_WEB_ALLOWED_HOSTS, read-only
  passwordConfigured: boolean     // env or file
  passwordSource?: "file" | "env" // which source authenticates right now
  username: "pi"
  configError?: string
}
```

Never `password`, never `passwordHash`.

### `PUT /api/remote-access`

Body:

```ts
{
  allowedHosts: string[]
  password?: string | null        // omit = keep, string = set, null = clear
}
```

Writes `pi-web.json`, invalidates the in-memory cache, returns the same snapshot shape as GET.

| Condition | Status | `code` |
|---|---|---|
| Invalid hostname | 400 | `invalid_hostname` |
| Hosts non-empty and no effective password | 400 | `password_required` |
| Password shorter than 12, longer than 256, or empty string | 400 | `password_invalid` |
| Confirm mismatch is client-only; server sees a single `password` | — | — |
| Clear password from non-loopback Host | 403 | `cannot_disable_password_remotely` |
| Clear password while file hosts remain and no env password | 400 | `password_required` |
| Non-JSON content type | 415 | same as other routes |

PUT is allowed from localhost without a password when none is configured yet (bootstrap). After a password exists, the global Basic Auth middleware already 401s unauthenticated callers.

## i18n

New `remote.*` keys in `lib/i18n/messages/en.ts` and `zh-CN.ts`. Nav: 远程访问 / Remote access.

## README

Add a Settings paragraph above the env table in `README.md` and `README.zh-CN.md`:

- Open Settings → Remote access on `http://127.0.0.1:30141` first.
- Add the public hostname and a password, then point the reverse proxy at loopback.
- Env vars still override / extend as documented.

Do not remove the CLI / env table.

## Testing

Node tests (existing runner, no new framework):

- Hostname accept / reject matrix (URL, wildcard, IP, port, IDN).
- File serialize preserves unknown keys; GET snapshot has no `password` / `passwordHash`.
- scrypt verify accepts the original password and rejects a wrong one; env password wins over file hash.
- Host allow-list unions file + env; unlisted public hostname still 403.
- Origin `http://` + matching Host is allowed even when the request URL is `https://` (the #497 shape).
- Origin host mismatch still rejected; `sec-fetch-site: cross-site` still rejected.
- PUT `password: null` from a non-loopback Host is 403; from loopback with remaining hosts and no env password is 400; from loopback with empty hosts succeeds.
- Write mode is `0600`.
- i18n key sets stay equal.
- Route inventory and `API_ROUTE_METHODS` include `GET`/`PUT` `/api/remote-access`.

Do not run `npm run build` or `npm run pack:tanstack` during implementation.

## Acceptance

1. Settings nav shows 远程访问 / Remote access and opens without a project.
2. Bind address is visible and not editable.
3. Saving `pi.example.com` plus a 12+ character password writes `{agentDir}/pi-web.json` as `0600`; GET never contains the password or hash.
4. `Host: pi.example.com` is accepted after save; `Host: attacker.example` remains 403.
5. Unauthenticated requests 401 with the existing `WWW-Authenticate` header once a password is configured (env or file).
6. `PI_WEB_PASSWORD` authenticates even if a different hash is in the file; Settings shows the env-wins banner.
7. HTTPS proxy scheme mismatch (#497) no longer 403s when Host and Origin hosts match.
8. A remote client cannot clear the password.
9. Unsaved changes go through the existing discard dialog.
10. en / zh-CN keys stay synchronized.
11. Focused tests, TypeScript, lint, `git diff --check`, and route-inventory tests pass.

## Files

Create:

- `lib/remote-access-config.ts` + `lib/remote-access-config.test.mjs`
- `app/api/remote-access/route.ts` + `app/api/remote-access/route.test.mjs`
- `src/routes/api/remote-access.ts`
- `components/RemoteAccessConfig.tsx` + `components/RemoteAccessConfig.test.mjs`
- `lib/i18n/messages/remote-i18n.test.mjs`

Modify:

- `lib/web-auth.ts` + `lib/web-auth.test.mjs` — file-hash verify + env precedence
- `lib/request-security.ts` + `lib/request-security.test.mjs` — file hosts + Origin host match
- `src/request-security.ts` — use no-arg password lookup so file hashes apply
- `lib/tanstack-request-security.test.mjs` — isolate agent dir; #497 case
- `components/SettingsPage.tsx` + `components/SettingsPage.test.mjs`
- `app/globals.css` — remote settings layout if existing form classes are not enough
- `lib/i18n/messages/en.ts`, `zh-CN.ts`
- `src/api-methods.ts`
- `lib/tanstack-route-inventory.test.mjs`
- `src/routeTree.gen.ts`
- `README.md`, `README.zh-CN.md`

## Open questions

None. Defaults above are locked: loopback + existing reverse proxy, Settings file + env override, Basic Auth, Origin compared by host, no tunnel/SSE handshake work in this slice.
