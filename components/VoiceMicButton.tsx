"use client";

import { useVoiceInput } from "@/hooks/useVoiceInput";
import { useI18n } from "@/hooks/useI18n";

interface Props {
  onTranscript: (text: string) => void;
}

export function VoiceMicButton({ onTranscript }: Props) {
  const { t } = useI18n();
  const { phase, error, progress, lang, cycleLang, toggle } = useVoiceInput(onTranscript);
  const listening = phase === "recording";
  const busy = phase === "preparing" || phase === "transcribing";
  const title = error
    ? error
    : phase === "preparing"
      ? t("chat.voiceDownloading", { percent: Math.round(progress * 100) })
      : phase === "transcribing"
        ? t("chat.voiceTranscribing")
        : listening
          ? t("chat.voiceStop")
          : `${t("chat.voice")} · ${t(lang === "zh" ? "chat.voiceLangZh" : lang === "en" ? "chat.voiceLangEn" : "chat.voiceLangAuto")}`;

  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={listening}
      disabled={busy}
      onClick={toggle}
      onContextMenu={(event) => {
        event.preventDefault();
        cycleLang();
      }}
      style={{
        flexShrink: 0,
        alignSelf: "flex-end",
        width: 36,
        height: 36,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        border: "none",
        borderRadius: 999,
        background: listening ? "#dc2626" : "transparent",
        color: listening ? "#fff" : "var(--text-muted)",
        cursor: busy ? "wait" : "pointer",
        boxShadow: listening ? "0 0 0 3px rgba(220, 38, 38, 0.22)" : "none",
        opacity: busy ? 0.7 : 1,
        transition: "background 0.12s, color 0.12s, box-shadow 0.12s",
      }}
      onMouseEnter={(event) => {
        if (!listening) event.currentTarget.style.background = "var(--bg-hover)";
      }}
      onMouseLeave={(event) => {
        if (!listening) event.currentTarget.style.background = "transparent";
      }}
    >
      {listening ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <rect x="7" y="7" width="10" height="10" rx="1.5" />
        </svg>
      ) : (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 3a3.2 3.2 0 0 0-3.2 3.2v5.1a3.2 3.2 0 1 0 6.4 0V6.2A3.2 3.2 0 0 0 12 3z" />
          <path d="M7.5 11.5a4.5 4.5 0 0 0 9 0" />
          <path d="M12 16v3.5" />
          <path d="M9 19.5h6" />
        </svg>
      )}
    </button>
  );
}
