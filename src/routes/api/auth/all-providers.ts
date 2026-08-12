import { createFileRoute } from "@tanstack/react-router";
import { GET as GETHandler } from "@/app/api/auth/all-providers/route";

export const Route = createFileRoute("/api/auth/all-providers")({
  server: {
    handlers: {
      GET: () => GETHandler(),
    },
  },
});
