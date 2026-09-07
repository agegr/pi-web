import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { extname, join } from "node:path";

export const imageExtensionSource = `
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
export default function (pi) {
  pi.on("input", async (event, ctx) => {
    if (!event.text.startsWith("E2E image ")) return { action: "continue" };
    const paths = [...event.text.matchAll(/^\\d+\\. (".*")$/gm)].map(match => JSON.parse(match[1]));
    const files = await Promise.all(paths.map(async path => ({ path, data: (await readFile(path)).toString("base64") })));
    await writeFile(join(ctx.cwd, "image-capture.json"), JSON.stringify({ text: event.text, images: event.images, files }));
    ctx.ui.notify(event.text.split("\\n")[0].trim() + " captured");
    return { action: "handled" };
  });
}`;

export async function checkImageAttachments(page, project, artifacts, width) {
  const fixtures = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 16;
    canvas.height = 16;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#d64a39";
    ctx.fillRect(0, 0, 8, 16);
    ctx.fillStyle = "#269dc5";
    ctx.fillRect(8, 0, 8, 16);
    return ["image/jpeg", "image/png"].map(mimeType => ({ mimeType, data: canvas.toDataURL(mimeType).split(",")[1] }));
  });
  const allPaths = new Set();
  for (const entry of ["picker", "paste", "drop"]) {
    const input = page.locator("textarea").last();
    const text = `E2E image ${width} ${entry}`;
    await input.fill(text);
    if (entry === "picker") {
      await page.locator('input[type="file"][accept="image/*"]').setInputFiles(fixtures.map((image, index) => ({
        name: `fixture-${index}.${index === 0 ? "jpg" : "png"}`,
        mimeType: image.mimeType,
        buffer: Buffer.from(image.data, "base64"),
      })));
    } else {
      await input.evaluate((element, { entry, fixtures }) => {
        const transfer = new DataTransfer();
        fixtures.forEach((image, index) => {
          const bytes = Uint8Array.from(atob(image.data), char => char.charCodeAt(0));
          transfer.items.add(new File([bytes], `fixture-${index}`, { type: image.mimeType }));
        });
        let event;
        if (entry === "paste") event = new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true });
        else event = new DragEvent("drop", { dataTransfer: transfer, bubbles: true, cancelable: true });
        element.dispatchEvent(event);
      }, { entry, fixtures });
    }
    await page.waitForFunction(() => document.querySelectorAll('img[src^="blob:"]').length === 2);
    await page.screenshot({ path: join(artifacts, `images-${entry}-${width}.png`) });
    const requestPromise = page.waitForRequest(request => request.method() === "POST"
      && /\/api\/agent\/[^/]+$/.test(new URL(request.url()).pathname)
      && request.postDataJSON()?.message === text);
    await page.getByRole("button", { name: "Send", exact: true }).click();
    const sent = (await requestPromise).postDataJSON();
    await page.getByText(`${text} captured`, { exact: true }).waitFor();
    await page.getByRole("button", { name: "Stop agent", exact: true }).waitFor({ state: "hidden" });
    const captured = JSON.parse(await readFile(join(project, "image-capture.json"), "utf8"));
    assert.deepEqual(sent.images, fixtures.map(image => ({ type: "image", ...image })));
    assert.deepEqual(captured.images, sent.images);
    assert.equal(captured.files.length, 2);
    for (let index = 0; index < captured.files.length; index++) {
      const file = captured.files[index];
      assert.equal(file.data, fixtures[index].data);
      assert.equal(extname(file.path), index === 0 ? ".jpg" : ".png");
      assert.ok(!allPaths.has(file.path));
      allPaths.add(file.path);
      assert.deepEqual(await readFile(file.path), Buffer.from(fixtures[index].data, "base64"));
      if (process.platform !== "win32") assert.equal((await stat(file.path)).mode & 0o777, 0o600);
    }
  }
  console.log(`PASS: ${width}px JPEG/PNG picker, paste, drop, preview, inline inputs and readable server files`);
}
