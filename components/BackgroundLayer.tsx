"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useBackground } from "@/hooks/useBackground";
import { useI18n } from "@/hooks/useI18n";

function SpeakerIcon({ muted }: { muted: boolean }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none" />
      {muted ? (
        <>
          <line x1="23" y1="9" x2="17" y2="15" />
          <line x1="17" y1="9" x2="23" y2="15" />
        </>
      ) : (
        <>
          <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
          <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
        </>
      )}
    </svg>
  );
}

export function BackgroundLayer() {
  const { t } = useI18n();
  const {
    enabled,
    coverage,
    sound,
    dim,
    intervalSec,
    items,
    currentItem,
    setSound,
    next,
  } = useBackground();

  const videoRef = useRef<HTMLVideoElement | null>(null);
  // Browsers only allow unmuted autoplay after a user gesture on the page.
  // Track that so a stored "sound on" preference can resume once unlocked.
  const [unlocked, setUnlocked] = useState(false);

  useEffect(() => {
    if (unlocked || typeof window === "undefined") return;
    const unlock = () => setUnlocked(true);
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, [unlocked]);

  // Drive the transparency overrides in globals.css.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    if (enabled && currentItem) {
      root.dataset.piBg = coverage;
      root.style.setProperty("--pi-bg-dim", String(dim));
    } else {
      delete root.dataset.piBg;
      root.style.removeProperty("--pi-bg-dim");
    }
  }, [enabled, coverage, dim, currentItem]);

  // Resume playback with sound once a user gesture unlocks unmuted autoplay.
  const muted = !sound || !unlocked;
  useEffect(() => {
    if (!muted && videoRef.current) {
      void videoRef.current.play().catch(() => {});
    }
  }, [muted, currentItem?.id]);

  // Images rotate on the configured interval (0 = never); videos rotate on
  // end (single videos loop instead).
  useEffect(() => {
    if (!enabled || !currentItem || currentItem.kind !== "image") return;
    if (items.length <= 1 || intervalSec <= 0) return;
    const timer = setInterval(() => next(), intervalSec * 1000);
    return () => clearInterval(timer);
  }, [enabled, currentItem, intervalSec, items.length, next]);

  const handleSoundToggle = useCallback(() => {
    const nextSound = !sound;
    setSound(nextSound);
    if (nextSound) {
      setUnlocked(true);
      requestAnimationFrame(() => {
        void videoRef.current?.play().catch(() => {});
      });
    }
  }, [sound, setSound]);

  if (!enabled || !currentItem) return null;

  return (
    <>
      <div className="pi-bg-layer" aria-hidden="true">
        {currentItem.kind === "video" ? (
          <video
            key={currentItem.id}
            ref={videoRef}
            src={currentItem.url}
            autoPlay
            playsInline
            muted={muted}
            loop={items.length <= 1}
            onEnded={() => {
              if (items.length > 1) next();
            }}
          />
        ) : (
          <img key={currentItem.id} src={currentItem.url} alt="" />
        )}
        <div className="pi-bg-dim" />
      </div>
      {currentItem.kind === "video" && (
        <button
          type="button"
          className="pi-bg-sound-toggle"
          onClick={handleSoundToggle}
          title={muted ? t("settings.bgSoundOn") : t("settings.bgSoundOff")}
          aria-label={muted ? t("settings.bgSoundOn") : t("settings.bgSoundOff")}
        >
          <SpeakerIcon muted={muted} />
        </button>
      )}
    </>
  );
}
