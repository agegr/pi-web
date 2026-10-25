import assert from "node:assert/strict";
import { join } from "node:path";

/** Exercise real chat rendering/polling with synthetic run ids, never dispatch a model. */
export async function checkSubagentStatus(page, { base, sessionId, artifacts, width }) {
  const listRoute = (url) => url.pathname === "/api/sessions";
  const runningRoute = (url) => url.pathname === "/api/agent/running";
  const descriptions = ["Check configuration", "Read logs", `Verify ${"long-task-".repeat(50)}`];
  const ids = ["e2e-child-config", "e2e-child-logs", "e2e-child-nested"];
  let running = [...ids];
  await page.route(listRoute, async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    const main = data.sessions.find((session) => session.id === sessionId);
    assert.ok(main);
    data.sessions.push(...ids.map((id, index) => ({
      ...main, id, name: undefined, path: `${main.cwd}/${id}.jsonl`, firstMessage: descriptions[index],
      parentSessionId: index === 2 ? ids[0] : sessionId,
      relation: {
        kind: "subagent", parentSessionId: index === 2 ? ids[0] : sessionId,
        profile: "explore", description: descriptions[index], status: "running",
      },
    })));
    data.runningSessionIds = running;
    await route.fulfill({ response, json: data });
  });
  await page.route(runningRoute, async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...await response.json(), runningSessionIds: running } });
  });
  const status = page.getByRole("status").filter({ hasText: "subagent" });
  try {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto(`${base}/?session=${sessionId}`, { waitUntil: "domcontentloaded" });
    await status.filter({ hasText: "3 subagents running" }).waitFor();
    assert.equal(await status.textContent(), `3 subagents running (${descriptions.join(", ")})`);
    const spinner = status.locator("svg");
    assert.equal(await spinner.count(), 1);
    assert.equal(await spinner.locator("rect").count(), 4);
    assert.equal(await spinner.getAttribute("aria-hidden"), "true");
    assert.equal(await spinner.evaluate((element) => getComputedStyle(element).animationName), "spin");
    assert.equal(await spinner.evaluate((element) => getComputedStyle(element).animationDuration), "2.4s");
    const initialTransform = await spinner.evaluate((element) => getComputedStyle(element).transform);
    await page.waitForFunction((initial) => {
      const icon = document.querySelector('[role="status"] svg');
      return icon && getComputedStyle(icon).transform !== initial;
    }, initialTransform);
    await page.emulateMedia({ reducedMotion: "reduce" });
    assert.equal(await spinner.evaluate((element) => getComputedStyle(element).animationName), "none");
    await page.emulateMedia({ reducedMotion: "no-preference" });
    // The parent is idle and Agents was never opened; a nested child still counts.
    assert.equal(await page.getByText("Waiting for model...", { exact: true }).count(), 0);
    await status.scrollIntoViewIfNeeded();
    const bounds = await status.boundingBox();
    assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width,
      "Long descriptions wrap within the chat on desktop and phone");
    assert.ok(await status.evaluate((element) => element.scrollWidth <= element.clientWidth + 1));
    assert.equal(await spinner.evaluate((element) => getComputedStyle(element).width), "16px",
      "The icon does not shrink beside long descriptions");
    await page.screenshot({ path: join(artifacts, `subagent-status-${width}.png`) });

    running = ids.slice(1);
    await status.filter({ hasText: "2 subagents running" }).waitFor();
    assert.equal(await status.textContent(), `2 subagents running (${descriptions.slice(1).join(", ")})`);
    running = [ids[2]];
    await status.filter({ hasText: "1 subagent running" }).waitFor();
    assert.equal(await status.textContent(), `1 subagent running (${descriptions[2]})`);
    running = [];
    await status.waitFor({ state: "detached" });

    running = [ids[0], ids[1]];
    for (const [locale, text] of [
      ["zh-CN", "有 2 个子代理正在运行（Check configuration、Read logs）"],
      ["zh-TW", "有 2 個子代理正在執行（Check configuration、Read logs）"],
    ]) {
      await page.evaluate((value) => localStorage.setItem("pi-locale", value), locale);
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.getByRole("status").filter({ hasText: text }).waitFor();
    }
    console.log(`PASS: ${width}px running subagents, four-square rotation, reduced motion, poll removal, wrapping and Chinese locales`);
  } finally {
    await page.unroute(listRoute);
    await page.unroute(runningRoute);
    await page.emulateMedia({ reducedMotion: null });
    await page.evaluate(() => localStorage.setItem("pi-locale", "en"));
    await page.goto(`${base}/?session=${sessionId}`, { waitUntil: "domcontentloaded" });
  }
}
