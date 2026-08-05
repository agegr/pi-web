import { NextResponse } from "next/server";
import { runNpx, getSafeNpxEnv, redactNpxOutput } from "@/lib/npx";
import type { SkillSearchResult } from "@/lib/api-types";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

const ANSI_RE = /\x1B\[[0-9;]*m/g;
const DEFAULT_LIMIT = 50;
const MIN_LIMIT = 1;
const MAX_LIMIT = 50;
const MAX_QUERY_LENGTH = 200;
const SEARCH_API_BASE = process.env.SKILLS_API_URL || "https://skills.sh";

interface SkillsApiSkill {
  id?: string;
  name?: string;
  source?: string;
  installs?: number;
}

interface SkillsApiResponse {
  skills?: SkillsApiSkill[];
}

function parseLimit(value: unknown): number {
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, Math.floor(num)));
}

function formatInstalls(count?: number): string {
  if (!count || count <= 0) return "";
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1).replace(/\.0$/, "")}M installs`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1).replace(/\.0$/, "")}K installs`;
  return `${count} install${count === 1 ? "" : "s"}`;
}

function parseSearchOutput(raw: string): SkillSearchResult[] {
  const clean = raw.replace(ANSI_RE, "");
  const results: SkillSearchResult[] = [];
  const lines = clean.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    // package line: "owner/repo@skill  NNK installs"
    const pkgMatch = line.match(/^([\w.\-]+\/[\w.\-@:]+)\s+([\d.,]+[KMB]?\s+installs)$/);
    if (pkgMatch) {
      const urlLine = lines[i + 1]?.trim().replace(/^└\s*/, "");
      results.push({
        package: pkgMatch[1],
        installs: pkgMatch[2],
        url: urlLine?.startsWith("https://") ? urlLine : "",
      });
    }
  }
  return results;
}

async function searchSkillsApi(query: string, limit: number): Promise<SkillSearchResult[]> {
  const url = `${SEARCH_API_BASE}/api/search?q=${encodeURIComponent(query)}&limit=${limit}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`skills.sh search failed: HTTP ${res.status}`);

  const data = (await res.json()) as SkillsApiResponse;
  return (data.skills ?? [])
    .map((skill) => {
      const name = skill.name?.trim();
      const source = skill.source?.trim();
      const slug = skill.id?.trim();
      if (!name || (!source && !slug)) return null;

      const pkg = `${source || slug}@${name}`;
      return {
        package: pkg,
        installs: formatInstalls(skill.installs),
        url: slug ? `${SEARCH_API_BASE}/${slug}` : "",
      };
    })
    .filter((skill): skill is SkillSearchResult => skill !== null)
    .sort((a, b) => parseInstallCount(b.installs) - parseInstallCount(a.installs));
}

function parseInstallCount(installs: string): number {
  const match = installs.match(/^([\d.]+)([KMB])?\s+installs?$/);
  if (!match) return 0;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return 0;
  const multiplier = match[2] === "B" ? 1_000_000_000 : match[2] === "M" ? 1_000_000 : match[2] === "K" ? 1_000 : 1;
  return value * multiplier;
}

// POST /api/skills/search  body: { query: string, limit?: number }
export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }

  try {
    const { query: rawQuery, limit: rawLimit } = await req.json() as { query?: unknown; limit?: unknown };
    const query = typeof rawQuery === "string" ? rawQuery.trim() : "";
    if (!query) return NextResponse.json({ error: "query required" }, { status: 400 });
    if (query.length > MAX_QUERY_LENGTH) {
      return NextResponse.json({ error: `query must be ${MAX_QUERY_LENGTH} characters or fewer` }, { status: 400 });
    }
    const limit = parseLimit(rawLimit);

    try {
      const results = await searchSkillsApi(query, limit);
      return NextResponse.json({ results });
    } catch {
      const { stdout, stderr } = await runNpx(["skills", "find", query], {
        timeout: 20000,
        env: getSafeNpxEnv({ FORCE_COLOR: "0" }),
      });

      const output = redactNpxOutput(stdout + stderr).replace(ANSI_RE, "");
      const results = parseSearchOutput(output).slice(0, limit);
      return NextResponse.json({ results });
    }
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string; message?: string };
    const raw = redactNpxOutput((err.stdout ?? "") + (err.stderr ?? ""));
    const results = raw ? parseSearchOutput(raw) : [];
    if (results.length > 0) return NextResponse.json({ results });
    return NextResponse.json({
      error: redactNpxOutput(err.message ?? "Skill search failed").slice(-500),
    }, { status: 500 });
  }
}
