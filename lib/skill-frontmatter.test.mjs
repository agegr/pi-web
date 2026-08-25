import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseFrontmatter } from "@earendil-works/pi-coding-agent";

import { setDisableModelInvocation } from "./skill-frontmatter.ts";

describe("setDisableModelInvocation", () => {
  const withFrontmatter = "---\nname: my-skill\ndescription: Does things\n---\n\nBody text.\n";

  it("adds the key after the opening fence when absent", () => {
    const updated = setDisableModelInvocation(withFrontmatter, true);
    assert.equal(
      updated,
      "---\ndisable-model-invocation: true\nname: my-skill\ndescription: Does things\n---\n\nBody text.\n",
    );
    assert.equal(parseFrontmatter(updated).frontmatter["disable-model-invocation"], true);
  });

  it("creates a frontmatter block when the file has none", () => {
    const updated = setDisableModelInvocation("Just a body.\n", true);
    const { frontmatter, body } = parseFrontmatter(updated);
    assert.equal(frontmatter["disable-model-invocation"], true);
    assert.equal(body, "Just a body.");
  });

  it("replaces an explicit false value instead of adding a duplicate key", () => {
    const content = "---\nname: my-skill\ndisable-model-invocation: false\ndescription: Does things\n---\n\nBody text.\n";
    const updated = setDisableModelInvocation(content, true);
    // A duplicate key would make the whole file unparseable and the loader
    // would drop the skill, so this must parse to a single true value.
    const { frontmatter } = parseFrontmatter(updated);
    assert.equal(frontmatter["disable-model-invocation"], true);
    assert.equal(
      updated.match(/^disable-model-invocation[^\n]*/gm)?.length,
      1,
      "must not emit a duplicate key",
    );
  });

  it("updates and removes indented quoted keys", () => {
    for (const quote of ['"', "'"]) {
      const content = `---\n  name: my-skill\n  ${quote}disable-model-invocation${quote}: false\n---\nBody text.\n`;
      const updated = setDisableModelInvocation(content, true);
      assert.equal(parseFrontmatter(updated).frontmatter["disable-model-invocation"], true);
      assert.equal(
        parseFrontmatter(setDisableModelInvocation(updated, false)).frontmatter["disable-model-invocation"],
        undefined,
      );
    }
  });

  it("rejects unsupported key formatting instead of silently succeeding", () => {
    const content = "---\n{ disable-model-invocation: false, name: my-skill }\n---\nBody text.\n";
    assert.throws(() => setDisableModelInvocation(content, true), /unsupported frontmatter formatting/);
  });

  it("preserves CRLF line endings when updating or adding the key", () => {
    const content = "---\r\nname: my-skill\r\ndisable-model-invocation: false\r\n---\r\nBody text.\r\n";
    assert.equal(
      setDisableModelInvocation(content, true),
      "---\r\nname: my-skill\r\ndisable-model-invocation: true\r\n---\r\nBody text.\r\n",
    );
    assert.equal(
      setDisableModelInvocation(content.replace("disable-model-invocation: false\r\n", ""), true),
      "---\r\ndisable-model-invocation: true\r\nname: my-skill\r\n---\r\nBody text.\r\n",
    );
  });

  it("keeps a single key when disabling an already-true skill", () => {
    const content = "---\nname: my-skill\ndisable-model-invocation: true\ndescription: Does things\n---\n\nBody text.\n";
    const updated = setDisableModelInvocation(content, true);
    assert.equal(parseFrontmatter(updated).frontmatter["disable-model-invocation"], true);
    assert.equal(updated.match(/^disable-model-invocation[^\n]*/gm)?.length, 1);
  });

  it("removes the key when disabling is turned off", () => {
    const content = "---\nname: my-skill\ndisable-model-invocation: true\ndescription: Does things\n---\n\nBody text.\n";
    const updated = setDisableModelInvocation(content, false);
    assert.deepEqual(parseFrontmatter(updated).frontmatter, {
      name: "my-skill",
      description: "Does things",
    });
  });

  it("removes the key when it is the last frontmatter line before the closing fence", () => {
    const content = "---\nname: my-skill\ndescription: Does things\ndisable-model-invocation: true\n---\n\nBody text.\n";
    const updated = setDisableModelInvocation(content, false);
    assert.equal(updated, withFrontmatter);
  });

  it("is a no-op when disabling is off and the key is absent", () => {
    assert.equal(setDisableModelInvocation(withFrontmatter, false), withFrontmatter);
  });

  it("preserves unrelated frontmatter formatting and body lines that mention the key", () => {
    const content = "---\nname: my-skill\n# comment\nallowed-tools: [ read, write ]\ndisable-model-invocation: false\n---\nUse `disable-model-invocation: true` to hide me.\n";
    const updated = setDisableModelInvocation(content, true);
    const { frontmatter, body } = parseFrontmatter(updated);
    assert.equal(frontmatter["disable-model-invocation"], true);
    assert.deepEqual(frontmatter["allowed-tools"], ["read", "write"]);
    assert.match(updated, /# comment/);
    assert.equal(body, "Use `disable-model-invocation: true` to hide me.");
  });
});
