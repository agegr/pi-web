import { createFileRoute } from "@tanstack/react-router";
import { POST as POSTHandler } from "@/app/api/skills/check/route";

export const Route = createFileRoute("/api/skills/check")({
  server: {
    handlers: {
      POST: ({ request }) => POSTHandler(request),
    },
  },
});
