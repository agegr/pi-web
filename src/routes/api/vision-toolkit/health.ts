import { createFileRoute } from "@tanstack/react-router";
import { POST as POSTHandler } from "@/app/api/vision-toolkit/health/route";

export const Route = createFileRoute("/api/vision-toolkit/health")({
  server: {
    handlers: {
      POST: ({ request }) => POSTHandler(request),
    },
  },
});
