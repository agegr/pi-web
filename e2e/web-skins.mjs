// Isolated dev-server test. Never run beside another dev process in this checkout.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import { chromium } from "playwright";

const root=dirname(dirname(fileURLToPath(import.meta.url)));
assert.ok(!existsSync(join(root,".next/dev/lock")),"Stop this checkout's dev server before testing; never share its .next lock.");
const scratch=await mkdtemp(join(tmpdir(),"pi-web-skins-e2e-"));
const artifacts=join(root,"test-results","web-skins");await mkdir(artifacts,{recursive:true});
const packs=join(scratch,"packs");await mkdir(join(packs,"paper"),{recursive:true});
const fontMock=join(scratch,"fonts.cjs");
await writeFile(fontMock,'module.exports=' + JSON.stringify(Object.fromEntries([
  "https://fonts.googleapis.com/css2?family=Noto+Sans+Mono:wght@100..900&display=swap",
  "https://fonts.googleapis.com/css2?family=Noto+Sans+Mono&display=swap",
].map(url=>[url,"/* Offline font fixture, no URLs */"]))) + ';');
const light={bg:"#f7f1e8","bg-panel":"#ede0cd","bg-hover":"#e4d5c0","bg-selected":"#d8c7ab",border:"#bcaa8d",text:"#352d25","text-muted":"#645446","text-dim":"#766957",accent:"#765735","accent-hover":"#624829","accent-contrast":"#ffffff","user-bg":"#e8dcc8","assistant-bg":"#f7f1e8","tool-bg":"#eee4d5","bg-subtle":"#ede0cd"};
const dark={...light,bg:"#22211e","bg-panel":"#302c25","bg-hover":"#39342c","bg-selected":"#453c30",border:"#746655",text:"#f0e8dc","text-muted":"#c0b29e","text-dim":"#af9f89",accent:"#dcc096","accent-hover":"#eed3aa","accent-contrast":"#312b24","user-bg":"#3c3429","assistant-bg":"#22211e","tool-bg":"#302c25","bg-subtle":"#302c25"};
const manifest={version:1,name:"Paper dusk",light,dark,background:{file:"cover.png",opacity:0.12}};
await writeFile(join(packs,"paper","skin.json"),JSON.stringify(manifest));
// Original 64x64 geometric raster, created here. No third-party artwork.
function crc32(data){let crc=0xffffffff;for(const b of data){crc^=b;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return(crc^0xffffffff)>>>0;}
function chunk(name,data){const type=Buffer.from(name);const size=Buffer.alloc(4);size.writeUInt32BE(data.length);const crc=Buffer.alloc(4);crc.writeUInt32BE(crc32(Buffer.concat([type,data])));return Buffer.concat([size,type,data,crc]);}
const header=Buffer.alloc(13);header.writeUInt32BE(64,0);header.writeUInt32BE(64,4);header[8]=8;header[9]=2;
const pixels=Buffer.alloc(64*(1+64*3));for(let y=0;y<64;y++){for(let x=0;x<64;x++){const i=y*193+1+x*3;pixels[i]=180+x;pixels[i+1]=120+y;pixels[i+2]=100+Math.floor(x/2);}}
const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk("IHDR",header),chunk("IDAT",deflateSync(pixels)),chunk("IEND",Buffer.alloc(0))]);
await writeFile(join(packs,"paper","cover.png"),png);
const reserve=createServer();reserve.listen(0,"127.0.0.1");await once(reserve,"listening");const port=reserve.address().port;await new Promise(resolve=>reserve.close(resolve));
const base=`http://127.0.0.1:${port}`;
const report={pageErrors:[],checks:[],imageRequests:0,fontFixture:true};
const browser=await chromium.launch({channel:process.env.E2E_BROWSER_CHANNEL||undefined});
let server;
async function start(configured) {
  const home=join(scratch,"home");const agent=join(scratch,"agent");await mkdir(home,{recursive:true});await mkdir(agent,{recursive:true});
  const log=createWriteStream(join(artifacts,configured?"configured-server.log":"default-server.log"));
  await once(log,"open");
  const env={PATH:process.env.PATH,HOME:home,PI_CODING_AGENT_DIR:agent,PI_OFFLINE:"1",PI_WEB_SKIP_VERSION_CHECK:"1",PI_WEB_NO_OPEN:"1",NEXT_TELEMETRY_DISABLED:"1",NEXT_FONT_GOOGLE_MOCKED_RESPONSES:fontMock};
  if(configured)env.PI_WEB_SKINS_DIR=packs;
  server=spawn(process.execPath,[join(root,"node_modules/next/dist/bin/next"),"dev","--hostname","127.0.0.1","--port",String(port)],{cwd:root,env,detached:process.platform!=="win32",stdio:["ignore",log,log]});
  for(let i=0;i<120;i++){
    if(server.exitCode!==null)throw new Error("Isolated server exited; inspect its log");
    try{const response=await fetch(`${base}/api/web-skins`);if(response.ok)return;}catch{}
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  throw new Error("Isolated server startup timeout");
}
async function stop(){
  if(!server||server.exitCode!==null)return;
  const exited=once(server,"exit");
  if(process.platform==="win32"){const killer=spawn("taskkill",["/pid",String(server.pid),"/t","/f"]);await once(killer,"exit");}
  else process.kill(-server.pid,"SIGTERM");
  await exited;server=null;
}
process.once("uncaughtException", error => {
  console.error(error);
  void stop().finally(() => process.exit(1));
});
async function context(blockStorage=false) {
  const ctx=await browser.newContext({viewport:{width:1440,height:1000},locale:"en-US",colorScheme:"light",reducedMotion:"reduce",serviceWorkers:"block"});
  if(blockStorage)await ctx.addInitScript(()=>{
    // Scope the failure to this feature. The existing app's useAudio hook does
    // not catch a globally inaccessible localStorage getter (outside this PR).
    for (const method of ["getItem","setItem","removeItem"]) {
      const original=Storage.prototype[method];
      Storage.prototype[method]=function(key,...args){
        if(key==="pi-web:external-skin")throw new Error("Blocked skin storage");
        return original.call(this,key,...args);
      };
    }
  });
  await ctx.route("**/api/**",async(route)=>{
    const request=route.request(), url=new URL(request.url()),path=url.pathname;
    if(path.startsWith("/api/web-skins")){if(path.endsWith("/background"))report.imageRequests++;await route.continue();return;}
    if(path.endsWith("/events")){await route.fulfill({contentType:"text/event-stream",body:": fixture\n\n"});return;}
    let value={};
    if(path==="/api/sessions")value={sessions:[],sessionListVersion:0,runningSessionIds:[],completionNotificationSuppressedSessionIds:[]};
    if(path==="/api/agent/running")value={runningSessionIds:[],awaitingInputSessionIds:[]};
    if(path==="/api/home")value={home:"/demo"};
    if(path==="/api/models")value={models:{},modelList:[],defaultModel:null};
    if(path==="/api/cwd/validate")value={valid:true,cwd:"/demo/skin-preview",path:"/demo/skin-preview"};
    if(path==="/api/worktrees")value={worktrees:[],isGitRepo:false,projectRoot:"/demo/skin-preview",branches:[]};
    if(path.startsWith("/api/files/"))value={entries:[]};
    if(path==="/api/git/status")value={files:[],entries:[],isGitRepo:false};
    if(path==="/api/project-trust")value={trusted:true,status:"trusted"};
    await route.fulfill({json:value});
  });
  return ctx;
}
async function load(ctx){
  const page=await ctx.newPage();page.on("pageerror",e=>report.pageErrors.push(e.message));
  await page.goto(`${base}/?cwd=%2Fdemo%2Fskin-preview`);
  try { await page.locator(".chat-content").waitFor(); await page.locator("textarea").first().waitFor(); }
  catch(error) {
    report.failedBody=await page.locator("body").innerText();
    await page.screenshot({path:join(artifacts,"failure.png")});throw error;
  }
  return page;
}
const bg=page=>page.evaluate(()=>{
  const value=getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
  return /^#[0-9a-f]{3}$/i.test(value)?"#"+[...value.slice(1)].map(char=>char+char).join(""):value;
});
const open=page=>page.getByRole("button",{name:"Choose external skin",exact:true}).click();
const choose=async(page,name)=>{await open(page);await page.getByRole("dialog",{name:"Choose external skin",exact:true}).getByRole("button",{name,exact:true}).click();};
try {
  await start(false);
  let ctx=await context(), page=await load(ctx);
  await page.waitForTimeout(500);
  assert.equal(await page.locator(".web-skin-control").count(),0);assert.equal(report.imageRequests,0);assert.equal(await bg(page),"#ffffff");
  report.checks.push("unconfigured: no control, no image request, native appearance");await ctx.close();await stop();
  await start(true);ctx=await context();page=await load(ctx);
  await page.getByRole("button",{name:"Choose external skin",exact:true}).waitFor();
  const original=await bg(page);assert.equal(report.imageRequests,0);
  await choose(page,"Paper dusk");await page.waitForFunction(()=>document.documentElement.dataset.webSkin==="paper");assert.equal(await bg(page),light.bg);assert.ok(report.imageRequests>0);
  await page.screenshot({path:join(artifacts,"paper-light.png")});
  await page.reload();await page.waitForFunction(()=>document.documentElement.dataset.webSkin==="paper");
  await page.emulateMedia({colorScheme:"dark"});await page.waitForFunction(()=>getComputedStyle(document.documentElement).getPropertyValue("--bg").trim()==="#22211e");
  assert.equal(await page.evaluate(()=>localStorage.getItem("pi-theme")),null);
  await page.screenshot({path:join(artifacts,"paper-dark.png")});
  report.checks.push("selection survives refresh and follows builtin system mode without rewriting pi-theme");
  for(const [width,height] of [[1440,1000],[1024,768],[390,844],[844,390]]) {
    await page.setViewportSize({width,height});await open(page);
    const geometry=await page.evaluate(()=>{
      const b=document.querySelector(".web-skin-toggle").getBoundingClientRect(),p=document.querySelector(".web-skin-panel").getBoundingClientRect();
      const overlap=(a,c)=>a.left<c.right&&a.right>c.left&&a.top<c.bottom&&a.bottom>c.top;
      const protectedControls=[...document.querySelectorAll("textarea,button")].filter(e=>e.tagName==="TEXTAREA"||/Send|发送/.test(e.textContent)).map(e=>e.getBoundingClientRect()).filter(r=>r.width&&r.height);
      return{inViewport:p.left>=0&&p.top>=0&&p.right<=innerWidth&&p.bottom<=innerHeight,upward:p.bottom<=b.top-4,clear:protectedControls.every(r=>!overlap(r,p)&&!overlap(r,b))};
    });
    assert.ok(geometry.inViewport&&geometry.upward&&geometry.clear,JSON.stringify(geometry));
    await page.screenshot({path:join(artifacts,`menu-${width}x${height}.png`)});await page.keyboard.press("Escape");
    assert.equal(await page.getByRole("button",{name:"Choose external skin",exact:true}).evaluate(el=>document.activeElement===el),true);
  }
  await choose(page,"None — use built-in appearance");assert.equal(await page.evaluate(()=>document.documentElement.dataset.webSkin),undefined);assert.equal(await bg(page),"#1a1a1a");
  report.checks.push("disable restores native theme; four viewports fit, open upward and avoid composer/send; Escape returns focus");
  await page.setViewportSize({width:1440,height:1000});await choose(page,"Paper dusk");await page.waitForFunction(()=>document.documentElement.dataset.webSkin==="paper");
  await rm(join(packs,"paper","skin.json"));await page.evaluate(()=>window.dispatchEvent(new Event("focus")));await page.waitForFunction(()=>!document.documentElement.dataset.webSkin);
  assert.equal(await page.evaluate(()=>localStorage.getItem("pi-web:external-skin")),null);
  await writeFile(join(packs,"paper","skin.json"),JSON.stringify(manifest));await page.reload();await page.getByRole("button",{name:"Choose external skin",exact:true}).waitFor();
  await rm(join(packs,"paper","cover.png"));await choose(page,"Paper dusk");await page.waitForFunction(()=>localStorage.getItem("pi-web:external-skin")===null);assert.equal(await bg(page),"#1a1a1a");
  report.checks.push("removed manifest and missing image fall back cleanly");await writeFile(join(packs,"paper","cover.png"),png);await ctx.close();
  ctx=await context(true);page=await load(ctx);await choose(page,"Paper dusk");await page.waitForFunction(()=>document.documentElement.dataset.webSkin==="paper");await choose(page,"None — use built-in appearance");assert.equal(await bg(page),original);report.checks.push("blocked skin-key storage: select and disable still work in memory");await ctx.close();
  assert.deepEqual(report.pageErrors,[]);
  console.log(JSON.stringify(report,null,2));
} finally {
  await stop();await browser.close();await writeFile(join(artifacts,"result.json"),JSON.stringify(report,null,2));await rm(scratch,{recursive:true,force:true});
}
