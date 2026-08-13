import { SessionManager } from "@earendil-works/pi-coding-agent";
import { existsSync, mkdirSync, readFileSync } from "fs";
import { dirname, join } from "path";
import webpush from "web-push";
import { writePrivateFileAtomicSync } from "./atomic-file";
import { enLocale } from "./i18n/messages/en";
import { zhCNLocale } from "./i18n/messages/zh-CN";
import { getAgentDir } from "./session-reader";

export interface PushSubscriptionRecord {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  locale: string;
}

interface PushStateFile {
  vapidKeys: { publicKey: string; privateKey: string };
  subscriptions: PushSubscriptionRecord[];
}

interface WebPushEnvironment {
  /** Send one push payload. Returns the push service status code. */
  send: (
    subscription: PushSubscriptionRecord,
    payload: string,
    vapidKeys: PushStateFile["vapidKeys"],
  ) => Promise<{ statusCode: number }>;
  loadState: () => PushStateFile | null;
  saveState: (state: PushStateFile) => void;
  generateVapidKeys: () => PushStateFile["vapidKeys"];
  listSessionNames: () => Promise<Map<string, string>>;
  now: () => number;
}

export interface WebPushNotifier {
  getVapidPublicKey: () => string;
  addSubscription: (subscription: PushSubscriptionRecord) => void;
  removeSubscription: (endpoint: string) => void;
  notifySessionComplete: (sessionId: string) => Promise<void>;
}

const DEDUP_WINDOW_MS = 5_000;

function stateFilePath(): string {
  return join(getAgentDir(), "web-push.json");
}

function getDefaultEnvironment(): WebPushEnvironment {
  return {
    async send(subscription, payload, vapidKeys) {
      const result = await webpush.sendNotification(
        { endpoint: subscription.endpoint, keys: subscription.keys },
        payload,
        {
          vapidDetails: {
            subject: "mailto:pi-web@localhost",
            publicKey: vapidKeys.publicKey,
            privateKey: vapidKeys.privateKey,
          },
        },
      );
      return { statusCode: result.statusCode };
    },
    loadState() {
      const path = stateFilePath();
      if (!existsSync(path)) return null;
      try {
        return JSON.parse(readFileSync(path, "utf8")) as PushStateFile;
      } catch {
        return null;
      }
    },
    saveState(state) {
      const path = stateFilePath();
      mkdirSync(dirname(path), { recursive: true });
      writePrivateFileAtomicSync(path, JSON.stringify(state));
    },
    generateVapidKeys: () => webpush.generateVAPIDKeys(),
    async listSessionNames() {
      const names = new Map<string, string>();
      try {
        for (const session of await SessionManager.listAll()) {
          if (session.name) names.set(session.id, session.name);
        }
      } catch {
        // Session list is best-effort; fall back to the generic title.
      }
      return names;
    },
    now: () => Date.now(),
  };
}

/**
 * Locale lookup for push payloads. The browser reports its UI locale when it
 * subscribes; unknown locales fall back to English.
 */
export function localeText(locale: string, key: "sessionComplete" | "taskFinished"): string {
  if (locale === "zh-CN") {
    const message = zhCNLocale.messages[key === "sessionComplete" ? "i18n.sessionComplete" : "i18n.taskFinished"];
    if (message) return message;
  }
  const message = enLocale.messages[key === "sessionComplete" ? "i18n.sessionComplete" : "i18n.taskFinished"];
  return message ?? (key === "sessionComplete" ? "Session complete" : "Task finished.");
}

export function createWebPushNotifier(environment: WebPushEnvironment): WebPushNotifier {
  const state: PushStateFile = (() => {
    const loaded = environment.loadState();
    if (loaded?.vapidKeys?.publicKey && loaded.vapidKeys.privateKey) return loaded;
    return { vapidKeys: environment.generateVapidKeys(), subscriptions: [] };
  })();
  const saveState = () => {
    environment.saveState(state);
  };

  // ponytail: per-session in-memory dedup, collapses duplicate agent_end
  // events from parallel SSE connections; separate runs of the same session
  // finish minutes apart so the 5s window never swallows a real completion.
  const lastPushBySession = new Map<string, number>();

  return {
    getVapidPublicKey() {
      saveState();
      return state.vapidKeys.publicKey;
    },
    addSubscription(subscription) {
      state.subscriptions = [
        ...state.subscriptions.filter((s) => s.endpoint !== subscription.endpoint),
        subscription,
      ];
      saveState();
    },
    removeSubscription(endpoint) {
      state.subscriptions = state.subscriptions.filter((s) => s.endpoint !== endpoint);
      saveState();
    },
    async notifySessionComplete(sessionId) {
      const lastPush = lastPushBySession.get(sessionId) ?? Number.NEGATIVE_INFINITY;
      if (environment.now() - lastPush < DEDUP_WINDOW_MS) return;
      lastPushBySession.set(sessionId, environment.now());

      if (state.subscriptions.length === 0) return;
      const sessionName = (await environment.listSessionNames()).get(sessionId);
      const payloadFor = (locale: string) => ({
        title: sessionName ?? localeText(locale, "sessionComplete"),
        body: localeText(locale, "taskFinished"),
        url: `/?session=${encodeURIComponent(sessionId)}`,
      });

      let pruned = false;
      for (const subscription of [...state.subscriptions]) {
        try {
          const { statusCode } = await environment.send(
            subscription,
            JSON.stringify(payloadFor(subscription.locale)),
            state.vapidKeys,
          );
          // 404/410 mean the push service dropped the subscription; remove it
          // so future sends don't keep failing against a dead endpoint.
          if (statusCode === 404 || statusCode === 410) {
            state.subscriptions = state.subscriptions.filter((s) => s.endpoint !== subscription.endpoint);
            pruned = true;
          }
        } catch {
          // Delivery is best-effort; a dead push service must not break the agent stream.
        }
      }
      if (pruned) saveState();
    },
  };
}

let notifierPromise: Promise<WebPushNotifier> | undefined;

function getNotifier(): Promise<WebPushNotifier> {
  if (!notifierPromise) {
    notifierPromise = Promise.resolve().then(() => createWebPushNotifier(getDefaultEnvironment()));
  }
  return notifierPromise;
}

export function getVapidPublicKey(): Promise<string> {
  return getNotifier().then((notifier) => notifier.getVapidPublicKey());
}

export function addSubscription(subscription: PushSubscriptionRecord): Promise<void> {
  return getNotifier().then((notifier) => notifier.addSubscription(subscription));
}

export function removeSubscription(endpoint: string): Promise<void> {
  return getNotifier().then((notifier) => notifier.removeSubscription(endpoint));
}

/** Fire when the agent ends so backgrounded PWAs (notably iOS) still notify. */
export async function notifyAgentEnd(sessionId: string): Promise<void> {
  const notifier = await getNotifier();
  await notifier.notifySessionComplete(sessionId);
}
