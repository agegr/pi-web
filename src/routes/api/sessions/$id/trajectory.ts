import { createFileRoute } from "@tanstack/react-router";
import { GET as getTrajectory } from "@/app/api/sessions/[id]/trajectory/route";

export const Route = createFileRoute("/api/sessions/$id/trajectory")({
  server: {
    handlers: {
      GET: ({ request, params }) => getTrajectory(request, {
        params: Promise.resolve({ id: params.id }),
      }),
    },
  },
});
