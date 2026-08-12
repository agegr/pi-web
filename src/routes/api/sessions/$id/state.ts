import { createFileRoute } from "@tanstack/react-router";
import { GET as getState } from "@/app/api/sessions/[id]/state/route";

export const Route = createFileRoute("/api/sessions/$id/state")({
  server: {
    handlers: {
      GET: ({ request, params }) => getState(request, {
        params: Promise.resolve({ id: params.id }),
      }),
    },
  },
});
