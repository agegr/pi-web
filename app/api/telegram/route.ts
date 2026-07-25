import { existsSync } from "node:fs";
import { NextResponse } from "next/server";
import { getTelegramBridge, testTelegramToken } from "@/lib/telegram-bridge";
import {
  normalizeAllowedChatIds,
  readTelegramConfig,
  toPublicTelegramConfig,
  validateTelegramConfig,
  writeTelegramConfig,
} from "@/lib/telegram-config";

export const runtime = "nodejs";

export async function GET() {
  const config = readTelegramConfig();
  return NextResponse.json({
    config: toPublicTelegramConfig(config),
    status: getTelegramBridge().getStatus(),
  });
}
export async function PUT(req: Request) {
  try {
    const body = await req.json() as {
      enabled?: unknown;
      token?: unknown;
      clearToken?: unknown;
      allowedChatIds?: unknown;
      cwd?: unknown;
    };
    const current = readTelegramConfig();
    const next = {
      enabled: body.enabled === true,
      token: body.clearToken === true
        ? ""
        : typeof body.token === "string" && body.token.trim()
          ? body.token.trim()
          : current.token,
      allowedChatIds: normalizeAllowedChatIds(body.allowedChatIds),
      cwd: typeof body.cwd === "string" ? body.cwd.trim() : current.cwd,
    };
    const validationError = validateTelegramConfig(next);
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    writeTelegramConfig(next);
    await getTelegramBridge().restart();
    return NextResponse.json({
      config: toPublicTelegramConfig(next),
      status: getTelegramBridge().getStatus(),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json() as { action?: unknown; token?: unknown; cwd?: unknown };
    if (body.action === "test") {
      const saved = readTelegramConfig();
      const token = typeof body.token === "string" && body.token.trim()
        ? body.token.trim()
        : saved.token;
      if (!token) return NextResponse.json({ error: "Enter a bot token first." }, { status: 400 });
      const bot = await testTelegramToken(token);
      return NextResponse.json({ bot });
    }
    if (body.action === "validate-cwd") {
      const cwd = typeof body.cwd === "string" ? body.cwd.trim() : "";
      return NextResponse.json({ valid: Boolean(cwd && existsSync(cwd)) });
    }
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
