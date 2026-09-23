package app.piweb.twa

import android.app.Activity
import android.net.Uri
import android.os.Bundle
import com.google.androidbrowserhelper.trusted.TwaLauncher

/**
 * Pi Web Trusted Web Activity launcher (pi#40).
 *
 * Opens the configured origin through browserhelper's TwaLauncher and
 * finishes — nothing else. There is deliberately:
 *  - NO WebView code of ours (the page renders in the browser's renderer),
 *  - NO request proxying, and
 *  - NO script injection.
 *
 * The provider is PINNED to Chrome: TWA fullscreen requires the browser to
 * verify /.well-known/assetlinks.json (matching this APK's package name
 * app.piweb.twa and signing certificate SHA-256). OEM browsers on Chinese
 * ROMs don't perform that verification and would show a URL bar; with Chrome
 * pinned, a matching statement opens the Custom Tab as a Trusted Web
 * Activity: fullscreen, no address bar. If the URL bar ever shows, the
 * statement does not match the installed APK (rebuild it with
 * scripts/assetlinks.sh — see README.md), or Chrome is not installed.
 */
class TwaLauncherActivity : Activity() {

    private var launcher: TwaLauncher? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val launchUrl = getString(R.string.twa_launch_url)
        require(launchUrl.startsWith("https://")) {
            "PIWEB_TWA_LAUNCH_URL must be an HTTPS origin: $launchUrl"
        }

        launcher = TwaLauncher(this, CHROME_PACKAGE)
        launcher?.launch(Uri.parse(launchUrl))
        finish()
    }

    override fun onDestroy() {
        super.onDestroy()
        launcher?.destroy()
    }

    private companion object {
        const val CHROME_PACKAGE = "com.android.chrome"
    }
}
