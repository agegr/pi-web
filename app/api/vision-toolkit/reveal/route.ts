import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
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

export function waitForSpawn(child: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      child.off("spawn", onSpawn);
      reject(error);
    };
    const onSpawn = () => {
      child.off("error", onError);
      child.unref();
      resolve();
    };
    child.once("error", onError);
    child.once("spawn", onSpawn);
  });
}

export async function revealConfigFile(
  spawnImpl: typeof spawn = spawn,
  platform = process.platform,
): Promise<void> {
  const configPath = visionEnvPath();
  if (!existsSync(configPath)) {
    throw new Error("Config file does not exist yet. Save settings first.");
  }
  const { command, args } = revealConfigFileCommand(configPath, platform);
  await waitForSpawn(spawnImpl(command, args, { detached: true, stdio: "ignore" }));
}

export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return Response.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return Response.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }

  const configPath = visionEnvPath();
  if (!existsSync(configPath)) {
    return Response.json({ error: "Config file does not exist yet. Save settings first." }, { status: 404 });
  }

  try {
    await revealConfigFile();
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: redactVisionError(error) }, { status: 500 });
  }
}
