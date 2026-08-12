import { createFileRoute } from "@tanstack/react-router";
import { GET as GETHandler } from "@/app/api/agent/running/route";

export const Route = createFileRoute("/api/agent/running")({
  server: {
    handlers: {
      GET: () => GETHandler(),
    },
  },
});
