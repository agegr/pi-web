# Release Checklist

This repo publishes two artifacts for each release:

- npm package: `@agegr/pi-web`
- GitHub Release: `agegr/pi-web`

Use this checklist from a clean `main` checkout.

## 1. Preflight

```bash
git fetch origin
git status --short --branch
git log --oneline --decorate -5
git rev-list --left-right --count main...origin/main
gh auth status
npm whoami
node -e "const p=require('./package.json'); console.log(p.version)"
lsof -nP -iTCP:30141 -sTCP:LISTEN
ls .next/server/route-cache
```

Expected:

- `git status` is clean, or only contains changes you intentionally plan to release.
- `main` and `origin/main` are aligned (`0	0`).
- GitHub is authenticated as an account that can push and create releases.
- npm is authenticated as an account that can publish `@agegr/pi-web`.
- No dev server is listening on 30141: the production build rewrites `.next/` and breaks a running `npm run dev`. Stop it first.
- `.next/server/route-cache/` does not exist. An e2e run in `start` mode writes it (`next start` does, the build does not), and it would be published. Delete it if present.

Before bumping, confirm the next version is free (replace `<version>`):

```bash
npm view @agegr/pi-web@<version> version --registry https://registry.npmjs.org/   # expect E404
git ls-remote --tags origin v<version>                                            # expect empty
```

## 2. Publish to npm

Patch release:

```bash
npm run release
```

The release script runs:

```bash
npm version patch --no-git-tag-version && npm run build && npm publish --access public
```

`npm run release` only bumps the patch number. For a minor (or major) release, set the version yourself and run the other two steps separately:

```bash
npm version <x.y.0> --no-git-tag-version
npm run build
npm publish --access public
```

Choosing the bump: look at `git log --oneline v<previous>..HEAD`. A batch of `feat:` commits (new UI, new commands, new settings) is a minor; only fixes and small adjustments is a patch. Decide before running the script, since a published version cannot be reused.

Notes:

- This bumps `package.json` and `package-lock.json`.
- It intentionally runs a production build. Do not run `next build` during normal development; release work is the exception.
- A newly published version may take a few minutes to show up. `npm view @agegr/pi-web@<version> version` can return E404 and `npm view @agegr/pi-web version` can show the previous version even though the publish printed `+ @agegr/pi-web@<version>`. This is registry propagation, not a failed publish: do not publish again. Poll the registry until the version appears:

```bash
curl -s https://registry.npmjs.org/@agegr%2Fpi-web/<version> | head -c 80   # JSON once it exists, "version not found" before
npm view @agegr/pi-web dist-tags --registry https://registry.npmjs.org/
npm view @agegr/pi-web versions --json --registry https://registry.npmjs.org/
```

## 3. Commit the Version Bump

Replace `<version>` with the new package version, for example `0.7.5`.

```bash
git diff -- package.json package-lock.json
git add package.json package-lock.json
git commit -m "Release v<version>"
```

## 4. Tag and Push

```bash
git tag -a v<version> -m "v<version>"
git push origin main v<version>
```

Push the release tag by name. Do not use `git push --tags`: the local checkout holds tags fetched from contributor forks that are not on origin, and `--tags` publishes them (it leaked a stray `v0.10.5`, on a commit that is on no branch, during the v0.11.0 release). If you ever need `--tags`, compare `git tag` with `git ls-remote --tags origin` first.

Confirm the tag does not already exist before creating it when unsure:

```bash
git ls-remote --tags origin v<version>
gh release view v<version> --repo agegr/pi-web
```

## 5. Generate Release Notes from Commits

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

## 6. Create or Update the GitHub Release

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

## 7. Final Verification

```bash
gh release view v<version> --repo agegr/pi-web
npm view @agegr/pi-web@<version> version --registry https://registry.npmjs.org/
npm view @agegr/pi-web dist-tags --registry https://registry.npmjs.org/
git status --short --branch
git log --oneline --decorate -3
git ls-remote --tags origin
```

Expected:

- GitHub Release exists and is not a draft unless intentionally published as one.
- npm exact version resolves and `latest` points at it (allow a few minutes, see step 2).
- `git ls-remote --tags origin` shows no tag you did not mean to publish.
- `main` is aligned with `origin/main`.
- `HEAD` points at the release commit and `v<version>` tag.
