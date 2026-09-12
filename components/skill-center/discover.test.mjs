import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createJiti } from 'jiti';
const { Discover, initialDiscover } = await createJiti(import.meta.url, { jsx:{runtime:'automatic'}, tsconfigPaths:true }).import('./Discover.tsx');
const noop = () => {};
function render(state) { return renderToStaticMarkup(createElement(Discover, { counts:{},taxonomy:null,inventory:null,state,setState:noop,onDetail:noop,onInstall:noop,onManage:noop })); }
test('discovery offers only the existing source and the two approved new sources', () => {
  const html = render(initialDiscover);
  for (const label of ['skills.sh', 'SkillsMP', 'agentskill.sh']) assert.ok(html.includes(`>${label}</button>`));
  assert.ok(!html.includes('ClawHub')); assert.ok(!html.includes('sc-search-help'));
});
test('external discovery displays the selected source and restores old persisted state safely', () => {
  for (const [provider,label] of [['skillsmp','SkillsMP'], ['agentskill.sh','agentskill.sh'], [undefined,'skills.sh']]) {
    const html = render({ ...initialDiscover, external:true, provider });
    assert.ok(html.includes(`placeholder="搜索 ${label} 的技能"`));
    assert.ok(html.includes('aria-label="技能来源"')); assert.ok(html.includes('返回已收录目录'));
  }
});
