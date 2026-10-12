import { listWebSkins } from "@/lib/web-skin-files";

export const dynamic = "force-dynamic";
export async function GET() {
  return Response.json({ skins: listWebSkins() }, { headers: { "Cache-Control": "no-store" } });
}
