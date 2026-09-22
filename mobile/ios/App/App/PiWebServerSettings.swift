import Foundation

/**
 * Storage for the user's self-hosted pi-web server URL.
 *
 * Deliberately uses the SAME store the official @capacitor/preferences plugin
 * uses on iOS (UserDefaults.standard, key "<group>.<key>", default group
 * "CapacitorStorage" — verified in mobile/docs/spike-remote-bridge.md), so
 * the bundled settings page (which persists through the Preferences plugin)
 * and the native shell reader stay interoperable. The Android shell reads
 * the equivalent SharedPreferences entry.
 */
enum PiWebServerSettings {

    private static let storageKey = "CapacitorStorage.piweb.serverUrl"

    /// The stored server URL, or nil when none/blank.
    static func serverUrl() -> String? {
        guard
            let value = UserDefaults.standard.string(forKey: storageKey)?
                .trimmingCharacters(in: .whitespacesAndNewlines),
            !value.isEmpty
        else { return nil }
        return value
    }

    /// Persists the server URL (validated by the settings page).
    static func set(_ serverUrl: String) {
        UserDefaults.standard.set(serverUrl, forKey: storageKey)
    }

    /**
     * Whether cleartext http:// server URLs may be saved.
     *
     * iOS App Transport Security is default-ON; the pi-web opt-in
     * (PI_WEB_ALLOW_CLEARTEXT=1 in spirit) is a build-time Info.plist edit
     * (NSAppTransportSecurity.NSAllowsArbitraryLoads = true), and this reads
     * that state so the settings page only accepts http:// when the built app
     * would actually allow the traffic.
     */
    static func allowCleartext() -> Bool {
        guard
            let ats = Bundle.main.object(forInfoDictionaryKey: "NSAppTransportSecurity") as? [String: Any],
            let allowsArbitraryLoads = ats["NSAllowsArbitraryLoads"] as? Bool
        else { return false }
        return allowsArbitraryLoads
    }
}
