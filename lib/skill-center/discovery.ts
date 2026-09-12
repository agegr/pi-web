import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ignore from "ignore";
import { isExistingPathWithinRoots } from "../path-security";

/** SDK discovery semantics, with authorization BEFORE parsing any candidate or ignore file. */
export function discoverAuthorized(path: string, roots: Set<string>, problem: (message: string) => void): string[] {
  const files: string[] = []; const visited = new Set<string>(); const ig = ignore();
  const allowed = (p: string) => {
    if (isExistingPathWithinRoots(p, roots)) return true;
    problem("技能目录含不可读取或越出授权范围的链接。"); return false;
  };
  if (!allowed(path)) return files;
  if (statSync(path).isFile()) return [path];
  function visit(dir: string, rootFiles: boolean) {
    if (!allowed(dir)) return;
    const real = realpathSync(dir); if (visited.has(real)) return; visited.add(real);
    const prefix = relative(path, dir).replace(/\\/g, "/");
    for (const name of [".gitignore", ".ignore", ".fdignore"]) {
      const file = join(dir, name);
      if (existsSync(file) && allowed(file)) {
        for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
          if (!line.trim() || line.trim().startsWith("#")) continue;
          const negated = line.startsWith("!"); const pattern = (negated ? line.slice(1) : line.startsWith("\\!") ? line.slice(1) : line).replace(/^\//, "");
          ig.add(`${negated ? "!" : ""}${prefix ? `${prefix}/` : ""}${pattern}`);
        }
      }
    }
    const entries = readdirSync(dir, {withFileTypes:true});
    const skillFile = join(dir, "SKILL.md");
    if (entries.some(e => e.name === "SKILL.md") && allowed(skillFile) && statSync(skillFile).isFile() && !ig.ignores(relative(path,skillFile).replace(/\\/g,"/"))) { files.push(skillFile); return; }
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const target = join(dir,entry.name); if (!allowed(target)) continue;
      const stat = statSync(target); const rel = relative(path,target).replace(/\\/g,"/");
      if (ig.ignores(rel + (stat.isDirectory() ? "/" : ""))) continue;
      if (stat.isDirectory()) visit(target,false);
      else if (stat.isFile() && rootFiles && entry.name.endsWith(".md")) files.push(target);
    }
  }
  try { visit(path,true); } catch { problem("技能配置范围内有无法读取的目录。"); }
  return files;
}
