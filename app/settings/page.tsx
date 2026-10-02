"use client";

import { useEffect, useState } from "react";
import { SettingsPanel } from "@/components/SettingsPanel";
import { I18nProvider } from "@/hooks/useI18n";
import { SETTINGS_SECTION_VALUES, type SettingsSection } from "@/lib/settings-navigation";

// 独立设置页：供「移出到桌面」的独立窗口/新标签页使用。
// 从 URL 查询参数读取板块与工作目录（?section=models&cwd=...）。
export default function SettingsPage() {
  const [ready, setReady] = useState(false);
  const [section, setSection] = useState<SettingsSection>("general");
  const [cwd, setCwd] = useState<string | null>(null);
  const [quote, setQuote] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get("section");
    if (raw && (SETTINGS_SECTION_VALUES as readonly string[]).includes(raw)) {
      setSection(raw as SettingsSection);
    }
    const rawCwd = params.get("cwd");
    setCwd(rawCwd && rawCwd.length > 0 ? rawCwd : null);
    try {
      setQuote(localStorage.getItem("pi-quote-selection-enabled") === "true");
    } catch {
      // ignore storage errors
    }
    setReady(true);
  }, []);

  const close = () => {
    // 弹窗/独立窗口可关闭；浏览器新标签页则回到首页
    try {
      if (window.opener) {
        window.close();
        return;
      }
    } catch {
      // ignore
    }
    window.location.href = "/";
  };

  if (!ready) return null;

  return (
    <I18nProvider>
      <SettingsPanel
        cwd={cwd}
        sessionId={null}
        initialSection={section}
        onClose={close}
        onSessionReloaded={() => {}}
        quoteSelectionEnabled={quote}
        onQuoteSelectionChange={(enabled) => {
          setQuote(enabled);
          try {
            localStorage.setItem("pi-quote-selection-enabled", String(enabled));
          } catch {
            // ignore storage errors
          }
        }}
        undockable={false}
        standalone
      />
    </I18nProvider>
  );
}
