import { createFileRoute } from "@tanstack/react-router";
import {
  GET as getProjects,
  PUT as putProjects,
} from "@/app/api/projects/route";

export const Route = createFileRoute("/api/projects")({
  server: {
    handlers: {
      GET: () => getProjects(),
      PUT: ({ request }) => putProjects(request),
    },
  },
});
