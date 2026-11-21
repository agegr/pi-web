import { existsSync } from "node:fs";
import { NextResponse } from "next/server";
import {
  DEFAULT_USD_TO_CNY_RATE,
  normalizeCostDisplaySettings,
  type CostDisplaySettings,
} from "@/lib/cost-format";
import { getGlobalSettingsPath, readGlobalSettings, updateGlobalSettings } from "@/lib/global-settings-file";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

async function readCostDisplaySettings(): Promise<CostDisplaySettings> {
  return readGlobalSettings(getGlobalSettingsPath(), (settings) =>
    normalizeCostDisplaySettings(settings.ui),
  );
}

function errorResponse(error: unknown) {
  return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
}

export async function GET() {
  try {
    return NextResponse.json(await readCostDisplaySettings());
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Body must be a JSON object" }, { status: 400 });
  }
  const { costCurrency, usdToCnyRate } = body as { costCurrency?: unknown; usdToCnyRate?: unknown };
  if (costCurrency !== "USD" && costCurrency !== "CNY") {
    return NextResponse.json({ error: "costCurrency must be \"USD\" or \"CNY\"" }, { status: 400 });
  }
  if (typeof usdToCnyRate !== "number" || !Number.isFinite(usdToCnyRate) || usdToCnyRate <= 0) {
    return NextResponse.json({ error: "usdToCnyRate must be a positive number" }, { status: 400 });
  }
  try {
    if (
      costCurrency === "USD"
      && usdToCnyRate === DEFAULT_USD_TO_CNY_RATE
      && !existsSync(getGlobalSettingsPath())
    ) {
      return NextResponse.json({ costCurrency: "USD", usdToCnyRate: DEFAULT_USD_TO_CNY_RATE });
    }
    await updateGlobalSettings(getGlobalSettingsPath(), (settings) => {
      const ui =
        settings.ui !== null && typeof settings.ui === "object" && !Array.isArray(settings.ui)
          ? { ...(settings.ui as Record<string, unknown>) }
          : {};
      ui.costCurrency = costCurrency;
      ui.usdToCnyRate = usdToCnyRate;
      settings.ui = ui;
    });
    return NextResponse.json(await readCostDisplaySettings());
  } catch (error) {
    return errorResponse(error);
  }
}
