import assert from "node:assert/strict";
import { join } from "node:path";

const ID = "e2e-reply-thinking";
export function seedReplyThinking(writeSession, timestamp) {
  const entries = [];
  const append = (type, fields) => {
    const entry = { type, id: `r${entries.length}`, parentId: entries.at(-1)?.id ?? null, timestamp, ...fields };
    entries.push(entry);
    return entry;
  };
  for (const [level, label, text] of [
    ["high", "xhigh", "Mapped high answer"],
    ["high", "auto", "Automatic answer"],
    ["off", null, "Legacy disabled answer"],
  ]) {
    append("thinking_level_change", { thinkingLevel: level });
    append("message", { message: { role: "user", content: `Use ${level}` } });
    if (label) append("custom", { customType: "pi-web:message-thinking", data: { version: 1, label } });
    append("message", { message: { role: "assistant", provider: "test", model: "reasoner", content: [{ type: "text", text }] } });
  }
  writeSession(ID, entries);
  return [ID];
}

export async function checkReplyThinking({ page, base, artifacts, width }) {
  await page.setViewportSize({ width, height: width > 600 ? 800 : 844 });
  const check = async () => {
    for (const [level, text] of [["xhigh", "Mapped high answer"], ["auto", "Automatic answer"], ["off", "Legacy disabled answer"]]) {
      const message = page.locator('[data-message-role="assistant"]').filter({ hasText: text });
      await message.getByText(`test/reasoner · ${level}`, { exact: true }).waitFor();
    }
  };
  await page.goto(`${base}/?session=${ID}&sidebar=collapsed`);
  await check();
  await page.reload();
  await check();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: join(artifacts, `reply-thinking-${width}.png`) });
  console.log(`PASS: ${width}px per-reply thinking labels remain distinct after reload`);
}
