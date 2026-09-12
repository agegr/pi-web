import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { jsx: { runtime: 'automatic' }, tsconfigPaths: true });
const { Manage } = await jiti.import('./Manage.tsx');
const { Toast } = await jiti.import('./Shared.tsx');

test('installed cards retain explicit state labels, exact skill actions and accessible table headers', () => {
  const item = { installationId:'fixture', name:'example-skill', source:'example/repo', scope:'global', aliases:[], revision:'v1', logicalPath:'/test/SKILL.md', classification:{assignments:[]}, loadState:'loaded', disableModelInvocation:false, capabilities:{setVisibility:true} };
  const noop = () => {};
  const html = renderToStaticMarkup(createElement(Manage, { cwd:null, tab:'installed', inventory:{installations:[item],readAt:'2026-09-12T00:00:00Z',coverage:{description:'test'}}, taxonomy:null, filter:{domainId:null,categoryId:null,classificationState:'all'}, checks:{}, checking:false, query:'', setFilter:noop,onRefresh:noop,onCheck:noop,onDetail:noop,onUpdate:noop,setQuery:noop,onDiscover:noop,onClassify:noop }));
  assert.equal((html.match(/role="columnheader"/g) ?? []).length, 7);
  for (const label of ['领域分类','安装位置','配置加载','向模型展示','更新状态']) assert.ok(html.includes(`class="sc-cell-label">${label}</span>`));
  assert.match(html, /aria-label="example-skill · \/test\/SKILL.md · 向模型展示"/);
  assert.match(html, /设置分类/);
  assert.match(html, /检查更新/);
  assert.match(html, />详情<\/button>/);
});

test('feedback remains a dismissible polite live region and escapes message content', () => {
  for (const success of [true, false]) {
    const html = renderToStaticMarkup(createElement(Toast, { message:'已保存 <script>',success,onClose:()=>{} }));
    assert.match(html, /role="status"/);
    assert.match(html, /aria-label="关闭提示"/);
    assert.match(html, /&lt;script&gt;/);
    assert.doesNotMatch(html, /<script>/);
  }
});
