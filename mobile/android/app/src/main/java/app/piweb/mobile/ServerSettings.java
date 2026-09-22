package app.piweb.mobile;

import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;

/**
 * Storage for the user's self-hosted pi-web server URL.
 *
 * Deliberately uses the SAME store the official @capacitor/preferences plugin
 * uses on Android (SharedPreferences "CapacitorStorage", no key prefix —
 * verified in mobile/docs/spike-remote-bridge.md), so the value stays
 * interoperable with anything the plugin (or an iOS counterpart, which uses
 * UserDefaults key "CapacitorStorage.piweb.serverUrl") reads or writes.
 */
public final class ServerSettings {

    public static final String PREFS_NAME = "CapacitorStorage";
    public static final String KEY = "piweb.serverUrl";

    private ServerSettings() {}

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS_NAME, Activity.MODE_PRIVATE);
    }

    /** The stored server URL, or null when none/blank. */
    public static String get(Context context) {
        String value = prefs(context).getString(KEY, null);
        if (value == null) return null;
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }

    /** Persists the server URL (already validated by the settings page). */
    public static void set(Context context, String serverUrl) {
        prefs(context).edit().putString(KEY, serverUrl.trim()).apply();
    }
}
