---
name: verify
description: Launch Pi Web and exercise network proxy settings through its HTTP API.
---

# Verify Pi Web

1. Install dependencies with `npm ci` if `node_modules` is absent.
2. Start the real app with `npm run dev` from the repository root; it listens on `http://127.0.0.1:30141`.
3. Confirm the UI renders with `curl http://127.0.0.1:30141/`.
4. Exercise proxy settings through the public server surface:
   - `GET /api/network-config`
   - `PUT /api/network-config` with JSON proxy settings
   - repeat GET to confirm persistence/effective source
   - `PUT` with `{ "action": "clear" }` to restore automatic settings
   - `POST /api/network-config/test` with an allowlisted target
5. Probe malformed content types and unknown target values and inspect their JSON errors.
6. Stop the background dev server when finished.

On Windows, the GET response should include the current user's detected WinINET fixed proxy/PAC/WPAD fields. PAC/WPAD are diagnostic only.
