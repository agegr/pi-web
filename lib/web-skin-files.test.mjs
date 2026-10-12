import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
import { WEB_SKIN_TOKENS } from "./web-skin.ts";

const jiti=createJiti(import.meta.url,{moduleCache:false});
const { listWebSkins, readWebSkinBackground }=await jiti.import("./web-skin-files.ts");
const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==","base64");
function manifest(){return {version:1,name:"Paper",light:Object.fromEntries(WEB_SKIN_TOKENS.map(k=>[k,"#fafafa"])),dark:Object.fromEntries(WEB_SKIN_TOKENS.map(k=>[k,"#202020"])),background:{file:"cover.png",opacity:0.12}};}
async function setup(t) {
  const root=await mkdtemp(join(tmpdir(),"pi-web-skins-"));t.after(()=>rm(root,{recursive:true,force:true}));
  const pack=join(root,"paper");await mkdir(pack);
  await writeFile(join(pack,"skin.json"),JSON.stringify(manifest()));
  await writeFile(join(pack,"cover.png"),png);
  return {root,pack};
}
test("unconfigured, relative and missing roots provide no catalog or assets",()=>{
  for(const root of ["","relative/path","/does-not-exist/pi-web-skin-test"]) {
    assert.deepEqual(listWebSkins(root),[]);assert.equal(readWebSkinBackground("paper",root),null);
  }
});
test("only valid manifests are listed; background bytes are loaded separately",async(t)=>{
  const {root,pack}=await setup(t);
  assert.equal(listWebSkins(root).length,1);
  assert.deepEqual(readWebSkinBackground("paper",root),png);
  await rm(join(pack,"cover.png"));
  // Listing does not read image bytes. Selection will reject the missing image.
  assert.equal(listWebSkins(root).length,1);
  assert.equal(readWebSkinBackground("paper",root),null);
  for(const id of ["../paper","paper/../paper","/paper","unknown","paper%2fcover.png"])
    assert.equal(readWebSkinBackground(id,root),null);
  await writeFile(join(pack,"skin.json"),"not JSON");assert.deepEqual(listWebSkins(root),[]);
  await writeFile(join(pack,"skin.json"),"x".repeat(32*1024+1));assert.deepEqual(listWebSkins(root),[]);
});
test("links out of the pack, linked pack roots, devices and FIFOs are refused",async(t)=>{
  const {root,pack}=await setup(t);
  const outside=await mkdtemp(join(tmpdir(),"pi-web-skin-outside-"));t.after(()=>rm(outside,{recursive:true,force:true}));
  await writeFile(join(outside,"cover.png"),png);
  await rm(join(pack,"cover.png"));await symlink(join(outside,"cover.png"),join(pack,"cover.png"));
  assert.equal(readWebSkinBackground("paper",root),null);
  await writeFile(join(outside,"skin.json"),JSON.stringify(manifest()));
  await symlink(outside,join(root,"linked"),process.platform==="win32"?"junction":"dir");
  assert.equal(readWebSkinBackground("linked",root),null);
  assert.deepEqual(listWebSkins(root).map(s=>s.id),["paper"]);
  await rm(join(pack,"skin.json"));await symlink(join(outside,"skin.json"),join(pack,"skin.json"));
  assert.deepEqual(listWebSkins(root),[]);
  if(process.platform!=="win32") {
    await rm(join(pack,"skin.json"));execFileSync("mkfifo",[join(pack,"skin.json")]);
    assert.deepEqual(listWebSkins(root),[]);
    await rm(join(pack,"skin.json"));await writeFile(join(pack,"skin.json"),JSON.stringify(manifest()));
    await rm(join(pack,"cover.png"));execFileSync("mkfifo",[join(pack,"cover.png")]);
    assert.equal(readWebSkinBackground("paper",root),null);
  }
});
test("image response rejects other formats, oversized files and oversized dimensions",async(t)=>{
  const {root,pack}=await setup(t);
  for(const value of [Buffer.from('<svg onload="alert(1)"/>'),Buffer.alloc(4*1024*1024+1),Buffer.alloc(10)]) {
    await writeFile(join(pack,"cover.png"),value);assert.equal(readWebSkinBackground("paper",root),null);
  }
  const large=Buffer.from(png);large.writeUInt32BE(4097,16);
  await writeFile(join(pack,"cover.png"),large);assert.equal(readWebSkinBackground("paper",root),null);
  large.writeUInt32BE(4096,16);large.writeUInt32BE(4096,20);
  await writeFile(join(pack,"cover.png"),large);assert.equal(readWebSkinBackground("paper",root),null);
});
