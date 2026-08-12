import { createFileRoute } from "@tanstack/react-router";
import {
  GET as getFiles,
  POST as postFiles,
} from "@/app/api/files/[...path]/route";

export const Route = createFileRoute("/api/files/$")({
  server: {
    handlers: {
      GET: ({ request, params }) => getFiles(request, {
        params: Promise.resolve({ path: (params._splat ?? "").split("/") }),
      }),
      POST: ({ request, params }) => postFiles(request, {
        params: Promise.resolve({ path: (params._splat ?? "").split("/") }),
      }),
    },
  },
});
