import fs from "fs";
import path from "path";

function isWithin(target: string, root: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

export function resolveAllowedDirectory(target: string, allowedRoots: Set<string>): string | null {
  let resolvedTarget: string;
  try {
    resolvedTarget = fs.realpathSync(target);
    if (!fs.statSync(resolvedTarget).isDirectory()) return null;
  } catch {
    return null;
  }

  const canonicalRoots = new Set<string>();
  for (const root of allowedRoots) {
    try {
      canonicalRoots.add(fs.realpathSync(path.resolve(root)));
    } catch {
      // Stale session roots are ignored rather than weakening canonical checks.
    }
  }
  return [...canonicalRoots].some((root) => isWithin(resolvedTarget, root)) ? resolvedTarget : null;
}
