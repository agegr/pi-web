"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./PwaRegistration.module.css";

const UPDATE_INTERVAL_MS = 60 * 60 * 1000;
const CACHE_PREFIX = "pi-web-";

export function PwaRegistration() {
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);
  const refreshingRef = useRef(false);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) {
      return;
    }

    if (process.env.NODE_ENV !== "production") {
      // 旧版本可能已在同源开发地址注册，继续控制页面会让 HMR 加载缓存的 chunk。
      void navigator.serviceWorker.getRegistrations().then((registrations) => (
        Promise.all(registrations.map((registration) => registration.unregister()))
      )).catch((error: unknown) => {
        console.error("PWA Service Worker 注销失败", error);
      });
      if ("caches" in window) {
        void caches.keys().then((keys) => (
          Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX)).map((key) => caches.delete(key)))
        )).catch((error: unknown) => {
          console.error("PWA 缓存清理失败", error);
        });
      }
      return;
    }

    const appVersion = process.env.NEXT_PUBLIC_APP_VERSION ?? "dev";
    const scriptUrl = `/sw.js?v=${encodeURIComponent(appVersion)}`;
    let registration: ServiceWorkerRegistration | null = null;
    let intervalId: ReturnType<typeof setInterval> | null = null;
    let disposed = false;

    const watchInstallingWorker = (worker: ServiceWorker) => {
      worker.addEventListener("statechange", () => {
        if (!disposed && worker.state === "installed" && navigator.serviceWorker.controller) {
          setWaitingWorker(worker);
        }
      });
    };

    const handleUpdateFound = () => {
      if (registration?.installing) watchInstallingWorker(registration.installing);
    };

    const checkForUpdate = () => {
      if (document.visibilityState === "visible") {
        void registration?.update().catch((error: unknown) => {
          console.error("PWA Service Worker 更新检查失败", error);
        });
      }
    };

    const register = async () => {
      try {
        const nextRegistration = await navigator.serviceWorker.register(scriptUrl, {
          scope: "/",
          updateViaCache: "none",
        });
        if (disposed) return;

        registration = nextRegistration;
        if (registration.waiting && navigator.serviceWorker.controller) {
          setWaitingWorker(registration.waiting);
        }
        registration.addEventListener("updatefound", handleUpdateFound);
        document.addEventListener("visibilitychange", checkForUpdate);
        intervalId = setInterval(checkForUpdate, UPDATE_INTERVAL_MS);
        checkForUpdate();
      } catch (error) {
        console.error("PWA Service Worker 注册失败", error);
      }
    };

    const handleLoad = () => void register();
    if (document.readyState === "complete") {
      void register();
    } else {
      window.addEventListener("load", handleLoad, { once: true });
    }

    const handleControllerChange = () => {
      if (refreshingRef.current) return;
      refreshingRef.current = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", handleControllerChange);

    return () => {
      disposed = true;
      window.removeEventListener("load", handleLoad);
      document.removeEventListener("visibilitychange", checkForUpdate);
      registration?.removeEventListener("updatefound", handleUpdateFound);
      if (intervalId) clearInterval(intervalId);
      navigator.serviceWorker.removeEventListener("controllerchange", handleControllerChange);
    };
  }, []);

  const applyUpdate = useCallback(() => {
    if (!waitingWorker) return;
    refreshingRef.current = false;
    waitingWorker.postMessage({ type: "SKIP_WAITING" });
  }, [waitingWorker]);

  if (!waitingWorker) return null;

  return (
    <aside className={styles.updatePrompt} role="status" aria-live="polite">
      <span>发现新版本</span>
      <div className={styles.actions}>
        <button type="button" className={styles.laterButton} onClick={() => setWaitingWorker(null)}>
          稍后
        </button>
        <button type="button" className={styles.updateButton} onClick={applyUpdate}>
          立即更新
        </button>
      </div>
    </aside>
  );
}
