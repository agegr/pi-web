import type { Metadata } from "next";
import { Suspense } from "react";
import { GmailBoard } from "@/components/robin/GmailBoard";
import { I18nProvider } from "@/hooks/useI18n";

// Static because metadata is rendered on the server, before the viewer's
// locale (which lives in localStorage) is known.
export const metadata: Metadata = {
  title: "Gmail — Pi Web",
};

export default function DashboardGmailPage() {
  return (
    <Suspense>
      <I18nProvider>
        <GmailBoard />
      </I18nProvider>
    </Suspense>
  );
}
