"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const STORAGE_KEY = "pi-notification-enabled";
const PROMPT_DISMISSED_KEY = "pi-notification-prompt-dismissed";

type CompletionNotificationPermission = NotificationPermission | "unsupported";

function getPermission(): CompletionNotificationPermission {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission;
}

export function useCompletionNotification() {
  const [permission, setPermission] = useState<CompletionNotificationPermission>(getPermission);
  const [enabled, setEnabled] = useState(() => (
    typeof window !== "undefined"
    && localStorage.getItem(STORAGE_KEY) === "true"
    && getPermission() === "granted"
  ));
  const [showPrompt, setShowPrompt] = useState(() => (
    typeof window !== "undefined"
    && getPermission() === "default"
    && localStorage.getItem(PROMPT_DISMISSED_KEY) !== "true"
  ));
  const enabledRef = useRef(enabled);

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  const toggle = useCallback(async () => {
    if (!("Notification" in window)) return;

    localStorage.setItem(PROMPT_DISMISSED_KEY, "true");
    setShowPrompt(false);

    if (enabledRef.current) {
      enabledRef.current = false;
      localStorage.setItem(STORAGE_KEY, "false");
      setEnabled(false);
      setPermission(Notification.permission);
      return;
    }

    const nextPermission = Notification.permission === "granted"
      ? "granted"
      : await Notification.requestPermission();
    setPermission(nextPermission);
    const nextEnabled = nextPermission === "granted";
    enabledRef.current = nextEnabled;
    localStorage.setItem(STORAGE_KEY, String(nextEnabled));
    setEnabled(nextEnabled);
  }, []);

  const dismissPrompt = useCallback(() => {
    localStorage.setItem(PROMPT_DISMISSED_KEY, "true");
    setShowPrompt(false);
  }, []);

  const notifySession = useCallback(async (title: string, body: string, sessionId?: string | null) => {
    if (!enabledRef.current || Notification.permission !== "granted") return;

    const url = sessionId ? `/?session=${encodeURIComponent(sessionId)}` : "/";
    const options: NotificationOptions = {
      body,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: sessionId ? `pi-session-${sessionId}` : "pi-session-complete",
      data: { url },
    };

    try {
      const registration = "serviceWorker" in navigator
        ? await navigator.serviceWorker.getRegistration()
        : undefined;
      if (registration) {
        await registration.showNotification(title, options);
        return;
      }

      const notification = new Notification(title, options);
      notification.onclick = () => {
        window.focus();
        window.location.assign(url);
        notification.close();
      };
    } catch (error) {
      console.error("任务完成通知发送失败", error);
    }
  }, []);

  return {
    notificationEnabled: enabled,
    notificationPermission: permission,
    showNotificationPrompt: showPrompt,
    onNotificationToggle: toggle,
    dismissNotificationPrompt: dismissPrompt,
    notifySession,
  };
}
