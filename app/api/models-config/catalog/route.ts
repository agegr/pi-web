import { NextResponse } from "next/server";
import {
  flattenModelsDevCatalog,
  recommendModelCatalogPreset,
  searchModelCatalog,
  type ModelCatalogEntry,
} from "@/lib/model-catalog";
import { createRefreshingCache } from "@/lib/refreshing-cache";

export const dynamic = "force-dynamic";

const MODELS_DEV_URL = "https://models.dev/api.json";
const CATALOG_TTL_MS = 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 15_000;

async function fetchCatalog(): Promise<ModelCatalogEntry[]> {
  const response = await fetch(MODELS_DEV_URL, {
    cache: "no-store",
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`models.dev returned HTTP ${response.status}`);
  const entries = flattenModelsDevCatalog(await response.json());
  if (entries.length === 0) throw new Error("models.dev returned an empty catalog");
  return entries;
}

const loadCatalog = createRefreshingCache("pi-web:models-dev-catalog", CATALOG_TTL_MS, fetchCatalog);

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const query = (searchParams.get("q") ?? "").slice(0, 120);
  const provider = (searchParams.get("provider") ?? "").slice(0, 120);
  const baseUrl = (searchParams.get("baseUrl") ?? "").slice(0, 500);
  const parsedLimit = Number.parseInt(searchParams.get("limit") ?? "50", 10);
  const limit = Number.isFinite(parsedLimit) ? parsedLimit : 50;

  try {
    const entries = await loadCatalog();
    const models = searchModelCatalog(entries, query, provider, limit);
    const recommendation = recommendModelCatalogPreset(entries, query, provider, baseUrl);
    return NextResponse.json({ models, recommendation, source: MODELS_DEV_URL });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 502 });
  }
}
