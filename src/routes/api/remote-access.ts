import { createFileRoute } from "@tanstack/react-router";
import { GET as getRemoteAccess, PUT as putRemoteAccess } from "@/app/api/remote-access/route";

export const Route = createFileRoute("/api/remote-access")({
  server: {
    handlers: {
      GET: ({ request }) => getRemoteAccess(request),
      PUT: ({ request }) => putRemoteAccess(request),
    },
  },
});
