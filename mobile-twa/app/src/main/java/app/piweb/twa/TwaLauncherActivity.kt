package app.piweb.twa

import android.app.Activity
import android.net.Uri
import android.os.Bundle
import androidx.browser.customtabs.CustomTabsIntent

/**
 * Pi Web Trusted Web Activity launcher (pi#40).
 *
 * Opens the configured origin through androidx.browser Custom Tabs and
 * finishes — nothing else. There is deliberately:
 *  - NO WebView code of ours (the page renders in the browser's renderer),
 *  - NO request proxying, and
 *  - NO script injection.
 *
 * When the website serves /.well-known/assetlinks.json matching this APK's
 * package name (app.piweb.twa) and signing certificate SHA-256 fingerprint,
 * the browser verifies the Digital Asset Link at launch and the Custom Tab
 * opens as a Trusted Web Activity: fullscreen, no address bar. If the URL
 * bar ever shows, the assetlinks statement does not match the installed APK
 * (rebuild it with scripts/assetlinks.sh — see README.md).
 */
class TwaLauncherActivity : Activity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val launchUrl = getString(R.string.twa_launch_url)
        require(launchUrl.startsWith("https://")) {
            "PIWEB_TWA_LAUNCH_URL must be an HTTPS origin: $launchUrl"
        }

        val intent = CustomTabsIntent.Builder()
            // Hides the URL bar for the verified (TWA) case; for an
            // unverified origin the browser still shows its own toolbar.
            .setUrlBarHidingEnabled(true)
            .setShowTitle(false)
            .build()

        try {
            intent.launchUrl(this, Uri.parse(launchUrl))
        } catch (error: android.content.ActivityNotFoundException) {
            // No Custom Tabs provider on the device. The shell has no
            // fallback UI by design — install any Chromium-based browser
            // (works GMS-free; the README explains this).
            throw error
        }
        finish()
    }
}
