/**
 * Shared bits for tool registrations.
 *
 * Server-only: imported only by the `*-tools.ts` modules that register the
 * agent's tools. Kept out of `tools.ts`, which is client-safe.
 */
export function text(message: string) {
  return { content: [{ type: "text" as const, text: message }], details: {} };
}
