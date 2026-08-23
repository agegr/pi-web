import assert from "node:assert/strict";
import { test } from "node:test";
import { STARTER_COMPANIES } from "./jobs.ts";
import {
  BOARD_PROVIDERS,
  COMPANY_PROVIDERS,
  ageToDate,
  cellLink,
  cellText,
  findDeadPostings,
  hydrateDescriptions,
  makeFetchContext,
  markdownRows,
  isPublicWebHost,
  looksLikeJobDescription,
  parseListings,
  proseRatio,
  providerById,
  readUnknownBoard,
  resolveProvider,
  smartRecruitersPublicUrl,
  workdayPostedAt,
  workdaySite,
} from "./job-providers.ts";

const company = (over = {}) => ({ id: "c1", name: "Acme", url: "", enabled: true, ...over });

/** Answers every request with one canned payload and records the URLs asked for. */
function fakeFetch(payload) {
  const urls = [];
  const fetch = async (url, init) => {
    urls.push({ url: String(url), init });
    return { ok: true, status: 200, json: async () => payload };
  };
  return { fetch, urls };
}

/* ── routing ── */

test("each supported board is recognised from its public URL", () => {
  const cases = [
    ["https://job-boards.greenhouse.io/acme", "greenhouse"],
    ["https://job-boards.eu.greenhouse.io/acme", "greenhouse"],
    ["https://jobs.lever.co/acme", "lever"],
    ["https://jobs.eu.lever.co/acme", "lever"],
    ["https://jobs.ashbyhq.com/acme", "ashby"],
    ["https://careers.smartrecruiters.com/Acme", "smartrecruiters"],
    ["https://acme.recruitee.com/", "recruitee"],
    ["https://acme.wd5.myworkdayjobs.com/AcmeCareers", "workday"],
    ["https://acme.wd103.myworkdayjobs.com/en-US/AcmeCareers", "workday"],
    ["https://apply.workable.com/acme", "workable"],
  ];
  for (const [url, expected] of cases) {
    assert.equal(resolveProvider(company({ url }))?.id, expected, url);
  }
});

test("an unsupported or non-HTTPS URL resolves to no provider at all", () => {
  // There is no generic "just fetch it" fallback on purpose: every request the
  // scanner makes has to come from a module that validated the host first.
  assert.equal(resolveProvider(company({ url: "https://careers.acme.com" })), null);
  assert.equal(resolveProvider(company({ url: "http://jobs.lever.co/acme" })), null);
  assert.equal(resolveProvider(company({ url: "https://evil.example/jobs.lever.co/acme" })), null);
  assert.equal(resolveProvider(company({ url: "" })), null);
});

test("an explicit provider wins over detection, and an unknown one is refused", () => {
  const forced = resolveProvider(company({ url: "https://careers.acme.com", provider: "greenhouse" }));
  assert.equal(forced?.id, "greenhouse");
  assert.equal(resolveProvider(company({ url: "https://jobs.lever.co/acme", provider: "nope" })), null);
});

test("aggregator feeds are offered separately from company boards", () => {
  assert.ok(BOARD_PROVIDERS.every((provider) => provider.board === true));
  assert.ok(COMPANY_PROVIDERS.every((provider) => provider.board !== true));
  assert.ok(BOARD_PROVIDERS.some((provider) => provider.id === "remoteok"));
  assert.ok(COMPANY_PROVIDERS.some((provider) => provider.id === "greenhouse"));
});

/* ── request shape ── */

test("every request refuses redirects, so the host check cannot be walked around", async () => {
  const { fetch, urls } = fakeFetch({ jobs: [] });
  await providerById("greenhouse").fetch(
    company({ url: "https://job-boards.greenhouse.io/acme" }),
    makeFetchContext(fetch),
  );
  assert.equal(urls[0].url, "https://boards-api.greenhouse.io/v1/boards/acme/jobs");
  assert.equal(urls[0].init.redirect, "error");
});

test("a non-2xx board is an error the scan can record, not a silent empty result", async () => {
  const ctx = makeFetchContext(async () => ({ ok: false, status: 503, json: async () => ({}) }));
  await assert.rejects(
    () => providerById("lever").fetch(company({ url: "https://jobs.lever.co/acme" }), ctx),
    /HTTP 503/,
  );
});

/* ── parsing ── */

test("greenhouse postings keep their absolute apply URL and publish date", async () => {
  const { fetch } = fakeFetch({
    jobs: [
      { title: "AI Engineer", absolute_url: "https://job-boards.greenhouse.io/acme/jobs/1", location: { name: "Remote" }, first_published: "2026-08-10T12:00:00Z" },
      { title: "No link", location: { name: "Remote" } },
    ],
  });
  const postings = await providerById("greenhouse").fetch(
    company({ url: "https://job-boards.greenhouse.io/acme" }),
    makeFetchContext(fetch),
  );
  assert.equal(postings.length, 1, "a row without a usable URL is dropped, not rendered");
  assert.deepEqual(postings[0], {
    title: "AI Engineer",
    url: "https://job-boards.greenhouse.io/acme/jobs/1",
    company: "Acme",
    location: "Remote",
    postedAt: "2026-08-10",
  });
});

test("lever carries the description it already shipped, flattened and capped", async () => {
  const { fetch } = fakeFetch([
    {
      text: "Staff Engineer",
      hostedUrl: "https://jobs.lever.co/acme/1",
      categories: { location: "Berlin" },
      descriptionPlain: "We   are\nhiring.",
      createdAt: 1_755_000_000_000,
    },
  ]);
  const postings = await providerById("lever").fetch(
    company({ url: "https://jobs.lever.co/acme" }),
    makeFetchContext(fetch),
  );
  assert.equal(postings[0].description, "We are hiring.");
  assert.equal(postings[0].location, "Berlin");
});

test("ashby folds secondary locations in so a multi-region role stays filterable", async () => {
  const { fetch } = fakeFetch({
    jobs: [{
      title: "AI Engineer",
      jobUrl: "https://jobs.ashbyhq.com/acme/1",
      location: "Canada",
      secondaryLocations: [{ location: "Germany" }, { location: "Canada" }],
      publishedAt: "2026-08-12T00:00:00Z",
    }],
  });
  const postings = await providerById("ashby").fetch(
    company({ url: "https://jobs.ashbyhq.com/acme" }),
    makeFetchContext(fetch),
  );
  assert.equal(postings[0].location, "Canada · Germany", "deduplicated, both regions kept");
});

test("smartRecruiters rewrites the API ref into the public posting page", () => {
  // The public site has no /postings/ segment; carrying the ref over 404s, and
  // a 404 reads as an expired posting rather than as a bad URL.
  assert.equal(
    smartRecruitersPublicUrl("https://api.smartrecruiters.com/v1/companies/Acme/postings/99", "Acme", "99", "AI Engineer"),
    "https://jobs.smartrecruiters.com/Acme/99-ai-engineer",
  );
  assert.equal(
    smartRecruitersPublicUrl("", "Acme", "99", "AI Engineer"),
    "https://jobs.smartrecruiters.com/Acme/99-ai-engineer",
  );
  assert.equal(smartRecruitersPublicUrl("", "Acme", "", "AI Engineer"), "");
});

test("recruitee keeps a tenant's own-domain posting URL but never fetches it", async () => {
  const { fetch, urls } = fakeFetch({
    offers: [
      { title: "AI Engineer", careers_url: "https://careers.acme.com/o/ai-engineer", city: "Berlin", country: "Germany", remote: true },
      { title: "Bad link", url: "http://insecure.example/1" },
    ],
  });
  const postings = await providerById("recruitee").fetch(
    company({ url: "https://acme.recruitee.com/" }),
    makeFetchContext(fetch),
  );
  assert.equal(urls[0].url, "https://acme.recruitee.com/api/offers/", "only the tenant API is requested");
  assert.equal(postings.length, 1);
  assert.equal(postings[0].url, "https://careers.acme.com/o/ai-engineer");
  assert.equal(postings[0].location, "Berlin, Germany, Remote");
});

test("every shipped starter board routes to a provider", () => {
  // A typo'd slug is invisible until a scan reports a 404 the next morning.
  // This does not prove the board still exists — a company that MOVES ATS
  // shows up as a per-source error on the page, which is the honest place for
  // it — but it does prove every URL we ship is one we know how to read.
  for (const entry of STARTER_COMPANIES) {
    const provider = resolveProvider(company({ name: entry.name, url: entry.url }));
    assert.ok(provider, `${entry.name}: ${entry.url} routes to no provider`);
  }
  assert.ok(STARTER_COMPANIES.length >= 20, "a starter set this small would not fix the empty-scan problem");
});

/* ── Workday ── */

test("a Workday careers URL yields its CXS coordinates, locale segment and all", () => {
  assert.deepEqual(workdaySite("https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite"), {
    origin: "https://nvidia.wd5.myworkdayjobs.com",
    tenant: "nvidia",
    site: "NVIDIAExternalCareerSite",
  });
  // A locale in front of the site id is the difference between the board and a 404.
  assert.equal(workdaySite("https://acme.wd1.myworkdayjobs.com/en-US/External")?.site, "External");
  assert.equal(workdaySite("https://acme.myworkdayjobs.com/External"), null);
  assert.equal(workdaySite("http://acme.wd1.myworkdayjobs.com/External"), null);
  assert.equal(workdaySite("https://evil.example/acme.wd1.myworkdayjobs.com/External"), null);
});

test("Workday's relative posting label becomes a date, except when it is unbounded", () => {
  const now = Date.parse("2026-08-23T00:00:00Z");
  assert.equal(workdayPostedAt("Posted Today", now), "2026-08-23");
  assert.equal(workdayPostedAt("Posted Yesterday", now), "2026-08-22");
  assert.equal(workdayPostedAt("Posted 5 Days Ago", now), "2026-08-18");
  // "30+" is open-ended: dating it exactly 30 days back would sail a stale
  // posting through a freshness window it should not clear.
  assert.equal(workdayPostedAt("Posted 30+ Days Ago", now), undefined);
  assert.equal(workdayPostedAt("", now), undefined);
});

test("a Workday posting URL round-trips back into the ref its detail endpoint wants", () => {
  const ref = providerById("workday")?.refFromUrl?.(
    "https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite/job/US-CA-Santa-Clara/Engineer_JR123",
  );
  assert.deepEqual(ref, { board: "nvidia/NVIDIAExternalCareerSite", id: "/job/US-CA-Santa-Clara/Engineer_JR123" });
});

/* ── markdown feeds ── */

test("markdown rows are split so a pipe inside a cell cannot shift the columns", () => {
  // Workable really does emit a department called "EU - Sales | Tech Sales".
  const rows = markdownRows([
    "| Title | Department | Location | Type | Salary | Posted | Details |",
    "|-------|-----------|----------|------|--------|--------|---------|",
    "| Engineer | EU - Sales | Tech Sales | Ely, UK | Full-time | — | 2026-07-10 | [View](https://apply.workable.com/a/jobs/view/X.md) |",
  ].join("\n"));
  // The header comes back too; callers drop it by requiring a link.
  assert.equal(rows.length, 2);
  const cells = rows[1];
  assert.equal(cells[0], "Engineer");
  // Counted from the right, the tail columns survive the extra pipe.
  assert.equal(cells[cells.length - 2], "2026-07-10");
  assert.equal(cells[cells.length - 5], "Ely, UK");
});

test("a cell gives up its link and its plain text separately", () => {
  assert.equal(cellLink("[View](https://x.test/a.md)"), "https://x.test/a.md");
  assert.equal(cellLink('<a href="https://x.test/b"><img src="i.png"/></a>'), "https://x.test/b");
  assert.equal(cellLink("no link here"), "");
  assert.equal(cellText('<a href="https://x.test"><strong>GitHub</strong></a>'), "GitHub");
  assert.equal(cellText("[Software Engineer](https://x.test)"), "Software Engineer");
});

test("an age column becomes a date", () => {
  const now = Date.parse("2026-08-23T12:00:00Z");
  assert.equal(ageToDate("3d", now), "2026-08-20");
  assert.equal(ageToDate("14h", now), "2026-08-22");
  assert.equal(ageToDate("2w", now), "2026-08-09");
  assert.equal(ageToDate("—", now), undefined);
  assert.equal(ageToDate("", now), undefined);
});

/* ── community listings ── */

test("a community listing keeps only rows its maintainers still call open", () => {
  const postings = parseListings([
    { company_name: "Acme", title: "SWE New Grad", url: "https://job-boards.greenhouse.io/acme/jobs/1", locations: ["SF", "SF"], active: true, date_posted: 1767841111 },
    { company_name: "Dead", title: "SWE", url: "https://x.test/2", locations: ["NY"], active: false, date_posted: 1767841111 },
    { company_name: "Hidden", title: "SWE", url: "https://x.test/3", locations: [], active: true, is_visible: false },
  ], "Fallback");
  assert.equal(postings.length, 1);
  assert.equal(postings[0].company, "Acme");
  // Duplicated locations are folded, not repeated.
  assert.equal(postings[0].location, "SF");
  // The epoch is in seconds — read as milliseconds this lands in 1970.
  assert.equal(postings[0].postedAt, "2026-01-08");
});

test("a listing row with no company falls back to the feed's own name", () => {
  const postings = parseListings(
    [{ title: "SWE", url: "https://x.test/1", locations: ["Remote"], active: true }],
    "SimplifyJobs",
  );
  assert.equal(postings[0].company, "SimplifyJobs");
  assert.equal(postings[0].postedAt, undefined);
});

/* ── hydrate ── */

test("a posting from a list with no descriptions is routed to whoever owns its ATS", async () => {
  const asked = [];
  const ctx = {
    async fetchJson(url) {
      asked.push(url);
      return { content: "<p>5+ years of professional experience</p>" };
    },
    async fetchText() { return ""; },
  };
  const posting = {
    title: "SWE",
    url: "https://job-boards.greenhouse.io/acme/jobs/4461450008",
    company: "Acme",
    location: "SF",
    source: "simplify",
  };
  await hydrateDescriptions([posting], ctx);
  assert.equal(asked.length, 1);
  assert.ok(asked[0].endsWith("/v1/boards/acme/jobs/4461450008"), asked[0]);
  assert.match(posting.description, /5\+ years of professional experience/);
});

test("a posting on an ATS nobody here reads is left exactly as it arrived", async () => {
  const ctx = {
    async fetchJson() { throw new Error("should not be called"); },
    async fetchText() { throw new Error("should not be called"); },
  };
  const posting = { title: "SWE", url: "https://careers.acme.example/jobs/7", company: "Acme", location: "SF", source: "simplify" };
  await hydrateDescriptions([posting], ctx);
  assert.equal(posting.description, undefined);
});

test("a board that will not serve a description costs the scan nothing", async () => {
  const ctx = {
    async fetchJson() { throw new Error("HTTP 503"); },
    async fetchText() { throw new Error("HTTP 503"); },
  };
  const posting = { title: "SWE", url: "https://job-boards.greenhouse.io/acme/jobs/1", company: "Acme", location: "SF", source: "greenhouse", ref: { board: "acme", id: "1" } };
  await hydrateDescriptions([posting], ctx);
  assert.equal(posting.description, undefined);
});

/* ── reading a board nobody here owns ── */

test("only public HTTPS hosts are reachable from a link we did not choose", () => {
  for (const host of [
    "localhost", "127.0.0.1", "10.0.0.5", "192.168.1.1", "172.16.0.1", "172.31.255.255",
    "169.254.169.254", "0.0.0.0", "printer.local", "vault.internal", "::1", "fd00::1", "intranet",
  ]) {
    assert.equal(isPublicWebHost(host), false, host);
  }
  for (const host of ["lifeattiktok.com", "jobs.example.co.uk", "WWW.Example.COM", "careers.a-b.io"]) {
    assert.equal(isPublicWebHost(host), true, host);
  }
});

test("an address cannot reach the fetcher by dressing up as a hostname", () => {
  // An IPv4 address has more spellings than the dotted-decimal one, and the
  // hex and octal forms below both reach 127.0.0.1 through inet_aton while
  // looking nothing like "127.". Requiring an alphabetic last label refuses
  // every encoding at once, and refuses public bare IPs too — which is right,
  // because a job posting lives at a hostname.
  for (const host of [
    "0x7f.0.0.1", "0177.0.0.1", "2130706433", "0x7f000001",
    "127.000.000.001", "8.8.8.8", "172.15.0.1", "[2001:db8::1]",
  ]) {
    assert.equal(isPublicWebHost(host), false, host);
  }
});

test("a serialized blob never outscores prose", () => {
  const prose = "We are looking for a backend engineer to build and operate our payments platform.";
  const blob = '{"themeOptions":{"customTheme":{"varTheme":{"primary-color":"#3253dc"}}}}';
  assert.ok(proseRatio(prose) > 0.9);
  assert.ok(proseRatio(blob) < 0.3);
});

test("a careers page yields its description, preferring JSON-LD over page furniture", async () => {
  const html = `<html><head>
    <script type="application/ld+json">${JSON.stringify({
      "@type": "JobPosting",
      description: "<p>About the role: you will build data pipelines and own them in production. "
        + "Qualifications: a degree in computer science and experience with distributed systems. "
        + "Preferred skills: Python, Kafka. The team ships weekly.</p>".repeat(3),
    })}</script></head>
    <body><nav>Home About Careers Blog</nav><div>Cookie notice</div></body></html>`;
  const ctx = { async fetchJson() { return {}; }, async fetchText() { return html; } };
  const out = await readUnknownBoard("https://careers.example.com/jobs/1", ctx);
  assert.match(out, /build data pipelines/);
  assert.ok(!out.includes("Cookie notice"));
});

test("page furniture is dropped in favour of the one block that is actually the posting", async () => {
  const nav = Array.from({ length: 30 }, (_unused, i) => `<li>Nav link ${i}</li>`).join("");
  const jd = `<div>${"Requirements: we need someone with 5+ years of professional backend experience. "
    + "Preferred qualifications include Go and Kubernetes skills. You will join a small team. ".repeat(3)}</div>`;
  const ctx = { async fetchJson() { return {}; }, async fetchText() { return `<html><body><ul>${nav}</ul>${jd}</body></html>`; } };
  const out = await readUnknownBoard("https://careers.example.com/jobs/2", ctx);
  assert.match(out, /5\+ years of professional backend experience/);
  assert.ok(!out.includes("Nav link"), out.slice(0, 80));
});

test("an unreadable page costs the posting nothing", async () => {
  const cases = [
    { async fetchJson() { return {}; }, async fetchText() { throw new Error("HTTP 403"); } },
    { async fetchJson() { return {}; }, async fetchText() { return "<html><body><p>Short.</p></body></html>"; } },
    { async fetchJson() { return {}; }, async fetchText() { return `<html><body><div>${'{"a":1,"b":2},'.repeat(400)}</div></body></html>`; } },
  ];
  for (const ctx of cases) {
    assert.equal(await readUnknownBoard("https://careers.example.com/jobs/3", ctx), null);
  }
});

test("a link into a private address is never fetched at all", async () => {
  const ctx = {
    async fetchJson() { throw new Error("should not be called"); },
    async fetchText() { throw new Error("should not be called"); },
  };
  for (const url of [
    "https://169.254.169.254/latest/meta-data/",
    "https://localhost:8080/jobs/1",
    "http://careers.example.com/jobs/1",
    "file:///etc/passwd",
  ]) {
    assert.equal(await readUnknownBoard(url, ctx), null, url);
  }
});

test("unknown boards stay unread unless the profile asks for them", async () => {
  let called = 0;
  const ctx = {
    async fetchJson() { return {}; },
    async fetchText() {
      called += 1;
      return "<html><body><div>"
        + "About the role: you will own the ingestion service. Requirements: a degree and "
        + "three years of experience. Preferred skills include Rust. ".repeat(6)
        + "</div></body></html>";
    },
  };
  const posting = () => ({ title: "SWE", url: "https://careers.example.com/jobs/9", company: "X", location: "SF", source: "simplify" });

  const off = posting();
  await hydrateDescriptions([off], ctx);
  assert.equal(called, 0);
  assert.equal(off.description, undefined);

  const on = posting();
  await hydrateDescriptions([on], ctx, { readUnknownBoards: true });
  assert.equal(called, 1);
  assert.match(on.description, /own the ingestion service/);
});

test("prose that is not a job posting is refused rather than handed to the scorer", async () => {
  // The real failure this guards: a client-rendered careers page ships no
  // description, and the extractor happily returns the press releases in the
  // page chrome. Scoring an ML role against a robotaxi launch is worse than
  // scoring it on its title alone.
  const news = "Uber, Nuro, and Lucid to Bring Robotaxi Service to Houston in 2027. "
    + "Nuro Expands to Germany, Establishing a European Base for Its Universal Autonomy Platform. ";
  const ctx = {
    async fetchJson() { return {}; },
    async fetchText() { return `<html><body><div>${news.repeat(8)}</div></body></html>`; },
  };
  assert.equal(await readUnknownBoard("https://careers.example.com/jobs/4", ctx), null);
  assert.equal(looksLikeJobDescription(news.repeat(8)), false);
  assert.equal(
    looksLikeJobDescription("Requirements: a degree, three years of experience, and strong skills."),
    true,
  );
});

/* ── liveness ── */

test("an Ashby posting is dead when its board no longer lists it", async () => {
  // The posting page cannot answer this: a pulled Ashby role still serves 200
  // and a one-kilobyte JavaScript shell, identical to a live one.
  const ctx = {
    async fetchJson() { return { jobs: [{ id: "still-open" }, { id: "also-open" }] }; },
    async fetchText() { throw new Error("should not be called"); },
  };
  const gone = "https://jobs.ashbyhq.com/acme/pulled-down";
  const open = "https://jobs.ashbyhq.com/acme/still-open";
  const dead = await findDeadPostings([gone, open], ctx);
  assert.deepEqual([...dead], [gone]);
});

test("an empty Ashby board is a bad slug, not every role closing at once", async () => {
  const ctx = { async fetchJson() { return { jobs: [] }; }, async fetchText() { throw new Error("no"); } };
  const dead = await findDeadPostings(["https://jobs.ashbyhq.com/acme/anything"], ctx);
  assert.equal(dead.size, 0);
});

test("a 404 from a single-posting endpoint is the board saying it is gone", async () => {
  const ctx = {
    async fetchJson(url) {
      if (url.endsWith("/404404")) throw new Error("HTTP 404");
      return { content: "still hiring" };
    },
    async fetchText() { throw new Error("no"); },
  };
  const gone = "https://job-boards.greenhouse.io/acme/jobs/404404";
  const open = "https://job-boards.greenhouse.io/acme/jobs/111111";
  assert.deepEqual([...await findDeadPostings([gone, open], ctx)], [gone]);
});

test("a bad minute never costs a good posting", async () => {
  // Timeouts, 403s and 500s are facts about the network, not about the job.
  for (const boom of ["HTTP 403", "HTTP 500", "The operation was aborted"]) {
    const ctx = {
      async fetchJson() { throw new Error(boom); },
      async fetchText() { throw new Error(boom); },
    };
    const dead = await findDeadPostings([
      "https://job-boards.greenhouse.io/acme/jobs/1",
      "https://jobs.ashbyhq.com/acme/2",
    ], ctx);
    assert.equal(dead.size, 0, boom);
  }
});

test("a posting on a board with no probe is left alone rather than guessed at", async () => {
  const ctx = {
    async fetchJson() { throw new Error("should not be called"); },
    async fetchText() { throw new Error("should not be called"); },
  };
  assert.equal((await findDeadPostings(["https://lifeattiktok.com/search/123"], ctx)).size, 0);
});
