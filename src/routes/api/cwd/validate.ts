import { createFileRoute } from "@tanstack/react-router";
import { POST as POSTHandler } from "@/app/api/cwd/validate/route";

export const Route = createFileRoute("/api/cwd/validate")({
  server: {
    handlers: {
      POST: ({ request }) => POSTHandler(request),
    },
  },
});
