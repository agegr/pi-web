# Task 3 Report

## Status

Implemented request protection and page authentication gating.

## Changes

- `proxy.ts` now protects pages, business APIs, and SSE endpoints with cookie-only session validation.
- `/login`, `/setup`, `/api/auth/*`, Next static/image assets, and favicon remain public.
- Unauthenticated pages redirect to `/login` or `/setup`; the two entry URLs rewrite to the existing root page so `AuthGate` can render without adding duplicate pages.
- Unauthenticated API and SSE requests return JSON `401`.
- Existing Origin/Fetch Metadata CSRF rejection remains active for API requests and takes precedence over authentication.
- `AuthGate` fetches `/api/auth/status`, keeps `AppShell` unmounted until authenticated, and provides minimal setup/login forms.
- Added request-security coverage for public paths, page/API/SSE rejection, valid cookie access, and cross-site rejection.

## Verification

- `node --test lib/request-security.test.mjs lib/pi-web-auth.test.mjs`: PASS, 42 tests.
- `node_modules/.bin/tsc --noEmit`: BLOCKED because this checkout has no `node_modules/.bin/tsc`.
- `git diff --check`: PASS.

## Concerns

- TypeScript verification must be rerun in an environment with the project dependencies installed. No package installation was performed.
- Node test output emits existing `MODULE_TYPELESS_PACKAGE_JSON` warnings for the TypeScript test imports; tests still pass.

## Reviewer Follow-up

### Status

Fixed the Task 3 Critical/Important request-protection findings.

### Root Cause

`lib/request-security.ts` classified the entire `/api/auth/` prefix as public. That made API-key, provider, logout, and password-management endpoints bypass the Pi Web session check. Because the public-path branch ran before the API Origin/Fetch Metadata check, cross-site requests to public auth APIs also bypassed CSRF protection.

### Changes

- Public Pi Web auth paths are now limited to `/api/auth/status`, `/api/auth/setup`, `/api/auth/login`, and the existing Pi provider OAuth/device-code route `/api/auth/login/[provider]`.
- `/api/auth/api-key/*`, `/api/auth/providers`, `/api/auth/all-providers`, `/api/auth/logout*`, `/api/auth/password`, and other auth management paths require a valid `pi_web_session`.
- API Origin/Fetch Metadata CSRF checks now run before public auth-path routing, so cross-site auth status/login/setup/OAuth requests return `403`.
- Updated `FormEvent` to a type-only React import without expanding UI scope.

### TDD Evidence

- RED: new request-security tests failed with management APIs classified as `public` and cross-site public auth requests classified as `public`.
- GREEN: the same tests pass after the minimal request-security change.

### Verification

- `node --test lib/request-security.test.mjs lib/pi-web-auth.test.mjs`: PASS, 44 tests.
- `git diff --check`: PASS.
- `node_modules/.bin/tsc --noEmit`: BLOCKED because this checkout has no `node_modules/.bin/tsc`.

### Concerns

- TypeScript verification still requires an environment with project dependencies installed; no package installation was performed.
- Node test output emits existing `MODULE_TYPELESS_PACKAGE_JSON` warnings for TypeScript test imports; tests still pass.
