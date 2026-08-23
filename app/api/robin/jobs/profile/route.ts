import { NextResponse } from "next/server";
import { BOARD_PROVIDERS, COMPANY_PROVIDERS, resolveProvider } from "@/extension/robin/job-providers";
import {
  DEFAULT_JOB_PROFILE,
  EXCLUDE_PRESETS,
  LOCATION_PRESETS,
  STARTER_COMPANIES,
  TITLE_PRESETS,
  newId,
  readJobProfile,
  writeJobProfile,
  type JobProfile,
  type TrackedCompany,
} from "@/extension/robin/store";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

/** Big enough for a long CV, small enough that a paste accident is not a file bomb. */
const MAX_CV_BYTES = 200_000;
const MAX_NOTES_BYTES = 20_000;
const MAX_LIST_ENTRIES = 200;

function guard(req: Request, requireJson: boolean): NextResponse | null {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (requireJson && !hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }
  return null;
}

function fail(error: unknown, status = 400): NextResponse {
  return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status });
}

/** Keyword lists: trimmed, de-duplicated, bounded. Order is the user's. */
function stringList(value: unknown, field: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`${field} must be a list of strings`);
  const cleaned = value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean);
  if (cleaned.length > MAX_LIST_ENTRIES) {
    throw new Error(`${field} has more than ${MAX_LIST_ENTRIES} entries`);
  }
  return [...new Set(cleaned)];
}

function number(value: unknown, field: string, fallback: number, min: number, max: number): number {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${field} must be a number`);
  return Math.min(Math.max(parsed, min), max);
}

function text(value: unknown, field: string, limit: number): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw new Error(`${field} must be text`);
  if (Buffer.byteLength(value, "utf8") > limit) {
    throw new Error(`${field} is larger than ${Math.round(limit / 1000)}KB`);
  }
  return value;
}

/**
 * A company is only accepted once some provider recognises its URL.
 *
 * Rejecting it here rather than at scan time is the difference between "that
 * address is not a supported board" while the user is looking at the field,
 * and a row that silently contributes nothing every morning for a month.
 */
function companies(value: unknown): TrackedCompany[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("companies must be a list");
  if (value.length > MAX_LIST_ENTRIES) throw new Error(`More than ${MAX_LIST_ENTRIES} companies`);

  return value.map((raw) => {
    const entry = (raw ?? {}) as Record<string, unknown>;
    const name = typeof entry.name === "string" ? entry.name.trim() : "";
    const url = typeof entry.url === "string" ? entry.url.trim() : "";
    if (!name) throw new Error("Every company needs a name");
    if (!url) throw new Error(`${name} needs a careers or board URL`);

    const provider = typeof entry.provider === "string" && entry.provider.trim()
      ? entry.provider.trim()
      : undefined;
    if (provider && !COMPANY_PROVIDERS.some((candidate) => candidate.id === provider)) {
      throw new Error(`${name}: unknown board type "${provider}"`);
    }

    const company: TrackedCompany = {
      id: typeof entry.id === "string" && entry.id ? entry.id : newId(),
      name,
      url,
      ...(provider ? { provider } : {}),
      enabled: entry.enabled !== false,
    };
    if (!resolveProvider(company)) {
      throw new Error(
        `${name}: ${url} is not a supported job board. Supported: `
        + `${COMPANY_PROVIDERS.map((candidate) => candidate.label).join(", ")}.`,
      );
    }
    return company;
  });
}

/**
 * A pinned model, or null. Only the shape is checked here — whether the model
 * actually exists is pi's call, and it reports that at session start where the
 * error can name the model.
 */
function scoreModel(value: unknown): { provider: string; modelId: string } | null {
  if (!value || typeof value !== "object") return null;
  const entry = value as Record<string, unknown>;
  const provider = typeof entry.provider === "string" ? entry.provider.trim() : "";
  const modelId = typeof entry.modelId === "string" ? entry.modelId.trim() : "";
  if (!provider || !modelId) return null;
  return { provider, modelId };
}

function boards(value: unknown): string[] {
  const ids = stringList(value, "boards");
  const known = new Set(BOARD_PROVIDERS.map((provider) => provider.id));
  const unknown = ids.find((id) => !known.has(id));
  if (unknown) throw new Error(`Unknown job board "${unknown}"`);
  return ids;
}

/**
 * The saved profile, plus the two catalogues the editor renders itself from:
 * which boards exist, and which presets it can offer. Both are server-owned so
 * adding a provider or a preset does not need a matching change in the page.
 */
export async function GET(req: Request) {
  const blocked = guard(req, false);
  if (blocked) return blocked;
  try {
    return NextResponse.json({
      profile: readJobProfile(),
      providers: {
        companies: COMPANY_PROVIDERS.map(({ id, label }) => ({ id, label })),
        boards: BOARD_PROVIDERS.map(({ id, label }) => ({ id, label })),
      },
      presets: {
        titles: TITLE_PRESETS,
        excludes: EXCLUDE_PRESETS,
        locations: LOCATION_PRESETS,
      },
      starterCompanies: STARTER_COMPANIES,
    });
  } catch (error) {
    return fail(error, 500);
  }
}

/**
 * Replace the profile wholesale.
 *
 * It is one settings document edited on one screen, so a PATCH of individual
 * keys would only invite the two halves to disagree. Fields the body omits
 * fall back to their defaults, not to what was stored — a save always says
 * exactly what the profile now is.
 */
export async function PUT(req: Request) {
  const blocked = guard(req, true);
  if (blocked) return blocked;
  try {
    const body = await req.json() as Record<string, unknown>;
    const profile: JobProfile = {
      titles: stringList(body.titles, "titles"),
      excludeTitles: stringList(body.excludeTitles, "excludeTitles"),
      locationAlways: stringList(body.locationAlways, "locationAlways"),
      locationAllow: stringList(body.locationAllow, "locationAllow"),
      locationBlock: stringList(body.locationBlock, "locationBlock"),
      companies: companies(body.companies),
      boards: boards(body.boards),
      readUnknownBoards: body.readUnknownBoards === true,
      blacklist: stringList(body.blacklist, "blacklist"),
      sinceDays: number(body.sinceDays, "sinceDays", DEFAULT_JOB_PROFILE.sinceDays, 0, 365),
      minScore: number(body.minScore, "minScore", DEFAULT_JOB_PROFILE.minScore, 1, 5),
      // 0 is the off switch, so the floor is 0 rather than 1.
      maxYears: number(body.maxYears, "maxYears", DEFAULT_JOB_PROFILE.maxYears, 0, 20),
      digestSize: number(body.digestSize, "digestSize", DEFAULT_JOB_PROFILE.digestSize, 1, 50),
      scoreBatch: number(body.scoreBatch, "scoreBatch", DEFAULT_JOB_PROFILE.scoreBatch, 1, 40),
      rubricLocale: body.rubricLocale === "zh" ? "zh" : "en",
      scoreModel: scoreModel(body.scoreModel),
      cv: text(body.cv, "cv", MAX_CV_BYTES),
      notes: text(body.notes, "notes", MAX_NOTES_BYTES),
      linkGroup: text(body.linkGroup, "linkGroup", 200).trim() || DEFAULT_JOB_PROFILE.linkGroup,
      updatedAt: new Date().toISOString(),
    };
    writeJobProfile(profile);
    return NextResponse.json({ profile: readJobProfile() });
  } catch (error) {
    return fail(error);
  }
}
