import { NextResponse } from "next/server";
import { aggregateUsage, scanUsage, type UsageRange } from "@/lib/usage-store";

const RANGES: UsageRange[] = ["today", "7d", "30d", "all"];

export async function GET(req: Request) {
  try {
    const param = new URL(req.url).searchParams.get("range");
    const range: UsageRange = RANGES.includes(param as UsageRange) ? (param as UsageRange) : "7d";
    await scanUsage();
    return NextResponse.json(aggregateUsage(range));
  } catch (error) {
    return NextResponse.json(
      { error: String(error) },
      { status: 500 }
    );
  }
}
