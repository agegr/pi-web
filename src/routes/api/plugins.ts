import { createFileRoute } from "@tanstack/react-router";
import {
  GET as getPlugins,
  POST as postPlugins,
} from "@/app/api/plugins/route";

export const Route = createFileRoute("/api/plugins")({
  server: {
    handlers: {
      GET: ({ request }) => getPlugins(request),
      POST: ({ request }) => postPlugins(request),
    },
  },
});
