import { NextResponse } from "next/server";
import { spawn } from "child_process";
import { existsSync, statSync } from "fs";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const { path } = (await req.json()) as { path?: string };
    if (!path) {
      return NextResponse.json({ error: "Path is required" }, { status: 400 });
    }

    if (!existsSync(path)) {
      return NextResponse.json({ error: "Directory does not exist" }, { status: 404 });
    }

    const stat = statSync(path);
    if (!stat.isDirectory()) {
      return NextResponse.json({ error: "Path is not a directory" }, { status: 400 });
    }

    // Use spawn with raw array parameters instead of exec with a command string.
    // This bypasses cmd.exe shell parsing completely, avoiding any backslash escaping, 
    // character translation (like parenthesies), or quoting bugs.
    let child;
    if (process.platform === "win32") {
      child = spawn("explorer.exe", [path], { detached: true, stdio: "ignore" });
      child.unref(); // Prevents Next.js process from waiting for the Explorer window to close
    } else if (process.platform === "darwin") {
      child = spawn("open", [path]);
    } else {
      child = spawn("xdg-open", [path]);
    }

    if (process.platform !== "win32" && child) {
      await new Promise<void>((resolve, reject) => {
        child.on("close", (code) => {
          if (code === 0) resolve();
          else reject(new Error(`Process exited with code ${code}`));
        });
        child.on("error", reject);
      });
    }

    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || String(e) }, { status: 500 });
  }
}
