import { createFileRoute } from "@tanstack/react-router";
import { POST as postLogout } from "@/app/api/auth/logout/[provider]/route";

export const Route = createFileRoute("/api/auth/logout/$provider")({
  server: {
    handlers: {
      POST: ({ request, params }) => postLogout(request, {
        params: Promise.resolve({ provider: params.provider }),
      }),
    },
  },
});
