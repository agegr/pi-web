import Capacitor
import WebKit

/**
 * pi-web iOS shell view controller.
 *
 * This app ships NO server: the WKWebView loads the user's self-hosted
 * pi-web URL so the official Capacitor plugins (Camera, FilePicker,
 * LocalNotifications, Keyboard) close pi#26 at the native layer. The flow:
 *
 *  - Stored URL present: `server.url` is overridden in instanceDescriptor()
 *    before the bridge is created. (On iOS the runtime is injected into every
 *    main-frame page via WKUserScript — no origin gate, verified in
 *    mobile/docs/spike-remote-bridge.md — but server.url still matters: it is
 *    the URL the bridge loads and the reference origin for in-app
 *    navigation decisions.)
 *  - No stored URL: the bundled settings page is loaded directly. It has the
 *    injected Capacitor runtime on iOS, persists through the Preferences
 *    plugin (same UserDefaults store the native reader uses) and tells the
 *    shell to apply the URL through the `piwebShell` script message handler.
 *  - The server is unreachable / misconfigured: Capacitor's built-in
 *    server.errorPath handling swaps the main frame to the bundled
 *    connection-error.html; its "Server settings…" action navigates in-webview
 *    (window.WEBVIEW_SERVER_URL is injected by the runtime).
 *  - After a save, the root view controller is replaced: the bridge cannot
 *    re-read its configuration, so a fresh PiWebViewController builds a
 *    bridge against the newly stored URL.
 */
@objc(PiWebViewController)
public class PiWebViewController: CAPBridgeViewController {

    public override func instanceDescriptor() -> InstanceDescriptor {
        let descriptor = super.instanceDescriptor()
        if let serverUrl = PiWebServerSettings.serverUrl() {
            descriptor.serverURL = serverUrl
        }
        return descriptor
    }

    override public func viewDidLoad() {
        super.viewDidLoad()

        // The web view and bridge exist by now (loadView ran first). Extend
        // the live content controller — Capacitor replaces the configuration's
        // controller after webViewConfiguration(for:), so scripts/handlers
        // must be added here, not in that override. The handler is wrapped in
        // a weak proxy so the content controller (owned by the web view) never
        // retains this view controller beyond its replacement on reload.
        if let webView = webView {
            let contentController = webView.configuration.userContentController
            // Shell flags for the bundled settings page (see
            // src/pages/settings.html): cleartext acceptance follows the
            // app's App Transport Security state.
            let flagsScript = WKUserScript(
                source: "window.PiWebShell = { allowCleartext: \(PiWebServerSettings.allowCleartext()) };",
                injectionTime: .atDocumentStart,
                forMainFrameOnly: true
            )
            contentController.addUserScript(flagsScript)
            contentController.add(WeakScriptMessageHandler(self), name: "piwebShell")
        }

        if PiWebServerSettings.serverUrl() == nil, let bridge = bridge {
            // First run: show the bundled settings page — editable while no
            // server exists at all.
            bridge.webView?.load(URLRequest(url: bridge.config.localURL.appendingPathComponent("settings.html")))
        }
    }

    private func handleShellMessage(_ body: [String: Any]) {
        switch body["type"] as? String {
        case "applyServerUrl":
            let serverUrl = (body["serverUrl"] as? String)?
                .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            if !serverUrl.isEmpty {
                PiWebServerSettings.set(serverUrl)
            }
            reloadShell()
        default:
            break
        }
    }

    /// Replaces the root view controller so the bridge is rebuilt against
    /// the freshly stored URL.
    private func reloadShell() {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            let window = self.view.window
                ?? UIApplication.shared.windows.first(where: { $0.isKeyWindow })
                ?? UIApplication.shared.windows.first
            window?.rootViewController = PiWebViewController()
        }
    }
}

/// Breaks the content controller's strong reference back to the (app-lifetime,
/// but replaceable) view controller.
private final class WeakScriptMessageHandler: NSObject, WKScriptMessageHandler {

    private weak var target: PiWebViewController?

    init(_ target: PiWebViewController) {
        self.target = target
        super.init()
    }

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage
    ) {
        guard let target = target, let body = message.body as? [String: Any] else { return }
        target.handleShellMessage(body)
    }
}
