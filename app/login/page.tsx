import { Suspense } from "react";
import { authIsConfigured } from "@/lib/auth";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm configured={authIsConfigured()} />
    </Suspense>
  );
}
