import { createFileRoute } from "@tanstack/react-router";
import {
  DELETE as deleteWorktree,
  GET as getWorktrees,
  POST as postWorktrees,
} from "@/app/api/worktrees/route";

export const Route = createFileRoute("/api/worktrees")({
  server: {
    handlers: {
      GET: ({ request }) => getWorktrees(request),
      POST: ({ request }) => postWorktrees(request),
      DELETE: ({ request }) => deleteWorktree(request),
    },
  },
});
