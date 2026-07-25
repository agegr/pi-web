import { Suspense } from "react";
import { cookies, headers } from "next/headers";
import { AppShell } from "@/components/AppShell";

const MOBILE_USER_AGENT = /Android|iPhone|iPad|iPod|Mobile|IEMobile|Opera Mini/i;
const GET_STARTED_COOKIE = "pi-get-started-seen";

export default async function Home() {
  const [requestHeaders, cookieStore] = await Promise.all([headers(), cookies()]);
  const userAgent = requestHeaders.get("user-agent") ?? "";

  return (
    <Suspense>
      <AppShell
        initialIsMobile={MOBILE_USER_AGENT.test(userAgent)}
        initialShowGetStarted={cookieStore.get(GET_STARTED_COOKIE)?.value !== "1"}
      />
    </Suspense>
  );
}
