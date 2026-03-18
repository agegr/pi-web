// This route is no longer used — new sessions are created fully client-side.
// Kept as a no-op for reference.
export async function POST() {
  return new Response("Not used", { status: 410 });
}
