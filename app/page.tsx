import { Suspense } from "react";
import { AppShell } from "@/components/AppShell";
import { AuthGate } from "@/components/AuthGate";
import { I18nProvider } from "@/hooks/useI18n";

export default function Home() {
  return (
    <Suspense>
      <I18nProvider>
        <AuthGate>
          <AppShell />
        </AuthGate>
      </I18nProvider>
    </Suspense>
  );
}
