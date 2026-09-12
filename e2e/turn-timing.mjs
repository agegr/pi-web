import assert from "node:assert/strict";
import { join } from "node:path";

const PROCESS = "e2e-turn-timing-process";
const PLAIN = "e2e-turn-timing-plain";
const USER_ONLY = "e2e-turn-timing-user-only";
const FAILURE = "e2e-turn-timing-failure";
const ABORTED = "e2e-turn-timing-aborted";
const PAGED = "e2e-turn-timing-paged";
const LIVE = "e2e-turn-timing-live";
const LEGACY = "e2e-turn-timing-legacy";

function message(id, parentId, role, content, timestamp, extra = {}) {
  return {
    type: "message",
    id,
    parentId,
    timestamp,
    message: { role, content, timestamp: Date.parse(timestamp), ...extra },
  };
}

function timing(id, parentId, anchorEntryId, startedAt) {
  return {
    type: "custom",
    id: `${id}-timing`,
    parentId,
    timestamp: new Date(startedAt + 222_000).toISOString(),
    customType: "pi-web:turn-timing",
    data: {
      version: 1,
      id: `${id}-run`,
      startedAt,
      endedAt: startedAt + 222_000,
      anchorEntryId,
    },
  };
}

export function seedTurnTiming(writeSession, timestamp) {
  const startedAt = Date.parse(timestamp);
  const prompt = (id, text = "Create a small offline bicycle animation") =>
    message(`${id}-user`, null, "user", text, timestamp);
  const answer = (id) => message(
    `${id}-answer`,
    `${id}-user`,
    "assistant",
    [{ type: "text", text: "The bicycle animation is ready." }],
    timestamp,
    { provider: "test", model: "timer" },
  );

  const processUser = prompt(PROCESS);
  const processStep = message(
    `${PROCESS}-step`,
    processUser.id,
    "assistant",
    [{ type: "thinking", thinking: "Plan the motion path." }],
    timestamp,
    { provider: "test", model: "timer" },
  );
  const processAnswer = { ...answer(PROCESS), parentId: processStep.id };
  writeSession(PROCESS, [
    processUser,
    processStep,
    processAnswer,
    timing(PROCESS, processAnswer.id, processAnswer.id, startedAt),
  ]);

  const plainUser = prompt(PLAIN);
  const plainAnswer = answer(PLAIN);
  writeSession(PLAIN, [plainUser, plainAnswer, timing(PLAIN, plainAnswer.id, plainAnswer.id, startedAt)]);

  const userOnly = prompt(USER_ONLY, "Stop before the assistant replies");
  writeSession(USER_ONLY, [userOnly, timing(USER_ONLY, userOnly.id, userOnly.id, startedAt)]);

  const failureUser = prompt(FAILURE, "Trigger a provider failure");
  const failureAnswer = message(
    `${FAILURE}-answer`,
    failureUser.id,
    "assistant",
    [],
    timestamp,
    { provider: "test", model: "timer", stopReason: "error", errorMessage: "Provider unavailable" },
  );
  writeSession(FAILURE, [failureUser, failureAnswer, timing(FAILURE, failureAnswer.id, failureAnswer.id, startedAt)]);

  const abortedUser = prompt(ABORTED, "Stop before any response text");
  const abortedAnswer = message(
    `${ABORTED}-answer`,
    abortedUser.id,
    "assistant",
    [],
    timestamp,
    { provider: "test", model: "timer", stopReason: "aborted" },
  );
  writeSession(ABORTED, [abortedUser, abortedAnswer, timing(ABORTED, abortedAnswer.id, abortedAnswer.id, startedAt)]);

  const paged = [prompt(PAGED, "Prompt outside the first history page")];
  for (let index = 0; index < 50; index += 1) {
    const id = `${PAGED}-answer-${index}`;
    paged.push(message(
      id,
      paged.at(-1).id,
      "assistant",
      [{ type: "text", text: `Paged assistant ${index}` }],
      timestamp,
      { provider: "test", model: "timer" },
    ));
  }
  const pagedAnswer = paged.at(-1);
  paged.push(timing(PAGED, pagedAnswer.id, pagedAnswer.id, startedAt));
  writeSession(PAGED, paged);

  writeSession(LIVE, [prompt(LIVE, "Show a running timer")]);
  writeSession(LEGACY, [prompt(LEGACY), answer(LEGACY)]);
  return [PROCESS, PLAIN, USER_ONLY, FAILURE, ABORTED, PAGED, LIVE, LEGACY];
}

export async function checkTurnTiming({ page, base, artifacts, width }) {
  await page.setViewportSize({ width, height: width > 600 ? 800 : 844 });
  const liveTiming = { id: `live-${width}`, startedAt: Date.now() - 83_000, anchorEntryId: `${LIVE}-user` };
  const liveState = {
    running: true,
    state: { isStreaming: true, isPromptRunning: true, turnTiming: liveTiming },
  };
  const stateRoute = `**/api/sessions/${LIVE}/state`;
  const agentRoute = `**/api/agent/${LIVE}`;
  const eventsRoute = `**/api/agent/${LIVE}/events`;
  await page.route(stateRoute, (route) => route.fulfill({ json: liveState }));
  await page.route(agentRoute, (route) => route.fulfill({ json: liveState }));
  await page.route(eventsRoute, (route) => route.fulfill({
    contentType: "text/event-stream",
    body: `data: ${JSON.stringify({ type: "connected", sessionId: LIVE, isStreaming: true, turnTiming: liveTiming })}\n\n`,
  }));
  await page.goto(`${base}/?session=${LIVE}&sidebar=collapsed`, { waitUntil: "domcontentloaded" });
  const running = page.getByText(/^Waiting for model.* · \d/);
  await running.waitFor();
  const before = await running.innerText();
  await page.waitForFunction((text) => !document.body.innerText.includes(text), before);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: join(artifacts, `turn-timing-running-${width}.png`) });
  await page.goto("about:blank");
  await page.unroute(eventsRoute);
  await page.unroute(agentRoute);
  await page.unroute(stateRoute);

  await page.goto(`${base}/?session=${PROCESS}&sidebar=collapsed`, { waitUntil: "domcontentloaded" });
  const process = page.getByRole("button", { name: /^Process details · Took 3m 42s/ });
  await process.waitFor();
  assert.equal(await process.getAttribute("aria-expanded"), "false");
  assert.equal(await page.getByText("Took 3m 42s", { exact: true }).count(), 1);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: join(artifacts, `turn-timing-process-${width}.png`) });

  await process.click();
  assert.equal(await process.getAttribute("aria-expanded"), "true");
  await page.getByText("Plan the motion path.", { exact: true }).waitFor();

  await page.goto(`${base}/?session=${PLAIN}&sidebar=collapsed`, { waitUntil: "domcontentloaded" });
  const plainAnswer = page.locator(`[data-entry-id="${PLAIN}-answer"]`);
  await plainAnswer.getByText("The bicycle animation is ready.", { exact: true }).waitFor();
  await plainAnswer.getByText("Took 3m 42s", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: /^Process details/ }).count(), 0);
  await page.reload();
  await plainAnswer.getByText("Took 3m 42s", { exact: true }).waitFor();

  await page.goto(`${base}/?session=${USER_ONLY}&sidebar=collapsed`, { waitUntil: "domcontentloaded" });
  const userOnly = page.locator(`[data-entry-id="${USER_ONLY}-user"]`);
  await userOnly.getByText("Took 3m 42s", { exact: true }).waitFor();

  await page.goto(`${base}/?session=${FAILURE}&sidebar=collapsed`, { waitUntil: "domcontentloaded" });
  const failureUser = page.locator(`[data-entry-id="${FAILURE}-user"]`);
  const failureAnswer = page.locator(`[data-entry-id="${FAILURE}-answer"]`);
  await failureAnswer.getByText("Provider unavailable", { exact: false }).waitFor();
  await failureUser.getByText("Took 3m 42s", { exact: true }).waitFor();
  assert.equal(await failureAnswer.getByText("Took 3m 42s", { exact: true }).count(), 0);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: join(artifacts, `turn-timing-failure-${width}.png`) });

  await page.goto(`${base}/?session=${ABORTED}&sidebar=collapsed`, { waitUntil: "domcontentloaded" });
  const abortedUser = page.locator(`[data-entry-id="${ABORTED}-user"]`);
  await abortedUser.getByText("Took 3m 42s", { exact: true }).waitFor();

  await page.goto(`${base}/?session=${PAGED}&sidebar=collapsed`, { waitUntil: "domcontentloaded" });
  assert.equal(await page.getByText("Prompt outside the first history page", { exact: true }).count(), 0);
  const pagedAnswer = page.locator(`[data-entry-id="${PAGED}-answer-49"]`);
  await pagedAnswer.getByText("Took 3m 42s", { exact: true }).waitFor();

  await page.goto(`${base}/?session=${LEGACY}&sidebar=collapsed`, { waitUntil: "domcontentloaded" });
  await page.getByText("The bicycle animation is ready.", { exact: true }).waitFor();
  assert.equal(await page.getByText(/^Took /).count(), 0);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  console.log(`PASS: ${width}px live, completed, process, failure, aborted, paged, user-only and legacy turn timing`);
}
