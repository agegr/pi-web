import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { invalidateModelsCache } from "@/lib/models-cache";
import { getAuthenticatedSession, readAuthJson } from "@/lib/pi-web-auth-route";

export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ provider: string }> }
) {
  if (!getAuthenticatedSession(_req).valid) return Response.json({ error: "未认证" }, { status: 401 });
  try {
    await readAuthJson(_req);
  } catch (error) {
    const status = (error as { status?: number }).status;
    return Response.json({ error: status ? (error as Error).message : "请求体无效" }, { status: status ?? 400 });
  }
  const { provider } = await params;
  const modelRuntime = await ModelRuntime.create();
  if (!modelRuntime.getProvider(provider)?.auth.oauth) {
    return Response.json({ error: `Unknown provider: ${provider}` }, { status: 400 });
  }
  await modelRuntime.logout(provider);
  invalidateModelsCache();
  return Response.json({ ok: true });
}
