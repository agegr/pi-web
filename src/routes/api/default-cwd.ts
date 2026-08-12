import { createFileRoute } from "@tanstack/react-router";
import { POST as POSTHandler } from "@/app/api/default-cwd/route";

export const Route = createFileRoute("/api/default-cwd")({
  server: {
    handlers: {
      POST: () => POSTHandler(),
    },
  },
});
