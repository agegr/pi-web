import { randomUUID } from "crypto";
import { execFile } from "child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { basename, dirname, join } from "path";
import { promisify } from "util";
import { fileURLToPath } from "url";
import { NextResponse } from "next/server";
import { resolveSessionPath } from "@/lib/session/session-reader";

const execFileAsync = promisify(execFile);

export const runtime = "nodejs";

function encodeHeaderValue(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (ch) =>
    `%${ch.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

function getAttachmentDisposition(fileName: string): string {
  const fallback = fileName.replace(/[^\x20-\x7E]|["\\;\r\n]/g, "_") || "session.html";
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeHeaderValue(fileName)}`;
}

async function getPiCliPath(): Promise<string> {
  const resolver = (import.meta as ImportMeta & {
    resolve?: (specifier: string) => string | Promise<string>;
  }).resolve;
  if (typeof resolver === "function") {
    const indexUrl = await resolver("@earendil-works/pi-coding-agent");
    return join(dirname(fileURLToPath(indexUrl)), "cli.js");
  }

  return join(
    process.cwd(),
    "node_modules",
    "@earendil-works",
    "pi-coding-agent",
    "dist",
    "cli.js"
  );
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const filePath = await resolveSessionPath(id);
    if (!filePath) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const cliPath = await getPiCliPath();
    if (!existsSync(cliPath)) {
      return NextResponse.json({ error: "pi CLI not found" }, { status: 500 });
    }

    const tempDir = join(tmpdir(), "pi-web-export");
    mkdirSync(tempDir, { recursive: true });

    const sessionBase = basename(filePath, ".jsonl");
    const fileName = `pi-session-${sessionBase}.html`;
    const outputPath = join(tempDir, `${randomUUID()}.html`);

    try {
      await execFileAsync(process.execPath, [cliPath, "--export", filePath, outputPath], {
        cwd: process.cwd(),
        timeout: 30_000,
        env: {
          ...process.env,
          PI_OFFLINE: "1",
          PI_SKIP_VERSION_CHECK: "1",
        },
        maxBuffer: 1024 * 1024,
      });

      const html = readFileSync(outputPath, "utf8");
      return new Response(html, {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Content-Disposition": getAttachmentDisposition(fileName),
          "Cache-Control": "no-cache",
        },
      });
    } finally {
      rmSync(outputPath, { force: true });
    }
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
