// Which pages may put Pi Web's own pages (`/`, `/login`) in a frame. The app
// drives an agent that runs commands, and with no password set it needs no
// cookie, so a site that frames it gets a working UI it can lay its own
// content over and steer clicks and drops into. Only Pi Web's own origin may
// frame it unless PI_WEB_FRAME_ANCESTORS names more: a launcher or portal
// that embeds Pi Web in an iframe from another origin.

// One CSP source expression: a scheme (`https:`), `*`, or a host with an
// optional scheme, wildcard subdomain and port, e.g. `https://portal.example`,
// `http://localhost:*`, `*.example.com`. Nothing that could end the directive
// (`;`, `,`, whitespace) or add a keyword.
const SOURCE_EXPRESSION = /^(?:\*|[a-z][a-z0-9+.-]*:|(?:[a-z][a-z0-9+.-]*:\/\/)?(?:\*|(?:\*\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*|\[[0-9a-f:.]+\])(?::(?:\d{1,5}|\*))?\/?)$/i;

let warnedValue: string | undefined;

export function frameAncestorSources(value = process.env.PI_WEB_FRAME_ANCESTORS): string[] {
  const entries = (value ?? "").split(",").map((entry) => entry.trim()).filter(Boolean);
  const valid = entries.filter((entry) => SOURCE_EXPRESSION.test(entry));
  if (valid.length !== entries.length && warnedValue !== value) {
    warnedValue = value;
    const invalid = entries.filter((entry) => !valid.includes(entry));
    console.warn(`[pi-web] PI_WEB_FRAME_ANCESTORS: ignoring ${invalid.map((entry) => JSON.stringify(entry)).join(", ")}`);
  }
  return valid;
}

// Documents Pi Web serves for its own frames (the DOCX preview, an SVG
// opened as a document) name the same ancestors: frame-ancestors checks every ancestor up to the top page, so
// 'self' alone blanks them once a launcher embeds Pi Web.
export function frameAncestorsDirective(value = process.env.PI_WEB_FRAME_ANCESTORS): string {
  return ["frame-ancestors", "'self'", ...frameAncestorSources(value)].join(" ");
}

export function pageFramingHeaders(value = process.env.PI_WEB_FRAME_ANCESTORS): [string, string][] {
  const sources = frameAncestorSources(value);
  const headers: [string, string][] = [
    ["Content-Security-Policy", frameAncestorsDirective(value)],
  ];
  // X-Frame-Options cannot name another origin. Browsers that know
  // frame-ancestors ignore it, so it only guards older ones, and only when
  // there is no other origin to let through.
  if (sources.length === 0) headers.push(["X-Frame-Options", "SAMEORIGIN"]);
  return headers;
}
