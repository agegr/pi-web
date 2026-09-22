# Spike — remote-page bridge injection (pi#31 step 2)

Status: **layout verified against the shipped Capacitor sources; runtime
device pass NOT executed in this environment** (no Android SDK, emulator, or
iOS device was available when this step ran — see "What was not verified").
The findings below drove the final shell layout; every dependent step was
implemented against them. A real-device pass remains part of the work item's
acceptance criteria and must be run on hardware before release.

## The load-bearing assumption under test

> The whole layout depends on the Capacitor runtime (and the plugin JS
> surface) being present inside the **remote** pi-web page, which is served
> from the user's own server — not from any asset bundled with the app.

## What was verified, and how

All findings below were read directly from the installed dependency sources
(`mobile/node_modules`), not from documentation:

| # | Finding | Evidence |
|---|---------|----------|
| 1 | Capacitor 7's Android injection is **origin-gated**: `Bridge.loadWebView()` registers the runtime via `WebViewCompat.addDocumentStartJavaScript(..., Collections.singleton(allowedOrigin))`, where `allowedOrigin` is the origin of the configured `appUrl`. With `server.url` unset the gate is the *local* origin only, so a remotely loaded page gets **no** `window.Capacitor`. | `@capacitor/android` 7.6.9, `Bridge.java` (`loadWebView`, `initWebView`) |
| 2 | With `server.url` set (remote mode), `localUrl = appUrl = server.url`, so the document-start gate matches the remote server — this is the only supported way to get the runtime into the remote page. `server.allowNavigation` is **not** sufficient: it only widens the `androidBridge` WebMessageListener origins (`setAllowedOriginRules`), not the runtime injection. | `Bridge.java` (`initWebView`, `setAllowedOriginRules`) |
| 3 | The runtime JS includes `window.Capacitor.PluginHeaders` (the native plugin method tables), but `Capacitor.Plugins.X` only exists **after** `registerPlugin("X", …)` ran. There is no legacy lazy proxy in Capacitor 7. Consequence for the dependency-free web app: `lib/capacitor-bridge.ts` materializes each plugin proxy through the public `Capacitor.registerPlugin(name, {})`; methods listed in the native header route straight to native. | `@capacitor/core` `dist/index.js` (`createCapacitor`, `registerPlugin`), `@capacitor/android` `JSExport.java` |
| 4 | iOS has **no origin gate**: the runtime is injected via `WKUserScript(…, forMainFrameOnly: true)` (no origin restriction), so any page the WKWebView loads — local or remote — gets `window.Capacitor`. | `@capacitor/ios` `JSExport.swift`, `WebViewDelegationHandler.swift` |
| 5 | `server.errorPath` gives both platforms a **built-in main-frame error page** flow: Android `BridgeWebViewClient.onReceivedError/onReceivedHttpError` and iOS `webView(_:didFail…)` both load `localUrl + "/" + errorPath` when a main-frame load fails. | `BridgeWebViewClient.java`, `WebViewDelegationHandler.swift`, `Bridge.getErrorUrl()` |
| 6 | `CapacitorConfig` is overridable **before bridge init** on both platforms, which is what makes the runtime-configurable server URL possible: Android `BridgeActivity.config` is a protected field consumed by `load()` (built from the bundled `capacitor.config.json`; the deprecated `CapConfig(AssetManager, JSONObject)` constructor rebuilds it with `server.url` mutated); iOS `CAPBridgeViewController.instanceDescriptor()` is an explicitly open override point with a settable `descriptor.serverURL`. | `BridgeActivity.java`, `CapConfig.java`, `CAPBridgeViewController.swift`, `CAPInstanceDescriptor.h/.m` |
| 7 | The camera/file data paths were pinned down: `Camera.getPhoto` with `resultType: "base64"` returns bytes through the bridge (no fetch needed). `Camera.pickImages` gallery results only carry a `webPath` on the **local** origin (`FileUtils.getPortablePath(bridge.getLocalUrl(), …)`), and `WebViewLocalServer` sends **no CORS headers** — a remote-origin page therefore cannot fetch those webPaths. `@capawesome/capacitor-file-picker` `pickFiles`/`pickImages` accept `readData: true` and return per-file base64 `data` + `name`/`mimeType`/`path` natively on both platforms. | `@capacitor/camera` `CameraPlugin.java` + `plugin.js`; `@capacitor/android` `WebViewLocalServer.java`; `@capawesome/capacitor-file-picker` `FilePickerPlugin.java`, `definitions.d.ts`, iOS `FilePickerPlugin.swift` |
| 8 | `@capacitor/preferences` native stores are directly readable by shell code: Android `SharedPreferences("CapacitorStorage", MODE_PRIVATE)` (no key prefix), iOS `UserDefaults.standard` key `"<group>.<key>"` (default group `CapacitorStorage`). | `@capacitor/preferences` `Preferences.java`, `Preferences.swift`, `PreferencesConfiguration.java` |

## Verdict and chosen layout

1. **Remote bridge injection: PASS by design** (finding 1+2+6). The shells
   set `server.url` **at activity/bridge init time** from the stored user
   URL (Android: rebuild `CapConfig` from the bundled config JSON with
   `server.url` overwritten before `super.onCreate()`; iOS: override
   `instanceDescriptor()`), so the document-start gate matches the user's
   server and the remote pi-web page gets the full Capacitor runtime with
   `PluginHeaders` for Camera / FilePicker / LocalNotifications / Keyboard.
2. **Gallery attach and file upload: bytes via the bridge, not fetch**
   (finding 7). `Camera.getPhoto(base64)` for capture; the
   `@capawesome/capacitor-file-picker` with `readData: true` for gallery
   multi-pick and general uploads. Cost: picked file bytes are base64-encoded
   in native memory before crossing the bridge — very large uploads carry a
   memory/speed overhead. This is the documented limitation recorded in
   `mobile/README.md` instead of a broken `fetch(webPath)` branch.
3. **Settings never depend on the server, and never depend on the injected
   runtime either** (finding 1 + 8). Because local pages **lose** the
   injected runtime on Android once a server URL is active (the gate moves to
   the remote origin), the plan's original idea of persisting settings
   through the Preferences plugin from a locally-served settings page is not
   uniformly reachable. Chosen fallback: a tiny native settings host writes
   the same storage the Preferences plugin uses — on Android a dedicated
   `SettingsActivity` exposing a `window.piwebSettings` JS interface
   (mirroring the Electron shell's preload seam), on iOS the main webview
   hosts `settings.html` (runtime always present there, finding 4) and talks
   to the shell through a `WKScriptMessageHandler`. The
   `connection-error.html` page is wired through Capacitor's built-in
   `server.errorPath` flow (finding 5), and its "Server settings…" action
   opens the native settings host on Android via a `piweb-shell://` scheme
   intercepted by a `BridgeWebViewClient` subclass, or navigates in-webview
   on iOS.
4. **App reload after a URL change**: Android recreates the activity (the
   bridge cannot re-read config); iOS replaces the root view controller.

## What was not verified (and remains for the device pass)

- No Android SDK / emulator / Gradle build was available in this
  environment, so **no APK was assembled and no runtime injection or
  `Camera.getPhoto` round-trip was observed on a device**. The Android
  platform sources here are the `cap add android` template plus the
  modifications described above; `assembleDebug` must be run (and the
  injection sanity-checked once with `chrome://inspect`) on a machine with
  the SDK, then the real-device pass from the work item's acceptance list.
- No macOS/Xcode was available, so **no IPA/archive was built**; the iOS
  project follows the standard `cap add ios` template plus the overrides
  above and must be built with `xcodebuild` on macOS.
- Runtime behaviors that could not be exercised here and could still
  surprise: WKWebView ` WKURLSchemeHandler` quirks for the local error page
  in remote mode, Android photo-picker permission prompts on API 33+, and
  LocalNotifications cold-launch replay on iOS.

## Fallback considered and rejected

Bundling a built copy of the pi-web web app (`www/`) and pointing the shell
at local assets would make the injection trivial, but it bundles the app
with every shell release and breaks the "self-hosted server, zero-install
PWA parity" contract of the work item (the shell must talk to *the user's*
server, where their sessions live). Rejected; the config-override layout
above keeps that contract at the cost of the native settings host.
