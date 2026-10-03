# Releases

release-please owns the version bookkeeping; you own the *when*. It keeps one
accumulating release pull request open, and merging that PR is the release.

Nothing releases until you merge the bot's PR, and no workflow ever pushes to `main`
— it is protected by this repository's ruleset (*Default*: pull requests required, no
bypass actors), so every change to it, including the version bump, arrives as a PR.

## One-time setup (do this before the first release)

One thing must exist, and it is not a stored npm token: the npm trusted publisher.

### The npm trusted publisher

**Do this before the first publish, or it fails with `ENONPMTOKEN`.** This repo stores
no npm token, so npm has to trust the workflow instead. Register the publisher as
**stage-only**: it may stage a release but must not be able to publish one directly.

1. Open <https://www.npmjs.com/package/@dreadster3/pi-web/access> (npm account with
   publish rights on `@dreadster3/pi-web`).
2. Add a **Trusted Publisher** for GitHub Actions with exactly these values:
   - Repository owner: `dreadster3`
   - Repository name: `pi-web`
   - Workflow name: `release.yml`
   - Environment: `release`
3. **Grant staged publishing only — do not grant direct publish.** Allow
   `npm stage publish`; disallow `npm publish`. npm then rejects a direct publish
   from this workflow, so even a compromised CI run cannot make a version live — it
   can only put a tarball in front of you for approval. (CLI form:
   `npm trust github … --allow-stage-publish`, without `--allow-publish`.)
   See <https://docs.npmjs.com/staged-publishing>.
4. In the repository's *Settings → Environments*, create an environment named `release`.
   It must exist before you register the publisher: the `environment:` field has to name a
   real environment, and it is where publish approval gating will hang.
5. On the package's **Settings** page, turn on **"Require two-factor authentication and
   disallow tokens (recommended)"** so no legacy token can publish either, and make sure
   2FA is enabled on your npm account — approval of a staged release requires it
   (<https://docs.npmjs.com/trusted-publishers>, npm's package-settings best practices).
6. Save.

The runner needs npm ≥ 11.15.0 for staged publishing (and Node ≥ 22.14, which the
workflow's Node 24 provides). The node-24 toolcache image `setup-node` installs
bundles npm ≥ 11.16, so the requirement is already met and `release.yml` runs no npm
pin. Provenance is generated automatically on this path — no `--provenance` token
setup, no stored token.

## The release ritual

### 1. Let the bot propose a version

On every push to `main`, the `release-please` job reads the conventional commits since
the last release and opens (or updates) **one** pull request that:

- bumps `version` in `package.json` and `package-lock.json`,
- writes the new section at the top of `CHANGELOG.md`.

`feat:` → minor, `fix:` → patch, `feat!:`/`BREAKING CHANGE:` → major.

While a release PR is open, further merges to `main` add to it rather than opening a
second one — review it whenever you like.

### 2. Adjust the version if you want to

Two documented overrides:

- **`Release-As: x.y.z` in a commit body** on `main` forces the next release PR to that
  version:
  `git commit --allow-empty -m "chore: release 2.0.0" -m "Release-As: 2.0.0"`
- **Edit the release PR's title.** release-please reads the version back out of the
  title on its next run.

See <https://github.com/googleapis/release-please#how-do-i-change-the-version-number>.

### 3. Merge the release PR (or don't)

- **Ship it:** merge. In that same run release-please commits the version, pushes the
  tag `vX.Y.Z` and creates the GitHub release; job `publish` is then unblocked by
  `needs: release-please` and runs immediately — and **stages** the release rather than
  publishing it. See step 4.
- **Hold it back:** leave the PR open. Nothing is released. This is the entire
  hold-back mechanism.

`publish` does, from the released tag:

1. checks out the tag's commit,
2. `npm ci` — the npm floor (≥ 11.15.0) comes from the node-24 toolcache's bundled
   npm ≥ 11.16, no pin step,
3. `npm run build` — required, not `--if-present`: the tarball ships `.next` and
   `next.config.ts` bakes `NEXT_PUBLIC_APP_VERSION` from `package.json`, so a skipped
   build would publish an empty artifact reporting the wrong version,
4. `npm test`,
5. `npm stage publish --provenance --access public` — **staged, not published.** The
   tarball is uploaded for review; npm requires a 2FA approval before the version
   becomes installable. `--provenance`/`--access` behave exactly as they do on
   `npm publish` (`npm stage publish` has full params parity) and provenance is
   attached automatically by the trusted publisher.

### 4. Approve it on npm

The merge released the *metadata* (tag + GitHub release) and staged the *artifact*,
but nothing is installable yet. This is the gate.

1. The run's step summary prints the stage line, including the stage id:
   `+ @dreadster3/pi-web@X.Y.Z (staged with id <stage-id>)`.
2. Approve it either way — both prompt for 2FA:
   - npmjs.com → the package → **Staged Packages** tab → **Approve**, or
   - `npm stage approve <stage-id>` from your laptop.
3. On approval the version goes live with the dist-tag it was staged with — `latest`,
   the default for a stable version. There is no separate promotion step.

**The tag is immutable.** npm records the dist-tag on the staged tarball and it
cannot be changed afterwards, so a stage created with `latest` goes live as `latest`
or not at all.

**To reject:** `npm stage reject <stage-id>` (2FA) removes the staged package
permanently. There is no documented expiry — the stage sits there until you act —
and, because staged versions share the published version index, **a pending stage
blocks re-staging that same version**. Approve or reject it to clear the way.

## nix builds: no hash to maintain

`package.nix` takes its npm dependencies straight from `package-lock.json` through
`importNpmLock`, so there is no `npmDepsHash` to refresh and no caretaker workflow —
a version bump or a dependency change is just a lock edit. (`#24` retired the old
fixed-output `npmDepsHash` scheme.) Nothing about a release needs nix work.

## Where the version lives

| Place | Written by | Truth for |
| --- | --- | --- |
| `package.json` / `package-lock.json` / `CHANGELOG.md` | the merged release PR | what the tree and the next build are |
| the git tag `vX.Y.Z` | release-please, on that same merge | which commit shipped |
| the staged package | the `publish` job | a tarball awaiting your approval |
| the npm registry | **you**, on 2FA approval | what consumers install |

```bash
npm view @dreadster3/pi-web version   # the latest published version
npm stage list @dreadster3/pi-web     # staged, not yet approved (no 2FA needed)
git tag --sort=-v:refname | head -1   # the latest release tag
```

## Retired

- **`npm run release` from a laptop.** The script is gone; publishing is CI-only.
- **Hand-made version PRs.** release-please opens them.
- **Hand-written bilingual release notes.** `CHANGELOG.md` is bot-written, in English,
  and the GitHub release is created from it.

## Verifying a release

```bash
npm view @dreadster3/pi-web version
npm view @dreadster3/pi-web@<version> dist.attestations   # provenance

git fetch --tags origin
git tag --sort=-v:refname | head -3
gh release view v<version> --repo dreadster3/pi-web
```

## If a run fails

- **`ENONPMTOKEN` / "Invalid npm token"** — the trusted publisher is missing or its
  owner/repo/workflow/environment values do not match. Do the setup above.
- **The run staged instead of published** — expected. That is the gate: approve at
  npmjs.com (package → *Staged Packages* → *Approve*, 2FA) or
  `npm stage approve <stage-id>`. Nothing is installable until you do.
- **"cannot publish version: a staged version already exists" (pending stage)** — a
  previous run staged this version and it was never approved or rejected. Resolve it:
  `npm stage approve <stage-id>` to ship it, or `npm stage reject <stage-id>` (2FA) to
  delete it permanently, then re-run the workflow. A re-run only helps after a reject:
  once approved the version is live, so re-running re-stages the same version and fails
  with version-already-exists — expected. Staged versions share the published
  version index, so the pending stage has to be cleared before re-staging.
- **`npm stage publish` fails (unknown command / `ENO…`) — the npm CLI is too old.**
  Staged publishing needs npm ≥ 11.15.0. The node-24 toolcache image `setup-node`
  installs bundles npm ≥ 11.16, so this should not happen on an up-to-date runner; if
  it ever does — a future image shipping an older npm — the workflow's header comment
  names this failure and the fix is a `npm install -g npm@<latest 11.x>` step in
  `release.yml`.
- **No release PR appears** — no releasable commit since the last release (all
  `chore:`/`docs:`/`test:`). Merge a `feat:`/`fix:`, or force one with `Release-As:`.
- **The release PR has no checks** — expected, not a failure. The bot runs on the
  default `GITHUB_TOKEN`, and a PR opened with it does not trigger other workflows. This
  is accepted because publish is chained by `needs:` in the same run, the ruleset
  requires no status checks, and release PRs only touch version fields and the
  changelog. If required status checks
  are ever added to the ruleset, give the `release-please` job an App token
  (`actions/create-github-app-token`) so the release PR triggers them.
- **Merged the PR but no tag/release** — re-run the workflow
  (*Actions → Release → Run workflow*); re-runs re-detect the merged PR.
