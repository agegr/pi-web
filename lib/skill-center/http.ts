import { isApiRequestAllowed, hasJsonContentType } from "../request-security";
import { CenterError, errorBody, requireValue } from "./errors";
import { getTaxonomy, queryCatalog } from "./catalog";
import { inventory } from "./inventory";
import { detail, search, snapshotContent, snapshotFiles } from "./remote";
import { checks, createPlan, getOperation, reconcile, submitOperation, visibility, writeStatus, setClassification } from "./mutations";
import type { DetailRequest, PlanRequest } from "./types";

export async function handleSkillCenter(req: Request, segments: string[]): Promise<Response> {
  try {
    requireValue(isApiRequestAllowed(req), "FORBIDDEN_REQUEST", "请求来源未获授权。", 403);
    const route = segments.join("/");
    let body: Record<string, unknown> = {};
    if (req.method !== "GET") {
      requireValue(hasJsonContentType(req), "UNSUPPORTED_MEDIA_TYPE", "请求必须为 application/json。", 415);
      try { const parsed = await req.json(); requireValue(parsed && typeof parsed === "object" && !Array.isArray(parsed), "INVALID_INPUT", "请求必须为 JSON 对象。"); body = parsed; }
      catch (error) { if (error instanceof CenterError) throw error; throw new CenterError(400, "INVALID_INPUT", "JSON 请求格式无效。"); }
    }
    let result: unknown; let status = 200;
    if (req.method === "GET" && route === "taxonomy") result = getTaxonomy();
    else if (req.method === "GET" && route === "write-status") result = await writeStatus();
    else if (req.method === "POST" && route === "write-status/reconcile") result = await writeStatus(true);
    else if (req.method === "POST" && route === "catalog/query") result = queryCatalog(body);
    else if (req.method === "POST" && route === "search") result = await search(body);
    else if (req.method === "POST" && route === "inventory/query") result = await inventory(body.cwd);
    else if (req.method === "POST" && route === "detail") {
      requireValue(body.kind === "remote" && typeof body.canonicalSkillId === "string" && body.installationId === undefined || body.kind === "installed" && typeof body.installationId === "string" && body.canonicalSkillId === undefined, "INVALID_INPUT", "请选择明确的来源技能或安装实例。");
      result = await detail(body as unknown as DetailRequest);
    } else if (req.method === "POST" && route === "plans") {
      requireValue(body.kind === "install" && typeof body.canonicalSkillId === "string" || body.kind === "update" && typeof body.installationId === "string" && typeof body.expectedRevision === "string", "INVALID_INPUT", "计划输入无效。");
      result = (await createPlan(body as unknown as PlanRequest)).plan;
    } else if (req.method === "POST" && route === "operations") {
      const response = await submitOperation(body); result = { operation: response.operation }; status = response.duplicate ? 200 : 202;
    } else if (req.method === "GET" && segments.length === 2 && segments[0] === "operations") result = await getOperation(segments[1]);
    else if (req.method === "POST" && segments.length === 3 && segments[0] === "operations" && segments[2] === "reconcile") result = await reconcile(segments[1]);
    else if (req.method === "GET" && segments.length === 3 && segments[0] === "snapshots" && segments[2] === "files") result = await snapshotFiles(segments[1]);
    else if (req.method === "POST" && segments.length === 3 && segments[0] === "snapshots" && segments[2] === "content") result = await snapshotContent(segments[1], body.path);
    else if (req.method === "PATCH" && segments.length === 3 && segments[0] === "installations" && segments[2] === "visibility") result = await visibility(segments[1], body);
    else if (req.method === "PATCH" && segments.length === 3 && segments[0] === "installations" && segments[2] === "classification") result = await setClassification(segments[1], body);
    else if (req.method === "POST" && route === "checks") result = await checks(body.cwd, body.installationIds);
    else throw new CenterError(404, "NOT_FOUND", "未找到技能中心接口。");
    return Response.json(result, { status, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return Response.json(errorBody(error), { status: error instanceof CenterError ? error.status : 500, headers: { "Cache-Control": "no-store" } }); }
}
