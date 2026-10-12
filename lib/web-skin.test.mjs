import assert from "node:assert/strict";
import test from "node:test";
import { WEB_SKIN_TOKENS, isWebSkinId, parseWebSkinManifest, webSkinStyles } from "./web-skin.ts";

function fixture() {
  return { version: 1, name: "Paper", light: Object.fromEntries(WEB_SKIN_TOKENS.map(k => [k,"#fafafa"])), dark: Object.fromEntries(WEB_SKIN_TOKENS.map(k => [k,"#202020"])) };
}
test("versioned palettes accept only complete hex-color token sets", () => {
  const parsed = parseWebSkinManifest(fixture());
  assert.equal(parsed.name,"Paper");
  assert.equal(parsed.dark.bg,"#202020");
  for (const key of WEB_SKIN_TOKENS) {
    const missing=fixture(); delete missing.light[key];
    assert.equal(parseWebSkinManifest(missing),null);
    for (const value of ["red","#fff","#000000; display:none","url(https://example.com)",123,null]) {
      const bad=fixture(); bad.dark[key]=value;
      assert.equal(parseWebSkinManifest(bad),null);
    }
  }
  for (const field of ["css","script","html","url","font-family"]) {
    assert.equal(parseWebSkinManifest({...fixture(),[field]:"ignored?"}),null);
    const bad=fixture();bad.light[field]="#000000";
    assert.equal(parseWebSkinManifest(bad),null);
  }
  assert.equal(parseWebSkinManifest({...fixture(),version:2}),null);
  for (const name of ["", "x".repeat(81), "bad\nname", "bad\u202ename"]) assert.equal(parseWebSkinManifest({...fixture(),name}),null);
});
test("backgrounds are bounded local PNG declarations, not paths, URLs or SVG", () => {
  for (const file of ["../cover.png","/cover.png","dir/cover.png","C:\\cover.png","https://example.com/a.png","data:image/png,a","a.svg","a.js","cover.PNG/.."])
    assert.equal(parseWebSkinManifest({...fixture(),background:{file,opacity:0.12}}),null);
  for (const opacity of [-1,0.26,Infinity,NaN,"0.1",null])
    assert.equal(parseWebSkinManifest({...fixture(),background:{file:"cover.png",opacity}}),null);
  const valid=parseWebSkinManifest({...fixture(),background:{file:"cover.png",opacity:0.12}});
  assert.deepEqual(valid.background,{file:"cover.png",opacity:0.12});
  assert.equal(parseWebSkinManifest({...fixture(),background:{file:"cover.png",opacity:0.12,style:"position:fixed"}}),null);
});
test("safe IDs and generated styles never change builtin theme/font preferences", () => {
  for (const id of ["..","a/b","a%2fb","a\\b","", "A","x".repeat(65),null]) assert.equal(isWebSkinId(id),false);
  const skin={id:"paper-dusk",...parseWebSkinManifest({...fixture(),background:{file:"cover.png",opacity:0.1}})};
  const styles=webSkinStyles(skin,false);
  assert.equal(styles["--bg"],"#fafafa");
  assert.equal(styles["--web-skin-image"],'url("/api/web-skins/paper-dusk/background")');
  assert.equal(styles["--web-skin-wash"],"90%");
  assert.equal(webSkinStyles(skin,true)["--bg"],"#202020");
  assert.equal(styles["--font-ui"],undefined);
  assert.equal(styles["pi-theme"],undefined);
});
