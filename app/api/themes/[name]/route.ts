import { NextRequest, NextResponse } from "next/server";
import { resolveTheme, type ThemeVariant } from "@/lib/theme";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  try {
    const { name } = await params;
    const { searchParams } = new URL(request.url);
    const mode = (searchParams.get("mode") || "dark") as ThemeVariant;

    const resolved = resolveTheme(
      decodeURIComponent(name),
      mode === "light" ? "light" : "dark",
    );

    if (!resolved) {
      return NextResponse.json(
        { error: `Theme "${name}" variant "${mode}" not found` },
        { status: 404 },
      );
    }

    return NextResponse.json(resolved);
  } catch (error) {
    console.error("Failed to resolve theme:", error);
    return NextResponse.json(
      { error: "Failed to resolve theme" },
      { status: 500 },
    );
  }
}
