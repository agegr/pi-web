import { createFileRoute } from "@tanstack/react-router";
import { POST as postAutoName } from "@/app/api/sessions/[id]/auto-name/route";

export const Route = createFileRoute("/api/sessions/$id/auto-name")({
  server: {
    handlers: {
      POST: ({ request, params }) => postAutoName(request, {
        params: Promise.resolve({ id: params.id }),
      }),
    },
  },
});
