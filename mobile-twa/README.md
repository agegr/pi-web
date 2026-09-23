# Pi Web TWA — Android shell

Trusted Web Activity launcher for your self-hosted Pi Web origin
(pi#40). ~100 lines, **no WebView code, no proxying, no script injection**:
the launcher opens the origin through androidx.browser Custom Tabs, and the
Digital Asset Links statement served by the website makes the browser open
it fullscreen with no address bar.

**This app ships no server.** It connects to a Pi Web instance you host
yourself.

Device flows (side-load, install, iOS Add-to-Home-Screen, China notes,
notification capability matrix) live in [`../docs/mobile.md`](../docs/mobile.md).

## Build

Requires JDK 17+ and Android SDK 34 (or just open the folder in Android
Studio).

```bash
./gradlew assembleRelease
# → app/build/outputs/apk/release/app-release.apk
```

### Launch URL

Set in `gradle.properties` (`PIWEB_TWA_LAUNCH_URL`, default
`https://gcp-dev.stevenforai.top`), baked in at build time as a generated
resource. Override per build without touching code:

```bash
./gradlew assembleRelease -PPIWEB_TWA_LAUNCH_URL=https://your-origin
```

The launcher refuses a non-`https://` origin.

## Signing & Digital Asset Links

Release builds sign with the committed keystore in `keystore/` (see
[`keystore/README.md`](keystore/README.md) for the per-machine regeneration
story). The side-loaded APK verifies as a TWA only while
`/.well-known/assetlinks.json` on the site names the APK's actual signing
certificate SHA-256 fingerprint.

After every APK re-sign (new keystore, regenerated one, etc.) regenerate the
statement and redeploy the site:

```bash
# from a built APK (preferred — always matches what you will install):
scripts/assetlinks.sh app/build/outputs/apk/release/app-release.apk

# or straight from the keystore:
scripts/assetlinks.sh --keystore
```

The script writes `public/.well-known/assetlinks.json` in the Pi Web
checkout; commit it and redeploy. If the address bar ever shows on the
device, this statement is out of sync with the installed APK — that is the
one failure mode of a TWA, and this script is the fix.

## Layout

```
mobile-twa/
  settings.gradle.kts / build.gradle.kts / gradle.properties   Gradle config
  gradlew, gradle/wrapper/           standard Gradle wrapper (8.9)
  app/build.gradle.kts               app module; signing config; launch-URL resValue
  app/src/main/AndroidManifest.xml   launcher activity + INTERNET permission
  app/src/main/java/app/piweb/twa/TwaLauncherActivity.kt   the whole shell
  app/src/main/res/                  icons, strings, network security config
  keystore/                          committed release keystore (see its README)
  scripts/make-release-keystore.sh   per-machine keystore regeneration
  scripts/assetlinks.sh              regenerate public/.well-known/assetlinks.json
```
