import { handleSkillCenter } from "@/lib/skill-center/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
async function handler(req: Request, context: { params: Promise<{ path: string[] }> }) {
  return handleSkillCenter(req, (await context.params).path);
}
export { handler as GET, handler as POST, handler as PATCH };
