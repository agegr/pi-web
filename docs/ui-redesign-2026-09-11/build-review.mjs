import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

async function main() {
  const root = path.dirname(fileURLToPath(import.meta.url));
  const frames = JSON.parse(await fs.readFile(path.join(root, 'screen-prompts.json'), 'utf8'));
  await fs.mkdir(path.join(root, 'qa-comparisons'), {recursive:true});
  const dimensions = [];
  for (const frame of frames) {
    const actual = path.join(root, 'implemented', frame.file.replace('.png', '.jpg'));
    await fs.access(actual);
    await fs.access(path.join(root, '../ui-baseline-2026-09-11/screenshots', frame.file.replace('.png', '.jpg')));
    const source = path.join(root, 'screens', frame.file);
    const sourceMeta = await sharp(source).metadata();
    const actualMeta = await sharp(actual).metadata();
    const mobile = Number(frame.id) >= 17;
    const width = mobile ? 390 : 1280;
    const height = mobile ? 844 : 720;
    if (actualMeta.width !== width || actualMeta.height !== height) {
      throw new Error(`Wrong screenshot viewport for ${frame.file}: ${actualMeta.width}x${actualMeta.height}`);
    }
    // Contain preserves aspect ratio; originals remain untouched. This is a QA comparison only.
    const sourcePixels = await sharp(source).resize(width,height,{fit:'contain',background:'#ffffff'}).png().toBuffer();
    const actualPixels = await sharp(actual).resize(width,height,{fit:'contain',background:'#ffffff'}).png().toBuffer();
    await sharp({create:{width:width*2,height,channels:3,background:'#ffffff'}}).composite([{input:sourcePixels,left:0,top:0},{input:actualPixels,left:width,top:0}]).png().toFile(path.join(root,'qa-comparisons',frame.file));
    dimensions.push({id:frame.id,source:[sourceMeta.width,sourceMeta.height],actual:[actualMeta.width,actualMeta.height],viewport:[width,height],normalization:'contain; source left, implementation right'});
  }
  await fs.writeFile(path.join(root,'qa-comparisons','dimensions.json'),JSON.stringify(dimensions,null,2));
  const cards = frames.map(f=>`<section id="page-${f.id}"><h2>${f.id} ${f.name}</h2><div class="compare"><figure class="before"><figcaption>原界面</figcaption><a href="../ui-baseline-2026-09-11/screenshots/${f.file.replace('.png','.jpg')}"><img loading="lazy" src="../ui-baseline-2026-09-11/screenshots/${f.file.replace('.png','.jpg')}" alt="${f.name} 原界面"></a></figure><figure class="design"><figcaption>第三版设计图</figcaption><a href="screens/${f.file}"><img loading="lazy" src="screens/${f.file}" alt="${f.name} 设计图"></a></figure><figure class="actual"><figcaption>实际运行截图</figcaption><a href="implemented/${f.file.replace('.png','.jpg')}"><img loading="lazy" src="implemented/${f.file.replace('.png','.jpg')}" alt="${f.name} 实装"></a></figure></div></section>`).join('\n');
  const nav = frames.map(f=>`<a href="#page-${f.id}">${f.id} ${f.name}</a>`).join('');
  const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pi Web · 第三版设计与实装对照</title><style>:root{color-scheme:light;--ink:#122342;--muted:#536986;--line:#dbe3ef;--accent:#315bec}*{box-sizing:border-box}body{margin:0;background:#f5f8fc;color:var(--ink);font:15px/1.65 system-ui,sans-serif}header{padding:32px 5vw;background:#fff;border-bottom:1px solid var(--line)}h1{font-size:30px;margin:0 0 12px}p{max-width:980px;color:var(--muted)}a{color:var(--accent)}nav{display:flex;gap:10px;flex-wrap:wrap;margin-top:24px}nav a{padding:5px 10px;background:#f5f8fc;text-decoration:none;border-radius:6px}main{padding:24px 3vw}section{margin:0 0 36px;scroll-margin-top:20px}h2{font-size:21px;margin-bottom:12px}.compare{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}figure{margin:0;border:1px solid var(--line);background:white;border-radius:8px;overflow:hidden}figcaption{padding:10px 14px;border-bottom:1px solid var(--line);font-weight:600}img{display:block;width:100%;height:auto}section:nth-last-child(-n+4) img{max-height:800px;object-fit:contain}footer{padding:24px 5vw}input{margin-left:3vw;accent-color:var(--accent)}label{display:inline-block;margin:20px 18px 0 4px}body:has(#large:checked) .compare{grid-template-columns:1fr}body:has(#large:checked) figure{max-width:1280px}body:has(#large:checked) section:nth-last-child(-n+4) figure{max-width:390px}@media(max-width:1000px){.compare{grid-template-columns:1fr}figure{max-width:1280px}}@media print{nav,input,label{display:none}section{break-inside:avoid}.compare{grid-template-columns:repeat(3,1fr)}}</style><header><h1>Pi Web · 第三版设计与实装对照</h1><p>20 个页面状态：原始界面 → Clear Horizon 设计图 → 实际运行截图。图像原文件均保留，点击可查看大图。桌面验收 1280×720，手机验收 390×844。</p><p>设计图中的示例内容、虚构快捷键与重复入口未照搬。实装使用真实项目、模型与文件状态；Next.js 开发角标仅来自当前开发环境。版本更新提示和 README 中的图片均为项目真实数据。</p><p><a href="comparison.md">逐页规则</a> · <a href="implementation-plan.md">修改计划</a> · <a href="../../design-qa.md">视觉与验证报告</a> · <a href="screen-prompts.json">20 页生成提示词</a></p><nav>${nav}</nav></header><input type="checkbox" id="large"><label for="large">展开为大图逐张比较</label><main>${cards}</main><footer>原始基准完整保留在 ui-baseline-2026-09-11。全部图片与文档保存在本项目 docs 目录，可在后续修改时继续对照。</footer></html>`;
  await fs.writeFile(path.join(root,'index.html'),html);
  console.log(`Created ${dimensions.length} normalized comparisons and 20-page review document.`);
}
main().catch(e=>{console.error(e);process.exitCode=1});
