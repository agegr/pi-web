package app.piweb.mobile;

import android.net.Uri;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import java.util.HashMap;
import java.util.Map;
import java.util.Objects;
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
    public static final String SHELL_RELOAD_HOST = "reload";

    private final Bridge bridge;
    private final MainActivity activity;

    public PiWebWebViewClient(Bridge bridge, MainActivity activity) {
        super(bridge);
        this.bridge = bridge;
        this.activity = activity;
    }

    @Override
    public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
        Uri url = request.getUrl();
        if (SHELL_SCHEME.equals(url.getScheme())) {
            if (SHELL_SETTINGS_HOST.equals(url.getHost())) {
                activity.openSettings();
            } else if (SHELL_RELOAD_HOST.equals(url.getHost())) {
                activity.reloadServer();
            }
            return true;
        }
        return super.shouldOverrideUrlLoading(view, request);
    }

    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        WebResourceResponse response = super.shouldInterceptRequest(view, request);
        // Main-frame proxied responses carry no cache headers, so the WebView
        // heuristic-cache kept serving a stale garbled page even after the
        // server was fixed (device pass). Never cache the main frame: the
        // document is re-fetched (and runtime-injected) on every navigation.
        if (response != null && request.isForMainFrame()) {
            Map<String, String> headers = new HashMap<>();
            headers.put("Cache-Control", "no-store");
            response.setResponseHeaders(headers);
        }
        return response;
    }

    @Override
    public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
        super.onReceivedError(view, request, error);
        // Capacitor has no built-in main-frame error fallback on Android:
        // server.errorPath is only consulted for the minimum-WebView check,
        // so without this a failed server load strands the user on the
        // system error page with no way back to settings (device pass).
        if (!request.isForMainFrame()) return;
        String errorUrl = bridge.getErrorUrl();
        if (errorUrl == null) return;
        String failing = String.valueOf(request.getUrl());
        Uri err = Uri.parse(errorUrl);
        if (Objects.equals(Uri.parse(failing).getHost(), err.getHost())) {
            return; // already showing the bundled error page — no loop
        }
        view.post(() -> view.loadUrl(errorUrl + "?code=" + Uri.parse(failing).getLastPathSegment() == null
            ? errorUrl + "?from=" + Uri.encode(failing)
            : errorUrl + "?code=" + (error != null ? error.getErrorCode() : -1) + "&from=" + Uri.encode(failing)));
    }
}
