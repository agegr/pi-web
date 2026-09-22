import type { BlockingExtensionUiRequest, ExtensionUiRequest } from "./types";
import { getCapacitorLocalNotifications } from "./capacitor-bridge";

interface WindowNotificationLike {
  onclick: Notification["onclick"];
  close: () => void;
}

interface ServiceWorkerRegistrationLike {
  showNotification: (title: string, options?: NotificationOptions) => Promise<void>;
}

/**
 * Capacitor shell delivery (pi#31): schedules through the LocalNotifications
 * plugin; the session URL rides in `extra` so a tap can select the session
 * (WKWebView has no Notification API — the degraded pi#7 path).
 */
export type LocalNotificationScheduler = (
  title: string,
  options: NotificationOptions,
  sessionUrl: string,
) => Promise<boolean>;

export interface BrowserNotificationEnvironment {
  createWindowNotification: (title: string, options?: NotificationOptions) => WindowNotificationLike;
  getServiceWorkerRegistration: (() => Promise<ServiceWorkerRegistrationLike | undefined>) | null;
  /** Absent (or null) in every browser — the web paths are used unchanged. */
  scheduleLocalNotification?: LocalNotificationScheduler | null;
}

export interface BrowserNotificationOptions {
  title: string;
  body: string;
  sessionUrl: string;
  onClick: () => void;
  tag?: string;
}

export type NotificationDelivery = "service-worker" | "window" | "local-notifications" | null;

type DocumentAttentionState = Pick<Document, "visibilityState" | "hasFocus">;

export function shouldShowBrowserNotification(
  attentionState: DocumentAttentionState = document,
): boolean {
  return attentionState.visibilityState !== "visible" || !attentionState.hasFocus();
}

export function isBlockingExtensionUiRequest(
  request: ExtensionUiRequest,
): request is BlockingExtensionUiRequest {
  switch (request.method) {
    case "select":
    case "confirm":
    case "input":
    case "editor":
      return true;
    case "custom":
      return request.closed !== true;
    default:
      return false;
  }
}

export function claimExtensionAttentionNotification(
  request: ExtensionUiRequest,
  notifiedRequestIds: Set<string>,
): request is BlockingExtensionUiRequest {
  if (!isBlockingExtensionUiRequest(request) || notifiedRequestIds.has(request.id)) return false;
  notifiedRequestIds.add(request.id);
  return true;
}

function getCapacitorLocalNotificationScheduler(): LocalNotificationScheduler | null {
  const localNotifications = getCapacitorLocalNotifications();
  if (!localNotifications?.schedule) return null;
  // Local notification ids must be unique int32s; a monotonically increasing
  // counter within this page's lifetime is sufficient (immediate schedules,
  // no cross-launch bookkeeping).
  let nextId = 1;
  return async (title, options, sessionUrl) => {
    try {
      // The official plugin requires the { notifications: [...] } envelope —
      // both native implementations (LocalNotification.java,
      // LocalNotificationsPlugin.swift) reject a flat payload with
      // "Must provide notifications array as notifications option".
      await localNotifications.schedule({
        notifications: [
          {
            id: nextId,
            title,
            body: String(options.body ?? ""),
            extra: { sessionUrl },
          },
        ],
      });
      nextId = (nextId % 2147483647) + 1;
      return true;
    } catch {
      // Permission denied or the plugin unavailable — fall back to the web paths.
      return false;
    }
  };
}

function getBrowserEnvironment(): BrowserNotificationEnvironment {
  return {
    createWindowNotification: (title, options) => new Notification(title, options),
    getServiceWorkerRegistration: "serviceWorker" in navigator
      ? () => navigator.serviceWorker.getRegistration()
      : null,
    scheduleLocalNotification: getCapacitorLocalNotificationScheduler(),
  };
}

export async function showBrowserNotification(
  options: BrowserNotificationOptions,
  environment: BrowserNotificationEnvironment = getBrowserEnvironment(),
): Promise<NotificationDelivery> {
  const notificationOptions: NotificationOptions = {
    body: options.body,
    ...(options.tag ? { tag: options.tag, renotify: true } : {}),
  };

  // Shell delivery first (pi#31): WKWebView/Android WebView have no usable
  // Notification API, so when the Capacitor bridge is present the
  // LocalNotifications plugin owns delivery. The extra payload carries the
  // session URL for the tap handler (see AppShell).
  if (environment.scheduleLocalNotification) {
    try {
      const delivered = await environment.scheduleLocalNotification(
        options.title,
        notificationOptions,
        options.sessionUrl,
      );
      if (delivered) return "local-notifications";
    } catch {
      // Fall through to the web delivery paths.
    }
  }

  if (environment.getServiceWorkerRegistration) {
    try {
      const registration = await environment.getServiceWorkerRegistration();
      if (registration) {
        await registration.showNotification(options.title, {
          ...notificationOptions,
          data: { url: options.sessionUrl },
        });
        return "service-worker";
      }
    } catch {
      // Fall back to a page notification where the constructor is supported.
    }
  }

  try {
    const notification = environment.createWindowNotification(options.title, notificationOptions);
    notification.onclick = () => {
      notification.close();
      options.onClick();
    };
    return "window";
  } catch {
    // Most mobile browsers expose Notification but require service-worker delivery.
    return null;
  }
}
