import { createFileRoute } from "@tanstack/react-router";
import { POST as POSTHandler } from "@/app/api/models-config/test/route";

export const Route = createFileRoute("/api/models-config/test")({
  server: {
    handlers: {
      POST: ({ request }) => POSTHandler(request),
    },
  },
});
