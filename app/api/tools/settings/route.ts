import { NextResponse } from "next/server";
import type { McpErrorResponse, McpRefusalReason, ToolSettingsResponse } from "@/lib/api-types";
import { isCodemodePreference, readCodemodePreference, writeCodemodePreference } from "@/lib/codemode-settings";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import {
  readPowerShellToolEnabled,
  writePowerShellToolEnabled,
} from "@/lib/powershell-settings";

export const dynamic = "force-dynamic";

// The only writer of the global `defaultTools` key: the PowerShell switch
// (Windows) and the Code mode choice (ADR 0006, chosen in Settings › MCP) both
// edit it, under the lock pi's SettingsManager takes on the same file. Every
// refusal carries a `reason` code the panel translates, beside the English
// `error` it shows only as the diagnostic of an `internal` failure.

function refusal(status: number, reason: McpRefusalReason, error: string) {
  return NextResponse.json({ error, reason } satisfies McpErrorResponse, { status });
}

function errorResponse(error: unknown) {
  return refusal(500, "internal", error instanceof Error ? error.message : String(error));
}

async function readToolSettings(): Promise<ToolSettingsResponse> {
  // One after the other: both take the file lock, and a reader that finds it
  // held backs off for about a second.
  const powerShellEnabled = await readPowerShellToolEnabled();
  const codemode = await readCodemodePreference();
  return { isWindows: process.platform === "win32", powerShellEnabled, codemode };
}

export async function GET() {
  try {
    return NextResponse.json(await readToolSettings());
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return refusal(403, "request-denied", "Untrusted API request");
  }
  if (!hasJsonContentType(req)) {
    return refusal(415, "content-type", "Content-Type must be application/json");
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return refusal(400, "invalid-request", "Invalid JSON body");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return refusal(400, "invalid-request", "Expected a JSON object");
  }
  const changes = body as { enabled?: unknown; codemode?: unknown };
  if (("codemode" in changes) === ("enabled" in changes)) {
    return refusal(400, "invalid-request", "Send either enabled (PowerShell) or codemode");
  }

  if ("codemode" in changes) {
    if (!isCodemodePreference(changes.codemode)) {
      return refusal(400, "invalid-request", "codemode must be \"automatic\" or \"always\"");
    }
    try {
      await writeCodemodePreference(changes.codemode);
      return NextResponse.json(await readToolSettings());
    } catch (error) {
      return errorResponse(error);
    }
  }

  if (process.platform !== "win32") {
    return refusal(404, "invalid-request", "PowerShell tool settings are only available on Windows");
  }
  if (typeof changes.enabled !== "boolean") {
    return refusal(400, "invalid-request", "enabled must be a boolean");
  }
  try {
    await writePowerShellToolEnabled(changes.enabled);
    return NextResponse.json(await readToolSettings());
  } catch (error) {
    return errorResponse(error);
  }
}
