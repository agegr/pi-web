import { createFileRoute } from "@tanstack/react-router";
import { GET as GETHandler } from "@/app/api/auth/providers/route";

export const Route = createFileRoute("/api/auth/providers")({
  server: {
    handlers: {
      GET: () => GETHandler(),
    },
  },
});
