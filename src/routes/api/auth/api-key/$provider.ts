import { createFileRoute } from "@tanstack/react-router";
import {
  DELETE as deleteApiKey,
  GET as getApiKey,
  POST as postApiKey,
} from "@/app/api/auth/api-key/[provider]/route";

export const Route = createFileRoute("/api/auth/api-key/$provider")({
  server: {
    handlers: {
      GET: ({ request, params }) => getApiKey(request, {
        params: Promise.resolve({ provider: params.provider }),
      }),
      POST: ({ request, params }) => postApiKey(request, {
        params: Promise.resolve({ provider: params.provider }),
      }),
      DELETE: ({ request, params }) => deleteApiKey(request, {
        params: Promise.resolve({ provider: params.provider }),
      }),
    },
  },
});
