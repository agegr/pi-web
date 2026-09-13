export function normalizeFilePathSlashes(filePath: string): string {
  if (/^[a-zA-Z]:[\\/]/.test(filePath) || filePath.startsWith("\\\\")) {
    return filePath.replace(/\\/g, "/");
  }
  return filePath;
}

export function encodeFilePathForApi(filePath: string): string {
  return normalizeFilePathSlashes(filePath)
    .split("/")
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");
}

export function getFileName(filePath: string): string {
  const normalized = normalizeFilePathSlashes(filePath).replace(/\/+$/, "");
  return normalized.split("/").pop() ?? normalized;
}

export function getFileDirectory(filePath: string): string {
  const normalized = normalizeFilePathSlashes(filePath).replace(/\/+$/, "");
  const lastSlash = normalized.lastIndexOf("/");
  if (lastSlash < 0) return "";
  if (lastSlash === 0) return "/";
  if (lastSlash === 2 && /^[a-zA-Z]:\//.test(normalized)) return normalized.slice(0, 3);
  return normalized.slice(0, lastSlash);
}

export function getRelativeFilePath(filePath: string, cwd?: string): string {
  if (!cwd) return filePath;

  const normalizedFile = normalizeFilePathSlashes(filePath);
  const normalizedCwd = normalizeFilePathSlashes(cwd).replace(/\/$/, "");
  if (normalizedFile.startsWith(normalizedCwd + "/")) {
    return normalizedFile.slice(normalizedCwd.length + 1);
  }
  return filePath;
}

export function joinFilePath(parent: string, child: string): string {
  return `${normalizeFilePathSlashes(parent).replace(/\/$/, "")}/${child}`;
}

/**
 * Compare browser-side file paths without importing Node's path module.
 * Windows drive and UNC paths are case-insensitive; POSIX paths are not.
 */
export function sameFilePath(a: string, b: string): boolean {
  const key = (value: string) => {
    const normalized = normalizeFilePathSlashes(value).replace(/\/+/g, "/");
    const absolutePrefix = normalized.match(/^[a-zA-Z]:\//)?.[0]
      ?? (normalized.startsWith("//") ? "//" : normalized.startsWith("/") ? "/" : "");
    const parts = normalized.slice(absolutePrefix.length).split("/");
    const resolved: string[] = [];
    for (const part of parts) {
      if (!part || part === ".") continue;
      if (part === ".." && resolved.length > 0 && resolved.at(-1) !== "..") resolved.pop();
      else if (part !== "..") resolved.push(part);
      else if (!absolutePrefix) resolved.push(part);
    }
    return absolutePrefix + resolved.join("/");
  };

  const normalizedA = key(a);
  const normalizedB = key(b);
  const windowsPath = /^[a-zA-Z]:\//.test(normalizedA)
    || /^[a-zA-Z]:\//.test(normalizedB)
    || normalizedA.startsWith("//")
    || normalizedB.startsWith("//");
  return windowsPath
    ? normalizedA.toLowerCase() === normalizedB.toLowerCase()
    : normalizedA === normalizedB;
}
