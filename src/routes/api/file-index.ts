import { createFileRoute } from "@tanstack/react-router";
import { GET as GETHandler } from "@/app/api/file-index/route";

export const Route = createFileRoute("/api/file-index")({
  server: {
    handlers: {
      GET: ({ request }) => GETHandler(request),
    },
  },
});
