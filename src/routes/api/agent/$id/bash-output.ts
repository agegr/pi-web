import { createFileRoute } from "@tanstack/react-router";
import { GET as getBashOutput } from "@/app/api/agent/[id]/bash-output/route";

export const Route = createFileRoute("/api/agent/$id/bash-output")({
  server: {
    handlers: {
      GET: ({ request, params }) => getBashOutput(request, {
        params: Promise.resolve({ id: params.id }),
      }),
    },
  },
});
