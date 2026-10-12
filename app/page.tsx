import { Suspense } from "react";
import { AppShell } from "@/components/AppShell";
import { I18nProvider } from "@/hooks/useI18n";
import { OptionalWebSkins } from "@/components/OptionalWebSkins";

export default function Home() {
  return (
    <Suspense>
      <I18nProvider>
        <AppShell />
        <OptionalWebSkins />
      </I18nProvider>
    </Suspense>
  );
}
