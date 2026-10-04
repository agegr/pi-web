// Secret classification and masking for MCP server entries (ADR 0006). The
// Settings panel and the trust dialog show a server's command, arguments and
// URL to a browser that may be on another machine, and a project's `mcp.json`
// is whatever its repository committed. Env and header values are never sent
// at all (names only); this module covers what is shown: it masks the parts
// of a URL or an argument list that look like credentials. The same rules
// decide which values of an entry are literal secrets, which may only be
// saved in the global file.
//
// It is pure (no Node APIs), so the browser-side importer can use it too.
// Masked strings are for display only; nothing parses them back. What a mask
// hid can be listed (`urlSecretParts()`, `commandSecretParts()`,
// `argSecretParts()`), for code that must find those values again in other
// text, such as a connection test's error message.

export const SECRET_MASK = "•••";

/** Words that name a credential wherever they appear in a name: `OPENAI_API_KEY`, `x-api-key`, `accessToken`. */
const SECRET_WORDS = new Set([
  "key",
  "apikey",
  "token",
  "secret",
  "password",
  "passwd",
  "passphrase",
  "pwd",
  "pass",
  "credential",
  "credentials",
  "authorization",
  "bearer",
  "jwt",
  "cookie",
  "signature",
  "pat",
]);

/** Names that hold credentials in a query string as well: `?auth=…`, Azure's `sig=…`. */
const SECRET_PARAMETER_WORDS = new Set([...SECRET_WORDS, "auth", "sig", "code", "pw"]);

/** A word that ends in one of these is a credential too, as all-caps names run words together: `GITHUBTOKEN`. */
const SECRET_SUFFIXES = ["token", "secret", "password", "passwd", "apikey"];

/**
 * A name that ends in one of these words describes a credential rather than
 * holding one: `API_KEY_FILE`, `TOKEN_URL`, `AWS_ACCESS_KEY_ID`.
 */
const QUALIFIER_WORDS = new Set([
  "file",
  "path",
  "dir",
  "url",
  "uri",
  "endpoint",
  "id",
  "name",
  "type",
  "header",
  "env",
  "var",
  "length",
  "ttl",
  "expiry",
  "expires",
  "timeout",
  "mode",
  "format",
]);

/** Short flags that take a credential as their next argument. */
const SHORT_SECRET_FLAGS = new Set(["-k"]);

function nameWords(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function namesSecret(name: string, words: ReadonlySet<string>): boolean {
  const parts = nameWords(name);
  if (parts.length > 1 && QUALIFIER_WORDS.has(parts[parts.length - 1])) return false;
  return parts.some(
    (word) => words.has(word) || SECRET_SUFFIXES.some((suffix) => word.length > suffix.length && word.endsWith(suffix)),
  );
}

/** Whether an env variable, header, or flag name names a credential. */
export function isSecretName(name: string): boolean {
  return namesSecret(name, SECRET_WORDS);
}

function isSecretParameterName(name: string): boolean {
  let decoded = name;
  try {
    decoded = decodeURIComponent(name);
  } catch {
    // Keep the raw name.
  }
  return namesSecret(decoded, SECRET_PARAMETER_WORDS);
}

/** Prefixes that well-known services give their keys and tokens. */
const KNOWN_TOKEN = new RegExp(
  "^(?:" + [
    "sk-[A-Za-z0-9_-]{16,}",
    "(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{16,}",
    "gh[pousr]_[A-Za-z0-9]{20,}",
    "github_pat_[A-Za-z0-9_]{20,}",
    "glpat-[A-Za-z0-9_-]{16,}",
    "xox[abposr]-[A-Za-z0-9-]{10,}",
    "(?:AKIA|ASIA)[0-9A-Z]{16}",
    "AIza[0-9A-Za-z_-]{30,}",
    "ya29\\.[0-9A-Za-z_-]{20,}",
    "npm_[A-Za-z0-9]{30,}",
    "hf_[A-Za-z0-9]{30,}",
    "shp(?:at|ss|ca|pa)_[A-Fa-f0-9]{20,}",
    "dop_v1_[a-f0-9]{40,}",
    "lin_api_[A-Za-z0-9]{20,}",
  ].join("|") + ")",
);
const JWT = /^eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*$/;
const TOKEN_CHARACTERS = /^[A-Za-z0-9_\-+/=.~]+$/;
const GENERIC_TOKEN_MIN_LENGTH = 24;
const GENERIC_TOKEN_MIN_ENTROPY = 3.5;

function entropyPerCharacter(value: string): number {
  const counts = new Map<string, number>();
  for (const character of value) counts.set(character, (counts.get(character) ?? 0) + 1);
  let entropy = 0;
  for (const count of counts.values()) {
    const p = count / value.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

/**
 * Whether a bare value looks like a key or a token: a well-known prefix, a
 * JWT, or a long random-looking string. Paths, file names, package names and
 * URLs do not count, and neither does a value made only of `${VAR}`
 * references.
 */
export function looksLikeSecretValue(value: string): boolean {
  if (/\s/.test(value) || isReferenceOnly(value)) return false;
  if (KNOWN_TOKEN.test(value) || JWT.test(value)) return true;
  if (value.length < GENERIC_TOKEN_MIN_LENGTH || !TOKEN_CHARACTERS.test(value)) return false;
  // Paths, relative paths, home paths, and file names.
  if (/^[./~]/.test(value) || /\.[A-Za-z][A-Za-z0-9]{0,4}$/.test(value) || value.split("/").length > 2) return false;
  if (!/\d/.test(value) || !/[A-Za-z]/.test(value)) return false;
  // Random keys mix cases, are hex, or run without separators; dashed words
  // with dates and versions (`mcp-server-postgres-2024-10-01`) are names.
  const opaque = (/[a-z]/.test(value) && /[A-Z]/.test(value)) || /^[0-9a-f]+$/i.test(value) || !/[-_.]/.test(value);
  return opaque && entropyPerCharacter(value) >= GENERIC_TOKEN_MIN_ENTROPY;
}

const REFERENCE = /\$\{[A-Za-z_][A-Za-z0-9_]*\}|\$[A-Za-z_][A-Za-z0-9_]*/;
const REFERENCES = new RegExp(REFERENCE.source, "g");
const AUTHORIZATION_SCHEME = /^(?:bearer|basic|token)\s+/i;

/** Whether `value`, after an optional authorization scheme, is only `pattern` matches and separators. */
function onlyMatches(value: string, pattern: RegExp, patterns: RegExp): boolean {
  const withoutScheme = value.replace(AUTHORIZATION_SCHEME, "");
  // Separators between references (`${USER}:${PASS}`) add nothing secret.
  return pattern.test(withoutScheme) && /^[^A-Za-z0-9]*$/.test(withoutScheme.replace(patterns, ""));
}

/**
 * Whether a value the SDK resolves (an env value, a header value,
 * `oauth.clientSecret`) is only `${VAR}` / `$VAR` references, optionally after
 * an authorization scheme (`Bearer ${TOKEN}`): it names where the secret
 * lives, not the secret.
 */
export function isReferenceOnly(value: string): boolean {
  // `$$` and `$!` are escapes for a literal `$` and `!`, never a reference.
  return onlyMatches(value.replace(/\$[$!]/g, "_x"), REFERENCE, REFERENCES);
}

/**
 * `${NAME}`, or `$NAME` spelled as an environment variable (`$GITHUB_TOKEN`).
 * The SDK uses `command`, `args` and `url` as written and expands neither
 * there, so `$Passw0rd` is just a password that starts with `$`. A wrapper
 * that does expand them (mcp-remote's `--header "Authorization: Bearer
 * ${TOKEN}"`, `sh -c`) reads the value from its environment.
 */
const PLACEHOLDER = /\$\{[A-Za-z_][A-Za-z0-9_]*\}|\$[A-Z_][A-Z0-9_]*(?![A-Za-z0-9_])/;
const PLACEHOLDERS = new RegExp(PLACEHOLDER.source, "g");

/** Whether a value used as written is only placeholders, optionally after an authorization scheme. */
function isPlaceholderOnly(value: string): boolean {
  return onlyMatches(value, PLACEHOLDER, PLACEHOLDERS);
}

/** Tells a value that names where a secret lives from the secret; it depends on whether the SDK resolves the field. */
type ReferenceTest = (value: string) => boolean;

export interface MaskedValue {
  value: string;
  masked: boolean;
}

/** Where the maskers note the raw text each mask replaced, and its percent-decoded form when that differs. */
type HiddenParts = string[] | undefined;

function hide(hidden: HiddenParts, raw: string): void {
  if (!hidden || raw === "") return;
  hidden.push(raw);
  const decoded = safeDecode(raw);
  if (decoded !== raw) hidden.push(decoded);
}

const URL_AUTHORITY = /^([A-Za-z][A-Za-z0-9+.-]*:\/\/)([^/?#]*)/;

function maskUrlWith(url: string, isReference: ReferenceTest, hidden?: HiddenParts): MaskedValue {
  let masked = false;
  let rest = url;
  let prefix = "";
  const authority = URL_AUTHORITY.exec(url);
  if (authority) {
    const [whole, scheme, host] = authority;
    const at = host.lastIndexOf("@");
    if (at >= 0 && !isReference(safeDecode(host.slice(0, at)))) {
      prefix = `${scheme}${SECRET_MASK}${host.slice(at)}`;
      masked = true;
      const userinfo = host.slice(0, at);
      hide(hidden, userinfo);
      // The password alone, as a server may quote it.
      const colon = userinfo.indexOf(":");
      if (colon >= 0) hide(hidden, userinfo.slice(colon + 1));
    } else {
      prefix = whole;
    }
    rest = url.slice(whole.length);
  }
  const queryStart = rest.search(/[?#]/);
  const path = queryStart < 0 ? rest : rest.slice(0, queryStart);
  let query = queryStart < 0 ? "" : rest.slice(queryStart);
  const maskedPath = path
    .split("/")
    .map((segment) => {
      if (!looksLikeSecretValue(safeDecode(segment))) return segment;
      masked = true;
      hide(hidden, segment);
      return SECRET_MASK;
    })
    .join("/");
  query = query.replace(/([?&#;])([^&#;]*)/g, (match, separator: string, part: string) => {
    const equals = part.indexOf("=");
    if (equals < 0) {
      // A bare key (`?ghp_…`), as some servers take it.
      const decoded = safeDecode(part);
      if (!looksLikeSecretValue(decoded) || isReference(decoded)) return match;
      masked = true;
      hide(hidden, part);
      return `${separator}${SECRET_MASK}`;
    }
    const name = part.slice(0, equals);
    const decoded = safeDecode(part.slice(equals + 1));
    if (decoded === "" || isReference(decoded)) return match;
    if (!isSecretParameterName(name) && !looksLikeSecretValue(decoded)) return match;
    masked = true;
    hide(hidden, part.slice(equals + 1));
    return `${separator}${name}=${SECRET_MASK}`;
  });
  return { value: `${prefix}${maskedPath}${query}`, masked };
}

/**
 * A URL with its credentials masked: userinfo, query and fragment parameters
 * whose name names a credential or whose value looks like one, bare query
 * parts and path segments that look like a token (servers that put the key
 * there). The rest is kept character for character; a string that is not a
 * URL is masked the same way.
 */
export function maskUrl(url: string): MaskedValue {
  return maskUrlWith(url, isPlaceholderOnly);
}

/**
 * The raw parts `maskUrl()` hides (userinfo, its password alone, secret query
 * values and bare parts, token-like path segments), each also percent-decoded,
 * for finding them where a message quotes them on their own.
 */
export function urlSecretParts(url: string): string[] {
  const hidden: string[] = [];
  maskUrlWith(url, isPlaceholderOnly, hidden);
  return [...new Set(hidden)];
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function isUrl(value: string): boolean {
  return /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(value);
}

/** `Name=value;Name=value`, as ADO.NET and Azure write connection strings. */
const CONNECTION_STRING_SEGMENT = /^(\s*[A-Za-z][A-Za-z0-9 _.-]*=)([\s\S]*)$/;

function maskConnectionString(value: string, isReference: ReferenceTest, hidden?: HiddenParts): MaskedValue | undefined {
  const segments = value.split(";");
  if (segments.length < 2 || !segments.every((segment) => segment.trim() === "" || CONNECTION_STRING_SEGMENT.test(segment))) {
    return undefined;
  }
  let masked = false;
  const result = segments.map((segment) => {
    const match = CONNECTION_STRING_SEGMENT.exec(segment);
    if (!match) return segment;
    const [, key, segmentValue] = match;
    if (segmentValue.trim() === "" || isReference(segmentValue)) return segment;
    if (isSecretName(key.slice(0, -1).trim())) {
      masked = true;
      hide(hidden, segmentValue.trim());
      return `${key}${SECRET_MASK}`;
    }
    const inner = maskValue(segmentValue, isReference, hidden);
    masked ||= inner.masked;
    return `${key}${inner.value}`;
  });
  return { value: result.join(";"), masked };
}

/**
 * One value on its own: a `Name: value` header, a connection string, a
 * `NAME=value` pair, a phrase of several words (`Bearer …`, a whole command
 * line), a URL, or a bare token.
 */
function maskValue(value: string, isReference: ReferenceTest, hidden?: HiddenParts): MaskedValue {
  const header = /^([A-Za-z0-9_-]+):(\s*)([\s\S]*)$/.exec(value);
  if (header && header[3] !== "" && !header[3].startsWith("//") && isSecretName(header[1])) {
    const [, name, space, headerValue] = header;
    if (isReference(headerValue)) return { value, masked: false };
    hide(hidden, headerValue.trim());
    return { value: `${name}:${space}${SECRET_MASK}`, masked: true };
  }
  const connectionString = value.includes(";") ? maskConnectionString(value, isReference, hidden) : undefined;
  if (connectionString) return connectionString;
  const pair = /^([A-Za-z_][A-Za-z0-9_]*)=([\s\S]*)$/.exec(value);
  if (pair && pair[2] !== "" && isSecretName(pair[1])) {
    if (isReference(pair[2])) return { value, masked: false };
    hide(hidden, pair[2]);
    return { value: `${pair[1]}=${SECRET_MASK}`, masked: true };
  }
  if (/\s/.test(value)) return maskPhrase(value, isReference, hidden);
  if (isUrl(value)) return maskUrlWith(value, isReference, hidden);
  if (pair && pair[2] !== "") {
    const inner = maskValue(pair[2], isReference, hidden);
    return { value: `${pair[1]}=${inner.value}`, masked: inner.masked };
  }
  if (looksLikeSecretValue(value) && !isReference(value)) {
    hide(hidden, value);
    return { value: SECRET_MASK, masked: true };
  }
  return { value, masked: false };
}

/**
 * Several words in one value, masked word by word as an argument list, with
 * the whitespace between them kept: a whole command line in `command`, or
 * `Bearer …` as one argument. Inside a phrase an authorization scheme
 * (`Bearer`, `Basic`, `Token`) or a `Name:` that names a credential makes the
 * next word a secret.
 */
function maskPhrase(value: string, isReference: ReferenceTest, hidden?: HiddenParts): MaskedValue {
  const parts = value.split(/(\s+)/);
  const words = parts.filter((_, index) => index % 2 === 0);
  const result = maskSequence(words, isReference, true, hidden);
  return {
    value: parts.map((part, index) => (index % 2 === 0 ? result.values[index / 2] : part)).join(""),
    masked: result.masked,
  };
}

/** A command, masked like a single argument: a key passed as the executable, or a whole command line, still holds a key. */
export function maskCommand(command: string): MaskedValue {
  return maskValue(command, isPlaceholderOnly);
}

/** The raw parts `maskCommand()` hides, as `urlSecretParts()` lists a URL's. */
export function commandSecretParts(command: string): string[] {
  const hidden: string[] = [];
  maskValue(command, isPlaceholderOnly, hidden);
  return [...new Set(hidden)];
}

function flagTakesSecret(flag: string): boolean {
  if (SHORT_SECRET_FLAGS.has(flag)) return true;
  if (!/^--?[A-Za-z]/.test(flag)) return false;
  const name = flag.replace(/^-+/, "");
  // `--auth user:password`, `--basic-auth …`.
  return isSecretName(name) || nameWords(name).at(-1) === "auth";
}

const SCHEME_WORD = /^(?:bearer|basic|token)$/i;

function maskSequence(
  items: readonly string[],
  isReference: ReferenceTest,
  phrase: boolean,
  hidden?: HiddenParts,
): { values: string[]; masked: boolean } {
  let masked = false;
  let secretNext = false;
  const values = items.map((item) => {
    if (item === "") return item;
    if (secretNext) {
      // `Authorization: Bearer <token>`: the scheme stays readable.
      if (phrase && SCHEME_WORD.test(item)) return item;
      secretNext = false;
      if (!/^-[A-Za-z-]/.test(item)) {
        if (isReference(item)) return item;
        masked = true;
        hide(hidden, item);
        return SECRET_MASK;
      }
    }
    const flag = /^(--?[A-Za-z][A-Za-z0-9_.-]*)=([\s\S]*)$/.exec(item);
    if (flag) {
      const [, name, value] = flag;
      if (value !== "" && flagTakesSecret(name) && !isReference(value)) {
        masked = true;
        hide(hidden, value);
        return `${name}=${SECRET_MASK}`;
      }
      const inner = maskValue(value, isReference, hidden);
      masked ||= inner.masked;
      return `${name}=${inner.value}`;
    }
    if (/^--?[A-Za-z][A-Za-z0-9_.-]*$/.test(item)) {
      secretNext = flagTakesSecret(item);
      return item;
    }
    if (phrase) {
      const headerName = /^([A-Za-z0-9_-]+):$/.exec(item);
      if (SCHEME_WORD.test(item) || (headerName && isSecretName(headerName[1]))) {
        secretNext = true;
        return item;
      }
    }
    const inner = maskValue(item, isReference, hidden);
    masked ||= inner.masked;
    return inner.value;
  });
  return { values, masked };
}

/**
 * Arguments with credentials masked: the value of a flag that names one
 * (`--api-key=…`, `--token X`, `-k X`, `--auth X`), a `Name: value` header
 * whose name names one, a `NAME=value` pair or a connection string likewise,
 * URLs, the credential after `Bearer` in an argument of several words, and
 * values that look like tokens on their own. A value made only of `${VAR}`
 * placeholders is kept: it says where the secret comes from.
 */
export function maskArgs(args: readonly string[]): { args: string[]; masked: boolean } {
  const { values, masked } = maskSequence(args, isPlaceholderOnly, false);
  return { args: values, masked };
}

/** The raw parts `maskArgs()` hides (a flag's value, the argument after a secret flag, …), as `urlSecretParts()` lists a URL's. */
export function argSecretParts(args: readonly string[]): string[] {
  const hidden: string[] = [];
  maskSequence(args, isPlaceholderOnly, false, hidden);
  return [...new Set(hidden)];
}

export type LiteralSecretField =
  | { kind: "env" | "header"; name: string }
  | { kind: "oauth-client-secret" | "url" | "args" | "command" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A resolved value (env, header, `oauth.clientSecret`) written out rather than referenced or computed. */
function isLiteral(value: string): boolean {
  return !value.startsWith("!") && !isReferenceOnly(value);
}

function literalSecretValue(name: string, value: string): boolean {
  if (!isLiteral(value) || value === "") return false;
  return isSecretName(name) || /^(?:bearer|basic|token)\s+\S/i.test(value) || maskValue(value, isReferenceOnly).masked;
}

/**
 * The parts of an entry that carry a credential written into the file itself:
 * env and header values that are not `${VAR}` references or `!command`s and
 * are named like or look like a secret, a literal `oauth.clientSecret`, and
 * credentials in the URL, the command, or the arguments. The entry need not
 * be valid; values that are not strings are skipped.
 */
export function literalSecretFields(config: unknown): LiteralSecretField[] {
  if (!isRecord(config)) return [];
  const fields: LiteralSecretField[] = [];
  for (const kind of ["env", "headers"] as const) {
    const values = config[kind];
    if (!isRecord(values)) continue;
    for (const [name, value] of Object.entries(values)) {
      if (typeof value === "string" && literalSecretValue(name, value)) {
        fields.push({ kind: kind === "env" ? "env" : "header", name });
      }
    }
  }
  const clientSecret = isRecord(config.oauth) ? config.oauth.clientSecret : undefined;
  if (typeof clientSecret === "string" && clientSecret !== "" && isLiteral(clientSecret)) {
    fields.push({ kind: "oauth-client-secret" });
  }
  if (typeof config.url === "string" && maskUrl(config.url).masked) fields.push({ kind: "url" });
  if (typeof config.command === "string" && maskCommand(config.command).masked) fields.push({ kind: "command" });
  if (Array.isArray(config.args)) {
    const args = config.args.filter((arg): arg is string => typeof arg === "string");
    if (maskArgs(args).masked) fields.push({ kind: "args" });
  }
  return fields;
}
