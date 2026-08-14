import { createFileRoute } from "@tanstack/react-router";
import {
  GET as getSubagents,
  POST as postSubagents,
} from "@/app/api/agent/[id]/subagents/route";

export const Route = createFileRoute("/api/agent/$id/subagents")({
  server: {
    handlers: {
      GET: ({ request, params }) => getSubagents(request, {
        params: Promise.resolve({ id: params.id }),
      }),
      POST: ({ request, params }) => postSubagents(request, {
        params: Promise.resolve({ id: params.id }),
      }),
    },
  },
});
