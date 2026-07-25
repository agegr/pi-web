"use client";

import { createContext, createElement, type ReactNode, useContext, useSyncExternalStore } from "react";

// Mobile breakpoint shared with app/globals.css (max-width: 640px).
const MOBILE_QUERY = "(max-width: 640px)";
const InitialMobileContext = createContext(false);

export function MobileInitialProvider({ value, children }: { value: boolean; children: ReactNode }) {
  return createElement(InitialMobileContext.Provider, { value }, children);
}

function subscribe(cb: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mql = window.matchMedia(MOBILE_QUERY);
  mql.addEventListener("change", cb);
  return () => mql.removeEventListener("change", cb);
}

function getSnapshot(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia(MOBILE_QUERY).matches;
}

/**
 * 服务端使用请求 UA 决定首屏，hydration 后由媒体查询接管并响应窗口变化。
 */
export function useIsMobile(initialValue?: boolean): boolean {
  const contextValue = useContext(InitialMobileContext);
  const serverValue = initialValue ?? contextValue;
  return useSyncExternalStore(subscribe, getSnapshot, () => serverValue);
}
