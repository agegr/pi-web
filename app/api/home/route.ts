import { homedir } from "os";

export async function GET() {
  return Response.json({ home: homedir() });
}
