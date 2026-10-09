import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const interactivePreviewFixture = `<!doctype html>
<html lang="en"><head><title>Bill splitter</title><style>
body { background: #fff; color: #222; }
main { max-width: 500px; margin: auto; }
h1 { font-size: 24px; }
label { display: block; margin: 16px 0; }
input { display: block; box-sizing: border-box; width: 100%; padding: 8px; }
output { display: block; margin: 20px 0; font-size: 28px; color: #087f6e; }
button { padding: 8px 14px; }
#details > div { height: 48px; display: flex; align-items: center; border-bottom: 1px solid #ddd; }
</style></head><body><main>
<h1>Bill splitter</h1>
<label>Total<input id="total" type="number" value="120"></label>
<label>People<input id="people" type="number" min="1" value="3"></label>
<label>Detail rows<input id="rows" type="number" min="0" max="30" value="0"></label>
<output id="result"></output>
<button id="increment">Add a person</button>
<button id="fail">Trigger error</button>
<div id="details"></div>
</main><script>
const total = document.getElementById('total');
const people = document.getElementById('people');
const rows = document.getElementById('rows');
function update() { document.getElementById('result').textContent = '$' + (Number(total.value) / Math.max(1, Number(people.value))).toFixed(2); }
total.oninput = people.oninput = update;
document.getElementById('increment').onclick = () => { people.value = Number(people.value) + 1; update(); };
document.getElementById('fail').onclick = () => { throw new Error('fixture error'); };
rows.oninput = () => {
  const details = document.getElementById('details');
  details.replaceChildren();
  for (let index = 0; index < Number(rows.value); index++) {
    const row = document.createElement('div');
    row.textContent = 'Member ' + (index + 1);
    details.append(row);
  }
};
update();
</script></body></html>`;

export async function checkInteractivePreview(page, artifacts, width) {
  const preview = page.locator('.interactive-preview');
  const frame = page.frameLocator('.interactive-preview iframe');
  await frame.locator('#result').getByText('$40.00', { exact: true }).waitFor();
  assert.equal(await preview.count(), 1, 'Only the assistant pi-html fence executes');
  await frame.locator('#total').fill('180');
  await frame.locator('#increment').click();
  assert.equal(await frame.locator('#result').textContent(), '$45.00');

  await preview.getByRole('button', { name: 'Source', exact: true }).click();
  assert.equal(await preview.locator('pre').isVisible(), true);
  await preview.getByRole('button', { name: 'Preview', exact: true }).click();
  assert.equal(await frame.locator('#result').textContent(), '$45.00');

  await preview.getByRole('button', { name: 'Expand', exact: true }).click();
  assert.equal(await preview.evaluate((node) => node.matches(':modal')), true);
  assert.equal(await frame.locator('#result').textContent(), '$45.00');
  await frame.locator('#people').press('Escape');
  await page.waitForFunction(() => !document.querySelector('.interactive-preview').matches(':modal'));
  assert.equal(await frame.locator('#result').textContent(), '$45.00');

  const downloadPromise = page.waitForEvent('download');
  await preview.getByRole('button', { name: 'Download file', exact: true }).click();
  const download = await downloadPromise;
  assert.equal(download.suggestedFilename(), 'pi-interactive.html');
  assert.equal(await readFile(await download.path(), 'utf8'), interactivePreviewFixture);

  const isolation = await frame.locator('body').evaluate(async () => {
    let parentBlocked = false;
    let storageBlocked = false;
    let fetchBlocked = false;
    try { void parent.document.body; } catch { parentBlocked = true; }
    try { localStorage.setItem('pi-html-test', 'bad'); } catch { storageBlocked = true; }
    try { await fetch('/api/sessions'); } catch { fetchBlocked = true; }
    return { parentBlocked, storageBlocked, fetchBlocked };
  });
  assert.deepEqual(isolation, { parentBlocked: true, storageBlocked: true, fetchBlocked: true });

  // Messages from any other window cannot control the preview.
  await page.evaluate(() => window.postMessage({ type: 'pi-html:error' }, '*'));
  assert.equal(await preview.getByRole('status').count(), 0);
  const height = () => preview.locator('.interactive-preview-frame').evaluate((node) => node.getBoundingClientRect().height);
  const originalHeight = await height();
  await page.evaluate(() => window.postMessage({ type: 'pi-html:resize', height: 9000 }, '*'));
  assert.equal(await height(), originalHeight, 'Foreign resize messages are ignored');
  await frame.locator('body').evaluate(() => parent.postMessage({ type: 'pi-html:resize', height: 9000 }, '*'));
  await page.waitForFunction(() => document.querySelector('.interactive-preview-frame').style.height === '9000px');
  assert.equal(await height(), 9000, 'Height is not capped by pixels or the viewport');
  for (const value of [NaN, Infinity, -1, '500', 100_001, Number.MAX_VALUE]) {
    await frame.locator('body').evaluate((_, height) => parent.postMessage({ type: 'pi-html:resize', height }, '*'), value);
  }
  assert.equal(await preview.locator('.interactive-preview-frame').evaluate((node) => node.style.height), '9000px');
  await frame.locator('body').evaluate(() => parent.postMessage({ type: 'pi-html:resize', height: 80 }, '*'));
  await page.waitForFunction(() => document.querySelector('.interactive-preview-frame').style.height === '80px');
  assert.equal(await height(), 80, 'Short content is not padded to 160px');
  await page.locator('.interactive-preview iframe').evaluate((node) => node.contentWindow.postMessage({ type: 'pi-html:measure' }, '*'));
  await page.waitForFunction(() => Number.parseInt(document.querySelector('.interactive-preview-frame').style.height) > 160);
  await frame.locator('#fail').click();
  await preview.getByRole('status').waitFor();
  await preview.getByRole('button', { name: 'Restart preview', exact: true }).click();
  await frame.locator('#result').getByText('$40.00', { exact: true }).waitFor();
  assert.equal(await preview.getByRole('status').count(), 0);

  const bounds = await preview.boundingBox();
  assert.ok(bounds.width > 200 && bounds.x >= 0 && bounds.x + bounds.width <= width + 1);
  const messageWidth = await preview.evaluate((node) => node.closest('[data-message-role="assistant"]').getBoundingClientRect().width);
  assert.ok(Math.abs(bounds.width - messageWidth) <= 1, 'Preview fills the chat message width');
  if (width >= 1280) assert.ok(bounds.width > 760, 'The old independent width cap is removed');
  const overflow = await frame.locator('body').evaluate(() => document.documentElement.scrollWidth > innerWidth);
  assert.equal(overflow, false, 'The tool fits the mobile preview');
  await preview.scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(artifacts, `interactive-preview-${width}.png`) });
  await preview.getByRole('button', { name: 'Expand', exact: true }).click();
  await page.screenshot({ path: join(artifacts, `interactive-preview-expanded-${width}.png`) });
  await preview.getByRole('button', { name: 'Close', exact: true }).click();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await frame.locator('#result').getByText('$40.00', { exact: true }).waitFor();
  await checkNaturalSizing(page, artifacts, width);
  console.log(`PASS: ${width}px interactive preview, state retention, download, isolation, errors and reload`);
}

async function checkNaturalSizing(page, artifacts, width) {
  const preview = page.locator('.interactive-preview');
  const frame = preview.frameLocator('iframe');
  const frameHeight = () => preview.locator('.interactive-preview-frame').evaluate((node) => node.getBoundingClientRect().height);
  const waitForFit = () => page.waitForFunction(() => {
    const node = document.querySelector('.interactive-preview-frame');
    return node?.dataset.expectedHeight && Math.abs(node.getBoundingClientRect().height - Number(node.dataset.expectedHeight)) <= 1;
  });
  const assertFit = async () => {
    const contentHeight = await frame.locator('body').evaluate((body) => Math.ceil(body.getBoundingClientRect().height));
    await preview.locator('.interactive-preview-frame').evaluate((node, height) => { node.dataset.expectedHeight = String(height); }, contentHeight);
    await waitForFit();
    assert.equal(await frame.locator('body').evaluate(() => document.documentElement.scrollHeight > innerHeight + 1), false, 'Inline content does not need its own vertical scrollbar');
    const dialogHeight = (await preview.boundingBox()).height;
    assert.ok(dialogHeight > contentHeight, 'Dialog does not clip its tall frame');
    return contentHeight;
  };
  const rowCount = width >= 3000 ? '30' : '16';
  await frame.locator('#rows').fill(rowCount);
  const tallHeight = await assertFit();
  assert.ok(tallHeight > 1100 && tallHeight > page.viewportSize().height * 0.6);
  await frame.locator('#rows').fill('2');
  const shortHeight = await assertFit();
  assert.ok(tallHeight - shortHeight >= 600, 'Content can shrink after growing');

  await preview.getByRole('button', { name: 'Expand', exact: true }).click();
  await frame.locator('#rows').fill(rowCount);
  assert.ok(await frameHeight() <= page.viewportSize().height, 'Expanded view stays within the viewport');
  await preview.getByRole('button', { name: 'Close', exact: true }).click();
  await assertFit();
  assert.equal(await frame.locator('#rows').inputValue(), rowCount);
  await preview.getByRole('button', { name: 'Source', exact: true }).click();
  await preview.getByRole('button', { name: 'Preview', exact: true }).click();
  await assertFit();

  // Wheel input inside an inline tool should scroll the conversation, not a nested viewport.
  await preview.evaluate((node) => {
    let container = node.parentElement;
    while (container && (!['auto', 'scroll'].includes(getComputedStyle(container).overflowY) || container.scrollHeight <= container.clientHeight + 1)) container = container.parentElement;
    if (!container) throw new Error('Chat scroll container not found');
    const relativeTop = node.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
    container.scrollTop = relativeTop;
    container.dataset.previewScrollStart = String(container.scrollTop);
  });
  const visibleBounds = await preview.boundingBox();
  await page.mouse.move(visibleBounds.x + 30, Math.max(80, visibleBounds.y + 150));
  await page.mouse.wheel(0, 300);
  await page.waitForFunction(() => {
    const container = document.querySelector('[data-preview-scroll-start]');
    return container && container.scrollTop > Number(container.dataset.previewScrollStart) + 20;
  });
  await page.screenshot({ path: join(artifacts, `interactive-preview-tall-${width}.png`) });

  // Body margins belong to the document height too, not to an inner scrollbar.
  await frame.locator('body').evaluate((body) => { body.style.margin = '12px 0 20px'; });
  const marginedHeight = Math.ceil(await frame.locator('body').evaluate((body) => body.getBoundingClientRect().height + 32));
  await page.waitForFunction((height) => Math.abs(document.querySelector('.interactive-preview-frame').getBoundingClientRect().height - height) <= 1, marginedHeight);
  assert.equal(await frame.locator('body').evaluate(() => document.documentElement.scrollHeight > innerHeight + 1), false);
  console.log(`PASS: ${width}px full-width natural sizing (${tallHeight}px tall -> ${shortHeight}px short), modal/source remeasurement and chat scrolling`);
}
