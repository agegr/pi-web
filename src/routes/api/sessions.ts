import { createFileRoute } from "@tanstack/react-router";
import { GET as getSessions } from "@/app/api/sessions/route";

export const Route = createFileRoute("/api/sessions")({
  server: {
    handlers: {
      GET: ({ request }) => getSessions(request),
    },
  },
});
