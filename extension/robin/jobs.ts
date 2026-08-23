/**
 * Job discovery for the Robin dashboard — types, filters, and formatting.
 *
 * Pure logic only, no node builtins: the jobs page and the dashboard panel
 * import `sortJobs`, `describeFilters` and the types directly, and a `node:fs`
 * anywhere in this module's graph fails the browser bundle. Network access
 * lives in ./job-providers.ts, discovery in ./job-scan.ts and
 * ./job-directory.ts, everything between discovery and the store in
 * ./job-intake.ts, and persistence in ./store.ts.
 *
 * The filter semantics are ported from career-ops (MIT, github.com/santifer/
 * career-ops) — `scan.mjs`'s title/location filters. Two behaviours are worth
 * keeping in mind because they look like bugs otherwise: a 2-3 letter keyword
 * matches on word boundaries, and an empty `locationAllow` passes everything
 * that survived the block list.
 */

/** One tracked employer. `url` is a careers page or an ATS board URL. */
export interface TrackedCompany {
  id: string;
  name: string;
  url: string;
  /** Skip URL-based detection and force this provider id. */
  provider?: string;
  /**
   * Sweep-mode hint: nothing published before this date (YYYY-MM-DD) is wanted.
   *
   * Only providers that page a board in date order can act on it, and only
   * Workday does — but for Workday it is the difference between reading two
   * thousand postings from one employer and reading the twenty that are new.
   * Everyone else ignores it; the real freshness filter still runs downstream.
   */
  since?: string;
  enabled: boolean;
}

/**
 * Everything the scan and the scorer need to know about what the user wants.
 * Stored whole, rewritten whole — it is a settings document, not a list.
 */
export interface JobProfile {
  /** Title keywords. A keyword containing " + " requires every term. */
  titles: string[];
  /** Titles carrying any of these are dropped even if `titles` matched. */
  excludeTitles: string[];
  /** Checked before `locationBlock`, so a multi-city posting keeps its home region. */
  locationAlways: string[];
  /** Empty means "anywhere that survived the block list". */
  locationAllow: string[];
  locationBlock: string[];
  companies: TrackedCompany[];
  /** Ids of company-less aggregator feeds, e.g. "remoteok". */
  boards: string[];
  /**
   * Read job descriptions off careers pages that no provider owns.
   *
   * Roughly half the early-career market sits on an employer's own portal
   * rather than an ATS with a public API, and those postings otherwise reach
   * the scorer as a title and a city. Turning this on recovers most of them.
   *
   * It is a setting rather than a default because it is the one place this
   * scanner gives up its host allow-list: every other request goes to a host
   * checked before the fetch, and this one goes wherever a posting's link
   * points. The narrower guarantees that replace it are documented on
   * `readUnknownBoard` in ./job-providers.ts, and they hold — but swapping an
   * allow-list for a rule set should be somebody's decision.
   */
  readUnknownBoards: boolean;
  /** Employers to never surface, matched case-insensitively. */
  blacklist: string[];
  /** Freshness window in days; 0 keeps postings with no date at all. */
  sinceDays: number;
  /** Jobs below this score are never pushed. */
  minScore: number;
  /**
   * Hard ceiling on a posting's stated years of experience. 0 disables it.
   *
   * A separate gate from `minScore` because it answers a different question.
   * The score says how well the role fits; this says whether applying is worth
   * the stamp at all. They are not interchangeable: a role can be a perfect
   * archetype match, score 4.5 on every other axis, and still want seven years
   * from someone who has one — and a model asked to fold that into a single
   * number will keep finding reasons not to.
   */
  maxYears: number;
  /** How many jobs one Telegram digest carries. */
  digestSize: number;
  /**
   * How many jobs one scoring round works through.
   *
   * Separate from `digestSize` on purpose: scoring produces the ranking and
   * pushing consumes it, so tying them together means a backlog can never
   * drain faster than one digest at a time. A sweep that adds two hundred jobs
   * should be scored in a night, not over ten days.
   */
  scoreBatch: number;
  /** Language the rubric and the one-line reasons are written in. */
  rubricLocale: "en" | "zh";
  /**
   * Which model scores the jobs.
   *
   * Worth pinning separately from the dashboard assistant's default: scoring
   * is a high-volume, low-judgement task — read a title, a location and a CV,
   * emit a number and a sentence — and it runs unattended a few hundred times
   * a night. The chat you have with the assistant is the opposite on every
   * axis. Empty means "whatever pi defaults to".
   */
  scoreModel: { provider: string; modelId: string } | null;
  /** The CV the scorer reads, markdown. */
  cv: string;
  /** Free-text preferences the scorer should weigh but the CV does not state. */
  notes: string;
  /**
   * Which saved-links group the jobs page pins at the top — Handshake,
   * Jobright, LinkedIn, whatever you actually open. Shared with the links
   * panel rather than duplicated, so a link added in either place is the same
   * link, with the same icon and the same agent tooling behind it.
   */
  linkGroup: string;
  updatedAt: string;
}

export type JobStatus = "new" | "shortlist" | "applied" | "dropped";

export interface Job {
  id: string;
  /** The apply link. This is the payload of the whole feature. */
  url: string;
  company: string;
  title: string;
  location: string;
  /** Local calendar date the employer published it, YYYY-MM-DD, when known. */
  postedAt?: string;
  /** Provider id the posting came from. */
  source: string;
  /** Untrusted employer-authored text, truncated. Absent unless free to fetch. */
  description?: string;
  /**
   * Smallest years-of-experience figure the posting states, when it states one.
   *
   * Read off the description by regex at merge time, not asked of the model.
   * "Does this posting say five years" is a lookup, and a lookup that a model
   * performs a few hundred times a night is a lookup that will silently be
   * wrong some of the time — whereas the rubric's level cap is only as good as
   * this number being right. Absent means the posting did not say, which is
   * different from zero.
   */
  yearsRequired?: number;
  /** UTC instant, ISO 8601. */
  discoveredAt: string;

  /** 1.0–5.0, absent until the scorer has seen it. */
  score?: number;
  /** One line, shown in the panel and the push. */
  reason?: string;
  /** Short machine-ish tags, e.g. "no-sponsorship". */
  flags?: string[];
  scoredAt?: string;
  /** Model that produced `score`, so a bad batch can be found later. */
  scoredBy?: string;

  status: JobStatus;
  /**
   * UTC instant you marked it applied.
   *
   * Kept apart from `status` because the two answer different questions: the
   * status says where it is now, this says when it moved. Without it the
   * applied list is an unordered pile and "what did I send last week" has no
   * answer.
   */
  appliedAt?: string;
  /** Your own note — why you applied, who referred you, what you said. */
  note?: string;
  /** UTC instant of the push that carried it; absent means never pushed. */
  notifiedAt?: string;
}

export const JOB_STATUSES: readonly JobStatus[] = ["new", "shortlist", "applied", "dropped"];

/**
 * A first-run profile that already finds something.
 *
 * An empty profile technically works — no keywords means every title passes —
 * but the first scan then returns a few thousand rows and the feature reads as
 * broken. These defaults are the same shape a Jobright-style filter has (a set
 * of job functions, a metro plus remote, a short freshness window), so the
 * first scan lands on the right order of magnitude and the presets below are
 * how you move from there.
 */
export const DEFAULT_JOB_PROFILE: JobProfile = {
  titles: [
    "AI Engineer",
    "Machine Learning Engineer",
    "LLM Engineer",
    "Backend Engineer",
    "Full Stack Engineer",
    "Software Engineer",
    "Data Engineer",
    "Product Engineer",
  ],
  excludeTitles: [],
  locationAlways: [],
  locationAllow: ["Remote", "United States", "San Francisco", "Bay Area"],
  locationBlock: [],
  companies: [],
  // Four public, no-auth feeds are on from the start so the very first [SCAN]
  // returns real postings with zero setup. Without them a fresh profile has no
  // sources at all, and the button reports a successful scan of nothing —
  // which is indistinguishable from the feature being broken.
  //
  // The two community new-grad lists earn their place separately: they are the
  // only sources here that reach employers on Workday, iCIMS and in-house
  // portals, and the only ones that say whether a posting is still open.
  boards: ["remoteok", "remotive", "simplify", "newgradlist"],
  readUnknownBoards: false,
  blacklist: [],
  // Short on purpose: the scan runs twice a day and remembers what it has
  // already shown you, so a wide window only re-surfaces postings you passed on.
  sinceDays: 3,
  // 4.0, not 3.5. The rubric calls 3.5–3.9 "plausible, but only with a specific
  // reason" — the band a scorer lands on when it is not sure. Setting the push
  // floor to the bottom of that band turns every "not sure" into a push, and in
  // practice that is where a third of all scores pile up.
  minScore: 4.0,
  // Off by default: it depends entirely on where the candidate is in their
  // career, and a shipped default would silently hide senior roles from senior
  // people. The settings panel is where this gets a number.
  maxYears: 0,
  digestSize: 10,
  scoreBatch: 40,
  rubricLocale: "en",
  scoreModel: null,
  cv: "",
  notes: "",
  linkGroup: "Job hunt",
  updatedAt: "",
};

/* ─────────────────── starter company boards ─────────────────── */

/**
 * A verified set of public boards to start from.
 *
 * The aggregator feeds alone are a thin diet: they carry only remote roles and
 * only their latest hundred or so, so a first scan sees barely a hundred
 * postings and matches two. Company boards are where the volume is — these
 * twenty-six carry roughly five thousand openings between them.
 *
 * Every slug here was checked against the live API and returned a non-empty
 * board; `job-providers.test.mjs` re-checks that each URL still routes to a
 * provider, which is what catches a typo. It cannot catch a company MOVING
 * boards — that shows up as a per-source error on the page after a scan, which
 * is the honest place for it.
 *
 * Weighted toward AI, backend and data because that is what the default title
 * keywords look for. It is a starting point, not a recommendation: delete the
 * ones you would not work at.
 */
export const STARTER_COMPANIES: readonly { name: string; url: string }[] = [
  // AI labs and AI-native product
  { name: "OpenAI", url: "https://jobs.ashbyhq.com/openai" },
  { name: "Anthropic", url: "https://job-boards.greenhouse.io/anthropic" },
  { name: "Harvey", url: "https://jobs.ashbyhq.com/harvey" },
  { name: "ElevenLabs", url: "https://jobs.ashbyhq.com/elevenlabs" },
  { name: "Scale AI", url: "https://job-boards.greenhouse.io/scaleai" },
  { name: "Sierra", url: "https://jobs.ashbyhq.com/sierra" },
  { name: "Cohere", url: "https://jobs.ashbyhq.com/cohere" },
  { name: "LangChain", url: "https://jobs.ashbyhq.com/langchain" },
  { name: "Decagon", url: "https://jobs.ashbyhq.com/decagon" },
  { name: "Baseten", url: "https://jobs.ashbyhq.com/baseten" },
  { name: "Abridge", url: "https://jobs.ashbyhq.com/abridge" },

  // Data and infrastructure
  { name: "Databricks", url: "https://job-boards.greenhouse.io/databricks" },
  { name: "MongoDB", url: "https://job-boards.greenhouse.io/mongodb" },
  { name: "Cloudflare", url: "https://job-boards.greenhouse.io/cloudflare" },
  { name: "Elastic", url: "https://job-boards.greenhouse.io/elastic" },
  { name: "Supabase", url: "https://jobs.ashbyhq.com/supabase" },
  { name: "PostHog", url: "https://jobs.ashbyhq.com/posthog" },

  // Product companies with large Bay Area and remote engineering orgs
  { name: "Stripe", url: "https://job-boards.greenhouse.io/stripe" },
  { name: "Figma", url: "https://job-boards.greenhouse.io/figma" },
  { name: "Airbnb", url: "https://job-boards.greenhouse.io/airbnb" },
  { name: "Notion", url: "https://jobs.ashbyhq.com/notion" },
  { name: "Reddit", url: "https://job-boards.greenhouse.io/reddit" },
  { name: "Discord", url: "https://job-boards.greenhouse.io/discord" },
  { name: "Vercel", url: "https://job-boards.greenhouse.io/vercel" },
  { name: "Linear", url: "https://jobs.ashbyhq.com/linear" },
  { name: "Ramp", url: "https://jobs.ashbyhq.com/ramp" },

  // Workday tenants. Kept to a short list on purpose: Workday's public
  // endpoint answers in about three seconds a page and pages twenty rows at a
  // time, so one large employer costs half a minute of a scan where a
  // Greenhouse board costs a fraction of a second. These five were chosen for
  // Bay Area engineering volume and each returned a live board.
  { name: "NVIDIA", url: "https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite" },
  { name: "Salesforce", url: "https://salesforce.wd12.myworkdayjobs.com/External_Career_Site" },
  { name: "Adobe", url: "https://adobe.wd5.myworkdayjobs.com/external_experienced" },
  { name: "Autodesk", url: "https://autodesk.wd1.myworkdayjobs.com/Ext" },
  { name: "Workday", url: "https://workday.wd5.myworkdayjobs.com/Workday" },
];

/* ─────────────────────────── presets ─────────────────────────── */

/**
 * A named bundle of keywords you can switch on and off.
 *
 * Presets add to the lists rather than replacing them: a job hunt is usually
 * two or three of these at once ("AI/ML plus backend, but nothing senior"),
 * and a picker that clobbered the field every time would make that combination
 * impossible to express. `id` is also an i18n key suffix, so the label lives in
 * the message catalogue rather than here.
 */
export interface JobPreset {
  id: string;
  titles?: string[];
  excludeTitles?: string[];
  locationAllow?: string[];
  locationBlock?: string[];
}

export const TITLE_PRESETS: readonly JobPreset[] = [
  {
    id: "aiml",
    titles: [
      "AI Engineer", "LLM Engineer", "Machine Learning Engineer", "Machine Learning Researcher",
      "AI Researcher", "Applied Scientist", "MLOps",
    ],
  },
  {
    id: "backend",
    titles: ["Backend Engineer", "Python Engineer", "Java Engineer", "Go Engineer", "Platform Engineer", "API Engineer"],
  },
  {
    id: "fullstack",
    titles: ["Full Stack Engineer", "Frontend Engineer", "React Developer", "Web Engineer", "UI Engineer", "Product Engineer"],
  },
  {
    id: "data",
    titles: ["Data Engineer", "Analytics Engineer", "Data Platform", "Data Infrastructure"],
  },
  {
    id: "product",
    titles: ["Product Manager", "AI Product Manager", "Product Analyst", "Technical Program Manager", "Program Manager"],
  },
  {
    id: "mobile",
    titles: ["iOS Engineer", "Android Engineer", "Mobile Engineer", "Swift Developer"],
  },
  {
    id: "systems",
    titles: ["Systems Engineer", "Infrastructure Engineer", "C++ Engineer", "Blockchain Engineer", "Game Developer"],
  },
  {
    id: "newgrad",
    titles: ["New Grad", "University Grad", "Early Career", "Entry Level", "Intern + Engineer"],
  },
];

export const EXCLUDE_PRESETS: readonly JobPreset[] = [
  {
    id: "nosenior",
    excludeTitles: ["senior", "staff", "principal", "director", "head of", "vp"],
  },
  {
    id: "nojunior",
    excludeTitles: ["intern", "internship", "apprentice", "working student"],
  },
  {
    id: "nogtm",
    excludeTitles: ["sales", "account executive", "recruiter", "marketing", "customer success", "bdr", "sdr"],
  },
  {
    id: "nocontract",
    excludeTitles: ["contract", "contractor", "freelance", "temporary", "part-time"],
  },
];

export const LOCATION_PRESETS: readonly JobPreset[] = [
  {
    id: "sfbay",
    locationAllow: [
      "San Francisco", "South San Francisco", "Bay Area", "Palo Alto", "Mountain View",
      "Sunnyvale", "Santa Clara", "San Jose", "Redwood City", "Menlo Park", "Cupertino", "Oakland",
    ],
  },
  { id: "remoteus", locationAllow: ["Remote", "United States", "USA", "US"] },
  { id: "nyc", locationAllow: ["New York", "NYC", "Brooklyn"] },
  { id: "seattle", locationAllow: ["Seattle", "Bellevue", "Redmond"] },
  {
    id: "usonly",
    locationBlock: [
      "India", "Bengaluru", "Hyderabad", "Pune", "Philippines", "Manila",
      "United Kingdom", "London", "Germany", "Poland", "Singapore", "Japan",
    ],
  },
];

/** Which JobProfile lists a preset writes into. */
export type PresetField = "titles" | "excludeTitles" | "locationAllow" | "locationBlock";

const PRESET_FIELDS: PresetField[] = ["titles", "excludeTitles", "locationAllow", "locationBlock"];

/** A preset counts as on only when every one of its terms is already present. */
export function isPresetActive(preset: JobPreset, profile: JobProfile): boolean {
  return PRESET_FIELDS.every((field) => {
    const wanted = preset[field];
    if (!wanted || wanted.length === 0) return true;
    const current = new Set(profile[field].map((entry) => entry.toLowerCase()));
    return wanted.every((entry) => current.has(entry.toLowerCase()));
  });
}

/**
 * Switch a preset on or off, returning only the lists it touches.
 *
 * Turning one off removes exactly its own terms, so a keyword you also typed
 * by hand and that happens to sit in two presets survives the second one being
 * switched off only if that other preset is still on — which is the behaviour
 * you want when "AI/ML" and "Backend" both claim "Platform Engineer".
 */
export function togglePreset(
  preset: JobPreset,
  profile: JobProfile,
  others: readonly JobPreset[] = [],
): Partial<JobProfile> {
  const turnOn = !isPresetActive(preset, profile);
  const changes: Partial<JobProfile> = {};

  for (const field of PRESET_FIELDS) {
    const wanted = preset[field];
    if (!wanted || wanted.length === 0) continue;
    const current = profile[field];

    if (turnOn) {
      const present = new Set(current.map((entry) => entry.toLowerCase()));
      changes[field] = [...current, ...wanted.filter((entry) => !present.has(entry.toLowerCase()))];
      continue;
    }

    // Terms another still-active preset also claims are kept.
    const claimed = new Set(
      others
        .filter((other) => other.id !== preset.id && isPresetActive(other, profile))
        .flatMap((other) => other[field] ?? [])
        .map((entry) => entry.toLowerCase()),
    );
    const dropping = new Set(
      wanted.map((entry) => entry.toLowerCase()).filter((entry) => !claimed.has(entry)),
    );
    changes[field] = current.filter((entry) => !dropping.has(entry.toLowerCase()));
  }

  return changes;
}

/* ────────────────────────── title filter ────────────────────────── */

/**
 * Compile one lowercased keyword into a matcher.
 *
 * A 2-3 letter all-alphabetic keyword ("ai", "ml", "vp", "coo") is anchored on
 * word boundaries — without that, "coo" matches "Coordinator" and the filter
 * quietly stops filtering. Anything longer, or containing punctuation
 * (".net", "c++"), stays a plain substring match.
 */
export function compileKeyword(keyword: string): (lowerTitle: string) => boolean {
  const term = keyword.trim().toLowerCase();
  if (!term) return () => false;
  if (/^[a-z]{2,3}$/.test(term)) {
    const pattern = new RegExp(`\\b${term}\\b`);
    return (lower) => pattern.test(lower);
  }
  return (lower) => lower.includes(term);
}

/**
 * Compile one entry of `titles`.
 *
 * " + " between terms means every term must appear, in any order. Real titles
 * vary in separator and word order, so "Director + Engineering" is the only
 * spelling that catches both "Director of Engineering" and
 * "Director - Software Engineering".
 */
function compileTitleEntry(entry: string): (lowerTitle: string) => boolean {
  const terms = entry.split(" + ").map((part) => part.trim()).filter(Boolean);
  if (terms.length === 0) return () => false;
  const matchers = terms.map(compileKeyword);
  return (lower) => matchers.every((matches) => matches(lower));
}

export interface TitleFilter {
  /** The keyword that matched, or null when the title is rejected. */
  (title: string): string | null;
}

/** An empty `titles` list matches everything — an unconfigured profile is not a mute one. */
export function buildTitleFilter(titles: string[], excludeTitles: string[] = []): TitleFilter {
  const positive = titles
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => ({ entry, matches: compileTitleEntry(entry) }));
  const negative = excludeTitles
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map(compileKeyword);

  return (title: string) => {
    const lower = title.toLowerCase();
    if (negative.some((matches) => matches(lower))) return null;
    if (positive.length === 0) return "";
    return positive.find(({ matches }) => matches(lower))?.entry ?? null;
  };
}

/* ───────────────────────── location filter ──────────────────────── */

export interface LocationRules {
  always: string[];
  allow: string[];
  block: string[];
}

/**
 * Order matters and is the whole point:
 *
 *   empty location → pass (a missing field is not a reason to drop a job)
 *   any `always` hit → pass, outranking `block`
 *   any `block` hit → reject
 *   `allow` empty → pass
 *   otherwise → must hit `allow`
 *
 * `always` is what rescues "Remote — New York or Bengaluru" for someone who
 * blocks Bengaluru but lives in New York.
 */
export function buildLocationFilter(rules: LocationRules): (location: string) => boolean {
  const clean = (list: string[]) =>
    list.map((value) => value.trim().toLowerCase()).filter(Boolean);
  const always = clean(rules.always);
  const block = clean(rules.block);
  const allow = clean(rules.allow);

  return (location: string) => {
    const lower = location.trim().toLowerCase();
    if (!lower) return true;
    if (always.some((term) => lower.includes(term))) return true;
    if (block.some((term) => lower.includes(term))) return false;
    if (allow.length === 0) return true;
    return allow.some((term) => lower.includes(term));
  };
}

/* ──────────────────────────── identity ──────────────────────────── */

/**
 * The dedup key for a posting.
 *
 * Host and path are lowercased and a trailing slash dropped, but the query is
 * KEPT: several boards carry the job id there, and folding it away would merge
 * every opening at that employer into one. Losing a duplicate costs one extra
 * row; merging two real jobs loses one of them silently.
 */
export function jobKey(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/\/$/, "").toLowerCase();
    return `${parsed.hostname.toLowerCase()}${path}${parsed.search.toLowerCase()}`;
  } catch {
    return url.trim().toLowerCase().replace(/[#].*$/, "").replace(/\/$/, "");
  }
}

/** Reject anything that would not be safe as an href on the jobs page. */
export function assertJobUrl(url: string): string {
  const trimmed = url.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`Cannot read "${url}" as a URL`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(`Unsupported URL scheme "${parsed.protocol}"`);
  }
  return parsed.toString();
}

export function isBlacklisted(company: string, blacklist: string[]): boolean {
  const needle = company.trim().toLowerCase();
  if (!needle) return false;
  return blacklist.some((entry) => {
    const term = entry.trim().toLowerCase();
    return term !== "" && (needle === term || needle.includes(term));
  });
}

/* ──────────────────────────── ordering ──────────────────────────── */

/**
 * Best first: scored jobs above unscored ones, then by score, then by how
 * recently we found them. An unscored job is not "score 0" — it is unknown,
 * and burying it under a 1.2 would hide the ones the scorer has not reached.
 */
export function sortJobs(jobs: Job[]): Job[] {
  return [...jobs].sort((a, b) => {
    const aScored = typeof a.score === "number";
    const bScored = typeof b.score === "number";
    if (aScored !== bScored) return aScored ? -1 : 1;
    if (aScored && bScored && a.score !== b.score) return (b.score ?? 0) - (a.score ?? 0);
    return (b.discoveredAt ?? "").localeCompare(a.discoveredAt ?? "");
  });
}

/**
 * Jobs eligible for a push: scored at or above the floor, still new, not yet
 * sent, and not asking for more years than the profile allows.
 *
 * The years check runs here rather than in the scorer because it is the last
 * gate before a phone buzzes, and because it must hold even when the model
 * scored the job before a description was available. A posting whose stated
 * requirement the candidate cannot meet is not a 3.9 — it is not a push.
 */
export function digestCandidates(jobs: Job[], profile: JobProfile): Job[] {
  const maxYears = profile.maxYears > 0 ? profile.maxYears : null;
  return sortJobs(
    jobs.filter((job) =>
      job.status === "new"
      && !job.notifiedAt
      && typeof job.score === "number"
      && job.score >= profile.minScore
      // Absent means the posting never said, which is not a reason to drop it.
      && (maxYears === null || job.yearsRequired === undefined || job.yearsRequired <= maxYears)),
  );
}

/**
 * Applied jobs, most recently sent first — the order you actually browse them
 * in. Rows applied before the timestamp existed sort last rather than being
 * hidden.
 */
export function appliedJobs(jobs: Job[]): Job[] {
  return jobs
    .filter((job) => job.status === "applied")
    .sort((a, b) => (b.appliedAt ?? "").localeCompare(a.appliedAt ?? ""));
}

/* ────────────────── years of experience ────────────────── */

/**
 * Phrases that make a number nearby mean "experience wanted" rather than
 * anything else a job ad counts in years.
 */
const EXPERIENCE_CONTEXT =
  /experience|expertise|background|industry|professional|working|worked|build|building|develop|engineering|software|track record|hands[- ]on|relevant|similar role|in the field/i;

/**
 * Phrases that make the same number mean something else entirely.
 *
 * "Founded in the last 3 years", "doubled revenue over the past 5 years",
 * "in 2 years you will own the platform" — all common in the company
 * boilerplate that sits directly above the requirements, and all good for a
 * confident, wrong number.
 */
const NOT_A_REQUIREMENT = /\b(?:last|past|next|ago|within|since|over the|founded|history|first)\s*$/i;

/**
 * A nested sub-requirement, which is a slice of the bar rather than the bar.
 *
 * "8+ years of engineering experience, including 2+ years managing" states one
 * requirement, not two, and the 2 is the part that is already inside the 8.
 */
const NESTED = /\b(?:includ\w+|of which|with)\s*$/i;

/** Wishlist framing. A number here is not something the candidate must clear. */
const OPTIONAL = /\b(?:preferred|a plus|bonus|nice[- ]to[- ]have|ideally|desirable|advantageous|would be great)\b/i;

/**
 * A heading that reopens the hard requirements after a wishlist section.
 *
 * Without it, a posting laid out as "Preferred qualifications … Requirements:
 * 3+ years" loses its real bar to the heading two paragraphs above it.
 */
const REQUIRED_AGAIN = /\b(?:required|requirements|must have|minimum qualification|basic qualification)\b/i;

/** Index just past the last match of `pattern`, or 0 when there is none. */
function lastMatchEnd(text: string, pattern: RegExp): number {
  const scan = new RegExp(pattern.source, `${pattern.flags.replace("g", "")}g`);
  let end = 0;
  for (let match = scan.exec(text); match; match = scan.exec(text)) end = match.index + match[0].length;
  return end;
}

/** Text up to the first clause break — where a trailing "preferred" stops applying. */
function firstClause(text: string): string {
  return text.split(/[;.\n•]|\s[-–]\s/)[0]?.slice(0, 60) ?? "";
}

/**
 * The years of experience a posting actually requires, or null.
 *
 * The MAXIMUM of the required figures, not the minimum — a candidate has to
 * clear every bar the posting sets, so a role wanting "5 years of engineering"
 * and "2 years in payments" wants five, and reporting two would wave through
 * exactly the applications this number exists to stop. Preferred-qualification
 * figures are excluded for the mirror-image reason: "3+ required, 7+
 * preferred" wants three.
 *
 * Ranges read as their lower bound ("2-4 years" → 2), because that is the
 * number the employer will actually screen on.
 *
 * Deliberately conservative: it returns null rather than a shaky number,
 * because null hands the judgement back to the scorer while a wrong number
 * silently gates a job out. Every match must sit next to a word from
 * EXPERIENCE_CONTEXT and must survive all three exclusions.
 */
export function extractYearsRequired(description: string): number | null {
  if (!description) return null;
  const pattern = /(\d{1,2})\s*(?:\+|plus)?\s*(?:-|–|—|to)?\s*(\d{1,2})?\s*\+?\s*(?:years?|yrs?)\b/gi;
  let found: number | null = null;

  for (let match = pattern.exec(description); match; match = pattern.exec(description)) {
    const before = description.slice(Math.max(0, match.index - 24), match.index);
    if (NOT_A_REQUIREMENT.test(before) || NESTED.test(before)) continue;

    // A window either side: "5+ years of professional experience" puts the
    // keyword after, "experience: 5+ years" puts it before.
    const after = description.slice(match.index + match[0].length, match.index + match[0].length + 90);
    if (!EXPERIENCE_CONTEXT.test(`${before} ${after}`)) continue;
    // A trailing "preferred" only governs its own clause: in "2+ years
    // required; 5+ years preferred" it must disqualify the 5 and leave the 2.
    if (OPTIONAL.test(firstClause(after))) continue;
    // Look further back for a section heading — "Preferred qualifications:" can
    // sit a clause or two above the bullet it governs. The nearest heading is
    // the one that governs, so anything before a later "Requirements:" is
    // superseded and must not disqualify what follows it.
    const behind = description.slice(Math.max(0, match.index - 140), match.index);
    const governing = behind.slice(lastMatchEnd(behind, REQUIRED_AGAIN));
    if (OPTIONAL.test(governing)) continue;

    const low = Number(match[1]);
    // 0 is not a requirement, and past 20 it is a typo or a company's age.
    if (!Number.isFinite(low) || low < 1 || low > 20) continue;
    if (found === null || low > found) found = low;
  }

  return found;
}

/** Jobs the scorer has not looked at yet, oldest first so nothing starves. */
export function pendingJobs(jobs: Job[]): Job[] {
  return jobs
    .filter((job) => typeof job.score !== "number" && job.status !== "dropped")
    .sort((a, b) => (a.discoveredAt ?? "").localeCompare(b.discoveredAt ?? ""));
}

/* ─────────────────────────── formatting ─────────────────────────── */

export type JobLocale = "en" | "zh";

const DIGEST_TEXT = {
  en: {
    empty: (scanned: number) => `No new matches. (${scanned} postings checked)`,
    header: (count: number, scanned: number) =>
      `${count} new match${count === 1 ? "" : "es"} — ${scanned} postings checked`,
  },
  zh: {
    empty: (scanned: number) => `没有新匹配。（扫了 ${scanned} 个岗位）`,
    header: (count: number, scanned: number) => `${count} 个新匹配 — 扫了 ${scanned} 个岗位`,
  },
} as const;

/**
 * Build the push body.
 *
 * Deterministic on purpose: the model scores, but it never writes this text.
 * A digest whose whole value is a clickable link cannot afford a hallucinated
 * URL, and a model that is only asked for a number and a sentence cannot
 * produce one.
 */
export function formatJobDigest(
  jobs: Job[],
  options: { locale?: JobLocale; scanned?: number } = {},
): string {
  const copy = DIGEST_TEXT[options.locale === "zh" ? "zh" : "en"];
  const scanned = options.scanned ?? 0;
  if (jobs.length === 0) return copy.empty(scanned);

  const body = jobs.map((job, index) => {
    const score = typeof job.score === "number" ? job.score.toFixed(1) : "—";
    const meta = [job.location, job.reason].map((part) => part?.trim()).filter(Boolean).join(" · ");
    return [
      `${index + 1}. ${score}  ${job.company} — ${job.title}`,
      meta ? `   ${meta}` : "",
      `   ${job.url}`,
    ].filter(Boolean).join("\n");
  });

  return [copy.header(jobs.length, scanned), "", ...body].join("\n");
}

/** One-line summary of a job for a tool result. */
export function formatJob(job: Job): string {
  const score = typeof job.score === "number" ? job.score.toFixed(1) : "unscored";
  const parts = [
    job.id,
    `[${score}]`,
    `${job.company} — ${job.title}`,
    job.location ? `(${job.location})` : "",
    job.postedAt ? `posted ${job.postedAt}` : "",
    `<${job.source}>`,
    job.status === "new" ? "" : `status:${job.status}`,
    job.reason ? `— ${job.reason}` : "",
  ];
  return parts.filter(Boolean).join("  ");
}

/** Human summary of what the filters will and will not admit. */
export function describeFilters(profile: JobProfile): string[] {
  const lines: string[] = [];
  lines.push(profile.titles.length > 0
    ? `Titles: ${profile.titles.join(" / ")}`
    : "Titles: (any — no keywords set)");
  if (profile.excludeTitles.length > 0) lines.push(`Excluding: ${profile.excludeTitles.join(" / ")}`);
  if (profile.locationAlways.length > 0) lines.push(`Always allow: ${profile.locationAlways.join(" / ")}`);
  lines.push(profile.locationAllow.length > 0
    ? `Locations: ${profile.locationAllow.join(" / ")}`
    : "Locations: (any not blocked)");
  if (profile.locationBlock.length > 0) lines.push(`Blocked: ${profile.locationBlock.join(" / ")}`);
  lines.push(`Freshness: ${profile.sinceDays > 0 ? `last ${profile.sinceDays} days` : "no limit"}`);
  return lines;
}

/**
 * Strip tags and collapse whitespace on employer-authored HTML, then truncate.
 *
 * This text is untrusted — it reaches the scorer as data. Flattening it is not
 * a security control (the tool output labels it instead); the cap is, because
 * an unbounded description would let one posting fill the model's context.
 *
 * 2500, not 1200. The requirements block — where "5+ years of professional
 * experience" lives, and with it the only thing that can trigger the rubric's
 * level cap — sits after the company boilerplate and the role summary, and a
 * 1200-character window routinely stops short of it. Forty postings at this
 * size is roughly 25k tokens, which at flash-model rates is a fraction of a
 * cent per scoring round.
 */
export function cleanDescription(raw: string, limit = 2500): string {
  const text = raw
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= limit) return text;

  // Over budget: keep the opening AND the requirements, rather than the
  // opening twice as much of it.
  //
  // A long posting spends its first two thousand characters on the company and
  // the team, and only then says what it wants. Measured on real TikTok and
  // ByteDance postings, "Qualifications" lands between 1,900 and 2,600
  // characters in — which a plain truncation at 2,500 either clips or misses
  // entirely, throwing away the single most decision-relevant paragraph and
  // keeping the boilerplate that reads the same on every posting.
  const heading = /\b(?:minimum |basic |preferred )?(?:qualification|requirement|what (?:we|you)(?:'re| are)? (?:looking for|bring)|who you are|about you|skills? (?:and|&) experience)/i;
  const head = Math.floor(limit * 0.45);
  const found = text.slice(head).search(heading);
  if (found === -1) return `${text.slice(0, limit)}…`;

  const start = head + found;
  const tail = text.slice(start, start + (limit - head));
  // A short requirements section leaves budget unspent, and the opening is
  // what that budget is for — without this a posting whose qualifications run
  // to two lines came back at 1,167 characters of an allowed 2,500, having
  // thrown away the half of the role summary it had room for.
  const opening = text.slice(0, Math.min(limit - tail.length, start)).trim();
  return `${opening} … ${tail}…`;
}
