import { createFileRoute } from "@tanstack/react-router";
import { POST as postFiles } from "@/app/api/files/[...path]/route";

export const Route = createFileRoute("/api/files/$")({
  server: {
    handlers: {
      POST: ({ request, params }) => postFiles(request, {
        params: Promise.resolve({ path: (params._splat ?? "").split("/") }),
      }),
    },
  },
});
