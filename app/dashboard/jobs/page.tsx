import type { Metadata } from "next";
import { Suspense } from "react";
import { JobsBoard } from "@/components/robin/JobsBoard";
import { I18nProvider } from "@/hooks/useI18n";

// Static because metadata is rendered on the server, before the viewer's
// locale (which lives in localStorage) is known.
export const metadata: Metadata = {
  title: "Jobs — Pi Web",
};

export default function DashboardJobsPage() {
  return (
    <Suspense>
      <I18nProvider>
        <JobsBoard />
      </I18nProvider>
    </Suspense>
  );
}
