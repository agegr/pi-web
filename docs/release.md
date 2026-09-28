# Release Checklist

This repo publishes two artifacts for each release:

- npm package: `@dreadster3/pi-web`
- GitHub Release: `dreadster3/pi-web`

Use this checklist from a clean `main` checkout.

## 1. Preflight

```bash
git status --short --branch
git log --oneline --decorate -5
gh auth status
npm whoami
node -e "const p=require('./package.json'); console.log(p.version)"
```

Expected:

- `git status` is clean, or only contains changes you intentionally plan to release.
- GitHub is authenticated as an account that can push and create releases.
- npm is authenticated as an account that can publish `@dreadster3/pi-web`.

## 2. Publish to npm

For the **first publish** of the package (`0.0.1`), publish directly — `npm version patch` would skip to `0.0.2`:

```bash
npm run build && npm pack --dry-run && npm publish --access public
```

For every subsequent release:

```bash
npm run release
```

The release script runs:

```bash
npm version patch --no-git-tag-version && npm run build && npm publish --access public
```

Notes:

- This bumps `package.json` and `package-lock.json`.
- It intentionally runs a production build. Do not run `next build` during normal development; release work is the exception.
- Before publishing, `npm pack --dry-run` prints the tarball contents; verify that `bin/`, `.next/`, `public/` are present and that `demo/`, `docs/`, `e2e/`, and `public/sw.test.mjs` are absent.
- Provenance is not enabled in `publishConfig`; publish locally without it. If publishing is later moved to GitHub Actions, configure a Trusted Publisher and `permissions: id-token: write` there instead — provenance is generated automatically in that setup.
- If `npm view @dreadster3/pi-web version` briefly shows the previous version, check the exact version instead:

```bash
npm view @dreadster3/pi-web@<version> version --registry https://registry.npmjs.org/
npm view @dreadster3/pi-web versions --json --registry https://registry.npmjs.org/
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
git push origin main --tags
```

Confirm the tag does not already exist before creating it when unsure:

```bash
git ls-remote --tags origin v<version>
gh release view v<version> --repo dreadster3/pi-web
```

## 5. Generate Release Notes from Commits

Use the previous release tag as the base.

```bash
git log --oneline --decorate v<previous>..v<version>
git log --format='%h%x09%s%n%b' v<previous>..v<version>
git diff --stat v<previous>..v<version>
```

Write the release notes from those commits, not from memory. Include both Chinese and English sections. Keep commit hashes next to each item when useful.

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

- 发布 npm 包 `@dreadster3/pi-web@<version>`。

## English

Prepared from commits in `v<previous>..v<version>`.

### Added

- ...

### Fixed

- ...

### Improved

- ...

### Internal

- Published npm package `@dreadster3/pi-web@<version>`.
```

## 6. Create or Update the GitHub Release

Create a new release:

```bash
gh release create v<version> \
  --repo dreadster3/pi-web \
  --verify-tag \
  --title "v<version>" \
  --notes-file release-notes.md
```

If the release already exists and only the notes need updating:

```bash
gh release edit v<version> \
  --repo dreadster3/pi-web \
  --notes-file release-notes.md
```

You can avoid a temporary file by passing notes through stdin:

```bash
gh release edit v<version> --repo dreadster3/pi-web --notes-file - <<'EOF'
## 中文

...

## English

...
EOF
```

## 7. Final Verification

```bash
gh release view v<version> --repo dreadster3/pi-web
npm view @dreadster3/pi-web@<version> version --registry https://registry.npmjs.org/
git status --short --branch
git log --oneline --decorate -3
```

Expected:

- GitHub Release exists and is not a draft unless intentionally published as one.
- npm exact version resolves.
- `main` is aligned with `origin/main`.
- `HEAD` points at the release commit and `v<version>` tag.
