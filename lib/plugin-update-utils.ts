import type { PluginScope } from "@/lib/api-types";

export function pluginUpdateKey(source: string, scope: PluginScope): string {
  return `${scope}\0${source}`;
}

function getConfiguredVersion(source: string): string | undefined {
  const npmSpec = source.startsWith("npm:") ? source.slice(4) : undefined;
  if (npmSpec) {
    const lastAt = npmSpec.lastIndexOf("@");
    const packageNameEnd = npmSpec.startsWith("@") ? npmSpec.indexOf("/", 1) : 0;
    if (lastAt > packageNameEnd) return npmSpec.slice(lastAt + 1) || undefined;
    return undefined;
  }

  if (source.startsWith("git:") || /^[a-z]+:\/\//.test(source)) {
    const lastAt = source.lastIndexOf("@");
    const lastSlash = source.lastIndexOf("/");
    const lastColon = source.lastIndexOf(":");
    if (lastAt > Math.max(lastSlash, lastColon)) return source.slice(lastAt + 1) || undefined;
  }
  return undefined;
}

export function isPluginSourceCheckable(source: string): boolean {
  if (getConfiguredVersion(source)) return false;
  if (source.startsWith("npm:")) return true;
  if (source.startsWith("git:") || /^[a-z]+:\/\//.test(source)) return true;
  return false;
}
