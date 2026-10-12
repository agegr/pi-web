# Optional external web skins (prototype)

An opt-in, web-only loading point proposed in [#1204](https://github.com/agegr/pi-web/issues/1204). The format and integration are **not yet agreed with upstream**. This is not the pi CLI JSON theme format or a new executable extension API.

## Enable and remove

1. Choose an absolute directory outside Pi Web's installed files.
2. Put each pack in a child directory with a lowercase slug, for example `paper-dusk/skin.json` and optionally `paper-dusk/cover.png`.
3. Start Pi Web with `PI_WEB_SKINS_DIR` pointing at that directory.
4. Select a pack using the small bottom-right button; its panel opens upward and avoids the composer. Selecting **None** restores the selected built-in appearance. Missing/invalid packs fall back to the built-in appearance.

```sh
PI_WEB_SKINS_DIR="$HOME/.pi/web-skins" pi-web --no-open
```

For this source prototype, use the same variable with `npm run dev`. Nothing is installed automatically. There is no package manager, marketplace, upload endpoint, server-side preference write or folder watcher. Copy/replace a pack yourself and reload or focus the page to refresh the catalog.

Without a configured root or a valid pack, no skin control appears. The client makes a small catalog GET; an unconfigured server returns an empty list **without filesystem reads**. Catalogs contain declarations only: no background-image reads or requests until selection. This does not claim zero extra HTTP requests or zero JavaScript bytes in the default app.

## Manifest version 1

`skin.json` has `version: 1`, a plain display `name`, and complete `light` and `dark` color maps. Both maps contain exactly these 15 tokens:

```text
bg bg-panel bg-hover bg-selected border text text-muted text-dim
accent accent-hover accent-contrast user-bg assistant-bg tool-bg bg-subtle
```

Every color must be six-digit RGB hex (`#rrggbb`). No CSS expressions, variables, fonts, layout properties, scripts or HTML. Unknown manifest fields and extra/missing color tokens are rejected.

An optional declaration looks like this:

```json
"background": { "file": "cover.png", "opacity": 0.12 }
```

It is a **basename**, not a path or URL. Only local PNG is accepted, with opacity 0–0.25, at most 4 MiB, axes at most 4096 pixels and at most 16 million pixels. The server checks the PNG header and the browser must successfully decode the image before applying the skin. SVG, remote resources, symlinks and special files are refused. The backend revalidates the current manifest on every image request and serves only that manifest's declared asset, with PNG/nosniff/sandbox headers.

Manifests are at most 32 KiB. Discovery examines at most 256 directory entries and returns at most 100 valid packs. It skips malformed packs without leaking filesystem paths. Folder containment uses the project's existing path-security helper, not the general file-browser allow list.

Selection uses a separate browser key, `pi-web:external-skin`. It never rewrites `pi-theme`, sessions, models or credentials. The existing resolved light/dark/system mode chooses the palette; skin colors do not replace builtin theme IDs. Disabling restores earlier inline values and leaves font settings untouched.

## Deliberate limits

- Palette application waits for the catalog and optional image decode. A selected skin can appear after the first native paint on refresh; this prototype does not promise flash-free skin restoration.
- Authors remain responsible for contrast and for permission to redistribute their images. There is no automatic contrast adjustment. Upstream fixtures must use original/cleared artwork; no album covers are supplied here.
- A skin-storage-key error falls back to an in-memory choice. Fully inaccessible `localStorage` exposes an existing unrelated `useAudio` issue in the host app; this change does not fix or claim to cover that app-wide case.
- Desktop viewport tests are not a real phone software-keyboard test. The control accounts for `visualViewport`, but device acceptance is still needed.
- Daily shuffle, alternate layouts, arbitrary CSS/JS, installable npm resources and Settings integration are not part of this first isolated prototype. They require an upstream scope decision.

## Verification

```sh
node --experimental-strip-types --test lib/web-skin.test.mjs lib/web-skin-files.test.mjs lib/theme.test.mjs
npm test
node_modules/.bin/tsc --noEmit
npm run lint
# This starts/stops its own isolated dev server. Stop dev in this checkout first.
E2E_BROWSER_CHANNEL=chrome node e2e/web-skins.mjs
```

The E2E test uses fresh browser profiles, fake home/agent directories and synthetic non-skin API responses. Only the skin catalog/images reach the test server; it calls no model and uses an original generated raster fixture. Google-font CSS is mocked offline. Artifacts are under ignored `test-results/web-skins/`. Do not run `next build` during development.
