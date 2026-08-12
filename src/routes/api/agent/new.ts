import { createFileRoute } from "@tanstack/react-router";
import { POST as POSTHandler } from "@/app/api/agent/new/route";

export const Route = createFileRoute("/api/agent/new")({
  server: {
    handlers: {
      POST: ({ request }) => POSTHandler(request),
    },
  },
});
