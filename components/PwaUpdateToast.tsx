"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

// Surface a toast when a new service worker is waiting to activate.
// Flow:
//   1. SW installs (`updatefound` + `statechange === "installed"`) AND a
//      controller is already present (i.e. this is an upgrade, not a first
//      install) → show the toast.
//   2. User clicks "Reload" → `registration.waiting.postMessage({ type:
//      "SKIP_WAITING" })`. The SW's `message` listener calls `self.skipWaiting()`,
//      `activate` fires, the page gets `controllerchange` → we reload.
//
// The toast renders via createPortal; when no update is available, the
// component renders null and the existing UI is untouched.

export function PwaUpdateToast() {
  const [waiting, setWaiting] = useState<ServiceWorkerRegistration | null>(null);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    let cancelled = false;

    const onControllerChange = () => {
      // The new SW has taken over. Reload so the page picks up the new bundle.
      // Tiny delay lets `clients.claim()` settle on the SW side first.
      window.setTimeout(() => {
        window.location.reload();
      }, 100);
    };

    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    const evaluate = (reg: ServiceWorkerRegistration) => {
      if (cancelled) return;
      // First install path: there's a waiting worker but no current controller
      // → no toast (the page already controls itself on the very first visit).
      if (!navigator.serviceWorker.controller) return;
      const worker = reg.installing ?? reg.waiting;
      if (!worker) return;
      if (worker.state === "installed" || worker.state === "activated") {
        setWaiting(reg);
      }
    };

    navigator.serviceWorker.getRegistration().then((reg) => {
      if (!reg || cancelled) return;
      evaluate(reg);
      reg.addEventListener("updatefound", () => {
        const installing = reg.installing;
        if (!installing) return;
        installing.addEventListener("statechange", () => evaluate(reg));
      });
    });

    return () => {
      cancelled = true;
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    };
  }, []);

  if (typeof document === "undefined" || !waiting) return null;

  const reload = () => {
    waiting.waiting?.postMessage({ type: "SKIP_WAITING" });
  };

  return createPortal(
    <div role="status" aria-live="polite" className="pwa-update-toast">
      <span className="pwa-update-toast__text">New version available</span>
      <button type="button" className="pwa-update-toast__reload" onClick={reload}>
        Reload
      </button>
    </div>,
    document.body,
  );
}
