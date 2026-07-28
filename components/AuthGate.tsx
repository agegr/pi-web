"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

type AuthStatus = { initialized: boolean; authenticated: boolean };

/**
 * Prevent business UI from mounting until authentication is confirmed, and provide login or setup forms.
 * @param props Component properties.
 * @param props.children Business UI shown after authentication.
 * @returns Authentication routing interface.
 * @throws Does not throw to callers; displays a generic error interface when the status request fails.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    async function refreshStatus() {
      const response = await fetch("/api/auth/status", { cache: "no-store" });
      if (!response.ok) throw new Error("Failed to read authentication status");
      setStatus(await response.json() as AuthStatus);
    }

    refreshStatus().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Failed to read authentication status"));
  }, []);

  useEffect(() => {
    if (!status || status.authenticated) return;
    const target = status.initialized ? "/login" : "/setup";
    if (pathname !== target) router.replace(target);
  }, [pathname, router, status]);

  if (status?.authenticated) return children;
  if (error) return <main className="auth-page"><p className="auth-form-error" role="alert">Failed to read authentication status. Refresh the page and try again.</p></main>;
  return <main className="auth-page"><p>Redirecting...</p></main>;
}
