import { createFileRoute } from "@tanstack/react-router";
import { GET as getThinking } from "@/app/api/sessions/[id]/entries/[entryId]/thinking/route";

export const Route = createFileRoute("/api/sessions/$id/entries/$entryId/thinking")({
  server: {
    handlers: {
      GET: ({ request, params }) => getThinking(request, {
        params: Promise.resolve({ id: params.id, entryId: params.entryId }),
      }),
    },
  },
});
