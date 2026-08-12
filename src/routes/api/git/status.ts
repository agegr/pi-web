import { createFileRoute } from "@tanstack/react-router";
import { GET as GETHandler } from "@/app/api/git/status/route";

export const Route = createFileRoute("/api/git/status")({
  server: {
    handlers: {
      GET: ({ request }) => GETHandler(request),
    },
  },
});
