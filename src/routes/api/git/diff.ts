import { createFileRoute } from "@tanstack/react-router";
import { GET as GETHandler } from "@/app/api/git/diff/route";

export const Route = createFileRoute("/api/git/diff")({
  server: {
    handlers: {
      GET: ({ request }) => GETHandler(request),
    },
  },
});
