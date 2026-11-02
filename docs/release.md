# Release Checklist

This repo publishes three artifacts for each release:

- npm package: `@agegr/pi-web`, published by GitHub Actions (`.github/workflows/publish.yml`) when a `v*` tag is pushed
- Docker image: `ghcr.io/agegr/pi-web`, tagged `<version>`, `<major>.<minor>` and `latest`, published by the same workflow on the same tag (see [docker.md](./docker.md))
- GitHub Release: `agegr/pi-web`

Use this checklist from a clean `main` checkout.

## 0. One-time Setup: npm Trusted Publishing

The publish workflow authenticates to npm with Trusted Publishing (OIDC). No npm token exists anywhere, so nothing expires or needs rotating.

On npmjs.com, open `@agegr/pi-web` → Settings → Trusted Publisher → GitHub Actions and enter:

- Organization or user: `agegr`
- Repository: `pi-web`
- Workflow filename: `publish.yml`
- Environment: leave empty
- Permissions: `npm publish` only. The workflow publishes directly; `npm stage publish` (a staged version that waits for a maintainer's 2FA approval) is not used.

Renaming the workflow file breaks publishing until this entry is updated. Settings → Publishing access is set to "Require two-factor authentication and disallow bypass 2fa tokens": Trusted Publishing is not a token and keeps working, and a manual `npm publish` still works with a 2FA prompt.

## 1. Preflight

```bash
git fetch origin
git status --short --branch
git log --oneline --decorate -5
git rev-list --left-right --count main...origin/main
gh auth status
node -e "const p=require('./package.json'); console.log(p.version)"
gh run list --branch main --workflow ci.yml --limit 1
```

Expected:

- `git status` is clean: `npm version` refuses a dirty tree.
- `main` and `origin/main` are aligned (`0	0`), and every commit meant for this release is on `origin/main`. A commit merged only locally has had no CI run: push `main` first and wait for CI.
- GitHub is authenticated as an account that can push and create releases.
- CI on the commit you are releasing passed. The publish workflow only builds; it does not lint or test.

Nothing is built locally, so a running dev server on 30141 is safe, and a local `.next/server/route-cache/` cannot leak into the package: CI builds from a fresh checkout.

Before bumping, confirm the next version is free (replace `<version>`):

```bash
npm view @agegr/pi-web@<version> version --registry https://registry.npmjs.org/   # expect E404
git ls-remote --tags origin v<version>                                            # expect empty
```

## 2. Bump, Commit and Tag

Patch release:

```bash
npm run release
```

The release script runs:

```bash
npm version patch -m "Release v%s"
```

It bumps `package.json` and `package-lock.json`, commits them as `Release v<version>`, and creates the annotated tag `v<version>`. Nothing leaves your machine yet.

For a minor (or major) release, name the bump yourself:

```bash
npm version minor -m "Release v%s"
```

Choosing the bump: look at `git log --oneline v<previous>..HEAD`. A batch of `feat:` commits (new UI, new commands, new settings) is a minor; only fixes and small adjustments is a patch. Decide before pushing, since a published version cannot be reused.

Check the result before pushing:

```bash
git show --stat HEAD
git tag --points-at HEAD
```

## 3. Push: CI Publishes to npm and GHCR

```bash
git push origin main v<version>
```

Push the release tag by name. Do not use `git push --tags`: the local checkout holds tags fetched from contributor forks that are not on origin, and `--tags` publishes them (it leaked a stray `v0.10.5`, on a commit that is on no branch, during the v0.11.0 release). If you ever need `--tags`, compare `git tag` with `git ls-remote --tags origin` first.

The tag starts the Release workflow (`publish.yml`). Its `check-tag` job fails the run at once if the tag is not `v` + the `package.json` version; after it, two jobs run side by side:

- `npm` runs `npm ci`, `npm run build` and `npm publish --access public`. It takes about three minutes.
- `container` builds `linux/amd64` and `linux/arm64` images and pushes them to GHCR. The arm64 half runs under QEMU: the v0.14.1 build took 33 minutes of its 45-minute timeout.

Follow it:

```bash
gh run list --workflow publish.yml --limit 1
gh run watch <run-id> --exit-status
```

The same push to `main` also redeploys the demo (`demo-pages.yml`), since the release commit changes `package.json`.

Notes:

- `gh run watch` can return a non-zero exit while the run is still going (it did on the long container build). Check `gh run view <run-id>` before treating it as a failure.

- A newly published version may take a few minutes to show up. `npm view @agegr/pi-web@<version> version` can return E404 and `npm view @agegr/pi-web version` can show the previous version even though the workflow log printed `+ @agegr/pi-web@<version>`. This is registry propagation, not a failed publish: do not re-run the workflow. Poll the registry until the version appears:

```bash
curl -s https://registry.npmjs.org/@agegr%2Fpi-web/<version> | head -c 80   # JSON once it exists, "version not found" before
npm view @agegr/pi-web dist-tags --registry https://registry.npmjs.org/
npm view @agegr/pi-web versions --json --registry https://registry.npmjs.org/
```

- The package carries a provenance statement linking it to the workflow run; the npm page shows it.

If the workflow fails before `npm publish` succeeds, the version is still free:

- A passing cause (npm or GitHub outage): `gh run rerun <run-id>`.
- A code or config fix: land it on `main`, then move the tag to the fixed commit and push it again. This is safe only while npm does not have the version (check with the `curl` above):

```bash
git tag -d v<version>
git push origin :refs/tags/v<version>
git tag -a v<version> -m "Release v<version>"
git push origin main v<version>
```

- An `ENEEDAUTH` or 404 on `npm publish` means the Trusted Publisher entry (step 0) does not match this repository and `publish.yml`.

If the `container` job fails after npm has the version, the tag can no longer move. A passing cause: `gh run rerun <run-id> --failed`, which reruns that job only; image tags are overwritten, so a partial push does no harm. A rerun builds the tagged commit again, so a fix to the Dockerfile or the workflow reaches GHCR only with the next release.

### Pushed the tag too early

If the tag went out before the release was ready (a commit still missing, say), cancel the Release run before `npm publish` runs:

```bash
gh run cancel <run-id>
curl -s https://registry.npmjs.org/@agegr%2Fpi-web/<version> | head -c 80   # still "version not found"
```

Then either move the tag once the fix is on `main`, as above, or release the next patch instead. The second leaves an unpublished `v<version>` tag on origin, as `v0.14.0` was: base the next release notes on the last version that was published, and say there that the skipped tag was never released.

## 4. Generate Release Notes from Commits

Use the previous release tag as the base.

```bash
git log --oneline --decorate v<previous>..v<version>
git log --format='%h%x09%s%n%b' v<previous>..v<version>
git diff --stat v<previous>..v<version>
```

Write the release notes from those commits, not from memory. Include both Chinese and English sections. Keep commit hashes or PR numbers next to each item when useful.

- Check commands, flags and setting names against `README.md` and the code before writing them down.
- Thank outside contributors by name: `git log --format='%h %an | %s' v<previous>..v<version>` lists authors, and the previous release's notes show the style.
- Open with the install/upgrade command (`npm install -g @agegr/pi-web@latest`), as earlier releases did.
- Write the notes to a file outside the repo (for example `NOTES=$(mktemp)`), or pass them through stdin as shown below. A `release-notes.md` in the repo root is an untracked file in the next release's `git status`.

Suggested structure:

```markdown
## 中文

基于 `v<previous>..v<version>` 的提交整理。

### 新增

- ...

### 修复

- ...

### 改进

- ...

### 内部调整

- 发布 npm 包 `@agegr/pi-web@<version>`。

## English

Prepared from commits in `v<previous>..v<version>`.

### Added

- ...

### Fixed

- ...

### Improved

- ...

### Internal

- Published npm package `@agegr/pi-web@<version>`.
```

## 5. Create or Update the GitHub Release

Create a new release:

```bash
gh release create v<version> \
  --repo agegr/pi-web \
  --verify-tag \
  --title "v<version>" \
  --notes-file "$NOTES"
```

If the release already exists and only the notes need updating:

```bash
gh release edit v<version> \
  --repo agegr/pi-web \
  --notes-file "$NOTES"
```

You can avoid a temporary file by passing notes through stdin:

```bash
gh release edit v<version> --repo agegr/pi-web --notes-file - <<'EOF'
## 中文

...

## English

...
EOF
```

## 6. Final Verification

```bash
gh release view v<version> --repo agegr/pi-web
gh run list --workflow publish.yml --limit 1
npm view @agegr/pi-web@<version> version --registry https://registry.npmjs.org/
npm view @agegr/pi-web dist-tags --registry https://registry.npmjs.org/
git status --short --branch
git log --oneline --decorate -3
git ls-remote --tags origin
```

Check that the image can be pulled without signing in:

```bash
T=$(curl -s "https://ghcr.io/token?scope=repository:agegr/pi-web:pull" | node -p 'JSON.parse(require("fs").readFileSync(0)).token')
for tag in <version> <major>.<minor> latest; do
  printf '%s: ' "$tag"
  curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $T" \
    -H 'Accept: application/vnd.oci.image.index.v1+json' \
    "https://ghcr.io/v2/agegr/pi-web/manifests/$tag"
done
```

Expected:

- GitHub Release exists and is not a draft unless intentionally published as one.
- The Release run for `v<version>` succeeded, both its `npm` and `container` jobs.
- npm exact version resolves and `latest` points at it (allow a few minutes, see step 3).
- Every image tag answers `200`.
- `git ls-remote --tags origin` shows no tag you did not mean to publish.
- `main` is aligned with `origin/main`.
- `HEAD` points at the release commit and `v<version>` tag.
