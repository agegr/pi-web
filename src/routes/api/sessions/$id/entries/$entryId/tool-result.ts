import { createFileRoute } from "@tanstack/react-router";
import { GET as getToolResult } from "@/app/api/sessions/[id]/entries/[entryId]/tool-result/route";

export const Route = createFileRoute("/api/sessions/$id/entries/$entryId/tool-result")({
  server: {
    handlers: {
      GET: ({ request, params }) => getToolResult(request, {
        params: Promise.resolve({ id: params.id, entryId: params.entryId }),
      }),
    },
  },
});
