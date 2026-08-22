import { existsSync } from "fs";
import { join } from "path";

export interface ResolvedShell {
  file: string;
  args: string[];
  label: string;
}

// Candidates for the git-bash executable on Windows. `bin/bash.exe` is the
// standalone console host that works best under ConPTY; the `-l` login flag
// loads the bash profile which puts git and the mingw tools on PATH.
function windowsGitBashCandidates(): string[] {
  const programFiles = process.env.ProgramFiles ?? "C:\\Program Files";
  const programFilesX86 = process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
  const localAppData = process.env.LOCALAPPDATA ?? "";
  const candidates = [
    join(programFiles, "Git", "bin", "bash.exe"),
    join(programFilesX86, "Git", "bin", "bash.exe"),
  ];
  if (localAppData) {
    candidates.push(join(localAppData, "Programs", "Git", "bin", "bash.exe"));
  }
  return candidates;
}

/**
 * Resolve the interactive shell used by the in-browser terminal. Honors the
 * `PI_TERMINAL_SHELL` environment variable (e.g. `"bash"`, `"C:\\...\\bash.exe"`,
 * or `"C:\\...\\bash.exe" --noprofile`), then falls back to git bash on Windows
 * and plain `bash` elsewhere.
 */
export function resolveTerminalShell(): ResolvedShell {
  const override = process.env.PI_TERMINAL_SHELL?.trim();
  if (override) {
    const [file, ...rest] = override.split(/\s+/).filter(Boolean);
    if (file) return { file, args: rest, label: file };
  }

  if (process.platform === "win32") {
    for (const candidate of windowsGitBashCandidates()) {
      if (existsSync(candidate)) {
        return { file: candidate, args: ["-l"], label: "Git Bash" };
      }
    }
  }

  return { file: "bash", args: ["-l"], label: "bash" };
}