import { createFileRoute } from "@tanstack/react-router";
import { POST as POSTHandler } from "@/app/api/skills/update/route";

export const Route = createFileRoute("/api/skills/update")({
  server: {
    handlers: {
      POST: ({ request }) => POSTHandler(request),
    },
  },
});
