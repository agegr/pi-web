import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  buildInstallPlan,
  compareVersions,
  getOmpWebUpdateStatus,
} = await jiti.import("./omp-updates.ts");

function response(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function fetcher({ release, npm }) {
  return async (url) => {
    if (url.includes("registry.npmjs.org")) return npm === null ? response({}, 503) : response(npm);
    if (url.includes("api.github.com")) return release === null ? response({}, 503) : response(release);
    throw new Error(`Unexpected URL: ${url}`);
  };
}

const release = {
  tag_name: "v0.1.8",
  name: "v0.1.8",
  body: "## Fixed\n\n- A release fix",
  html_url: "https://github.com/ddallabenetta/omp-web/releases/tag/v0.1.8",
  published_at: "2026-08-05T01:32:09Z",
};

test("compares release versions with prerelease ordering", () => {
  assert.equal(compareVersions("v0.1.8", "0.1.7"), 1);
  assert.equal(compareVersions("0.1.8-rc.1", "0.1.8"), -1);
  assert.equal(compareVersions("0.1.8+build.2", "0.1.8+build.1"), 0);
  assert.equal(compareVersions("not-a-version", "0.1.8"), 0);
});

test("reports a published omp-web release with its changelog", async () => {
  const status = await getOmpWebUpdateStatus({
    currentAppVersion: "0.1.7",
    fetcher: fetcher({
      release,
      npm: { version: "0.1.8" },
    }),
    env: { OMP_WEB_UPDATE_MANAGER: "bun" },
  });

  assert.equal(status.updateAvailable, true);
  assert.equal(status.availability, "installable");
  assert.equal(status.currentAppVersion, "0.1.7");
  assert.equal(status.latestRelease.version, "0.1.8");
  assert.equal(status.latestRelease.body, release.body);
  assert.equal(status.latestPackage?.version, "0.1.8");
  assert.equal(status.install.canInstall, true);
  assert.equal(status.install.command, "bun add --global omp-web@latest");
  assert.equal(status.install.alternateCommand, "npm install --global omp-web@latest");
});

test("does not advertise a GitHub-only release before npm publication", async () => {
  const status = await getOmpWebUpdateStatus({
    currentAppVersion: "0.1.7",
    fetcher: fetcher({
      release,
      npm: { version: "0.1.7" },
    }),
  });

  assert.equal(status.updateAvailable, false);
  assert.equal(status.availability, "up-to-date");
  assert.equal(status.latestPackage?.version, "0.1.7");
  assert.equal(status.latestRelease.version, "0.1.7");
  assert.equal(status.latestRelease.body, "");
});

test("falls back to the package release link when GitHub is unavailable", async () => {
  const status = await getOmpWebUpdateStatus({
    currentAppVersion: "0.1.7",
    fetcher: fetcher({
      release: null,
      npm: { version: "0.1.8" },
    }),
  });

  assert.equal(status.updateAvailable, true);
  assert.equal(status.latestRelease.version, "0.1.8");
  assert.equal(status.latestRelease.htmlUrl, "https://github.com/ddallabenetta/omp-web/releases/tag/v0.1.8");
  assert.equal(status.latestRelease.body, "");
});

test("self-update can be disabled without hiding the manual commands", () => {
  const plan = buildInstallPlan({
    currentAppVersion: "0.1.7",
    latestPackage: { version: "0.1.8" },
    env: { OMP_WEB_UPDATE_MANAGER: "bun", OMP_WEB_DISABLE_SELF_UPDATE: "1" },
  });

  assert.equal(plan.canInstall, false);
  assert.equal(plan.reason, "disabled");
  assert.equal(plan.command, "bun add --global omp-web@latest");
});
