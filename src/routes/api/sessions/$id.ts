import { createFileRoute } from "@tanstack/react-router";
import {
  DELETE as deleteSession,
  GET as getSession,
  PATCH as patchSession,
} from "@/app/api/sessions/[id]/route";

export const Route = createFileRoute("/api/sessions/$id")({
  server: {
    handlers: {
      GET: ({ request, params }) => getSession(request, {
        params: Promise.resolve({ id: params.id }),
      }),
      PATCH: ({ request, params }) => patchSession(request, {
        params: Promise.resolve({ id: params.id }),
      }),
      DELETE: ({ request, params }) => deleteSession(request, {
        params: Promise.resolve({ id: params.id }),
      }),
    },
  },
});
