import { createFileRoute } from "@tanstack/react-router";
import { POST as POSTHandler } from "@/app/api/skills/install/route";

export const Route = createFileRoute("/api/skills/install")({
  server: {
    handlers: {
      POST: ({ request }) => POSTHandler(request),
    },
  },
});
