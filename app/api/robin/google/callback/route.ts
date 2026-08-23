import { exchangeCode } from "@/extension/robin/google-calendar";
import { consumeState, redirectUriFor } from "@/lib/google-oauth-state";

export const dynamic = "force-dynamic";

/**
 * Google redirects the browser here after consent.
 *
 * This arrives as a cross-site navigation from accounts.google.com, so the
 * same-origin guard cannot pass; `isApiRequestAllowed` exempts this exact path
 * (see lib/request-security.ts) because otherwise proxy.ts rejects the callback
 * before this route ever runs. The `state` nonce is what authenticates it: it
 * was minted by this server, is single-use, and expires in ten minutes.
 */
function page(title: string, detail: string): Response {
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>${title}</title>`
    + `<body style="font:14px system-ui;padding:2rem;max-width:34rem">`
    + `<h1 style="font-size:1rem">${title}</h1><p>${detail}</p>`
    + `<p><a href="/dashboard">Back to the dashboard</a></p>`,
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char] as string
  ));
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const error = url.searchParams.get("error");
  if (error) return page("Connection cancelled", escapeHtml(error));

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return page("Connection failed", "Google's redirect was missing code or state.");
  if (!consumeState(state)) {
    return page(
      "Connection failed",
      "That authorization link was not recognised — it may have expired or already been used. Start again from the dashboard.",
    );
  }

  try {
    await exchangeCode(code, redirectUriFor(req));
    return page("Google Calendar connected", "Your events will appear on the dashboard.");
  } catch (caught) {
    return page("Connection failed", escapeHtml(caught instanceof Error ? caught.message : String(caught)));
  }
}
