import { getModelNameMap, getModelList, getDefaultModel } from "@/lib/session-reader";

export const dynamic = "force-dynamic";

export async function GET() {
  const map = getModelNameMap();
  const list = getModelList();
  const defaultModel = getDefaultModel();
  return Response.json({ models: Object.fromEntries(map), modelList: list, defaultModel });
}
