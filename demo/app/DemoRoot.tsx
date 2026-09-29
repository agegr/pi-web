"use client";

import "@/mock/install";
import { AppShell } from "@/components/AppShell";
import { I18nProvider } from "@/hooks/useI18n";

export function DemoRoot() {
  return (
    <I18nProvider>
      <AppShell />
    </I18nProvider>
  );
}
