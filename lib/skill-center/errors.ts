import { randomUUID } from "node:crypto";
import type { ApiError } from "./types";

export class CenterError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export function requireValue(condition: unknown, code: string, message: string, status = 400): asserts condition {
  if (!condition) throw new CenterError(status, code, message);
}
export function errorBody(error: unknown): ApiError {
  return { error: { code: error instanceof CenterError ? error.code : "INTERNAL_ERROR",
    message: error instanceof CenterError ? error.message : "技能中心暂时无法完成请求，请重试读取或预检。",
    retryable: !(error instanceof CenterError) || error.status >= 500,
    requestId: randomUUID() } };
}
