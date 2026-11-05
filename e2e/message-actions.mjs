import assert from "node:assert/strict";

/** Visible action buttons per message, counting the opacity of the groups around each button. */
const shownActions = (page) => page.evaluate(() => Object.fromEntries([...document.querySelectorAll("[data-entry-id]")]
  .filter((entry) => !entry.parentElement.closest("[data-entry-id]"))
  .map((entry) => {
    const buttons = [...entry.querySelectorAll(".message-action-label")].map((label) => label.closest("button"));
    const shown = buttons.filter((button) => {
      let opacity = 1;
      for (let node = button; node && node !== entry; node = node.parentElement) opacity *= Number(getComputedStyle(node).opacity);
      return opacity > 0.5;
    }).length;
    return [entry.dataset.entryId, shown];
  })));

/** The chat's copy of a message's text; the sidebar shows the first one as the session title. */
const inChat = (page, text) => page.locator("[data-entry-id]").getByText(text, { exact: true }).first();

async function open(page, base, session) {
  await page.goto(`${base}/?session=${session.id}`, { waitUntil: "domcontentloaded" });
  await inChat(page, session.answer).waitFor();
}

/** The buttons fade, so wait for the state rather than read it once. */
async function settles(page, test, message) {
  const deadline = Date.now() + 5_000;
  let shown;
  do {
    shown = await shownActions(page);
    if (test(shown)) return;
    await page.waitForTimeout(50);
  } while (Date.now() < deadline);
  assert.fail(`${message}: ${JSON.stringify(shown)}`);
}

/**
 * The actions under a message follow the hover with a mouse. A phone has none, and the hover a
 * tap imitates is unreliable, so there a tap on a message shows its actions and a tap anywhere
 * else hides them.
 */
export async function checkMessageActions({ browser, base, session }) {
  const { questionEntry: q, answerEntry: a } = session;
  const none = (shown) => shown[q] === 0 && shown[a] === 0;
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "en-US" });
  try {
    const page = await phone.newPage();
    await open(page, base, session);
    const question = inChat(page, session.question);
    const answer = inChat(page, session.answer);
    await settles(page, none, "nothing shows before a tap");
    await question.tap();
    await settles(page, (shown) => shown[q] > 0 && shown[a] === 0, "a tap shows that message's actions");
    await answer.tap();
    await settles(page, (shown) => shown[q] === 0 && shown[a] > 0, "a tap on another message moves them");
    await answer.tap();
    await page.waitForTimeout(300);
    await settles(page, (shown) => shown[a] > 0, "a second tap on the same message keeps them");
    const last = await answer.boundingBox();
    await page.touchscreen.tap(195, last.y + last.height + 60);
    await settles(page, none, "a tap elsewhere hides them");
    await question.hover();
    await page.waitForTimeout(300);
    await settles(page, none, "a touch screen ignores mouse hover");
  } finally {
    await phone.close();
  }

  const desktop = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: "en-US" });
  try {
    const page = await desktop.newPage();
    await open(page, base, session);
    await page.mouse.move(1, 1);
    await inChat(page, session.question).hover();
    await settles(page, (shown) => shown[q] > 0, "the hover shows them with a mouse");
    await inChat(page, session.question).click();
    await page.mouse.move(1, 1);
    await settles(page, none, "a click keeps nothing once the mouse leaves");
  } finally {
    await desktop.close();
  }
  console.log("PASS: message actions follow the hover with a mouse and a tap on a touch screen");
}
