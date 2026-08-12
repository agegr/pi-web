import { createFileRoute } from "@tanstack/react-router";
import { GET as getExport } from "@/app/api/sessions/[id]/export/route";

export const Route = createFileRoute("/api/sessions/$id/export")({
  server: {
    handlers: {
      GET: ({ request, params }) => getExport(request, {
        params: Promise.resolve({ id: params.id }),
      }),
    },
  },
});
