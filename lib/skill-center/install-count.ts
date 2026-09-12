import type { SourceSkill } from "./types";

type InstallCount = SourceSkill["installCount"];
const abbreviated = /^(\d+(?:\.\d+)?)([KMB])$/i;
const units: Record<string, number> = { K: 1e3, M: 1e6, B: 1e9 };

export function parseInstallCount(value: unknown): InstallCount {
  if (typeof value === "number") return Number.isSafeInteger(value) && value >= 0 ? { display: String(value), numeric: value } : null;
  if (typeof value !== "string") return null;
  const display = value.trim().replace(/\s+installs?$/i, "");
  if (/^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(display)) return parseInstallCount(Number(display.replaceAll(",", "")));
  return abbreviated.test(display) ? { display: display.toUpperCase(), numeric: null } : null;
}

/** Approximate values are only sorting hints; numeric remains exact or null. */
export function installCountSortValue(count: InstallCount): number {
  if (count?.numeric !== null && count?.numeric !== undefined) return count.numeric;
  const match = count && abbreviated.exec(count.display.replace(/\s+installs?$/i, ""));
  return match ? Number(match[1]) * units[match[2].toUpperCase()] : -1;
}

export function formatInstallCount(count: InstallCount): string {
  if (!count) return "安装量未提供";
  if (count.numeric !== null) return `${count.numeric.toLocaleString("zh-CN")} 次安装`;
  return `约 ${count.display.replace(/\s+installs?$/i, "")} 次安装`;
}
