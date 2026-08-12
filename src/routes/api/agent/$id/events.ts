import { createFileRoute } from "@tanstack/react-router";
import { GET as getAgentEvents } from "@/app/api/agent/[id]/events/route";

export const Route = createFileRoute("/api/agent/$id/events")({
  server: {
    handlers: {
      GET: ({ request, params }) => getAgentEvents(request, {
        params: Promise.resolve({ id: params.id }),
      }),
    },
  },
});
