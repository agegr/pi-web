package app.piweb.mobile;

import android.net.Uri;
import android.webkit.CookieManager;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;
import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import java.util.Objects;

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
        // Main-frame GETs to the server origin are fetched HERE with an
        // identity Accept-Encoding and the runtime injected by us.
        // Capacitor's own proxy copies the WebView's Accept-Encoding: gzip
        // verbatim and reads the body as UTF-8 text to splice the runtime —
        // any gzipped/odd response arrives as mojibake and the WebView shows
        // "This page couldn't load" with no diagnostics (device pass, pi#31).
        // Serving it ourselves makes the failure mode visible on screen.
        Uri url = request.getUrl();
        String serverUrl = activity.getServerUrl();
        if (request.isForMainFrame()
                && "GET".equals(request.getMethod())
                && serverUrl != null
                && sameAuthority(url, Uri.parse(serverUrl))) {
            WebResourceResponse own = fetchMainFrame(view, request, serverUrl);
            if (own != null) return own;
            // Unexpected shape: fall through to Capacitor's proxy.
        }

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

    private static boolean sameAuthority(Uri a, Uri b) {
        String hostA = a.getHost(), hostB = b.getHost();
        if (hostA == null || !hostA.equalsIgnoreCase(hostB)) return false;
        int pa = a.getPort() == -1 ? a.getScheme().equals("https") ? 443 : 80 : a.getPort();
        int pb = b.getPort() == -1 ? b.getScheme().equals("https") ? 443 : 80 : b.getPort();
        return pa == pb;
    }

    /**
     * Fetches the main frame with an identity Accept-Encoding (no gzip), injects
     * the Capacitor runtime, and serves the result. On any failure serves a
     * diagnostics page that shows WHAT came back (status, content-type, body
     * preview) instead of the opaque system error page.
     */
    private WebResourceResponse fetchMainFrame(WebView view, WebResourceRequest request, String serverUrl) {
        String detail = null;
        String contentType = "text/html";
        byte[] body = null;
        try {
            URL target = new URL(request.getUrl().toString());
            HttpURLConnection conn = (HttpURLConnection) target.openConnection();
            for (Map.Entry<String, String> h : request.getRequestHeaders().entrySet()) {
                String name = h.getKey();
                if ("Accept-Encoding".equalsIgnoreCase(name) || "Host".equalsIgnoreCase(name)) continue;
                conn.setRequestProperty(name, h.getValue());
            }
            conn.setRequestProperty("Accept-Encoding", "identity");
            String cookie = CookieManager.getInstance().getCookie(request.getUrl().toString());
            if (cookie != null) conn.setRequestProperty("Cookie", cookie);
            conn.setConnectTimeout(10_000);
            conn.setReadTimeout(20_000);
            conn.setInstanceFollowRedirects(true);
            int status = conn.getResponseCode();
            contentType = conn.getContentType() == null ? "text/html" : conn.getContentType();
            InputStream in = status >= 400 ? conn.getErrorStream() : conn.getInputStream();
            java.io.ByteArrayOutputStream buf = new java.io.ByteArrayOutputStream();
            if (in != null) {
                byte[] chunk = new byte[8192];
                for (int n; (n = in.read(chunk)) > 0; ) buf.write(chunk, 0, n);
                in.close();
            }
            body = buf.toByteArray();

            boolean looksHtml = contentType.toLowerCase().contains("html")
                && new String(body, 0, Math.min(body.length, 64), StandardCharsets.UTF_8).contains("<");
            if (looksHtml && status < 400) {
                InputStream injected = injectRuntime(new ByteArrayInputStream(body));
                if (injected != null) {
                    Map<String, String> headers = new HashMap<>();
                    headers.put("Cache-Control", "no-store");
                    return new WebResourceResponse("text/html", "utf-8", 200, "OK",
                        headers, injected);
                }
                detail = "runtime injection failed (reflection)";
            } else if (status >= 400) {
                detail = "HTTP " + status + " — body: " + preview(body);
            } else {
                detail = "non-HTML response (content-type: " + contentType + ") — body: " + preview(body);
            }
        } catch (Exception e) {
            detail = "fetch failed: " + e.getClass().getSimpleName() + ": " + e.getMessage();
        }

        String html = "<!DOCTYPE html><html><head><meta charset=\"utf-8\"/>"
            + "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1, viewport-fit=cover\"/>"
            + "<style>body{font:14px/1.6 system-ui;padding:24px;word-break:break-all}"
            + "pre{background:#222;color:#0f0;padding:12px;white-space:pre-wrap;font-size:11px}</style></head>"
            + "<body><h3>Main page fetch failed</h3><pre>" + htmlEscape(detail == null ? "unknown" : detail)
            + "</pre><p><a href=\"piweb-shell://reload\">Retry</a> · "
            + "<a href=\"piweb-shell://settings\">Server settings</a></p></body></html>";
        Map<String, String> headers = new HashMap<>();
        headers.put("Cache-Control", "no-store");
        return new WebResourceResponse("text/html", "utf-8", 200, "OK",
            headers, new ByteArrayInputStream(html.getBytes(StandardCharsets.UTF_8)));
    }

    private static String preview(byte[] body) {
        if (body == null || body.length == 0) return "(empty)";
        String text = new String(body, 0, Math.min(body.length, 400), StandardCharsets.UTF_8);
        return htmlEscape(text);
    }

    private static String htmlEscape(String s) {
        return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;");
    }

    /** Injects the Capacitor runtime via the bridge's JSInjector (private — reflection). */
    private InputStream injectRuntime(InputStream plain) {
        try {
            var method = bridge.getClass().getDeclaredMethod("getJSInjector");
            method.setAccessible(true);
            Object injector = method.invoke(bridge);
            var injected = injector.getClass()
                .getDeclaredMethod("getInjectedStream", InputStream.class);
            injected.setAccessible(true);
            return (InputStream) injected.invoke(injector, plain);
        } catch (Exception e) {
            return null;
        }
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
