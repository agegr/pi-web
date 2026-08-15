import { createFileRoute } from "@tanstack/react-router";
import { POST as POSTHandler } from "@/app/api/vision-toolkit/reveal/route";

export const Route = createFileRoute("/api/vision-toolkit/reveal")({
  server: {
    handlers: {
      POST: ({ request }) => POSTHandler(request),
    },
  },
});
