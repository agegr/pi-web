package app.piweb.mobile;

import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;

/**
 * The shell's WebView client: routes the internal `piweb-shell://` scheme to
 * the settings flow and leaves everything else to Capacitor (including the
 * built-in main-frame error handling that swaps in the bundled
 * connection-error page via server.errorPath).
 *
 * Needed because the bundled local pages have NO injected Capacitor runtime
 * once a server URL is active (the runtime's document-start injection is
 * origin-gated — see mobile/docs/spike-remote-bridge.md), so a plain page
 * cannot call a plugin to reach native code. A custom-scheme navigation is
 * the one channel that always works.
 */
public class PiWebWebViewClient extends BridgeWebViewClient {

    public static final String SHELL_SCHEME = "piweb-shell";
    public static final String SHELL_SETTINGS_HOST = "settings";

    private final MainActivity activity;

    public PiWebWebViewClient(Bridge bridge, MainActivity activity) {
        super(bridge);
        this.activity = activity;
    }

    @Override
    public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
        Uri url = request.getUrl();
        if (SHELL_SCHEME.equals(url.getScheme())) {
            if (SHELL_SETTINGS_HOST.equals(url.getHost())) {
                activity.openSettings();
            }
            return true;
        }
        return super.shouldOverrideUrlLoading(view, request);
    }
}
