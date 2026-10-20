import { NextResponse } from "next/server";
import { getAllowedFileRoots } from "@/lib/file-access";
import { authorizeProjectDevCwd } from "@/lib/project-dev-access";
import { controlProjectDev, inspectProjectDev } from "@/lib/project-dev-manager";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const cwd = await authorizeProjectDevCwd(new URL(req.url).searchParams.get("cwd"));
    return NextResponse.json(inspectProjectDev(cwd, true));
  } catch (error) { return failure(error); }
}
export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (!body || typeof body !== "object") throw new Error("Invalid request");
    if (body.action === "inspect") {
      if (!Array.isArray(body.cwds) || body.cwds.length > 100) throw new Error("At most 100 project directories are allowed");
      const roots = await getAllowedFileRoots();
      const projects = await Promise.all(body.cwds.map(async (requestedCwd: unknown) => {
        try {
          const cwd = await authorizeProjectDevCwd(requestedCwd, roots);
          return { requestedCwd, info: inspectProjectDev(cwd, body.refresh === true) };
        } catch (error) {
          return { requestedCwd, error: error instanceof Error ? error.message : String(error) };
        }
      }));
      return NextResponse.json({ projects });
    }
    if (!["start", "stop", "restart"].includes(body.action)) throw new Error("Invalid development service action");
    // The earlier button controlled the whole project directly. Reject its
    // stale callbacks rather than executing them after the menu upgrade.
    if (body.controlVersion !== 2) return NextResponse.json({ error: "Development service controls have changed. Reload Pi Web to use the service menu." }, { status: 409 });
    if (body.process !== undefined && (typeof body.process !== "string" || !/^[A-Za-z0-9_][A-Za-z0-9_-]*$/.test(body.process))) throw new Error("Invalid development service name");
    const cwd = await authorizeProjectDevCwd(body.cwd, undefined, body.action !== "stop");
    return NextResponse.json(await controlProjectDev(cwd, body.action, body.process));
  } catch (error) { return failure(error); }
}
function failure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return NextResponse.json({ error: message }, { status: message.startsWith("Access denied") ? 403 : 400 });
}
