# Windows desktop launcher design

## Goal

Provide a small, source-checkout-oriented Windows workflow that starts Pi Web from the repository, opens the local page, and can be launched from a Desktop shortcut. Document it in English and Simplified Chinese.

## Scope

- Add `scripts/windows/Start-PiWeb.ps1` to start `npm.cmd run dev` only when port `30141` is not already listening, wait for readiness, then open `http://127.0.0.1:30141`.
- Add `scripts/windows/Install-PiWebDesktopLauncher.ps1` to create or update a Desktop shortcut that runs the starter script.
- Add `scripts/windows/assets/pi-web.ico`, generated from the Pi Logo SVG supplied for this contribution, and assign it to the Desktop shortcut.
- Add matching English and Simplified Chinese README guidance, including a manual update procedure for a Git checkout.

## Out of scope

- No Windows service, scheduled task, or login auto-start.
- No automatic `git pull`, dependency installation, or mutation of the user’s Pi data directory.
- No changes to Pi Web runtime behavior, API routes, or model configuration.

## Behavior and safeguards

The scripts derive the repository root from their own location, so a cloned repository can be moved without editing hard-coded paths. The starter does not set `PI_CODING_AGENT_DIR`; Pi therefore follows its documented default, unless the user has independently configured that environment variable. It reuses an existing server on port `30141` instead of starting a duplicate.

The installer is idempotent: rerunning it updates the same Desktop shortcut and its Pi Logo icon. It uses `-ExecutionPolicy Bypass` only for the shortcut’s one PowerShell process and does not change the computer-wide policy.

README update guidance uses `git pull --ff-only` so local divergent commits are not merged implicitly. Users run `npm install` only after an update changes dependencies.

## Verification

- Run the installer twice and confirm one Desktop shortcut exists.
- Run the shortcut with Pi Web stopped and confirm the server becomes reachable at `127.0.0.1:30141`.
- Run it again while the server is already running and confirm no second listener is created.
- Run TypeScript and lint checks; scripts are documented and independent of the application bundle.
