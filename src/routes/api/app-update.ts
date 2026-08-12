import { createFileRoute } from "@tanstack/react-router";
import { GET as GETHandler } from "@/app/api/app-update/route";

export const Route = createFileRoute("/api/app-update")({
  server: {
    handlers: {
      GET: () => GETHandler(),
    },
  },
});
