import assert from "node:assert/strict";

/** Inspect the SVG document's real CSS animation, and the image's media-selected source. */
export async function checkPiBlocksIcon(page, icon) {
  assert.equal(await icon.count(), 1);
  assert.equal(await icon.getAttribute("aria-hidden"), "true");
  assert.equal(await icon.getAttribute("alt"), "");
  await icon.evaluate((element) => element.decode());
  const size = await icon.evaluate(() => getComputedStyle(document.documentElement).fontSize);
  assert.deepEqual(await icon.evaluate((element) => [
    getComputedStyle(element).width, getComputedStyle(element).height,
    element.naturalWidth, element.naturalHeight,
  ]), [size, size, 16, 16], "The rendered icon follows its 1rem box, not its intrinsic SVG size");
  const source = await icon.evaluate((element) => element.currentSrc);
  assert.ok(source.endsWith("/icons/pi-blocks-running.svg"));

  const svgPage = await page.context().newPage();
  try {
    const response = await svgPage.goto(source, { waitUntil: "load" });
    assert.ok(response?.ok(), "The running SVG asset loads successfully");
    const phases = await svgPage.locator("path").evaluateAll((paths) => {
      for (const path of paths) {
        const timing = path.getAnimations()[0].effect.getTiming();
        if (timing.duration !== 450 || getComputedStyle(path).animationTimingFunction !== "ease-in-out") {
          throw new Error("The icon must use the selected 450ms soft fade");
        }
      }
      return [0, 75, 150, 225, 300, 375, 450].map((time) => {
        for (const path of paths) {
          const animation = path.getAnimations()[0];
          animation.pause();
          animation.currentTime = time;
        }
        return paths.map((path) => Number(getComputedStyle(path).opacity));
      });
    });
    assert.deepEqual(phases.map((values) => values.map((value) => Number(value.toFixed(4)))), [
      [1, .3, .3], [.65, .3, .65], [.3, .3, 1], [.3, .65, .65],
      [.3, 1, .3], [.65, .65, .3], [1, .3, .3],
    ], "Blocks crossfade clockwise without a jump: coral, yellow, blue, then repeat");
  } finally {
    await svgPage.close();
  }

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.waitForFunction((element) => element.currentSrc.endsWith("/icons/pi-blocks-still.svg"),
    await icon.elementHandle());
  await icon.evaluate((element) => element.decode());
  assert.deepEqual(await icon.evaluate((element) => [
    getComputedStyle(element).width, getComputedStyle(element).height,
  ]), [size, size], "Reduced motion preserves the relative icon size");
  const stillSource = await icon.evaluate((element) => element.currentSrc);
  assert.ok(stillSource.endsWith("/icons/pi-blocks-still.svg"));
  const stillResponse = await page.request.get(stillSource);
  assert.ok(stillResponse.ok(), "The reduced-motion asset loads successfully");
  const still = await stillResponse.text();
  assert.equal((still.match(/<path\b/g) ?? []).length, 3);
  assert.doesNotMatch(still, /animation|<animate\b|opacity/,
    "Reduced motion selects an actually static SVG, not an image with an ignored media query");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.waitForFunction((element) => element.currentSrc.endsWith("/icons/pi-blocks-running.svg"),
    await icon.elementHandle());
  await icon.evaluate((element) => element.decode());
  const resumedSource = await icon.evaluate((element) => element.currentSrc);
  assert.ok(resumedSource.endsWith("/icons/pi-blocks-running.svg"));
}
