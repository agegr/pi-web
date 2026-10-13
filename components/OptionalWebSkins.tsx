"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useTheme } from "@/hooks/useTheme";
import { ConfigButton } from "./SettingsUi";
import { isWebSkinId, parseWebSkinManifest, webSkinStyles, WEB_SKIN_STORAGE_KEY, type WebSkin } from "@/lib/web-skin";

function readSelection(): string | null | undefined {
  try { return localStorage.getItem(WEB_SKIN_STORAGE_KEY); } catch { return undefined; }
}
function saveSelection(id: string | null): boolean {
  try {
    if (id) localStorage.setItem(WEB_SKIN_STORAGE_KEY, id);
    else localStorage.removeItem(WEB_SKIN_STORAGE_KEY);
    return true;
  } catch { return false; }
}

/** No catalog configured/installed: renders nothing and never requests an image. */
export function OptionalWebSkins() {
  const { t } = useI18n();
  const { isDark } = useTheme();
  const [skins, setSkins] = useState<WebSkin[]>([]);
  const [selection, setSelection] = useState<string | null>(null);
  const [ready, setReady] = useState<WebSkin | null>(null);
  const [open, setOpen] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [placement, setPlacement] = useState({ bottom: 16, right: 16, menuBottom: 36, maxHeight: 560 });
  const button = useRef<HTMLButtonElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  // undefined follows storage; null is an unsaved choice to disable the skin.
  const unsavedSelection = useRef<string | null | undefined>(undefined);
  const rememberSelection = useCallback((id: string | null) => {
    unsavedSelection.current = saveSelection(id) ? undefined : id;
  }, []);
  const selected = skins.find((skin) => skin.id === selection) ?? null;
  const active = ready === selected ? ready : null;
  const menuOpen = open && skins.length > 0;

  useEffect(() => {
    let disposed = false;
    let current: AbortController | null = null;
    const refresh = async () => {
      current?.abort();
      const controller = new AbortController();
      current = controller;
      try {
        const response = await fetch("/api/web-skins", { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("Unavailable skin catalog");
        const data = await response.json() as { skins?: unknown[] };
        const catalog = (Array.isArray(data.skins) ? data.skins : []).flatMap((value) => {
          if (!value || typeof value !== "object" || !("id" in value) || !isWebSkinId(value.id)) return [];
          const { id, ...manifest } = value;
          const parsed = parseWebSkinManifest(manifest);
          return parsed ? [{ id, ...parsed }] : [];
        });
        if (disposed || controller.signal.aborted) return;
        setSkins(catalog);
        if (!catalog.length) setOpen(false);
        // A failed write can leave getItem working but returning a stale value.
        const stored = unsavedSelection.current === undefined ? readSelection() : unsavedSelection.current;
        setSelection((previous) => {
          const next = stored === undefined ? previous : stored;
          if (next && catalog.some((skin) => skin.id === next)) return next;
          if (next) rememberSelection(null);
          return null;
        });
      } catch {
        if (!disposed && !controller.signal.aborted) { setSkins([]); setSelection(null); setOpen(false); }
      }
    };
    const storage = (event: StorageEvent) => {
      if (event.key === WEB_SKIN_STORAGE_KEY || event.key === null) void refresh();
    };
    void refresh();
    window.addEventListener("focus", refresh);
    window.addEventListener("storage", storage);
    return () => {
      disposed = true; current?.abort();
      window.removeEventListener("focus", refresh);
      window.removeEventListener("storage", storage);
    };
  }, [rememberSelection]);

  useEffect(() => {
    if (!selected) return;
    let disposed = false;
    if (!selected.background) { queueMicrotask(() => { if (!disposed) setReady(selected); }); }
    else {
      const image = new Image();
      image.onload = () => { if (!disposed) setReady(selected); };
      image.onerror = () => {
        if (disposed) return;
        setSelection(null); setImageError(true); rememberSelection(null);
      };
      image.src = `/api/web-skins/${encodeURIComponent(selected.id)}/background`;
      return () => { disposed = true; image.onload = null; image.onerror = null; };
    }
    return () => { disposed = true; };
  }, [selected, rememberSelection]);

  useLayoutEffect(() => {
    if (!active) return;
    const root = document.documentElement;
    const previous = new Map<string, [string, string]>();
    const styles = webSkinStyles(active, isDark);
    const oldId = root.dataset.webSkin;
    for (const [key, value] of Object.entries(styles)) {
      previous.set(key, [root.style.getPropertyValue(key), root.style.getPropertyPriority(key)]);
      root.style.setProperty(key, value);
    }
    root.dataset.webSkin = active.id;
    return () => {
      for (const [key, [value, priority]] of previous) {
        if (value) root.style.setProperty(key, value, priority);
        else root.style.removeProperty(key);
      }
      if (oldId === undefined) delete root.dataset.webSkin;
      else root.dataset.webSkin = oldId;
    };
  }, [active, isDark]);

  useLayoutEffect(() => {
    if (!skins.length) return;
    const measure = () => {
      const vv = window.visualViewport;
      const top = vv?.offsetTop ?? 0;
      const right = (vv?.offsetLeft ?? 0) + (vv?.width ?? innerWidth) - 16;
      let bottom = top + (vv?.height ?? innerHeight) - 16;
      const controls = [...document.querySelectorAll<HTMLElement>('button,textarea,[contenteditable="true"]')]
        .filter((node) => !host.current?.contains(node));
      const rectangles = controls.map((node) => node.getBoundingClientRect()).filter((r) => r.width && r.height).sort((a,b) => b.top - a.top);
      for (const r of rectangles) {
        if (r.left < right + 6 && r.right > right - 34 && r.top < bottom + 6 && r.bottom > bottom - 34) bottom = Math.min(bottom, r.top - 8);
      }
      bottom = Math.max(top + 36, bottom);
      let menuBottom = bottom - 36;
      const width = Math.min(264, (vv?.width ?? innerWidth) - 32);
      for (const node of controls.filter((el) => el.tagName === "TEXTAREA" || el.isContentEditable)) {
        let r = node.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        let parent = node.parentElement;
        for (let depth = 0; parent && depth < 4; depth++, parent = parent.parentElement) {
          const parentRect = parent.getBoundingClientRect();
          if (parent.querySelector("button") && parentRect.height <= r.height + 128) { r = parentRect; break; }
        }
        if (r.left < right && r.right > right - width && r.top < menuBottom && r.bottom > Math.max(top + 8, menuBottom - 560)) menuBottom = Math.min(menuBottom, r.top - 12);
      }
      setPlacement({ bottom: Math.max(8, innerHeight-bottom), right: Math.max(8,innerWidth-right), menuBottom: Math.max(36,bottom-menuBottom), maxHeight: Math.max(0,Math.min(560,menuBottom-top-8)) });
    };
    measure();
    window.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("scroll", measure);
    const observer = new ResizeObserver(measure);
    document.querySelectorAll("textarea").forEach((el) => observer.observe(el));
    return () => {
      observer.disconnect(); window.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("scroll", measure);
    };
  }, [skins.length, open]);

  useEffect(() => {
    if (!menuOpen) return;
    panel.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus();
    const outside = (event: PointerEvent) => { if (!host.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setOpen(false); button.current?.focus(); }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape, true);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape, true); };
  }, [menuOpen]);

  if (!skins.length) return null;
  const choose = (id: string | null) => {
    setSelection(id); rememberSelection(id); setImageError(false); setOpen(false); button.current?.focus();
  };
  return (
    <div ref={host} className="web-skin-control" style={{ bottom: placement.bottom, right: placement.right }}>
      <ConfigButton ref={button} variant="secondary" size="small" className="web-skin-toggle" aria-label={t("skins.choose")} title={t("skins.choose")} aria-expanded={menuOpen} aria-controls="web-skin-panel" onClick={() => setOpen(!open)}>♪</ConfigButton>
      {menuOpen && <div ref={panel} id="web-skin-panel" role="dialog" aria-label={t("skins.choose")} className="web-skin-panel" style={{ bottom: placement.menuBottom, maxHeight: placement.maxHeight }}>
        <div className="web-skin-heading">{t("skins.choose")}</div>
        {[{ id: null, name: t("skins.none") }, ...skins].map((skin) => <button key={skin.id ?? "none"} type="button" aria-pressed={(selected?.id ?? null) === skin.id} onClick={() => choose(skin.id)}>{skin.name}</button>)}
        {imageError && <p role="alert">{t("skins.failed")}</p>}
      </div>}
    </div>
  );
}
