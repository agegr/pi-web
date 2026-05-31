import { NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";

export async function GET() {
  let piVersion = "unknown";
  try {
    const piPkgPath = join(
      process.cwd(),
      "node_modules/@earendil-works/pi-coding-agent/package.json"
    );
    piVersion = JSON.parse(readFileSync(piPkgPath, "utf8")).version;
  } catch {
    // fallback to build-time env
    piVersion = process.env.NEXT_PUBLIC_PI_VERSION ?? "unknown";
  }

  let appVersion = "0.0.0";
  try {
    const pkgPath = join(process.cwd(), "package.json");
    appVersion = JSON.parse(readFileSync(pkgPath, "utf8")).version;
  } catch {
    appVersion = process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0";
  }

  return NextResponse.json({
    appVersion,
    piVersion,
  });
}
