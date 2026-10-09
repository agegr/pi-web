import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function checkArtifactVersions(page, artifacts, width) {
  const id = 'bill-splitter';
  const document = (value, broken = false) => `<!doctype html>\n<html><body><label>Value<input id="value" type="number" value="${value}"></label>\n${broken ? '<script>throw new Error("version fixture error")</script>' : ''}\n</body></html>`;
  const fence = (code) => `\`\`\`pi-html id="${id}"\n${code}\n\`\`\``;
  const message = (code, thinking = false) => ({ role: 'assistant', content: [
    ...(thinking ? [{ type: 'thinking', thinking: 'Fixture reasoning' }] : []), { type: 'text', text: fence(code) },
  ], provider: 'test', model: 'test', timestamp: Date.now() });
  const version = (entryId, code, blockIndex = 0) => ({ id, key: `${entryId}:${blockIndex}:0`, entryId, blockIndex, ordinal: 0, code });
  const user = (content) => ({ role: 'user', content });
  let fixture = { leafId: 'v2', entryIds: ['u1', 'v1', 'u2', 'v2'], messages: [user('Create a work'), message(document(11)), user('Revise the work'), message(document(22), true)],
    versions: [version('paged-out', document(5)), version('paged-extra', document(7)), version('v1', document(11)), version('v2', document(22), 1)] };
  const setFixture = (value) => page.evaluate((fixture) => window.__previewSetArtifacts(fixture), value);
  await setFixture(fixture);
  await page.evaluate(() => window.__previewSetRunning(false));
  await page.reload({ waitUntil: 'domcontentloaded' });
  const preview = page.locator('.interactive-preview');
  const select = () => page.getByRole('combobox', { name: 'Version', exact: true }).last();
  const input = () => page.locator('.interactive-preview').last().frameLocator('iframe').frameLocator('iframe').locator('#value');
  await input().waitFor();
  await page.waitForFunction(() => document.querySelector('.interactive-preview select')?.options.length === 4);
  assert.equal(await preview.count(), 1, 'Only the latest version initially executes');
  assert.equal(await page.locator('.interactive-artifact-history').count(), 1);
  assert.equal(await page.locator('.interactive-artifact-history').getAttribute('open'), null);
  assert.equal(await select().inputValue(), 'v2:1:0', 'Projected final answers retain original block identity');
  await input().fill('99');
  await preview.getByRole('button', { name: 'Source', exact: true }).click();
  await preview.getByRole('button', { name: 'Preview', exact: true }).click();
  assert.equal(await input().inputValue(), '99');
  await preview.getByRole('button', { name: 'Expand', exact: true }).click();
  await preview.getByRole('button', { name: 'Close', exact: true }).click();
  assert.equal(await input().inputValue(), '99');

  // Paged-out sources load lazily; failure must not trap the version selector.
  await setFixture({ ...fixture, failCode: true });
  await select().selectOption('paged-out:0:0');
  await page.getByRole('status').getByText('This version could not be loaded.', { exact: true }).waitFor();
  await setFixture(fixture);
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await input().waitFor();
  assert.equal(await input().inputValue(), '5');
  const downloading = page.waitForEvent('download');
  await preview.getByRole('button', { name: 'Download file', exact: true }).click();
  assert.equal(await readFile(await (await downloading).path(), 'utf8'), document(5));
  await select().selectOption('v2:1:0');
  assert.equal(await input().inputValue(), '22', 'Version switching resets inputs');

  // An aborted old-version fetch must not replace the subsequently selected source.
  await setFixture({ ...fixture, codeDelay: 500 });
  await select().selectOption('v1:0:0');
  assert.equal(await input().inputValue(), '11', 'Loaded local versions do not need a request');
  const pendingRead = page.waitForRequest((request) => request.url().includes('key=paged-extra%3A0%3A0'));
  await select().selectOption('paged-extra:0:0');
  await pendingRead;
  await select().selectOption('v2:1:0');
  await page.waitForTimeout(700);
  assert.equal(await input().inputValue(), '22');
  await setFixture(fixture);

  await page.locator('.interactive-artifact-history > summary').click();
  await page.locator('.interactive-artifact-history iframe').waitFor();
  assert.equal(await preview.count(), 2);
  await page.locator('.interactive-artifact-history > summary').click();
  await page.waitForFunction(() => document.querySelectorAll('.interactive-preview').length === 1);

  // Keep the current tool while even a closed replacement fence is still streaming.
  await input().fill('77');
  await page.evaluate(() => window.__previewSetRunning(true));
  const next = message(document(33, true));
  await page.evaluate(async (message) => {
    window.__previewEventSource.emit({ type: 'agent_start' });
    await window.__previewEventSource.emit({ type: 'message_end', message: { role: 'user', content: 'Revise again' } });
    window.__previewEventSource.emit({ type: 'message_start', message });
  }, next);
  await page.getByRole('img', { name: 'Generating preview' }).waitFor();
  assert.equal(await preview.first().frameLocator('iframe').frameLocator('iframe').locator('#value').inputValue(), '77');
  assert.equal(await page.locator('.interactive-preview iframe').count(), 1);
  await page.evaluate((message) => window.__previewEventSource.emit({ type: 'message_end', message }), next);
  await input().waitFor();
  assert.equal(await input().inputValue(), '33');
  await preview.last().getByRole('status').waitFor();
  assert.equal(await page.locator('.interactive-artifact-history').count(), 2);
  await select().selectOption('v2:1:0');
  assert.equal(await input().inputValue(), '22', 'Broken newest version remains manually reversible');
  assert.equal(await preview.last().getByRole('status').count(), 0);

  // Persisted transcript identities replace provisional ones and survive refresh.
  fixture = { ...fixture, leafId: 'v3', messages: [...fixture.messages, user('Revise again'), next], entryIds: ['u1', 'v1', 'u2', 'v2', 'u3', 'v3'],
    versions: [...fixture.versions, version('v3', document(33, true))] };
  await setFixture(fixture);
  await page.evaluate(() => window.__previewSetRunning(false));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await input().waitFor();
  await page.waitForFunction(() => document.querySelector('.interactive-preview select')?.options.length === 5);
  assert.equal(await select().inputValue(), 'v3:0:0');
  await select().selectOption('v2:1:0');
  assert.equal(await input().inputValue(), '22');
  await preview.last().screenshot({ path: join(artifacts, `interactive-artifact-versions-${width}.png`) });
  if (width < 600) {
    await preview.last().evaluate((node) => { node.style.width = '240px'; });
    assert.equal(await preview.last().evaluate((node) => node.scrollWidth > node.clientWidth), false);
    const parentBounds = await preview.last().boundingBox();
    for (const button of await preview.last().locator('button, select').all()) {
      const bounds = await button.boundingBox();
      assert.ok(bounds.x >= parentBounds.x && bounds.x + bounds.width <= parentBounds.x + parentBounds.width + 1, 'Controls fit a 240px-wide tool');
    }
  }

  // Another leaf has its own version chain, sharing ancestors but not sibling revisions.
  fixture = { leafId: 'other', messages: [message(document(44))], entryIds: ['other'], versions: [version('paged-out', document(5)), version('other', document(44))] };
  await setFixture(fixture);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await input().waitFor();
  await page.waitForFunction(() => document.querySelector('.interactive-preview select')?.options.length === 2);
  assert.equal(await input().inputValue(), '44');
  assert.equal(await select().locator('option[value="v3:0:0"]').count(), 0);
  console.log(`PASS: ${width}px artifact versions, projection identity, lazy history, retries, reset semantics, streaming replacement, error rollback, refresh and branch isolation`);
}
