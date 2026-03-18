import { Suspense } from "react";
import { AppShell } from "@/components/AppShell";

export default function Home() {
  return (
    <Suspense>
      <AppShell />
    </Suspense>
  );
}
