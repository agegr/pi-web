package app.piweb.mobile;

import android.content.Intent;
import android.os.Bundle;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.CapConfig;

/**
 * pi-web Android shell.
 *
 * This app ships NO server: it loads the user's self-hosted pi-web URL in a
 * Capacitor WebView so the official plugins (Camera, FilePicker,
 * LocalNotifications, Keyboard) close pi#26 at the native layer. The flow:
 *
 *  - Stored URL present: `server.url` is overridden at bridge-init time (via
 *    PiWebCapConfig) so Capacitor's origin-gated runtime injection reaches
 *    the REMOTE pi-web page — the load-bearing behavior verified in
 *    mobile/docs/spike-remote-bridge.md. The bridge then loads the server.
 *  - No stored URL: the native settings host (SettingsActivity) opens
 *    immediately, and the main WebView parks on the bundled
 *    connection-error.html until a URL is saved.
 *  - The server is unreachable / misconfigured: Capacitor's built-in
 *    server.errorPath handling swaps the main frame to the bundled
 *    connection-error.html, whose "Server settings…" action travels through
 *    the internal piweb-shell:// scheme (PiWebWebViewClient) — local pages
 *    have no injected runtime once a server URL is active.
 *  - After a save, the activity recreates so the bridge is rebuilt against
 *    the new origin (the bridge cannot re-read its config).
 */
public class MainActivity extends BridgeActivity {

    private static final int REQUEST_SETTINGS = 41;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        String serverUrl = ServerSettings.get(this);
        if (serverUrl != null) {
            CapConfig remoteConfig = PiWebCapConfig.withServerUrl(this, serverUrl);
            if (remoteConfig != null) {
                // Consumed by BridgeActivity.load() → bridge builder BEFORE
                // the bridge (and its origin-gated JS injection) is created.
                this.config = remoteConfig;
            }
        }
        super.onCreate(savedInstanceState);

        Bridge bridge = getBridge();
        if (bridge == null) {
            return;
        }
        // Swap in the shell's WebViewClient so piweb-shell:// works.
        bridge.setWebViewClient(new PiWebWebViewClient(bridge, this));

        if (serverUrl == null) {
            // First run: settings are editable without any server. The main
            // WebView shows the bundled first-run state meanwhile.
            bridge.getWebView().loadUrl(bridge.getLocalUrl() + "/connection-error.html?first-run=1");
            openSettings();
        }
    }

    public void reloadServer() {
        String serverUrl = ServerSettings.get(this);
        Bridge bridge = getBridge();
        if (serverUrl == null || bridge == null) {
            // No stored URL (or no bridge yet): settings is the right place.
            openSettings();
            return;
        }
        bridge.getWebView().loadUrl(serverUrl);
    }

    public String getServerUrl() {
        return ServerSettings.get(this);
    }

    public void openSettings() {
        startActivityForResult(new Intent(this, SettingsActivity.class), REQUEST_SETTINGS);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        // Only a successful save rebuilds the bridge (a dismissed settings
        // page leaves the connection-error state as-is; recreating on cancel
        // would reopen settings in a loop).
        if (requestCode == REQUEST_SETTINGS && resultCode == RESULT_OK) {
            // A (possibly different) URL may now be stored: rebuild the
            // whole bridge so the runtime injection matches the new origin.
            recreate();
        }
    }
}
