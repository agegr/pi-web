package app.piweb.mobile;

import android.content.Context;
import com.getcapacitor.CapConfig;
import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.stream.Collectors;
import org.json.JSONObject;

/**
 * Builds the Capacitor config with `server.url` pointing at the user's
 * pi-web server.
 *
 * Why this exists (see mobile/docs/spike-remote-bridge.md): Capacitor's
 * Android runtime is injected into the page via a document-start script whose
 * allowed origin is derived from the configured app URL. With `server.url`
 * unset that origin is the app's local asset server, so a remotely loaded
 * pi-web page would get NO Capacitor bridge — the native camera/file-picker/
 * notification plugins would be unreachable. The stored user URL therefore
 * has to become `server.url` BEFORE the bridge is created (in
 * MainActivity.onCreate, before super.onCreate()).
 */
public final class PiWebCapConfig {

    private PiWebCapConfig() {}

    /**
     * Loads the bundled capacitor.config.json, overrides server.url, and
     * returns a CapConfig built from it. Returns null on any failure — the
     * caller then keeps the bundled default config (local asset mode).
     */
    public static CapConfig withServerUrl(Context context, String serverUrl) {
        try (InputStream stream = context.getAssets().open("capacitor.config.json")) {
            String jsonText = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))
                .lines()
                .collect(Collectors.joining("\n"));
            JSONObject json = new JSONObject(jsonText);
            JSONObject server = json.optJSONObject("server");
            if (server == null) {
                server = new JSONObject();
                json.put("server", server);
            }
            server.put("url", serverUrl);
            return new CapConfig(context.getAssets(), json);
        } catch (Exception exception) {
            return null;
        }
    }
}
