import { statSync, type Stats } from "fs";
import { homedir } from "os";
import { isAbsolute, resolve } from "path";
import { allowFileRoot } from "@/lib/file-access";

function normalizeCwd(cwd: string): string {
  if (cwd === "~") return homedir();
  if (cwd.startsWith("~/")) return resolve(homedir(), cwd.slice(2));
  return isAbsolute(cwd) ? cwd : resolve(cwd);
}

// POST /api/cwd/validate  body: { cwd: string }
// Validates a candidate workspace before the UI selects it.
export async function POST(req: Request) {
  try {
    const body = await req.json() as { cwd?: unknown };
    const cwd = typeof body.cwd === "string" ? body.cwd.trim() : "";

    if (!cwd) {
      return Response.json({ error: "Path is required" }, { status: 400 });
    }

    const normalizedCwd = normalizeCwd(cwd);
    let stat: Stats;
    try {
      stat = statSync(normalizedCwd);
    } catch {
      return Response.json({ error: `Directory does not exist: ${cwd}` }, { status: 400 });
    }

    if (!stat.isDirectory()) {
      return Response.json({ error: `Path is not a directory: ${cwd}` }, { status: 400 });
    }

    allowFileRoot(normalizedCwd);
    return Response.json({ success: true, cwd: normalizedCwd });
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 });
  }
}
