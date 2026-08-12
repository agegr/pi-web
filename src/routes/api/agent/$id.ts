import { createFileRoute } from "@tanstack/react-router";
import {
  GET as getAgent,
  POST as postAgent,
} from "@/app/api/agent/[id]/route";

export const Route = createFileRoute("/api/agent/$id")({
  server: {
    handlers: {
      GET: ({ request, params }) => getAgent(request, {
        params: Promise.resolve({ id: params.id }),
      }),
      POST: ({ request, params }) => postAgent(request, {
        params: Promise.resolve({ id: params.id }),
      }),
    },
  },
});
