import { NextResponse } from "next/server";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type {
  ContextResponse,
  ContextWriteTarget,
  McpErrorResponse,
  McpRefusalReason,
} from "@/lib/api-types";
import {
  CONTEXT_FILE_MAX_BYTES,
  contextWriteTarget,
  deleteContextFile,
  readContextFiles,
  writeContextFile,
} from "@/lib/context-files";
import { getAllowedFileRoots } from "@/lib/file-access";
import { isMcpEntryRefusal, validateMcpProject } from "@/lib/mcp-entry-request";
import { getProjectTrustStatus } from "@/lib/project-trust";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

// Settings › Context (https://pi.dev/docs/latest/configuration). GET reads the
// seven context files and PUT writes one of them. An entry is named by the id
// Settings sends, never by a path: both routes resolve the file from the agent
// directory and the project, so no request can reach a file Pi does not read.
//
// Context files are discovered without project trust, so nothing here gates a
// read on it. The one exception is `SYSTEM.md` / `APPEND_SYSTEM.md`, whose
// project file Pi prefers only while the project is trusted, so the listing says
// which of the two sessions read. A project file that resolves outside the
// folders Pi Web may read is refused, as `.pi/mcp.json` is: the cwd check alone
// would not cover a `.pi/SYSTEM.md` that is a link out of the project.

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function refusal(status: number, reason: McpRefusalReason, error: string, path?: string) {
  return NextResponse.json({ error, reason, ...(path ? { path } : {}) } satisfies McpErrorResponse, { status });
}

/**
 * Whether Pi would load the project's own `.pi/SYSTEM.md` /
 * `.pi/APPEND_SYSTEM.md`: `discoverSystemPromptFile()` prefers those only while
 * the project is trusted, and `getProjectTrustStatus().trusted` is the rule it
 * applies — a decision trusts the folder. An unreadable `trust.json` counts as
 * untrusted, as it does for every other trust-gated read. Read at most once per
 * request.
 */
function projectTrustLookup(cwd: string | null, agentDir: string): () => boolean {
  let trusted: boolean | undefined;
  return () => {
    if (trusted !== undefined) return trusted;
    if (!cwd) return (trusted = false);
    try {
      return (trusted = getProjectTrustStatus(cwd, agentDir).trusted);
    } catch {
      return (trusted = false);
    }
  };
}

/** The entry's own path, refused with the reason the panel shows. */
function targetRefusal(target: Extract<ContextWriteTarget, { ok: false }>) {
  switch (target.error) {
    case "unknown-id":
      return refusal(400, "invalid-request", "Unknown context file");
    case "no-cwd":
      return refusal(400, "cwd-invalid", "This context file belongs to a project, and the request names none");
    case "outside-roots":
      return refusal(403, "link-outside", "Access denied", target.path);
    default:
      return refusal(409, "not-a-file", `${target.path} is not a regular file`, target.path);
  }
}

/** The project the request names: the same check every Settings › MCP route makes. */
async function readProject(value: unknown): Promise<
  { cwd: string | null; allowedRoots: Set<string> } | { response: NextResponse }
> {
  if (value === undefined || value === null) return { cwd: null, allowedRoots: await getAllowedFileRoots() };
  const result = await validateMcpProject(value);
  if (isMcpEntryRefusal(result)) return { response: NextResponse.json(result.body, { status: result.status }) };
  return { cwd: result.cwd, allowedRoots: result.allowedRoots };
}

// GET /api/context?cwd=<absolute project folder>
// Without `cwd` it lists the agent directory's entries and reports the four
// local ones as unset, so Settings › Context opens without a project.
export async function GET(req: Request) {
  const project = await readProject(new URL(req.url).searchParams.get("cwd"));
  if ("response" in project) return project.response;
  const agentDir = getAgentDir();
  try {
    return NextResponse.json(readContextFiles({
      agentDir,
      ...project,
      isProjectTrusted: projectTrustLookup(project.cwd, agentDir),
    }) satisfies ContextResponse);
  } catch (error) {
    return refusal(500, "internal", errorMessage(error));
  }
}

// PUT /api/context — write or remove one context file.
// Body: `{ id, content }` writes it, creating it and the folders on the way;
// `{ id, remove: true }` removes it, any of the seven. The answer is the whole
// listing, so the panel replaces its state in place instead of guessing what
// the write changed: a removed file is reported missing, which is also what
// makes Pi fall back to whichever file the docs name next.
export async function PUT(req: Request) {
  if (!isApiRequestAllowed(req)) return refusal(403, "request-denied", "Untrusted API request");
  if (!hasJsonContentType(req)) return refusal(415, "content-type", "Content-Type must be application/json");

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return refusal(400, "invalid-request", "Invalid JSON body");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return refusal(400, "invalid-request", "Expected a JSON object");
  }

  const { id, content, remove, cwd } = body as {
    id?: unknown;
    content?: unknown;
    remove?: unknown;
    cwd?: unknown;
  };
  const project = await readProject(cwd);
  if ("response" in project) return project.response;

  const agentDir = getAgentDir();
  const target = contextWriteTarget(id, agentDir, project.cwd, project.allowedRoots);
  if (!target.ok) return targetRefusal(target);

  try {
    if (remove === true) {
      // A file that is already gone is refused rather than answered with the same
      // listing: the panel's Delete names a file it saw, and silently doing
      // nothing would read as a removal that landed.
      if (!deleteContextFile(target.path)) {
        return refusal(409, "not-a-file", `There is no file at ${target.path} to remove`, target.path);
      }
    } else {
      if (typeof content !== "string") return refusal(400, "invalid-request", "content must be a string");
      if (Buffer.byteLength(content, "utf8") > CONTEXT_FILE_MAX_BYTES) {
        return refusal(413, "too-large", `The file would be larger than ${CONTEXT_FILE_MAX_BYTES} bytes`, target.path);
      }
      writeContextFile(target.path, content);
    }
    return NextResponse.json(readContextFiles({
      agentDir,
      ...project,
      isProjectTrusted: projectTrustLookup(project.cwd, agentDir),
    }) satisfies ContextResponse);
  } catch (error) {
    return refusal(500, "internal", errorMessage(error));
  }
}
