/**
 * Virtual filesystem for the demo projects. The Pi Web project is backed by
 * the repository snapshot in public/demo-files (see scripts/prepare-demo-files.mjs);
 * the scratch project lives entirely in memory. Session "tool runs" add
 * overrides on top so the explorer, viewer and Git panel tell one story.
 */
import { TEXT_PREVIEW_MAX_BYTES, documentPreviewKind, getAudioMime, getDocumentMime, getImageMime, getVideoMime } from "@/lib/file-types";
import { demoAssetPath } from "./base-path";
import { PROJECT_ROOT, SCRATCH_ROOT, WORKTREE_ROOT, relativeToProject } from "./paths";
import { getRealFetch } from "./runtime";
import { PROJECT_FILE_EDITS, PROJECT_FILE_OVERRIDES, SCRATCH_FILES } from "./data/project-files";

export interface VirtualFile {
  path: string;
  size: number;
  /** Static asset name under public/demo-files/f/. */
  asset?: string;
  /** Inline text content (overrides and scratch files). */
  content?: string;
}

interface Project {
  root: string;
  load(): Promise<VirtualFile[]>;
}

const IGNORED_NAMES = new Set([
  "node_modules", ".git", ".next", "dist", "build", "__pycache__",
  ".turbo", ".cache", "coverage", ".pytest_cache", ".mypy_cache",
  "target", "vendor", ".DS_Store",
]);

const EXT_TO_LANGUAGE: Record<string, string> = {
  ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
  mjs: "javascript", cjs: "javascript", py: "python", rb: "ruby",
  go: "go", rs: "rust", java: "java", kt: "kotlin", swift: "swift",
  c: "c", cpp: "cpp", h: "c", hpp: "cpp", cs: "csharp",
  html: "html", htm: "html", css: "css", scss: "css", less: "css",
  json: "json", jsonl: "json", yaml: "yaml", yml: "yaml",
  toml: "toml", xml: "xml", md: "markdown", mdx: "markdown",
  sh: "bash", bash: "bash", zsh: "bash", fish: "bash",
  sql: "sql", graphql: "graphql", gql: "graphql",
  dockerfile: "dockerfile", tf: "hcl", hcl: "hcl",
  env: "bash", gitignore: "bash", txt: "text",
  pdf: "pdf", docx: "word",
};

export function languageFor(filePath: string): string {
  const base = (filePath.split("/").pop() ?? "").toLowerCase();
  if (base === "dockerfile" || base.startsWith("dockerfile.")) return "dockerfile";
  if (base === ".env" || base.startsWith(".env.")) return "bash";
  if (base === "makefile" || base === "gnumakefile") return "makefile";
  const ext = base.split(".").pop() ?? "";
  return EXT_TO_LANGUAGE[ext] ?? "text";
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

let manifestPromise: Promise<VirtualFile[]> | null = null;

function loadRepositorySnapshot(): Promise<VirtualFile[]> {
  manifestPromise ??= getRealFetch()(demoAssetPath("/demo-files/manifest.json"))
    .then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json() as Promise<{ files: VirtualFile[] }>;
    })
    .then((manifest) => manifest.files)
    .catch((error) => {
      manifestPromise = null;
      throw error;
    });
  return manifestPromise;
}

/** Files added or rewritten by the demo sessions, keyed by project-relative path. */
const overrides = new Map<string, VirtualFile>(
  Object.entries(PROJECT_FILE_OVERRIDES).map(([path, content]) => [path, { path, size: byteLength(content), content }]),
);

export function writeProjectFile(relativePath: string, content: string): void {
  overrides.set(relativePath, { path: relativePath, size: byteLength(content), content });
}

/** Original snapshot text of files the demo sessions edited, for diffs. */
const editedOriginals = new Map<string, string>();
let editsApplied: Promise<void> | null = null;

function applyProjectEdits(files: VirtualFile[]): Promise<void> {
  editsApplied ??= (async () => {
    for (const { path, edits } of PROJECT_FILE_EDITS) {
      const file = files.find((candidate) => candidate.path === path);
      if (!file) continue;
      const original = await readFileText(file).catch(() => null);
      if (original === null) continue;
      let next = original;
      for (const edit of edits) {
        if (next.includes(edit.oldText)) next = next.replace(edit.oldText, edit.newText);
      }
      if (next === original) continue;
      editedOriginals.set(path, original);
      if (!overrides.has(path)) overrides.set(path, { path, size: byteLength(next), content: next });
    }
  })().catch(() => {
    editsApplied = null;
  });
  return editsApplied;
}

/** Snapshot text before the demo edits, or null for files that were not edited. */
export async function originalText(relativePath: string): Promise<string | null> {
  await PROJECTS[0].load();
  return editedOriginals.get(relativePath) ?? null;
}

const PROJECTS: Project[] = [
  {
    root: PROJECT_ROOT,
    async load() {
      const files = await loadRepositorySnapshot();
      await applyProjectEdits(files);
      const merged = new Map(files.map((file) => [file.path, file]));
      for (const [path, file] of overrides) merged.set(path, file);
      return [...merged.values()];
    },
  },
  {
    // The linked worktree is a clean checkout of the same snapshot.
    root: WORKTREE_ROOT,
    async load() {
      return loadRepositorySnapshot();
    },
  },
  {
    root: SCRATCH_ROOT,
    async load() {
      return Object.entries(SCRATCH_FILES).map(([path, content]) => ({ path, size: byteLength(content), content }));
    },
  },
];

export const PROJECT_ROOTS = PROJECTS.map((project) => project.root);

function findProject(filePath: string): { project: Project; relative: string } | null {
  for (const project of PROJECTS) {
    if (filePath === project.root) return { project, relative: "" };
    if (filePath.startsWith(`${project.root}/`)) return { project, relative: filePath.slice(project.root.length + 1) };
  }
  return null;
}

export async function projectFiles(root: string): Promise<VirtualFile[]> {
  const project = PROJECTS.find((candidate) => candidate.root === root);
  return project ? project.load() : [];
}

export type FileLookup =
  | { kind: "file"; file: VirtualFile; relative: string; root: string }
  | { kind: "dir"; relative: string; root: string }
  | null;

export async function lookup(filePath: string): Promise<FileLookup> {
  const match = findProject(filePath.replace(/\/+$/, "") || "/");
  if (!match) return null;
  if (match.relative === "") return { kind: "dir", relative: "", root: match.project.root };
  const files = await match.project.load();
  const file = files.find((candidate) => candidate.path === match.relative);
  if (file) return { kind: "file", file, relative: match.relative, root: match.project.root };
  const prefix = `${match.relative}/`;
  if (files.some((candidate) => candidate.path.startsWith(prefix))) {
    return { kind: "dir", relative: match.relative, root: match.project.root };
  }
  return null;
}

export async function listDirectory(filePath: string): Promise<{ name: string; isDir: boolean; size: number; modified: string }[] | null> {
  const found = await lookup(filePath);
  if (!found || found.kind !== "dir") return null;
  const files = await projectFiles(found.root);
  const prefix = found.relative ? `${found.relative}/` : "";
  const children = new Map<string, boolean>();
  for (const file of files) {
    if (!file.path.startsWith(prefix)) continue;
    const rest = file.path.slice(prefix.length);
    const [name, ...deeper] = rest.split("/");
    if (!name || IGNORED_NAMES.has(name) || name.endsWith(".pyc")) continue;
    children.set(name, (children.get(name) ?? false) || deeper.length > 0);
  }
  return [...children.entries()]
    .map(([name, isDir]) => ({ name, isDir, size: 0, modified: "" }))
    .sort((a, b) => (a.isDir !== b.isDir ? (a.isDir ? -1 : 1) : a.name.localeCompare(b.name)));
}

const textCache = new Map<string, Promise<string>>();

export async function readFileText(file: VirtualFile): Promise<string> {
  if (file.content !== undefined) return file.content;
  const asset = file.asset!;
  let pending = textCache.get(asset);
  if (!pending) {
    pending = getRealFetch()(assetUrl(file)!).then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.text();
    });
    pending.catch(() => textCache.delete(asset));
    textCache.set(asset, pending);
  }
  return pending;
}

/** Read a project file by absolute path; null when it does not exist. */
export async function readProjectText(filePath: string): Promise<string | null> {
  const found = await lookup(filePath);
  return found?.kind === "file" ? readFileText(found.file) : null;
}

export function assetUrl(file: VirtualFile): string | null {
  return file.asset ? demoAssetPath(`/demo-files/f/${file.asset}`) : null;
}

export function mimeFor(filePath: string): string {
  return getImageMime(filePath) || getAudioMime(filePath) || getVideoMime(filePath) || getDocumentMime(filePath) || "text/plain";
}

export function isBinaryPath(filePath: string): boolean {
  return mimeFor(filePath) !== "text/plain";
}

export function fileMeta(filePath: string, file: VirtualFile) {
  return {
    size: file.size,
    language: languageFor(filePath),
    mime: mimeFor(filePath),
    previewKind: documentPreviewKind(filePath),
  };
}

/** Same chunking contract as lib/text-preview.ts, measured in UTF-8 bytes. */
export function textChunk(text: string, offset: number) {
  const bytes = new TextEncoder().encode(text);
  let end = Math.min(bytes.length, offset + TEXT_PREVIEW_MAX_BYTES);
  while (end < bytes.length && end > offset && (bytes[end] & 0xc0) === 0x80) end--;
  return {
    content: new TextDecoder().decode(bytes.slice(offset, end)),
    nextOffset: end,
    truncated: end < bytes.length,
    language: "",
    size: bytes.length,
  };
}

/**
 * Map a Pi Web `/api/files/...?type=read|download` URL for a binary project
 * file to its static snapshot, for <img>/<audio>/<iframe> elements and download
 * links that never go through fetch(). Text files keep the API URL for reads;
 * downloads of in-memory files become data URLs, since GitHub Pages has no
 * /api/files endpoint to answer them.
 */
export function staticFileUrlForApi(apiUrl: string): string {
  // Resolved lazily from the manifest cache; see router-side lookups for fetch().
  const parsed = new URL(apiUrl, "http://demo.invalid");
  const type = parsed.searchParams.get("type");
  if (type !== "read" && type !== "download") return apiUrl;
  const filePath = "/" + parsed.pathname.replace(/^\/api\/files\//, "").split("/").map(decodeURIComponent).join("/");
  if (type === "read" && !isBinaryPath(filePath)) return apiUrl;
  const content = inlineContent(filePath);
  if (content !== undefined) {
    return type === "download" ? `data:text/plain;charset=utf-8,${encodeURIComponent(content)}` : apiUrl;
  }
  const asset = knownAssets.get(filePath);
  return asset ? demoAssetPath(`/demo-files/f/${asset}`) : apiUrl;
}

/** Text of a file that lives in memory (tutorial edits, scratch project), if any. */
function inlineContent(filePath: string): string | undefined {
  const projectRelative = relativeToProject(filePath, PROJECT_ROOT);
  if (projectRelative) return overrides.get(projectRelative)?.content;
  const scratchRelative = relativeToProject(filePath, SCRATCH_ROOT);
  if (scratchRelative && Object.hasOwn(SCRATCH_FILES, scratchRelative)) return SCRATCH_FILES[scratchRelative];
  return undefined;
}

/** Absolute path -> asset name, filled once the manifest loads. */
const knownAssets = new Map<string, string>();

export function primeAssetLookup(): Promise<void> {
  return loadRepositorySnapshot().then((files) => {
    for (const file of files) {
      if (!file.asset) continue;
      // The worktree is a clean checkout, so it maps every snapshot file;
      // edited project files are answered by inlineContent() first.
      knownAssets.set(`${PROJECT_ROOT}/${file.path}`, file.asset);
      knownAssets.set(`${WORKTREE_ROOT}/${file.path}`, file.asset);
    }
  }).catch(() => {});
}
