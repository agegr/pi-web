import { createFileRoute } from "@tanstack/react-router";
import {
  GET as getLogin,
  POST as postLogin,
} from "@/app/api/auth/login/[provider]/route";

export const Route = createFileRoute("/api/auth/login/$provider")({
  server: {
    handlers: {
      GET: ({ request, params }) => getLogin(request, {
        params: Promise.resolve({ provider: params.provider }),
      }),
      POST: ({ request, params }) => postLogin(request, {
        params: Promise.resolve({ provider: params.provider }),
      }),
    },
  },
});
