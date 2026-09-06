import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { annotateSkillsWithInstallInfo, getGlobalSkillsLockPath } =
  await jiti.import("./skill-lock.ts");

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function makeSkill(name, filePath, scope) {
  return {
    name,
    description: `${name} description`,
    filePath,
    baseDir: filePath.slice(0, -"/SKILL.md".length),
    disableModelInvocation: false,
    sourceInfo: { scope },
  };
}

test("uses the CLI global lock location", () => {
  assert.equal(
    getGlobalSkillsLockPath({ homeDir: "/home/test", xdgStateHome: undefined }),
    join("/home/test", ".agents", ".skill-lock.json"),
  );
  assert.equal(
    getGlobalSkillsLockPath({ homeDir: "/home/test", xdgStateHome: "/state" }),
    join("/state", "skills", ".skill-lock.json"),
  );
});

test("annotates only lock entries that exist in the matching Pi scope", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-web-skill-lock-"));
  try {
    const cwd = join(root, "project");
    const agentDir = join(root, "home", ".pi", "agent");
    const globalLockPath = join(root, "global-lock.json");
    const projectLockPath = join(cwd, "skills-lock.json");
    const globalSkillPath = join(agentDir, "skills", "edge-tts", "SKILL.md");
    const projectSkillPath = join(cwd, ".pi", "skills", "find-skills", "SKILL.md");
    const manualSkillPath = join(agentDir, "skills", "manual", "SKILL.md");
    const otherAgentSkillPath = join(root, "other-agent", "tts", "SKILL.md");

    for (const path of [globalSkillPath, projectSkillPath, manualSkillPath, otherAgentSkillPath]) {
      mkdirSync(join(path, ".."), { recursive: true });
      writeFileSync(path, "---\nname: test\n---\n", "utf8");
    }

    writeJson(globalLockPath, {
      version: 3,
      skills: {
        "edge-tts": {
          source: "https://github.com/aahl/skills.git",
          sourceType: "github",
          skillPath: "skills/edge-tts/SKILL.md",
          skillFolderHash: "global-version",
        },
        tts: { source: "noizai/skills", sourceType: "github" },
      },
    });
    writeJson(projectLockPath, {
      version: 1,
      skills: {
        "find-skills": {
          source: "vercel-labs/skills",
          sourceType: "github",
          skillPath: "skills/find-skills/SKILL.md",
          computedHash: "project-version",
        },
      },
    });

    const annotated = annotateSkillsWithInstallInfo(
      [
        makeSkill("edge-tts", globalSkillPath, "user"),
        makeSkill("find-skills", projectSkillPath, "project"),
        makeSkill("manual", manualSkillPath, "user"),
        makeSkill("tts", otherAgentSkillPath, "user"),
      ],
      { cwd, agentDir, globalLockPath, projectLockPath },
    );

    assert.deepEqual(annotated[0].install, {
      package: "aahl/skills@edge-tts",
      scope: "global",
      source: "aahl/skills",
      sourceType: "github",
      skillsShUrl: "https://skills.sh/aahl/skills/edge-tts",
      skillPath: "skills/edge-tts/SKILL.md",
      versionHash: "global-version",
      canCheckForUpdates: true,
    });
    assert.deepEqual(annotated[1].install, {
      package: "vercel-labs/skills@find-skills",
      scope: "project",
      source: "vercel-labs/skills",
      sourceType: "github",
      skillsShUrl: "https://skills.sh/vercel-labs/skills/find-skills",
      skillPath: "skills/find-skills/SKILL.md",
      versionHash: "project-version",
      canCheckForUpdates: true,
    });
    assert.equal(annotated[2].install, undefined);
    assert.equal(annotated[3].install, undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ignores stale lock entries and malformed lock files", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-web-skill-lock-"));
  try {
    const cwd = join(root, "project");
    const agentDir = join(root, "agent");
    const missingPath = join(agentDir, "skills", "missing", "SKILL.md");
    const projectSkillPath = join(cwd, ".pi", "skills", "broken", "SKILL.md");
    const globalLockPath = join(root, "global-lock.json");
    const projectLockPath = join(root, "project-lock.json");
    mkdirSync(join(projectSkillPath, ".."), { recursive: true });
    writeFileSync(projectSkillPath, "---\nname: broken\n---\n", "utf8");
    writeJson(globalLockPath, {
      version: 3,
      skills: {
        missing: { source: "owner/repo", sourceType: "github" },
      },
    });
    writeFileSync(projectLockPath, "not json", "utf8");

    const skills = annotateSkillsWithInstallInfo(
      [
        makeSkill("missing", missingPath, "user"),
        makeSkill("broken", projectSkillPath, "project"),
      ],
      { cwd, agentDir, globalLockPath, projectLockPath },
    );

    assert.equal(skills[0].install, undefined);
    assert.equal(skills[1].install, undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("does not compare a project ref with the default skills.sh snapshot", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-web-skill-lock-"));
  try {
    const cwd = join(root, "project");
    const agentDir = join(root, "agent");
    const projectLockPath = join(cwd, "skills-lock.json");
    const projectSkillPath = join(cwd, ".pi", "skills", "preview", "SKILL.md");
    mkdirSync(join(projectSkillPath, ".."), { recursive: true });
    writeFileSync(projectSkillPath, "---\nname: preview\n---\n", "utf8");
    writeJson(projectLockPath, {
      version: 1,
      skills: {
        preview: {
          source: "owner/repo",
          sourceType: "github",
          skillPath: "skills/preview/SKILL.md",
          ref: "preview",
          computedHash: "project-version",
        },
      },
    });

    const [skill] = annotateSkillsWithInstallInfo(
      [makeSkill("preview", projectSkillPath, "project")],
      { cwd, agentDir, projectLockPath, globalLockPath: join(root, "missing.json") },
    );

    assert.equal(skill.install.ref, "preview");
    assert.equal(skill.install.canCheckForUpdates, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
