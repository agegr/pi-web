import { realpathSync } from "node:fs";
import path from "node:path";
import { isPathWithinRoots } from "./path-security";
import { readRegularFileText, RegularFileError } from "./regular-file";

const MAX_BYTES = 1024 * 1024;

/** Only fixed, user-readable messages belong here, never filesystem error text. */
export class SkillDocumentError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "SkillDocumentError";
  }
}

function documentPath(baseDir: string, document: string): string {
  // URLSearchParams already decoded transport encoding. Percent signs, spaces,
  // # and ? are literal filename characters here, not URL syntax to parse again.
  // Require callers to normalize parent segments: realpath and the filesystem
  // can otherwise interpret link/../file differently.
  const hasControl = Array.from(document).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
  });
  if (!document || document.includes("\\") || hasControl
      || path.posix.isAbsolute(document) || path.win32.isAbsolute(document)
      || document.includes(":") || document.split("/").includes("..")) {
    throw new SkillDocumentError(400, "Use a relative document path without parent segments.");
  }
  if (!/\.(md|markdown)$/i.test(document)) {
    throw new SkillDocumentError(415, "Only Markdown documents (.md or .markdown) are supported.");
  }

  const root = path.resolve(baseDir);
  const target = path.resolve(root, document);
  // Input rules keep the lexical path inside root. Authorize canonical paths
  // once, including the root itself: installed skills may be symlinks.
  const realRoot = realpathSync(root);
  const realTarget = realpathSync(target);
  if (!isPathWithinRoots(realTarget, new Set([realRoot]))) {
    throw new SkillDocumentError(403, "Document is outside this skill folder.");
  }
  if (!/\.(md|markdown)$/i.test(realTarget)) {
    throw new SkillDocumentError(415, "Only Markdown documents (.md or .markdown) are supported.");
  }
  return realTarget;
}

/** Call only after matching filePath to the runtime loader's exact skill entry. */
export function readSkillDocument(
  skill: { filePath: string; baseDir: string },
  document: string | null = null,
): string {
  const missingMessage = document === null ? "Skill file not found" : "Skill document not found.";
  try {
    // Omission preserves the original runtime-loaded file, including frontmatter
    // and the loader's symlink semantics. An empty document is not omission.
    const content = readRegularFileText(
      document === null ? skill.filePath : documentPath(skill.baseDir, document),
      MAX_BYTES,
    );
    if (content === undefined) throw new SkillDocumentError(404, missingMessage);
    return content;
  } catch (error) {
    if (error instanceof SkillDocumentError) throw error;
    if (error instanceof RegularFileError) {
      if (error.reason === "nonregular") {
        throw new SkillDocumentError(400, "Skill document is not a regular file.");
      }
      if (error.reason === "too_large") {
        throw new SkillDocumentError(413, "Skill document exceeds the 1 MiB limit.");
      }
    }
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT" || code === "ENOTDIR") {
      throw new SkillDocumentError(404, missingMessage);
    }
    if (code === "EACCES" || code === "EPERM" || code === "ELOOP") {
      throw new SkillDocumentError(403, "Skill document cannot be accessed.");
    }
    throw new SkillDocumentError(500, "Unable to read skill document.");
  }
}
