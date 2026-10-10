import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { createJiti } from "jiti";

const root = await mkdtemp(join(tmpdir(), "pi-web-skill-content-"));
const agentDir = join(root, "agent");
const skillsDir = join(agentDir, "skills");
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = agentDir;

const skillPath = join(skillsDir, "preview", "SKILL.md");
const skillContent = "---\nname: preview\ndescription: Preview skill\n---\n\n# Preview\n\n- formatted\n";
await mkdir(join(skillsDir, "preview"), { recursive: true });
await writeFile(skillPath, skillContent);

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() } });
const { allowFileRoot } = await jiti.import("../../../../lib/file-access.ts");
allowFileRoot(process.cwd());
const { GET } = await jiti.import("./route.ts");

after(async () => {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  await rm(root, { recursive: true, force: true });
});

function getContent(filePath, cwd = process.cwd()) {
  const url = new URL("http://localhost/api/skills/content");
  url.searchParams.set("cwd", cwd);
  url.searchParams.set("filePath", filePath);
  return GET(new Request(url));
}

test("returns the complete file for a skill loaded by the runtime resource loader", async () => {
  const response = await getContent(skillPath);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { content: skillContent });
});

test("refuses a Markdown file that is not a loaded skill", async () => {
  const outsidePath = join(root, "outside.md");
  await writeFile(outsidePath, "# not a skill\n");

  const response = await getContent(outsidePath);
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "Skill not found" });
});

test("requires both the working directory and skill path", async () => {
  const withoutCwd = await GET(new Request(`http://localhost/api/skills/content?filePath=${encodeURIComponent(skillPath)}`));
  const withoutFile = await GET(new Request(`http://localhost/api/skills/content?cwd=${encodeURIComponent(process.cwd())}`));
  assert.equal(withoutCwd.status, 400);
  assert.equal(withoutFile.status, 400);
});
