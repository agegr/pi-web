// A fake OAuth-protected MCP server on 127.0.0.1, for sign-in tests that run
// the SDK's own flow: one origin serves a streamable HTTP MCP server at /mcp,
// which answers 401 with a `WWW-Authenticate` challenge unless the request
// carries an access token it issued, and the authorization server for it —
// protected resource and authorization server metadata, dynamic client
// registration, an /authorize that approves at once by redirecting to the
// redirect URI (what a browser would follow), and /token with PKCE checks and
// refresh tokens. Nothing leaves the machine.
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";

const base64url = (buffer) => Buffer.from(buffer).toString("base64url");

/**
 * Starts the server. `issued` holds what it handed out: access and refresh
 * tokens, pending codes, registered clients (their metadata) and the grant
 * types /token was asked for, in order. `hooks.beforeRefresh`, when set, is
 * awaited once a refresh token checked out and before it is answered, so a
 * test can sign out while a refresh is on its way.
 */
export async function startFakeOAuthServer() {
  const issued = { access: new Set(), refresh: new Set(), codes: new Map(), clients: [], grants: [] };
  const hooks = { beforeRefresh: undefined };
  let origin;
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, origin);
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString("utf8");
    const json = (status, value, headers = {}) => {
      response.writeHead(status, { "Content-Type": "application/json", ...headers });
      response.end(JSON.stringify(value));
    };
    if (url.pathname.startsWith("/.well-known/oauth-protected-resource")) {
      return json(200, { resource: `${origin}/mcp`, authorization_servers: [origin] });
    }
    if (url.pathname === "/.well-known/oauth-authorization-server") {
      return json(200, {
        issuer: origin,
        authorization_endpoint: `${origin}/authorize`,
        token_endpoint: `${origin}/token`,
        registration_endpoint: `${origin}/register`,
        response_types_supported: ["code"],
        code_challenge_methods_supported: ["S256"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        token_endpoint_auth_methods_supported: ["none"],
      });
    }
    if (url.pathname === "/register" && request.method === "POST") {
      const metadata = JSON.parse(body);
      issued.clients.push(metadata);
      return json(201, { client_id: `client-${issued.clients.length}`, redirect_uris: metadata.redirect_uris, token_endpoint_auth_method: "none" });
    }
    if (url.pathname === "/authorize") {
      const code = `code-${randomUUID()}`;
      issued.codes.set(code, { challenge: url.searchParams.get("code_challenge"), redirect: url.searchParams.get("redirect_uri") });
      const target = new URL(url.searchParams.get("redirect_uri"));
      target.searchParams.set("code", code);
      target.searchParams.set("state", url.searchParams.get("state"));
      response.writeHead(302, { Location: target.href });
      response.end();
      return undefined;
    }
    if (url.pathname === "/token" && request.method === "POST") {
      const params = new URLSearchParams(body);
      issued.grants.push(params.get("grant_type"));
      if (params.get("grant_type") === "authorization_code") {
        const record = issued.codes.get(params.get("code"));
        const verifier = params.get("code_verifier") ?? "";
        if (!record || base64url(createHash("sha256").update(verifier).digest()) !== record.challenge || params.get("redirect_uri") !== record.redirect) {
          return json(400, { error: "invalid_grant", error_description: "bad code" });
        }
        issued.codes.delete(params.get("code"));
      } else if (params.get("grant_type") === "refresh_token") {
        if (!issued.refresh.has(params.get("refresh_token"))) return json(400, { error: "invalid_grant" });
        if (hooks.beforeRefresh) await hooks.beforeRefresh();
      } else {
        return json(400, { error: "unsupported_grant_type" });
      }
      const access = `access-${randomUUID()}`;
      const refresh = `refresh-${randomUUID()}`;
      issued.access.add(access);
      issued.refresh.add(refresh);
      return json(200, { access_token: access, token_type: "Bearer", refresh_token: refresh, expires_in: 3600 });
    }
    if (url.pathname === "/mcp") {
      const token = request.headers.authorization?.replace(/^Bearer /, "");
      if (!token || !issued.access.has(token)) {
        return json(401, { error: "unauthorized" }, {
          "WWW-Authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"`,
        });
      }
      if (request.method !== "POST") {
        response.writeHead(request.method === "GET" ? 405 : 200).end();
        return undefined;
      }
      const message = JSON.parse(body);
      if (message.id === undefined) {
        response.writeHead(202).end();
        return undefined;
      }
      const result = message.method === "initialize"
        ? { protocolVersion: message.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "oauth-fixture", version: "1.0.0" } }
        : message.method === "tools/list"
          ? { tools: [{ name: "whoami", description: "Who signed in.", inputSchema: { type: "object" } }] }
          : {};
      return json(200, { jsonrpc: "2.0", id: message.id, result });
    }
    response.writeHead(404).end();
    return undefined;
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  return {
    url: `${origin}/mcp`,
    origin,
    issued,
    hooks,
    close: () => new Promise((resolve) => {
      server.closeAllConnections?.();
      server.close(() => resolve());
    }),
  };
}

/** What a browser gets when it opens the sign-in page and approves: the address it is sent back to. */
export async function approveSignIn(page) {
  const response = await fetch(page, { redirect: "manual" });
  if (response.status !== 302) throw new Error(`the sign-in page answered ${response.status}`);
  return response.headers.get("location");
}
