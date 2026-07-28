import { Suspense } from "react";
import { AppShell } from "@/components/AppShell";
import { AuthGate } from "@/components/AuthGate";

export default function Home() {
  return (
    <Suspense>
      <AuthGate>
        <AppShell />
      </AuthGate>
    </Suspense>
  );
}
