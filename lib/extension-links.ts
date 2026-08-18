import { lstatSync, unlinkSync } from "fs";
import { isAbsolute, join, relative, resolve, sep } from "path";

/** Return the direct extension-directory symlink that owns a discovered resource. */
export function findDirectExtensionSymlink(resourcePath: string, extensionRoot: string): string | undefined {
  const root = resolve(extensionRoot);
  const rel = relative(root, resolve(resourcePath));
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return undefined;

  const candidate = join(root, rel.split(sep)[0]);
  try {
    return lstatSync(candidate).isSymbolicLink() ? candidate : undefined;
  } catch {
    return undefined;
  }
}

/** Remove the link itself, never its target or a regular file. */
export function unlinkExtensionSymlink(path: string): void {
  if (!lstatSync(path).isSymbolicLink()) throw new Error("Extension entry is not a symbolic link");
  unlinkSync(path);
}
