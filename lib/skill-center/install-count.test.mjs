import test from 'node:test';
import assert from 'node:assert/strict';
import { createJiti } from 'jiti';
const { parseInstallCount, formatInstallCount, installCountSortValue } = await createJiti(import.meta.url).import('./install-count.ts');

test('install counts preserve exact zero and integers, format thousands and reject malformed values',()=>{
  for(const n of [0,1,999,1000,878556]) {
    const count=parseInstallCount(n);assert.equal(count.numeric,n);assert.equal(formatInstallCount(count),`${n.toLocaleString('zh-CN')} 次安装`);
  }
  for(const value of [undefined,null,-1,NaN,Infinity,0.5,'invalid','1,2 installs','-4 installs']) assert.equal(parseInstallCount(value),null);
  assert.equal(formatInstallCount(null),'安装量未提供');
  assert.equal(parseInstallCount('1,234 installs').numeric,1234);
});

test('CLI abbreviations carry approximate sorting hints without inventing exact counts or repeating units',()=>{
  for(const [text,value] of [['1.2K installs',1200],['1M installs',1e6],['2.5b installs',2.5e9]]) {
    const count=parseInstallCount(text);assert.equal(count.numeric,null);assert.equal(installCountSortValue(count),value);assert.match(formatInstallCount(count),/^约 /);assert.equal(formatInstallCount(count).includes('installs'),false);
  }
  const counts=['14 installs','1.2K installs',undefined,'0 installs'].map(parseInstallCount).sort((a,b)=>installCountSortValue(b)-installCountSortValue(a));
  assert.deepEqual(counts.map(installCountSortValue),[1200,14,0,-1]);
});
