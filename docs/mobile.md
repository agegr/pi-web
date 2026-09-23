# Mobile strategy: Android TWA, iOS PWA (pi#40)

Pi Web is a self-hosted web app, so the mobile story is deliberately thin:
**no bundled server, no custom native UI, no proxying, no script injection**.
Both platforms wrap the same deployed HTTPS origin you already run.

| Platform | Primary form | Install path | Zero-install fallback |
|---|---|---|---|
| Android | **TWA APK** (`mobile-twa/`) — fullscreen, no address bar, zero Google dependency | Side-load the APK from the file browser | PWA (Chrome → Install app) |
| iOS | **PWA** — Safari Add-to-Home-Screen is the native standalone form | Safari → Share → Add to Home Screen | — (same thing) |

The previous hybrid native shells (removed in pi#40) wrapped the site in a
WebView whose remote-content proxy caused the entire 7-fix failure chain of
PRs #34–42. The TWA shell contains ~100 lines with no WebView code of ours —
the page renders in the browser's own renderer, exactly as it does in a
desktop tab.

## Android: build and side-load the TWA APK

The Trusted Web Activity shell lives in [`mobile-twa/`](../mobile-twa/). A TWA
is just a launcher: it opens your origin through androidx.browser Custom Tabs.
Because the site serves a matching `/.well-known/assetlinks.json`, the browser
verifies the Digital Asset Link and opens **fullscreen with no address bar**.
Verification needs no Google account and no Google Play Services — the
assetlinks file comes from *our own server*.

Build (JDK 17+, Android SDK 34):

```bash
cd mobile-twa
./gradlew assembleRelease        # APK: app/build/outputs/apk/release/app-release.apk
```

- **Launch URL**: driven by the `PIWEB_TWA_LAUNCH_URL` gradle property
  (default `https://gcp-dev.stevenforai.top`). Retarget per build with
  `-PPIWEB_TWA_LAUNCH_URL=https://your-origin` — no code change.
- **Signing**: the release keystore is committed under `mobile-twa/keystore/`
  (private repo, side-loaded app). To regenerate it per machine, see
  `mobile-twa/keystore/README.md`.
- **After any re-sign**: regenerate the served statement so the fingerprint
  matches the APK:

  ```bash
  mobile-twa/scripts/assetlinks.sh app/build/outputs/apk/release/app-release.apk
  git add public/.well-known/assetlinks.json   # commit the new fingerprint
  ```

**Side-load** (works on GMS-free devices, e.g. Redmi/HyperOS): copy the APK to
the phone, open it from the file browser, allow "install unknown apps" for
that one tap, install. The home icon launches the verified fullscreen TWA.

**If the address bar shows**, the served assetlinks statement does not match
the installed APK — rerun `scripts/assetlinks.sh` against the APK you actually
installed, redeploy the site, and relaunch.

### Why assetlinks is served without the password gate

The browser's TWA verification fetches `/.well-known/assetlinks.json`
unauthenticated. The web-password middleware (`proxy.ts`) matches only
`["/", "/login", "/api/:path*"]`, so the well-known path is already exempt —
no matcher change is needed, and `next.config.ts` adds
`Cache-Control: public, max-age=0, must-revalidate` so Chrome re-verifies
right after an APK re-sign.

## iOS: Add to Home Screen (the PWA is the native form)

iOS has no TWA; Safari's Add-to-Home-Screen *is* the standalone native form.
The required metadata is in place and verified in the app code:

- `app/manifest.ts`: `display: "standalone"`, 192/512 PNG icons
- `app/layout.tsx`: `apple-touch-icon` and `appleWebApp { capable: true, title,
  statusBarStyle: "black-translucent" }`

Install: open the site in **Safari** (not Chrome — only Safari can install),
tap **Share → Add to Home Screen**. The icon launches fullscreen, standalone,
with safe-area-correct layout. Web Push works on iOS 16.4+ once you grant the
notification permission (see below).

## China reachability — honest notes

- **TWA needs no VPN.** Launch, fullscreen display, and assetlinks
  verification all talk to *your own server*; no Google endpoint is involved.
- **iOS Web Push needs no VPN.** Push rides Apple's APNs, which is reachable
  from mainland China.
- **Android closed-app Web Push needs FCM — and in mainland China FCM needs a
  VPN.** Chrome on Android delivers Web Push only through Google's FCM
  endpoints. There is no China-reachable push relay in this repo; that would
  be a separate work item.

## Notification capability matrix

| Capability | Android (browser/PWA) | Android TWA | iOS PWA (16.4+) |
|---|---|---|---|
| In-page notifications (page focused) | ✅ | ✅ | ✅ |
| Service-worker notifications while the app is alive in the background | ✅ | ✅ | ✅ |
| Closed-app **Web Push** (agent finishes while no tab/window is open) | ✅ via FCM — **VPN required in mainland China** | ✅ via FCM — **VPN required in mainland China** | ✅ via APNs — works in China, no VPN |
| Background Android push **without** VPN | ❌ not promised | ❌ not promised | n/a |

What this means practically: keep the Pi Web tab (or an installed PWA/TWA
window) alive and notifications arrive everywhere, no VPN anywhere. If you
close the app entirely, iOS still delivers through APNs, but Android needs
FCM reachability, i.e. a VPN in mainland China.
