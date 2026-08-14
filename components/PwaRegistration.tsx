"use client";

import { useEffect } from "react";

export function PwaRegistration() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) {
      return;
    }

    if (process.env.NODE_ENV !== "production") {
      // 开发模式不注册新的 SW;反之,如果有上一次 `npm start`/`next start`
      // 注册的 SW 还活着,它会拦截 /_next/static/* 并把生产构建的 chunk
      // 喂给开发页面,触发 "module factory is not available" 之类的运行时
      // 错误。注销掉,让浏览器回到网络直连。
      //
      // 关键:注销只是 promise,当前页面已被旧 SW 控制。必须 location.reload()
      // 才能让下一次加载真正从网络拿新 chunk。
      void navigator.serviceWorker
        .getRegistrations()
        .then((registrations) => {
          const active = registrations.filter((r) => r.active !== null);
          if (active.length === 0) return false;
          return Promise.all(active.map((r) => r.unregister())).then(() => true);
        })
        .then((unregistered) => {
          if (unregistered) {
            // 给 SW 一拍时间完成 unregister,然后强制刷新页面
            window.setTimeout(() => window.location.reload(), 50);
          }
        })
        .catch(() => {
          // 忽略:某些隐私模式或受限上下文会拒绝 SW 枚举。
        });
      return;
    }

    const register = () => {
      const appVersion = process.env.NEXT_PUBLIC_APP_VERSION ?? "dev";
      const scriptUrl = `/sw.js?v=${encodeURIComponent(appVersion)}`;

      void navigator.serviceWorker.register(scriptUrl, {
        scope: "/",
        updateViaCache: "none",
      }).catch((error: unknown) => {
        console.error("Failed to register the Pi Web service worker:", error);
      });
    };

    if (document.readyState === "complete") {
      register();
      return;
    }

    window.addEventListener("load", register, { once: true });
    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}
