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

    // Windows Execution (Primary: Windows Terminal, Fallback: PowerShell/CMD)
    if (process.platform === "win32") {
      await new Promise<void>((resolve, reject) => {
        // Attempt 1: Launch Windows Terminal (wt) which is the modern standard
        const child = spawn("wt", ["-d", path], { detached: true, stdio: "ignore" });
        child.unref();

        // Listen for ENOENT errors (e.g. Windows Terminal is not installed)
        child.on("error", (err: any) => {
          if (err.code === "ENOENT") {
            console.log("Windows Terminal (wt) not found. Falling back to PowerShell...");
            // Fallback: PowerShell starting in the given path
            const fallback = spawn("powershell", ["-NoExit", "-Command", `Set-Location -LiteralPath '${path}'`], {
              detached: true,
              shell: true,
              stdio: "ignore"
            });
            fallback.unref();
            resolve();
          } else {
            reject(err);
          }
        });

        // If no immediately triggered ENOENT error within 100ms, assume launch succeeded
        const timer = setTimeout(() => {
          resolve();
        }, 100);

        child.on("spawn", () => {
          clearTimeout(timer);
          resolve();
        });
      });
    } 
    // macOS Execution (Apple Terminal)
    else if (process.platform === "darwin") {
      const child = spawn("open", ["-a", "Terminal", path], { detached: true });
      child.unref();
    } 
    // Linux Execution (x-terminal-emulator or gnome-terminal)
    else {
      await new Promise<void>((resolve) => {
        const child = spawn("x-terminal-emulator", [], { cwd: path, detached: true, stdio: "ignore" });
        child.unref();

        child.on("error", (err: any) => {
          if (err.code === "ENOENT") {
            console.log("x-terminal-emulator not found. Trying gnome-terminal...");
            const fallback = spawn("gnome-terminal", ["--working-directory", path], { detached: true, stdio: "ignore" });
            fallback.unref();
          }
          resolve();
        });

        const timer = setTimeout(resolve, 100);
        child.on("spawn", () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }

    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || String(e) }, { status: 500 });
  }
}
