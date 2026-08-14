"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

// iOS Safari does not fire `beforeinstallprompt`, so we detect iOS ourselves
// and show a hint explaining how to install via the Share sheet. The hint is
// dismissed for 30 days when the user clicks "Got it", and reappears once
// the TTL elapses so the user can revisit it.
//
// Detection covers:
//   - iPhone / iPad (older WebKit user-agent)
//   - iPadOS 13+ desktop-class user-agent (MacIntel + touch + no standalone)
//
// We bail out if the app is already running in standalone mode
// (`navigator.standalone === true` or `display-mode: standalone`).

const DISMISS_KEY = "pi-ios-install-hint-dismissed";
const DISMISS_TTL_MS = 30 * 24 * 3600 * 1000;

function detectIos(): boolean {
  if (typeof navigator === "undefined" || typeof window === "undefined") return false;

  // Already installed as a standalone web app — no hint needed.
  if ((navigator as Navigator & { standalone?: boolean }).standalone === true) return false;
  if (window.matchMedia?.("(display-mode: standalone)").matches) return false;

  const ua = navigator.userAgent;
  if (/iPhone|iPad/.test(ua)) return true;

  // iPadOS 13+ presents as macOS with touch support.
  if (
    navigator.platform === "MacIntel" &&
    typeof navigator.maxTouchPoints === "number" &&
    navigator.maxTouchPoints > 1
  ) {
    return true;
  }

  return false;
}

export function PwaIosHint() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!detectIos()) return;
    if (typeof localStorage === "undefined") return;
    const last = Number(localStorage.getItem(DISMISS_KEY) ?? "0");
    if (Number.isFinite(last) && Date.now() - last < DISMISS_TTL_MS) return;
    setShow(true);
  }, []);

  if (typeof document === "undefined" || !show) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      /* localStorage may be unavailable; the hint will simply reappear */
    }
    setShow(false);
  };

  return createPortal(
    <div role="dialog" aria-label="Install Pi Web" className="pwa-ios-hint">
      <p className="pwa-ios-hint__text">
        Tap <strong>Share</strong> <span aria-hidden="true">↑</span> then{" "}
        <strong>Add to Home Screen</strong> to install Pi Web.
      </p>
      <button type="button" className="pwa-ios-hint__dismiss" onClick={dismiss}>
        Got it
      </button>
    </div>,
    document.body,
  );
}
