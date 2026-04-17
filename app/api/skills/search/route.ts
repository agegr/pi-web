import { NextResponse } from "next/server";
import { runNpx } from "@/lib/npx";

export const dynamic = "force-dynamic";

const ANSI_RE = /\x1B\[[0-9;]*m/g;

export interface SkillSearchResult {
  package: string;
  installs: string;
  url: string;
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

// POST /api/skills/search  body: { query: string }
export async function POST(req: Request) {
  try {
    const { query } = await req.json() as { query?: string };
    if (!query?.trim()) return NextResponse.json({ error: "query required" }, { status: 400 });

    const { stdout, stderr } = await runNpx(["skills", "find", query.trim()], {
      timeout: 20000,
      env: { ...process.env, FORCE_COLOR: "0" },
    });

    const results = parseSearchOutput(stdout + stderr);
    return NextResponse.json({ results });
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string; message?: string };
    const raw = (err.stdout ?? "") + (err.stderr ?? "");
    const results = raw ? parseSearchOutput(raw) : [];
    if (results.length > 0) return NextResponse.json({ results });
    return NextResponse.json({ error: err.message ?? String(e) }, { status: 500 });
  }
}
