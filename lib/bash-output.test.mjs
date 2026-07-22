import assert from "node:assert/strict";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
async function loadSubject() {
  return jiti.import("./bash-output.ts");
}

test("accepts only pi bash logs directly inside the configured temp directory", async () => {
  const { resolveBashOutputPath } = await loadSubject();
  const tempRoot = "/tmp/pi-web-output-tests";

  assert.equal(
    resolveBashOutputPath(`${tempRoot}/pi-bash-ab12.log`, tempRoot),
    join(resolve(tempRoot), "pi-bash-ab12.log"),
  );
  assert.equal(resolveBashOutputPath(`${tempRoot}/../pi-bash-ab12.log`, tempRoot), null);
  assert.equal(resolveBashOutputPath(`${tempRoot}/pi-bash-ab12.log.bak`, tempRoot), null);
  assert.equal(resolveBashOutputPath(`${tempRoot}-other/pi-bash-ab12.log`, tempRoot), null);
});

test("reads small output and rejects oversized inline output before buffering it", async () => {
  const { readUtf8FileWithinLimit } = await loadSubject();
  const dir = await mkdtemp(join(tmpdir(), "pi-web-bash-output-"));
  const filePath = join(dir, "pi-bash-ab12.log");
  try {
    await writeFile(filePath, "shell output", "utf8");

    assert.deepEqual(await readUtf8FileWithinLimit(filePath, 32), {
      tooLarge: false,
      content: "shell output",
      size: 12,
    });
    assert.deepEqual(await readUtf8FileWithinLimit(filePath, 4), {
      tooLarge: true,
      size: 12,
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("rejects symbolic links when opening bash output", async () => {
  const { readUtf8FileWithinLimit } = await loadSubject();
  const dir = await mkdtemp(join(tmpdir(), "pi-web-bash-output-link-"));
  const targetPath = join(dir, "target.log");
  const linkPath = join(dir, "pi-bash-link.log");
  try {
    await writeFile(targetPath, "not authorized through a link", "utf8");
    try {
      await symlink(targetPath, linkPath);
    } catch (err) {
      if (err.code === "EPERM") return; // skip symlink test on Windows when non-admin
      throw err;
    }
    await assert.rejects(() => readUtf8FileWithinLimit(linkPath));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
