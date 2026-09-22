package app.piweb.mobile;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.net.NetworkSecurityPolicy;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.appcompat.app.AppCompatActivity;
import androidx.webkit.WebViewAssetLoader;

/**
 * Native host for the bundled settings page.
 *
 * Mirrors the Electron desktop shell's settings window: the page
 * (src/pages/settings.html, bundled under assets/public) talks to a minimal
 * `window.piwebSettings` JS interface and never depends on the (possibly
 * unreachable) pi-web server, nor on the Capacitor runtime — which local
 * pages cannot rely on once a server URL is active, because Capacitor's
 * document-start injection is origin-gated (see
 * mobile/docs/spike-remote-bridge.md).
 *
 * The page is served through androidx.webkit's WebViewAssetLoader over
 * https://appassets.androidplatform.net (the recommended pattern) instead
 * of a file:// URL, so the page's own CSP `default-src 'self'` keeps
 * working and no file-system access is ever granted to web content.
 *
 * Saving persists through ServerSettings (the same store the
 * @capacitor/preferences plugin uses) and finishes; MainActivity recreates
 * itself so the bridge is rebuilt with the new server.url.
 */
public class SettingsActivity extends AppCompatActivity {

    private static final String ASSET_ORIGIN = "https://appassets.androidplatform.net";
    private static final String ASSET_PATH_PREFIX = "/assets/public/";

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        final WebViewAssetLoader assetLoader = new WebViewAssetLoader.Builder()
            .addPathHandler(ASSET_PATH_PREFIX, new WebViewAssetLoader.AssetsPathHandler(this))
            .build();

        WebView webView = new WebView(this);
        WebSettings webSettings = webView.getSettings();
        webSettings.setJavaScriptEnabled(true);
        // The settings page is a bundled asset served from a synthetic origin:
        // no file or content access is ever granted to web content here.
        webSettings.setAllowFileAccess(false);
        webSettings.setAllowContentAccess(false);
        webSettings.setAllowFileAccessFromFileURLs(false);
        webSettings.setAllowUniversalAccessFromFileURLs(false);
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return assetLoader.shouldInterceptRequest(request.getUrl());
            }
        });
        webView.addJavascriptInterface(new SettingsBridge(this), "piwebSettings");
        webView.loadUrl(ASSET_ORIGIN + ASSET_PATH_PREFIX + "settings.html");
        setContentView(webView);
    }

    @Override
    public void onBackPressed() {
        // Closing without saving leaves the stored URL untouched.
        setResult(Activity.RESULT_CANCELED);
        super.onBackPressed();
    }

    /** Minimal bridge surface exposed to settings.html as window.piwebSettings. */
    private static class SettingsBridge {

        private final SettingsActivity activity;

        SettingsBridge(SettingsActivity activity) {
            this.activity = activity;
        }

        @JavascriptInterface
        public String load() {
            return ServerSettings.get(activity);
        }

        /** Build-time default (PI_WEB_SERVER_URL), offered on first run only. */
        @JavascriptInterface
        public String defaultUrl() {
            String url = BuildConfig.PIWEB_DEFAULT_SERVER_URL;
            return url == null ? "" : url.trim();
        }

        /** True only in cleartext-enabled builds (PI_WEB_ALLOW_CLEARTEXT=1). */
        @JavascriptInterface
        public boolean allowCleartext() {
            return NetworkSecurityPolicy.getInstance().isCleartextTrafficPermitted();
        }

        @JavascriptInterface
        public boolean save(String serverUrl) {
            String trimmed = serverUrl == null ? "" : serverUrl.trim();
            if (!trimmed.matches("(?i)https?://\\S+.*")) {
                return false;
            }
            ServerSettings.set(activity, trimmed);
            Intent result = new Intent();
            result.putExtra("serverUrl", trimmed);
            activity.setResult(Activity.RESULT_OK, result);
            activity.finish();
            return true;
        }
    }
}
