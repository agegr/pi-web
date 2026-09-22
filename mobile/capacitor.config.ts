/**
 * Capacitor shell configuration for the pi-web mobile apps.
 *
 * The app ships NO server: the WebView loads a pi-web server URL the user
 * configures on the in-app settings page (see `src/pages/settings.html`).
 *
 * `server.url` is intentionally left unset here: the runtime injection of
 * the Capacitor bridge into the remote page is origin-gated to the
 * configured app URL (verified against the shipped @capacitor/android 7.x
 * sources — see `docs/spike-remote-bridge.md`), so the native shell code
 * sets `server.url` **at bridge init time** from the stored user URL
 * (Android: MainActivity rebuilds CapConfig before super.onCreate(); iOS:
 * PiWebViewController overrides instanceDescriptor()). With no URL stored
 * the shell runs in local-asset mode, where the bundled settings and
 * connection-error pages (the webDir below) get the injected runtime.
 *
 * `PI_WEB_SERVER_URL` (set at build time by the person building the APK/IPA)
 * only seeds the *default* URL offered on first run — a convenience for
 * development, never a requirement.
 */
import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "app.piweb.mobile",
  appName: "pi-web",
  // The bundled local pages (settings / connection error) double as the
  // Capacitor webDir so `cap sync` ships them inside the platform builds.
  webDir: "src/pages",
  android: {
    // targetSdk 35 forces edge-to-edge on Android 15+, drawing the WebView
    // under the status bar so the top bar's controls were untappable
    // (device pass, pi#31). "auto" lets Capacitor add the system-bar
    // margins to the WebView.
    adjustMarginsForEdgeToEdge: "auto",
  },
  server: {
    // Main-frame load failures (server unreachable / wrong URL) fall back to
    // this bundled page on both platforms (Capacitor's built-in errorPath
    // flow). Its "Server settings…" action reopens the native settings host.
    errorPath: "connection-error.html",
    // Cleartext (http://) server URLs stay refused by default. Android
    // `usesCleartextTraffic` and iOS ATS both stay in their secure defaults;
    // a `PI_WEB_ALLOW_CLEARTEXT=1` build flips this alongside the
    // platform-specific opt-ins (see README.md — Security).
    cleartext: process.env.PI_WEB_ALLOW_CLEARTEXT === "1",
    hostname: "app.piweb.mobile",
    androidScheme: "https",
    iosScheme: "capacitor",
  },
  plugins: {
    Keyboard: {
      // Native resize keeps the WKWebView/Android WebView shrinking with the
      // software keyboard; the web app's `interactiveWidget: resizes-content`
      // and `useViewportHeight` hook handle the page side (see plan pi#31).
      resize: "native",
      resizeOnFullScreen: true,
    },
    LocalNotifications: {
      smallIcon: "ic_launcher",
      iconColor: "#3ddc84",
    },
  },
};

export default config;
