# pi-web mobile shells

Capacitor Android and iOS shells that host your **self-hosted** pi-web
instance, with native camera/gallery image attachment, native file
selection for uploads, local notifications, and proper keyboard/safe-area
behavior. This closes pi#26 at the root: inside the shells, attaching files
goes through the official native plugins instead of a WebView file chooser.

**This app ships no server.** It connects to a pi-web server you run and
host yourself (for example `npm run dev` in your pi-web checkout, or any
deployed instance — reachable from the phone). The pi-web Next.js app
itself is never bundled, modified, or included here; the web app also
carries **zero Capacitor npm dependencies** (the bridge is injected into
the remote page at runtime — see `docs/spike-remote-bridge.md`).

## Layout

```
mobile/
  capacitor.config.ts     shell config (appId, hostname, errorPath, plugins)
  src/pages/               bundled local pages (doubles as the Capacitor webDir)
    settings.html          server-URL entry (hosted natively, never by the server)
    connection-error.html  shown when no URL is stored or the server is unreachable
    shared.css, index.html
  android/                 generated + customized Capacitor Android project
  ios/                     generated + customized Capacitor iOS project
  docs/spike-remote-bridge.md  the verified basis for the injection design
```

## How the settings/load/error flow works

1. **No server URL stored yet** — the native settings host opens
   immediately (Android: `SettingsActivity` with a minimal
   `window.piwebSettings` JS interface, mirroring the Electron desktop
   shell's preload seam; iOS: the main webview loads `settings.html`
   directly).
2. **URL saved** — it is persisted to the exact store the official
   `@capacitor/preferences` plugin uses (Android
   `SharedPreferences("CapacitorStorage")`, iOS
   `UserDefaults "CapacitorStorage.piweb.serverUrl"`), then the shell
   restarts its bridge (Android: `Activity.recreate()`; iOS: the root view
   controller is replaced) so the remote page gets the Capacitor runtime.
3. **Server unreachable / misconfigured** — Capacitor's built-in
   `server.errorPath` swaps the main frame to the bundled
   `connection-error.html`. Its **Server settings…** action reopens the
   settings host (Android: through the internal `piweb-shell://` scheme
   intercepted in `PiWebWebViewClient`; iOS: plain in-webview navigation
   via the injected `WEBVIEW_SERVER_URL`). Settings therefore stay
   editable while the server is down.

Why the native settings host exists at all: Capacitor's runtime injection is
**origin-gated** on Android, so bundled local pages lose the injected
runtime once a server URL is active. Verified against the shipped
dependency sources — details and costs in `docs/spike-remote-bridge.md`.

## Dev workflow

```bash
# 1. In your pi-web checkout: start the dev server (LAN-reachable)
npm run dev:lan          # binds 0.0.0.0:30141

# 2. In this directory
npm install

# 3. Generate/sync the platform projects (first time only: cap add)
npx cap sync

# 4. Build & install (Android)
cd android && ./gradlew assembleDebug
# → android/app/build/outputs/apk/debug/app-debug.apk (sideload it)
adb install -r app/build/outputs/apk/debug/app-debug.apk

# 4. Build & run (iOS, needs macOS + Xcode + CocoaPods)
npx cap open ios         # Xcode: pick a device, Run
# CLI archive/TestFlight:
cd ios/App
pod install
xcodebuild -workspace App.xcworkspace -scheme App -sdk iphoneos \
  -configuration Release archive -archivePath build/App.xcarchive
xcodebuild -exportArchive -archivePath build/App.xcarchive \
  -exportOptionsPlist <(printf '<?xml version="1.0"?><plist version="1.0"><dict><key>method</key><string>ad-hoc</string></dict></plist>') \
  -exportPath build/export
```

On first launch the app asks for your server URL
(e.g. `https://192.168.1.20:30141`) before anything else loads.

### Build-time conveniences (optional, never required)

- `PI_WEB_SERVER_URL=…` — seeds the default URL offered on the settings
  page's first run (Android `BuildConfig.PIWEB_DEFAULT_SERVER_URL`; on iOS
  just type it once — the value is persisted after that).
- `PI_WEB_ALLOW_CLEARTEXT=1` — **debug-only** opt-in that permits plain
  `http://` server URLs:
  - Android: flips the `android:usesCleartextTraffic` manifest placeholder
    (default builds keep it `false`) and the settings page starts accepting
    `http://` URLs.
  - iOS: ATS is default-ON; the equivalent opt-in is a build-time
    `Info.plist` edit (`NSAppTransportSecurity` →
    `NSAllowsArbitraryLoads: true`). The settings page reads that state and
    refuses `http://` otherwise.

Default builds are secure: HTTPS only, Android
`usesCleartextTraffic=false`, iOS ATS untouched.

## Security

- The WebView only ever loads the stored server URL and the bundled local
  pages; external links open in the system browser (Capacitor's default
  navigation handling).
- Cleartext is refused by default (see above).
- The settings page runs in a hardened host: on Android it is a dedicated
  activity whose WebView has file/network access from `file://` disabled
  and exposes exactly four JS methods (`load`, `defaultUrl`,
  `allowCleartext`, `save`); on iOS it talks to the shell through a single
  named `WKScriptMessageHandler`.
- Camera/photo-library access is runtime-prompted by the plugins with the
  usage strings declared in the platform manifests (`NSCameraUsageDescription`,
  `NSPhotoLibraryUsageDescription`, `NSPhotoLibraryAddUsageDescription`,
  Android `CAMERA` / `READ_MEDIA_IMAGES` / legacy `READ_EXTERNAL_STORAGE`).

## Plugins

| Plugin | Role | Provenance |
|---|---|---|
| `@capacitor/camera` | camera capture in the attach flow (`getPhoto`, base64) | official (MIT) |
| `@capawesome/capacitor-file-picker` | document/file multi-pick for uploads + gallery multi-pick for attach | **community** (capawesome.io, MIT, widely used) |
| `@capacitor/local-notifications` | background-task/session completion notifications (WKWebView has no Notification API) | official (MIT) |
| `@capacitor/keyboard` | keyboard `resize: native` | official (MIT) |
| `@capacitor/preferences` | settings persistence from the local settings page (iOS) | official (MIT) |
| `@capacitor/app` | app lifecycle events | official (MIT) |

**Documented limitation (scoped, from the spike)**: picked file bytes cross
the bridge base64-encoded (`readData: true`), because the Camera plugin's
gallery results only expose `webPath`s on the shell's local origin, which the
remote page cannot fetch (no CORS headers), and the web app carries zero
Capacitor dependencies so nothing else can read them. Consequence: very
large uploads/pay loads carry a native-memory and latency overhead in the
shells. Browser/PWA behavior is untouched.

## Keyboard & safe areas

- Android: `windowSoftInputMode="adjustResize"` (MainActivity) + the web
  app's existing `interactiveWidget: resizes-content` and
  `useViewportHeight` behavior.
- iOS: Keyboard plugin `resize: native` (configured in
  `capacitor.config.ts`).
- Safe-area insets: the web app's safe-area CSS scenario (pi#1), previously
  scoped to `display-mode: standalone`, now also applies to the
  `capacitor-shell` class that runtime bridge detection adds — the shell
  WebView reports `display-mode: browser`.
- The PWA remains the zero-install fallback: nothing in the web app changes
  when the Capacitor bridge is absent.

## Min OS versions

Capacitor 7 defaults, kept deliberately: Android API 23+ / iOS 14+.

## Build artifacts and repo hygiene

All Capacitor dependencies live in `mobile/package.json` only — the web
app's root `package.json` gains nothing. Because the shells load the remote
server, nothing from the web app (`www/`, `.next/`, `node_modules/`) is
copied into platform builds: the only bundled web assets are the local
pages under `src/pages/` (via the Capacitor webDir). Build outputs
(`android/app/build`, `.gradle`, `ios/App/Pods`, `build/`, the synced
`assets/public` and `ios/App/App/public`) are gitignored.
