"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// Chromium and Edge fire `beforeinstallprompt`; Safari/Firefox/iOS do not.
// We capture it, defer it, and surface a small "Install" chip in the bottom
// corner. The user clicks → we call `prompt()`, await `userChoice`, then hide.
//
// The chip is rendered through a portal so the existing app UI is untouched;
// when the prompt isn't available or the user has already installed, this
// component renders `null`.

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
  prompt(): Promise<void>;
}

export function PwaInstallPrompt() {
  const [event, setEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const deferredRef = useRef<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof window === "undefined") return;

    const onPrompt = (raw: Event) => {
      const e = raw as BeforeInstallPromptEvent;
      e.preventDefault();
      deferredRef.current = e;
      setEvent(e);
    };
    const onInstalled = () => {
      setInstalled(true);
      deferredRef.current = null;
      setEvent(null);
    };

    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (typeof document === "undefined") return null;
  if (installed || !event) return null;

  const onClick = async () => {
    try {
      await event.prompt();
      await event.userChoice;
    } finally {
      deferredRef.current = null;
      setEvent(null);
    }
  };

  return createPortal(
    <button
      type="button"
      className="pwa-install-chip"
      onClick={onClick}
      aria-label="Install Pi Web"
    >
      <span aria-hidden="true">↓</span>
      <span>Install Pi Web</span>
    </button>,
    document.body,
  );
}
