import { NextResponse } from "next/server";
import { homedir } from "os";

export async function GET() {
  return NextResponse.json({ home: homedir() });
}
