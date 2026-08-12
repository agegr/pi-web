import { createFileRoute } from "@tanstack/react-router";
import { POST as POSTHandler } from "@/app/api/skills/search/route";

export const Route = createFileRoute("/api/skills/search")({
  server: {
    handlers: {
      POST: ({ request }) => POSTHandler(request),
    },
  },
});
