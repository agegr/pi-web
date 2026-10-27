import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const emptyQueue = () => ({ steering: [], followUp: [] });
const queued = (steering, followUp = 0) => ({
  steering: Array.from({ length: steering }, (_, i) => `Queued steer ${i + 1}`),
  followUp: Array.from({ length: followUp }, (_, i) => `Queued follow-up ${i + 1}`),
});
const viewports = [
  { width: 1280, height: 600 },
  { width: 1366, height: 768 },
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
];

// Render the real chat and composer. Only the agent transport/catalog are
// synthetic: no prompt, abort or queue command can reach an AgentSession.
export async function checkQueuedMessages({ browser, base, artifacts, sessionId }) {
  for (const viewport of viewports) {
    const mobile = viewport.width <= 640;
    const label = `${viewport.width}x${viewport.height}`;
    const context = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, locale: "en-US", reducedMotion: "reduce" });
    await context.tracing.start({ screenshots: true, snapshots: true });
    const page = await context.newPage();
    page.setDefaultTimeout(30_000);
    const errors = [];
    const commands = [];
    let queue = emptyQueue();
    let running = true;
    let modelError = null;
    let modelScopeWarnings = [];
    const state = () => ({ running, state: {
      isStreaming: running, isPromptRunning: running, queuedMessages: queue,
      model: { provider: "e2e", id: "queue-model" }, thinkingLevel: "medium",
    } });
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (event) => { if (event.type() === "error") errors.push(event.text()); });
    await page.route("**/api/agent/**", async (route) => {
      const request = route.request();
      const { pathname } = new URL(request.url());
      if (pathname === "/api/agent/running") {
        return route.fulfill({ json: { runningSessionIds: running ? [sessionId] : [], version: 1 } });
      }
      if (pathname === `/api/agent/${sessionId}/lease`) return route.fulfill({ json: { running } });
      if (pathname !== `/api/agent/${sessionId}`) {
        errors.push(`unexpected agent request: ${pathname}`);
        return route.fulfill({ status: 400, json: { error: "Unexpected fixture request" } });
      }
      if (request.method() === "GET") return route.fulfill({ json: state() });
      const command = request.postDataJSON();
      if (command.type === "get_tools") return route.fulfill({ json: { success: true, data: [] } });
      if (command.type === "get_state") return route.fulfill({ json: { success: true, data: state().state } });
      if (command.type === "get_commands") return route.fulfill({ json: { success: true, data: { commands: [] } } });
      commands.push(command);
      if (!["prompt", "clear_queue", "abort"].includes(command.type)) {
        errors.push(`unexpected command: ${command.type}`);
        return route.fulfill({ status: 400, json: { error: "Unexpected fixture command" } });
      }
      if (command.type === "clear_queue") {
        const recalled = queue;
        queue = emptyQueue();
        return route.fulfill({ json: { success: true, data: recalled } });
      }
      return route.fulfill({ json: { success: true } });
    });
    await page.route(`**/api/sessions/${sessionId}/state`, (route) => route.fulfill({ json: state() }));
    await page.route(/\/api\/models(?:\?|$)/, (route) => route.fulfill({ json: {
      models: { "e2e/queue-model": "Queue fixture model" },
      modelList: [{ provider: "e2e", id: "queue-model", name: "Queue fixture model" }],
      defaultModel: { provider: "e2e", modelId: "queue-model" },
      modelError, modelScopeWarnings,
    } }));
    await page.addInitScript(({ sessionId }) => {
      const NativeEventSource = window.EventSource;
      const sources = new Set();
      window.EventSource = class extends EventTarget {
        constructor(url, options) {
          super();
          if (new URL(url, location.href).pathname !== `/api/agent/${sessionId}/events`) {
            return new NativeEventSource(url, options);
          }
          this.readyState = 1;
          sources.add(this);
          setTimeout(() => this.onmessage?.(new MessageEvent("message", {
            data: JSON.stringify({ type: "connected", isStreaming: true }),
          })), 0);
        }
        close() { this.readyState = 2; sources.delete(this); }
      };
      window.__queueEvent = (event) => {
        for (const source of sources) source.onmessage?.(new MessageEvent("message", { data: JSON.stringify(event) }));
      };
    }, { sessionId });

    const input = page.locator("textarea.chat-input-textarea");
    const more = page.locator(".chat-input-shell").getByRole("button", { name: "More controls", exact: true });
    const recall = page.getByRole("button", { name: "Recall to input", exact: true });
    const panel = recall.locator("..").locator("..");
    const rows = panel.locator("div[title]");
    const emit = (event) => page.evaluate((event) => window.__queueEvent(event), event);
    const clickCommand = async (control) => {
      const response = page.waitForResponse((response) => new URL(response.url()).pathname === `/api/agent/${sessionId}`
        && response.request().method() === "POST");
      await control.click();
      assert.ok((await response).ok());
    };
    const setQueue = async (next) => {
      queue = next;
      await emit({ type: "queue_update", ...queue });
      if (queue.steering.length + queue.followUp.length) {
        await panel.getByText(`Queued · ${queue.steering.length + queue.followUp.length}`, { exact: true }).waitFor();
        assert.deepEqual(await rows.evaluateAll((rows) => rows.map((row) => row.title)), [...queue.steering, ...queue.followUp]);
      } else {
        await recall.waitFor({ state: "detached" });
        assert.equal(await page.locator(".chat-queued-messages").count(), 0, "empty queue has no extra container");
      }
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    };
    const accessible = async (control, name) => {
      const geometry = await control.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const viewport = window.visualViewport;
        const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        return {
          top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right,
          width: rect.width, height: rect.height,
          viewportTop: viewport.offsetTop, viewportBottom: viewport.offsetTop + viewport.height,
          viewportWidth: viewport.width, uncovered: !!hit && element.contains(hit),
        };
      });
      assert.ok(geometry.width > 0 && geometry.height > 0, `${name} must be rendered: ${JSON.stringify(geometry)}`);
      assert.ok(geometry.top >= geometry.viewportTop - 1 && geometry.bottom <= geometry.viewportBottom + 1,
        `${name} must fit the visible viewport: ${JSON.stringify(geometry)}`);
      assert.ok(geometry.left >= 0 && geometry.right <= geometry.viewportWidth + 1, `${name} must fit horizontally`);
      assert.ok(geometry.uncovered, `${name} must not be covered by another layer`);
    };
    const composer = async () => {
      await accessible(input, "textarea");
      await accessible(page.getByRole("button", { name: "Steer", exact: true }), "Steer");
      await accessible(page.getByRole("button", { name: "Follow-up", exact: true }), "Follow-up");
      if (mobile && await more.isVisible()) {
        await accessible(more, "More controls");
        const keyboardOpen = await page.evaluate(() => !!document.documentElement.dataset.keyboardOpen);
        await more.click();
        if (keyboardOpen) {
          await input.focus();
          await page.waitForFunction(() => document.documentElement.dataset.keyboardOpen === "true");
        }
      }
      await accessible(page.getByRole("button", { name: "Stop", exact: true }), "Stop");
      if (await recall.count()) await accessible(recall, "Recall to input");
      assert.equal(await page.evaluate(() => document.scrollingElement.scrollHeight <= document.scrollingElement.clientHeight + 1),
        true, "the page must not gain vertical scrolling");
    };
    const saveLayout = async (name) => {
      await page.screenshot({ path: join(artifacts, `${name}-${label}.png`) });
      const layout = await page.evaluate(() => {
        const bounds = (element) => element?.getBoundingClientRect().toJSON();
        return {
          viewport: { width: innerWidth, height: innerHeight, visualHeight: visualViewport.height },
          composer: bounds(document.querySelector(".chat-input-shell")),
          textarea: bounds(document.querySelector("textarea.chat-input-textarea")),
          controls: bounds(document.querySelector(".chat-input-controls")),
          queue: bounds(document.querySelector(".chat-queued-messages")),
          scrollX, scrollY,
        };
      });
      writeFileSync(join(artifacts, `${name}-${label}.json`), JSON.stringify(layout, null, 2) + "\n");
    };
    const scrollQueue = async () => {
      const scroll = rows.first().locator("..");
      const dimensions = await scroll.evaluate((element) => ({ height: element.clientHeight, scroll: element.scrollHeight }));
      assert.ok(dimensions.height > 0 && dimensions.scroll > dimensions.height, "queued rows must overflow their own scroll area");
      const before = structuredClone(queue);
      const draft = await input.inputValue();
      await scroll.evaluate((element) => { element.scrollTop = 0; });
      await accessible(rows.first(), "first queued message");
      const box = await scroll.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.wheel(0, dimensions.scroll);
      await page.waitForFunction(() => {
        const element = document.querySelector(".chat-queued-rows");
        return element.scrollTop >= element.scrollHeight - element.clientHeight - 1;
      });
      await accessible(rows.last(), "last queued message");
      if (!mobile) {
        await scroll.focus();
        await scroll.press("Home");
        await page.waitForFunction(() => document.querySelector(".chat-queued-rows").scrollTop === 0);
        await accessible(rows.first(), "keyboard reaches the first queued message");
        await scroll.press("End");
        await page.waitForFunction(() => {
          const element = document.querySelector(".chat-queued-rows");
          return element.scrollTop >= element.scrollHeight - element.clientHeight - 1;
        });
        await accessible(rows.last(), "keyboard reaches the last queued message");
      }
      await accessible(recall, "queue header stays outside the scrolling rows");
      assert.deepEqual(queue, before, "scrolling must not change queued data");
      assert.equal(await input.inputValue(), draft, "scrolling must not change the draft");
    };

    const readDiagnostics = async () => {
      const draft = await input.inputValue();
      for (const body of [modelError, modelScopeWarnings.join("\n")]) {
        for (const last of [false, true]) {
          const geometry = await page.getByText(body, { exact: true }).evaluate((element, last) => {
            const alert = element.closest('[role="alert"]');
            alert.scrollTop = last ? alert.scrollHeight : 0;
            const text = element.firstChild;
            const start = last ? text.textContent.lastIndexOf("\n") + 1 : 0;
            const end = last ? text.length : text.textContent.indexOf("\n");
            const range = document.createRange();
            range.setStart(text, start);
            range.setEnd(text, end);
            const shelf = alert.parentElement;
            shelf.scrollTop += range.getBoundingClientRect().top - shelf.getBoundingClientRect().top - 2;
            const rect = range.getBoundingClientRect();
            const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
            return { top: rect.top, bottom: rect.bottom, height: visualViewport.height, uncovered: !!hit && element.contains(hit) };
          }, last);
          assert.ok(geometry.top >= 0 && geometry.bottom <= geometry.height && geometry.uncovered,
            `the ${last ? "last" : "first"} diagnostic line must be reachable: ${JSON.stringify(geometry)}`);
        }
      }
      const retry = page.getByText("— Synthetic retry: no provider request", { exact: true });
      for (const last of [false, true]) {
        const visible = await retry.evaluate((element, last) => {
          const text = last ? element.lastChild : element.firstChild;
          const range = document.createRange();
          range.setStart(text, last ? text.length - 1 : 0);
          range.setEnd(text, last ? text.length : 1);
          const shelf = element.closest(".chat-input-notices");
          shelf.scrollTop += range.getBoundingClientRect().top - shelf.getBoundingClientRect().top - 2;
          const rect = range.getBoundingClientRect();
          const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
          return !!hit && element.contains(hit) && rect.top >= 0 && rect.bottom <= visualViewport.height;
        }, last);
        assert.equal(visible, true, "the retry message must remain readable through scrolling");
      }
      await page.locator(".chat-input-notices").evaluate((element) => {
        element.scrollTop = 0;
        for (const alert of element.querySelectorAll('[role="alert"]')) alert.scrollTop = 0;
      });
      assert.equal(await input.inputValue(), draft, "reading diagnostics must not change the draft");
      await composer();
    };

    try {
      await page.goto(`${base}/?session=${sessionId}`, { waitUntil: "domcontentloaded" });
      await page.getByRole("button", { name: "Steer", exact: true }).waitFor();
      await page.evaluate(() => document.fonts.ready);
      const draft = "Keep this unsent draft";
      await input.fill(draft);
      await setQueue(emptyQueue());
      await composer();
      await setQueue(queued(3));
      await composer();
      assert.ok(await rows.first().locator("..").evaluate((element) => element.scrollHeight <= element.clientHeight), "three short rows need no scrolling");

      await setQueue(queued(19));
      await emit({ type: "auto_retry_start", attempt: 1, maxAttempts: 3, errorMessage: "Synthetic retry: no provider request" });
      await page.getByText("— Synthetic retry: no provider request", { exact: true }).waitFor();
      await saveLayout("queued-19-retry");
      await composer();
      await scrollQueue();
      assert.equal(await input.inputValue(), draft);
      console.log(`PASS: ${label} empty/3/19 queued messages with retry keep the composer accessible`);

      await emit({ type: "auto_retry_end" });
      await setQueue(queued(0, 50));
      await composer();
      await scrollQueue();
      await setQueue(queued(25, 25));
      await composer();
      await scrollQueue();
      assert.equal(await input.inputValue(), draft);

      // Real clicks with a long queue go through the unchanged client command
      // callbacks, but the route records them instead of running a model.
      await clickCommand(page.getByRole("button", { name: "Steer", exact: true }));
      await page.waitForFunction(() => document.querySelector("textarea.chat-input-textarea").value === "");
      await input.fill("A queued follow-up");
      await clickCommand(page.getByRole("button", { name: "Follow-up", exact: true }));
      await page.waitForFunction(() => document.querySelector("textarea.chat-input-textarea").value === "");
      assert.deepEqual(commands.splice(0), [
        { type: "prompt", message: draft, streamingBehavior: "steer" },
        { type: "prompt", message: "A queued follow-up", streamingBehavior: "followUp" },
      ]);
      await setQueue(queued(2, 1));
      await composer();
      assert.ok(await rows.first().locator("..").evaluate((element) => element.scrollHeight <= element.clientHeight));
      await input.fill(draft);
      const recalledDraft = [...queue.steering, ...queue.followUp, draft].join("\n\n");
      await clickCommand(recall);
      await page.waitForFunction((expected) => document.querySelector("textarea.chat-input-textarea").value === expected, recalledDraft);
      assert.deepEqual(commands.splice(0), [{ type: "clear_queue" }]);
      await recall.waitFor({ state: "detached" });
      await input.fill(draft);
      console.log(`PASS: ${label} 50 follow-ups/mixed queues, growth/shrink, real sends and recall preserve data/order/drafts`);

      // Long diagnostics and a maximum-height draft compete with the queue.
      queue = queued(10, 9);
      modelError = Array.from({ length: 12 }, (_, i) => `Synthetic model diagnostic ${i + 1}`).join("\n");
      modelScopeWarnings = Array.from({ length: 12 }, (_, i) => `Synthetic scope warning ${i + 1}`);
      await page.reload({ waitUntil: "domcontentloaded" });
      await recall.waitFor();
      await page.getByText("Model scope warnings", { exact: true }).waitFor();
      await page.getByText(modelError, { exact: true }).waitFor({ state: "attached" });
      await input.fill("A tall unsent draft\n".repeat(30));
      await emit({ type: "auto_retry_start", attempt: 1, maxAttempts: 3, errorMessage: "Synthetic retry: no provider request" });
      await page.getByText("— Synthetic retry: no provider request", { exact: true }).waitFor();
      await saveLayout("queued-diagnostics-tall-draft");
      await composer();
      await scrollQueue();
      await readDiagnostics();

      if (mobile) {
        await page.reload({ waitUntil: "domcontentloaded" });
        await recall.waitFor();
        await page.getByText("Model scope warnings", { exact: true }).waitFor();
        await setQueue(queued(25, 25));
        await emit({ type: "auto_retry_start", attempt: 1, maxAttempts: 3, errorMessage: "Synthetic retry: no provider request" });
        await input.fill(draft);
        await input.click();
        const setViewport = (height, notify = true) => page.evaluate(({ height, notify }) => {
          Object.defineProperty(window.visualViewport, "height", { configurable: true, get: () => height });
          if (notify) window.visualViewport.dispatchEvent(new Event("resize"));
        }, { height, notify });
        for (const height of [450, 340, 280]) {
          await setViewport(height, height !== 280);
          if (height === 280) await input.dispatchEvent("compositionupdate", { data: "x" });
          await page.waitForFunction((height) => document.documentElement.style.getPropertyValue("--app-viewport-height") === `${height}px`, height);
          const keyboardDraft = height === 450 ? draft : "A keyboard draft\n".repeat(30);
          await input.fill(keyboardDraft);
          await saveLayout(`queued-keyboard-${height}`);
          await composer();
          await scrollQueue();
          await readDiagnostics();
          assert.equal(await input.inputValue(), keyboardDraft);
          assert.deepEqual(await page.evaluate(() => [scrollX, scrollY]), [0, 0], "keyboard settling must not jump the page");
        }
        await clickCommand(page.getByRole("button", { name: "Stop", exact: true }));
        await page.evaluate(() => {
          delete window.visualViewport.height;
          window.visualViewport.dispatchEvent(new Event("resize"));
        });
        await page.waitForFunction(() => !document.documentElement.dataset.keyboardOpen);
      } else {
        await page.setViewportSize({ width: viewport.width, height: 400 });
        await saveLayout("queued-short-window");
        await composer();
        await scrollQueue();
        await readDiagnostics();
        await page.setViewportSize(viewport);
        await composer();
        await clickCommand(page.getByRole("button", { name: "Stop", exact: true }));
      }
      assert.deepEqual(commands.splice(0), [{ type: "abort" }]);
      running = false;
      queue = emptyQueue();
      await emit({ type: "agent_end" });
      await emit({ type: "agent_settled", aborted: true });
      await emit({ type: "prompt_done", aborted: true });
      await page.getByRole("button", { name: "Send", exact: true }).waitFor();
      await accessible(input, "idle textarea");
      await accessible(page.getByRole("button", { name: "Send", exact: true }), "idle Send");
      assert.deepEqual(errors, [], `browser errors at ${label}`);
      console.log(`PASS: ${label} diagnostics/tall draft, reduced viewport${mobile ? "/simulated keyboard" : ""}, Stop and idle composer`);
    } catch (error) {
      await saveLayout("queued-failure").catch(() => {});
      await context.tracing.stop({ path: join(artifacts, `queued-trace-${label}.zip`) });
      throw error;
    } finally {
      await context.close();
    }
  }
}
