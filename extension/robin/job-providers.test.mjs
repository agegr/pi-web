import assert from "node:assert/strict";
import { test } from "node:test";
import { STARTER_COMPANIES } from "./jobs.ts";
import {
  BOARD_PROVIDERS,
  COMPANY_PROVIDERS,
  makeFetchContext,
  providerById,
  resolveProvider,
  smartRecruitersPublicUrl,
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
