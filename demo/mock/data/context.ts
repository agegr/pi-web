/**
 * The seven context files Settings › Context lists, and the in-memory text the
 * demo's mock keeps for them. Mirrors lib/context-files.ts: the agent directory's
 * three entries, then the project's four, with the same precedence rules.
 */
import type { ContextFileId, ContextFileInfo, ContextResponse } from "@/lib/api-types";
import { AGENT_DIR, PROJECT_ROOT } from "../paths";

const AGENTS_GLOBAL = `${AGENT_DIR}/AGENTS.md`;
const SYSTEM_GLOBAL = `${AGENT_DIR}/SYSTEM.md`;
const APPEND_GLOBAL = `${AGENT_DIR}/APPEND_SYSTEM.md`;
const AGENTS_LOCAL = `${PROJECT_ROOT}/AGENTS.md`;
const SYSTEM_LOCAL = `${PROJECT_ROOT}/.pi/SYSTEM.md`;
const APPEND_LOCAL = `${PROJECT_ROOT}/.pi/APPEND_SYSTEM.md`;
const OVERRIDE_LOCAL = `${PROJECT_ROOT}/AGENTS.override.md`;

/** The text each entry starts with; null means the file does not exist yet. */
const INITIAL_TEXT: Record<ContextFileId, string | null> = {
  "agents-global": [
    "# Pi Web demo",
    "",
    "These are the agent-directory instructions the demo shows in Settings › Context.",
    "Pi loads this file in every working directory it runs in.",
    "",
  ].join("\n"),
  "system-global": null,
  "append-system-global": null,
  "agents-local": [
    "# pi-web",
    "",
    "Project instructions from AGENTS.md, applied here and in every folder below.",
    "Run `npm run lint` and `npx tsc --noEmit` before pushing.",
    "",
  ].join("\n"),
  "system-local": [
    "You are working on the Pi Web demo. Keep answers short.",
    "",
  ].join("\n"),
  "append-system-local": null,
  "agents-override-local": null,
};

const SPECS: Array<Pick<ContextFileInfo, "id" | "scope" | "deletable" | "path">> = [
  { id: "agents-global", scope: "global", deletable: false, path: AGENTS_GLOBAL },
  { id: "system-global", scope: "global", deletable: false, path: SYSTEM_GLOBAL },
  { id: "append-system-global", scope: "global", deletable: false, path: APPEND_GLOBAL },
  { id: "agents-local", scope: "local", deletable: false, path: AGENTS_LOCAL },
  { id: "system-local", scope: "local", deletable: false, path: SYSTEM_LOCAL },
  { id: "append-system-local", scope: "local", deletable: false, path: APPEND_LOCAL },
  { id: "agents-override-local", scope: "local", deletable: true, path: OVERRIDE_LOCAL },
];

/** The demo's in-memory copy; writes edit it so the panel's refetch shows the result. */
export const contextState = new Map<ContextFileId, string>(
  Object.entries(INITIAL_TEXT).filter((entry): entry is [ContextFileId, string] => entry[1] !== null),
);

/** The resolved listing for a project, or the agent directory alone without one. */
export function contextListing(cwd: string | null): ContextResponse {
  const files: ContextFileInfo[] = SPECS.map((spec) => {
    const local = spec.scope === "local";
    const path = local && !cwd ? null : spec.path;
    const text = path ? contextState.get(spec.id) : undefined;
    return {
      ...spec,
      path,
      exists: text !== undefined,
      // A file that is not there loads nothing; the demo's project is trusted,
      // so a project system prompt that is there is the one Pi reads.
      effective: text !== undefined,
      content: text ?? "",
      sizeBytes: text ? text.length : 0,
      truncated: false,
    };
  });

  // The docs' precedence: a project `.pi/SYSTEM.md` or `.pi/APPEND_SYSTEM.md`
  // replaces the agent directory's, and an AGENTS.override.md replaces AGENTS.md
  // in the same directory only.
  const replacement: Array<[ContextFileId, ContextFileId]> = [
    ["system-global", "system-local"],
    ["append-system-global", "append-system-local"],
    ["agents-local", "agents-override-local"],
  ];
  const byId = new Map(files.map((file) => [file.id, file]));
  for (const [loser, winner] of replacement) {
    const losing = byId.get(loser);
    const winning = byId.get(winner);
    if (losing?.exists && winning?.exists && winning.path) {
      losing.effective = false;
      losing.shadowedBy = winning.path;
    }
  }

  return { agentDir: AGENT_DIR, cwd, maxBytes: 256 * 1024, files };
}
