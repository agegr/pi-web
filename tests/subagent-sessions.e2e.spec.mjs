// Browser coverage for the visual subagent sessions feature.
//
// Spins up the Vite dev server against an isolated PI_CODING_AGENT_DIR whose
// fake global extension implements the subagent RPC v1 protocol, then asserts
// the tree popover, same-page navigation, read-only child transcript, and
// steer/interrupt/resume controls.
import { test, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";

import {
  createSubagentFixture,
  liveEntries,
  FAKE_ROOT_ID,
  FAKE_CHILD_ID,
  FAKE_GRAND_ID,
} from "./fixtures/subagent-sessions.mjs";

test.setTimeout(180_000);

let server;
let origin;
let fixture;
let serverPromise;

async function waitForViteReady(child) {
  return new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error(`vite did not start: ${output.slice(0, 2000)}`)), 120_000);
    child.stdout.on("data", (chunk) => {
      output += String(chunk);
      // Vite colors its banner with ANSI codes that split the URL digits.
      const plain = output.replace(/\u001b\[[0-9;]*m/g, "");
      const match = plain.match(/Local:\s+(http:\/\/127\.0\.0\.1:\d+\/)/);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
    child.stderr.on("data", (chunk) => { output += String(chunk); });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`vite exited early (${code}): ${output.slice(0, 2000)}`));
    });
  });
}

async function ensureServer() {
  if (serverPromise) return serverPromise;
  serverPromise = (async () => {
        fixture = createSubagentFixture();
        fixture.setState({ mode: "running", entries: liveEntries({ mode: "running" }) });
    server = spawn(process.execPath, [
      "node_modules/vite/bin/vite.js",
      "dev",
      "--configLoader", "runner",
      "--config", "vite.tanstack.config.ts",
      "--host", "127.0.0.1",
      "--port", "31741",
      "--strictPort",
    ], {
      cwd: process.cwd(),
      env: { ...process.env, PI_CODING_AGENT_DIR: fixture.agentDir, PI_WEB_PASSWORD: "" },
      stdio: ["ignore", "pipe", "pipe"],
    });
        return waitForViteReady(server);
  })();
  origin = await serverPromise;
  return origin;
}

test.beforeAll(async () => {
  await ensureServer();
});

test.afterAll(async () => {
  server?.kill();
});

async function openRootSession(page) {
  await page.goto(`${origin}/?session=${FAKE_ROOT_ID}`);
  await expect(page.getByText("Main e2e task").first()).toBeVisible({ timeout: 60_000 });
}

test("root is visible in the sidebar while child sessions stay hidden", async ({ page }) => {
  await openRootSession(page);
  // The sidebar lists the root session.
  await expect(page.locator(".codex-sidebar")).toContainText("Main e2e task");
  // Official subagent sessions are hidden from the sidebar inventory.
  await expect(page.locator(".codex-sidebar")).not.toContainText("subagent-worker-317e1ca0");
});

test("tree GET starts the root wrapper without a prompt and reports live rpc", async ({ page }) => {
  await openRootSession(page);
  const response = await page.request.get(`${origin}/api/agent/${FAKE_ROOT_ID}/subagents`);
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body.rpcAvailable).toBe(true);
  expect(body.nodes.length).toBe(1);
  expect(body.nodes[0].sessionId).toBe(FAKE_CHILD_ID);
  expect(body.nodes[0].children.length).toBe(1);
  expect(body.nodes[0].children[0].sessionId).toBe(FAKE_GRAND_ID);
});

test("subagent trigger opens a fixed overlay without moving the transcript", async ({ page }) => {
  await openRootSession(page);
  const workspace = page.locator(".app-center-column");
  const before = await workspace.boundingBox();
  await page.getByRole("button", { name: /Subagents/ }).click();
  await expect(page.locator('[data-subagent-popover="true"] [role="tree"]')).toBeVisible();
  const after = await workspace.boundingBox();
  expect(after).toEqual(before);
});

test("tree shows the nested child with task, state, activity, and elapsed time", async ({ page }) => {
  await openRootSession(page);
  await page.getByRole("button", { name: /Subagents/ }).click();
  const tree = page.locator('[data-subagent-popover="true"] [role="tree"]');
  await expect(tree).toContainText("subagent-worker-317e1ca0-1");
  await expect(tree).toContainText("subagent-reviewer-76fa6d64");
  await expect(tree).toContainText("Running");
  await expect(tree).toContainText("bash");
});

test("selecting the grandchild shows the full breadcrumb and highlights the tree row", async ({ page }) => {
  await openRootSession(page);
  await page.getByRole("button", { name: /Subagents/ }).click();
  await page.locator('[data-subagent-popover="true"]').getByRole("treeitem", { name: /subagent-reviewer-76fa6d64/ }).click();
  await expect(page.getByRole("navigation", { name: "Subagent breadcrumb" })).toContainText("Main e2e task");
  await expect(page.getByRole("navigation", { name: "Subagent breadcrumb" })).toContainText("subagent-worker-317e1ca0-1");
  await expect(page.getByRole("navigation", { name: "Subagent breadcrumb" })).toContainText("subagent-reviewer-76fa6d64");
  // The tree stays open on desktop and highlights the selected row.
  await expect(page.locator('[data-subagent-popover="true"] [aria-current="true"]')).toContainText("subagent-reviewer-76fa6d64");
});

test("a selected child never hits its state, agent, or SSE endpoints", async ({ page }) => {
  await openRootSession(page);
  const childRequests = [];
  page.on("request", (request) => {
    const url = request.url();
    if (url.includes(`/api/sessions/${FAKE_CHILD_ID}`) || url.includes(`/api/agent/${FAKE_CHILD_ID}`)) {
      childRequests.push(url);
    }
  });
  await page.getByRole("button", { name: /Subagents/ }).click();
  await page.locator('[data-subagent-popover="true"]').getByRole("treeitem", { name: /subagent-worker-317e1ca0-1/ }).click();
  await expect(page.getByText("Implementing now.").first()).toBeVisible();
  await page.waitForTimeout(4_000); // cover the polling window
  expect(childRequests.filter((url) => url.endsWith("/state") || url.includes("/events"))).toEqual([]);
  expect(childRequests.filter((url) => url.includes(`/api/agent/${FAKE_CHILD_ID}`))).toEqual([]);
});

test("appending to the child jsonl appears on the read-only transcript", async ({ page }) => {
  await openRootSession(page);
  await page.getByRole("button", { name: /Subagents/ }).click();
  await page.locator('[data-subagent-popover="true"]').getByRole("treeitem", { name: /subagent-worker-317e1ca0-1/ }).click();
  await expect(page.getByText("Implementing now.").first()).toBeVisible();

  const childFile = fixture.sessionFilePath(FAKE_CHILD_ID);
  const lines = readFileSync(childFile, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  const lastEntry = lines[lines.length - 1];
  appendFileSync(childFile, JSON.stringify({
    type: "message",
    id: "e2e-appended-1",
    parentId: lastEntry.id,
    timestamp: new Date().toISOString(),
    message: { role: "assistant", content: [{ type: "text", text: "Appended by the fixture." }], timestamp: Date.now() },
  }) + "\n", "utf8");

  await expect(page.getByText("Appended by the fixture.").first()).toBeVisible({ timeout: 30_000 });
});

test("active composer steers through the root endpoint and preserves drafts on rejection", async ({ page }) => {
  await openRootSession(page);
  await page.getByRole("button", { name: /Subagents/ }).click();
  await page.locator('[data-subagent-popover="true"]').getByRole("treeitem", { name: /subagent-worker-317e1ca0-1/ }).click();
  const composer = page.getByRole("textbox", { name: /steering message/ });
  await composer.fill("keep going");

  // Rejected control preserves the draft and shows the error.
  fixture.setState({ mode: "reject-steer", entries: liveEntries({ mode: "running" }) });
  await composer.press("Enter");
  await expect(page.getByRole("alert")).toContainText("steer rejected");
  await expect(composer).toHaveValue("keep going");

  // Accepted control clears the draft and records the RPC call.
  fixture.setState({ mode: "running", entries: liveEntries({ mode: "running" }) });
  await composer.press("Enter");
  await expect(composer).toHaveValue("");
  await expect.poll(() => fixture.readLog().some((entry) => entry.method === "steer" && entry.params?.runId === "317e1ca0")).toBe(true);
});

test("stop sends interrupt to paused and resume returns to running", async ({ page }) => {
  await openRootSession(page);
  await page.getByRole("button", { name: /Subagents/ }).click();
  await page.locator('[data-subagent-popover="true"]').getByRole("treeitem", { name: /subagent-worker-317e1ca0-1/ }).click();

  await page.getByRole("button", { name: "Pause this subagent (resumable)" }).click();
  await expect.poll(() => fixture.readLog().some((entry) => entry.method === "interrupt")).toBe(true);

  // The fake extension flips its state to paused; the polled tree follows and
  // the composer switches to resume mode (the popover closes on outside click).
  const resume = page.getByRole("textbox", { name: /Continue with a message/ });
  await expect(resume).toBeVisible({ timeout: 15_000 });
  await resume.fill("carry on");
  await resume.press("Enter");
  await expect.poll(() => fixture.readLog().some((entry) => entry.method === "resume")).toBe(true);
  await expect(page.getByRole("textbox", { name: /steering message/ })).toBeVisible({ timeout: 15_000 });
});

test("incompatible capability keeps historical browsing and disables controls", async ({ page }) => {
  await openRootSession(page);
  fixture.setState({ mode: "incompatible", entries: [] });
  await page.getByRole("button", { name: /Subagents/ }).click();
  await expect(page.locator('[data-subagent-popover="true"] [role="tree"]')).toBeVisible();
  await expect(page.locator('[data-subagent-popover="true"] [role="tree"]')).toContainText("subagent-worker-317e1ca0-1");
  // Durable-only nodes are inactive and read-only.
  await expect(page.locator('[data-subagent-popover="true"] [role="tree"]')).toContainText("Inactive");
  await page.locator('[data-subagent-popover="true"]').getByRole("treeitem", { name: /subagent-worker-317e1ca0-1/ }).click();
  await expect(page.getByRole("textbox")).toHaveCount(0);
  await expect(page.getByText("Live controls are unavailable for this session.")).toBeVisible();
});

test("escape closes the popover and returns focus to the trigger", async ({ page }) => {
  await openRootSession(page);
  const trigger = page.getByRole("button", { name: /Subagents/ });
  await trigger.click();
  await expect(page.locator('[data-subagent-popover="true"] [role="tree"]')).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-subagent-popover="true"] [role="tree"]')).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("desktop layout has no overlap or horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openRootSession(page);
  await page.getByRole("button", { name: /Subagents/ }).click();
  await expect(page.locator('[data-subagent-popover="true"] [role="tree"]')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const treeBox = await page.locator('[data-subagent-popover="true"] [role="tree"]').boundingBox();
  expect(treeBox.x + treeBox.width).toBeLessThanOrEqual(1440);
  expect(treeBox.y).toBeGreaterThanOrEqual(0);
  await page.screenshot({ path: "tests/test-output/subagents-desktop.png", fullPage: true });
});

test("wide desktop shows the right-gutter subagent card below conversation context", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openRootSession(page);
  const card = page.locator('[data-subagent-card="true"]');
  await expect(card).toBeVisible();
  await expect(card.locator('[role="tree"]')).toBeVisible();
  await expect(card).toContainText("subagent-worker-317e1ca0-1");
  await expect(page.locator(".desktop-conversation-context")).toBeVisible();
  // Conversation context renders above the subagent card in the stack.
  const contextBox = await page.locator(".desktop-conversation-context").boundingBox();
  const cardBox = await card.boundingBox();
  expect(contextBox.y + contextBox.height).toBeLessThanOrEqual(cardBox.y + 1);
});

test("card row navigates to the read-only child transcript without a child runtime", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  fixture.setState({ mode: "running", entries: liveEntries({ mode: "running" }) });
  await openRootSession(page);
  const childRequests = [];
  page.on("request", (request) => {
    const url = request.url();
    if (url.includes(`/api/sessions/${FAKE_CHILD_ID}`) || url.includes(`/api/agent/${FAKE_CHILD_ID}`)) {
      childRequests.push(url);
    }
  });
  await page.locator('[data-subagent-card="true"] [data-subagent-card-row]').first().click();
  await expect(page.getByRole("navigation", { name: "Subagent breadcrumb" })).toContainText("Main e2e task", { timeout: 30_000 });
  // The transcript is lazy-windowed from the tail, so assert the mounted
  // read-only composer instead of a specific early message (later tests append
  // to the fixture jsonl).
  await expect(page.getByRole("textbox", { name: /steering message/ })).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(4_000); // cover the polling window
  expect(childRequests.filter((url) => url.endsWith("/state") || url.includes("/events"))).toEqual([]);
  expect(childRequests.filter((url) => url.includes(`/api/agent/${FAKE_CHILD_ID}`))).toEqual([]);
});

test("mobile hides the right-gutter card and keeps the top entry", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openRootSession(page);
  await expect(page.locator('[data-subagent-card="true"]')).not.toBeVisible();
  await page.getByRole("button", { name: /More controls/ }).click();
  await page.getByRole("button", { name: /Subagents/ }).click();
  await expect(page.locator('[data-subagent-popover="true"] [role="tree"]')).toBeVisible();
});

test("mobile layout constrains the popover to the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openRootSession(page);
  // The mobile toolbar holds the subagent action behind the More menu.
  await page.getByRole("button", { name: /More controls/ }).click();
  await page.getByRole("button", { name: /Subagents/ }).click();
  await expect(page.locator('[data-subagent-popover="true"] [role="tree"]')).toBeVisible();
  const treeBox = await page.locator('[data-subagent-popover="true"] [role="tree"]').boundingBox();
  expect(treeBox.x).toBeGreaterThanOrEqual(0);
  expect(treeBox.x + treeBox.width).toBeLessThanOrEqual(390);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.screenshot({ path: "tests/test-output/subagents-mobile.png", fullPage: true });
});
