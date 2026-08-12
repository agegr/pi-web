import { createFileRoute } from "@tanstack/react-router";
import { GET as getContext } from "@/app/api/sessions/[id]/context/route";

export const Route = createFileRoute("/api/sessions/$id/context")({
  server: {
    handlers: {
      GET: ({ request, params }) => getContext(request, {
        params: Promise.resolve({ id: params.id }),
      }),
    },
  },
});
