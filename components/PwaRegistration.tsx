"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./PwaRegistration.module.css";

const UPDATE_INTERVAL_MS = 60 * 60 * 1000;

export function PwaRegistration() {
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);
  const refreshingRef = useRef(false);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    const appVersion = process.env.NEXT_PUBLIC_APP_VERSION ?? "dev";
    let registration: ServiceWorkerRegistration | null = null;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const watchInstallingWorker = (worker: ServiceWorker) => {
      worker.addEventListener("statechange", () => {
        if (worker.state === "installed" && navigator.serviceWorker.controller) {
          setWaitingWorker(worker);
        }
      });
    };

    const register = async () => {
      try {
        registration = await navigator.serviceWorker.register(
          `/sw.js?v=${encodeURIComponent(appVersion)}`,
          { scope: "/" },
        );
        if (registration.waiting && navigator.serviceWorker.controller) {
          setWaitingWorker(registration.waiting);
        }
        registration.addEventListener("updatefound", () => {
          if (registration?.installing) watchInstallingWorker(registration.installing);
        });

        // 浏览器不会保证常驻检查，前台恢复和定时器共同触发轻量更新检测。
        const checkForUpdate = () => {
          if (document.visibilityState === "visible") void registration?.update();
        };
        document.addEventListener("visibilitychange", checkForUpdate);
        intervalId = setInterval(checkForUpdate, UPDATE_INTERVAL_MS);
        void registration.update();

        return () => document.removeEventListener("visibilitychange", checkForUpdate);
      } catch (error) {
        console.error("PWA Service Worker 注册失败", error);
      }
    };

    let removeVisibilityListener: (() => void) | undefined;
    if (document.readyState === "complete") {
      void register().then((cleanup) => { removeVisibilityListener = cleanup; });
    } else {
      const handleLoad = () => {
        void register().then((cleanup) => { removeVisibilityListener = cleanup; });
      };
      window.addEventListener("load", handleLoad, { once: true });
      removeVisibilityListener = () => window.removeEventListener("load", handleLoad);
    }

    const handleControllerChange = () => {
      if (refreshingRef.current) return;
      refreshingRef.current = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", handleControllerChange);

    return () => {
      removeVisibilityListener?.();
      if (intervalId) clearInterval(intervalId);
      navigator.serviceWorker.removeEventListener("controllerchange", handleControllerChange);
    };
  }, []);

  const applyUpdate = useCallback(() => {
    if (!waitingWorker) return;
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
