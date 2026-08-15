import { createFileRoute } from "@tanstack/react-router";
import { GET as getVisionToolkit, PUT as putVisionToolkit } from "@/app/api/vision-toolkit/route";

export const Route = createFileRoute("/api/vision-toolkit")({
  server: {
    handlers: {
      GET: ({ request }) => getVisionToolkit(request),
      PUT: ({ request }) => putVisionToolkit(request),
    },
  },
});
