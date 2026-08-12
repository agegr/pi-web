import { createFileRoute } from "@tanstack/react-router";
import { GET as GETHandler } from "@/app/api/models/route";

export const Route = createFileRoute("/api/models")({
  server: {
    handlers: {
      GET: ({ request }) => GETHandler(request),
    },
  },
});
