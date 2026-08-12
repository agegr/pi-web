import { createFileRoute } from "@tanstack/react-router";
import { GET as GETHandler } from "@/app/api/home/route";

export const Route = createFileRoute("/api/home")({
  server: {
    handlers: {
      GET: () => GETHandler(),
    },
  },
});
