"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { loadWebPlugins } from "@/lib/web-plugins-client";
import type { WebPluginSlotContext, WebPluginSlotName } from "@/lib/web-plugin-types";

/** DOM-owned islands: failed/missing plugins preserve the built-in UI. */
export function WebPluginSlot({ slot, context, children }: {
  slot: WebPluginSlotName;
  context: WebPluginSlotContext;
  children?: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    const disposers: Array<() => void> = [];
    const container = root.current!;
    setMounted(false);
    void loadWebPlugins().then((runtime) => {
      if (controller.signal.aborted) return;
      let count = 0;
      for (const registration of runtime.slots) {
        if (registration.slot !== slot) continue;
        // An explicit Pi extension hint is handled only by its named web plugin.
        if (slot === "extension-dialog" && context.request?.web?.plugin
          && registration.pluginId !== context.request.web.plugin) continue;
        const island = document.createElement("div");
        const mountController = new AbortController();
        island.dataset.webPlugin = registration.pluginId;
        try {
          if (registration.renderer.matches && !registration.renderer.matches(context)) continue;
          container.appendChild(island);
          const dispose = registration.renderer.mount(island, { ...context, signal: mountController.signal });
          disposers.push(() => { mountController.abort(); if (typeof dispose === "function") dispose(); });
          count++;
          if (slot === "extension-dialog") break; // First matching renderer owns the dialog.
        } catch (error) {
          mountController.abort();
          island.remove();
          console.error(`[pi-web plugins] ${registration.pluginId} mount:`, error);
        }
      }
      setMounted(count > 0);
    });
    return () => {
      controller.abort();
      for (const dispose of disposers.reverse()) {
        try { dispose(); } catch (error) { console.error("[pi-web plugins] unmount:", error); }
      }
      container.replaceChildren();
    };
  }, [slot, context]);
  return <>
    <div ref={root} data-web-plugin-slot={slot} style={{ display: "contents" }} />
    {!mounted && children}
  </>;
}
