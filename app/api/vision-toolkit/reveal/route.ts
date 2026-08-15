import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { isApiRequestAllowed } from "@/lib/request-security";
import { visionEnvPath } from "@/lib/vision-toolkit-config";
import { redactVisionError } from "../route";

export const dynamic = "force-dynamic";

export function revealConfigFileCommand(configPath: string, platform = process.platform): {
  command: string;
  args: string[];
} {
  if (platform === "darwin") return { command: "open", args: ["-R", configPath] };
  if (platform === "win32") return { command: "explorer", args: [`/select,${configPath}`] };
  return { command: "xdg-open", args: [dirname(configPath)] };
}

export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return Response.json({ error: "Untrusted API request" }, { status: 403 });
  }

  const configPath = visionEnvPath();
  if (!existsSync(configPath)) {
    return Response.json({ error: "Config file does not exist yet. Save settings first." }, { status: 404 });
  }

  try {
    const { command, args } = revealConfigFileCommand(configPath);
    const child = spawn(command, args, { detached: true, stdio: "ignore" });
    child.unref();
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: redactVisionError(error) }, { status: 500 });
  }
}
