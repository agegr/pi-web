import { createFileRoute } from "@tanstack/react-router";
import { GET as GETHandler } from "@/app/api/models-config/catalog/route";

export const Route = createFileRoute("/api/models-config/catalog")({
  server: {
    handlers: {
      GET: ({ request }) => GETHandler(request),
    },
  },
});
