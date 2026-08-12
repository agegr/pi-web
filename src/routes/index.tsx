import { Suspense } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { I18nProvider } from "@/hooks/useI18n";

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>) => ({
    session: typeof search.session === "string" ? search.session : undefined,
    cwd: typeof search.cwd === "string" ? search.cwd : undefined,
  }),
  component: Home,
});

function Home() {
  return (
    <Suspense>
      <I18nProvider>
        <AppShell />
      </I18nProvider>
    </Suspense>
  );
}
