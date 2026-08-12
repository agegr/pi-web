import { createFileRoute } from "@tanstack/react-router";
import { POST as POSTHandler } from "@/app/api/models-config/discover/route";

export const Route = createFileRoute("/api/models-config/discover")({
  server: {
    handlers: {
      POST: ({ request }) => POSTHandler(request),
    },
  },
});
