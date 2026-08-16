import type { Metadata } from "next";
import { Suspense } from "react";
import { SettingsPanel } from "@/components/robin/SettingsPanel";
import { I18nProvider } from "@/hooks/useI18n";

// Static because metadata is rendered on the server, before the viewer's
// locale (which lives in localStorage) is known.
export const metadata: Metadata = {
  title: "Settings — Pi Web",
};

export default function DashboardSettingsPage() {
  return (
    <Suspense>
      <I18nProvider>
        <SettingsPanel />
      </I18nProvider>
    </Suspense>
  );
}
