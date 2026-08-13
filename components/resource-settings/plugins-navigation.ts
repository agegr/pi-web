import type { PluginNavItem } from "./resource-settings-types";

export interface FilteredPluginsNavigation {
  project: PluginNavItem[];
  global: PluginNavItem[];
}

export function pluginIdentity(pkg: Pick<PluginNavItem, "scope" | "source">): string {
  return `${pkg.scope}\0${pkg.source}`;
}

function pluginMatchesQuery(pkg: PluginNavItem, q: string): boolean {
  if (!q) return true;
  if (
    [pkg.source, pkg.packageName ?? "", pkg.status]
      .some((value) => value.toLocaleLowerCase().includes(q))
  ) {
    return true;
  }
  return (pkg.resources ?? []).some((resource) => resource.name.toLocaleLowerCase().includes(q));
}

export function filterPluginsNavigation(
  packages: readonly PluginNavItem[],
  query: string,
): FilteredPluginsNavigation {
  const q = query.trim().toLocaleLowerCase();
  const filtered = packages.filter((pkg) => pluginMatchesQuery(pkg, q));
  return {
    project: filtered.filter((pkg) => pkg.scope === "project"),
    global: filtered.filter((pkg) => pkg.scope === "global"),
  };
}

export function resolvePluginsSelection(
  selected: string | null,
  packages: readonly PluginNavItem[],
): string | null {
  if (!selected) return null;
  return packages.some((pkg) => pluginIdentity(pkg) === selected) ? selected : null;
}

export function pluginsSelectionLabel(
  selected: string | null,
  packages: readonly PluginNavItem[],
): { title: string; subtitle?: string } {
  const pkg = packages.find((item) => pluginIdentity(item) === selected);
  return pkg ? { title: pkg.packageName ?? pkg.source, subtitle: pkg.scope } : { title: "" };
}
