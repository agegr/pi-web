import { NextResponse } from "next/server";
import { listThemeSets } from "@/lib/theme";

export async function GET() {
  try {
    const themeSets = listThemeSets();

    return NextResponse.json({ themeSets });
  } catch (error) {
    console.error("Failed to list themes:", error);
    return NextResponse.json(
      { error: "Failed to list themes" },
      { status: 500 },
    );
  }
}
