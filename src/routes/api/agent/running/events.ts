import { createFileRoute } from "@tanstack/react-router";
import { GET as getRunningEvents } from "@/app/api/agent/running/events/route";

export const Route = createFileRoute("/api/agent/running/events")({
  server: {
    handlers: {
      GET: ({ request }) => getRunningEvents(request),
    },
  },
});
