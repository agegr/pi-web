"use strict";

const fs = require("node:fs");
const path = require("node:path");

const home = process.env.USERPROFILE || process.env.HOME || "~";
const ENHANCEMENT_SOURCE = path.join(home, ".pi", "agent", "scripts", "pi-web-enhancements.js");

function safeWriteFileSync(filePath, content, encoding = "utf8") {
  try {
    if (fs.existsSync(filePath)) {
      const existing = fs.readFileSync(filePath, encoding);
      if (existing === content) return false;
    }
    fs.writeFileSync(filePath, content, encoding);
    return true;
  } catch (e) {
    fs.writeFileSync(filePath, content, encoding);
    return true;
  }
}

function repairMalformedClientDurationCopy(content) {
  const malformed = /([A-Za-z_$][\w$]*)&&!t&&\(0,r\.jsxs\)\("button",\{onClick:\(\)=>\{([A-Za-z_$][\w$]*)\(([A-Za-z_$][\w$]*)\)\(0,r\.jsxs\)\("button",\{onClick:\(\)=>\{\2\(\3\)\.then\(\(\)=>\{([A-Za-z_$][\w$]*)\(!0\),setTimeout\(\(\)=>\4\(!1\),1500\)\}\)\},/;
  return content.replace(malformed, (_, condition, copyFn, copyArg, stateFn) =>
    `${condition}&&!t&&(0,r.jsxs)("button",{onClick:()=>{${copyFn}(${copyArg}).then(()=>{${stateFn}(!0),setTimeout(()=>${stateFn}(!1),1500)})},`);
}

function repairStreamingThinkingLevel(content) {
  // 官方构建产物在 isStreaming 时通过 !l&&S 卸载了思考深度按钮，并将其设为 disabled 与 not-allowed
  // 修复：移除 !isStreaming 限制，保持思考深度在任务运行与排队引导时始终可见且可正常点击配置
  const pattern = /!([a-zA-Z0-9_$]+)&&([a-zA-Z0-9_$]+)&&\((0,[a-zA-Z0-9_$]+(?:\.jsxs|\.jsx))\)\("div",\{ref:([a-zA-Z0-9_$]+),style:\{position:"relative"\},children:\[\((0,[a-zA-Z0-9_$]+(?:\.jsxs|\.jsx))\)\("button",\{onClick:\(\)=>!\1&&([a-zA-Z0-9_$]+)\(e=>!e\),disabled:\1,title:([a-zA-Z0-9_$]+)\("chat\.(?:changeReasoning|currentReasoning)",\{level:([a-zA-Z0-9_$]+)\}\),"aria-label":([a-zA-Z0-9_$]+)\("chat\.changeReasoningLabel"\),style:\{display:"flex",alignItems:"center",justifyContent:"center",gap:5,padding:([a-zA-Z0-9_$]+)\?"0 6px":"8px 12px",width:\10\?"auto":void 0,height:32,background:([a-zA-Z0-9_$]+)\?"var\(--bg-hover\)":"none",border:"none",borderRadius:9,color:"var\(--text-muted\)",cursor:\1\?"not-allowed":"pointer",fontSize:12,opacity:\1\?\.5:1,transition:"background 0\.12s, color 0\.12s"/g;

  return content.replace(pattern, (match, streamingVar, onThinkingVar, jsxs1, refVar, jsxs2, toggleDropdownVar, tVar, levelVar, tVar2, isMobileVar, bgHoverVar) => {
    return `${onThinkingVar}&&(${jsxs1})("div",{ref:${refVar},style:{position:"relative"},children:[(${jsxs2})("button",{onClick:()=>${toggleDropdownVar}(e=>!e),disabled:false,title:${tVar}("chat.changeReasoning",{level:${levelVar}}),"aria-label":${tVar2}("chat.changeReasoningLabel"),style:{display:"flex",alignItems:"center",justifyContent:"center",gap:5,padding:${isMobileVar}?"0 6px":"8px 12px",width:${isMobileVar}?"auto":void 0,height:32,background:${bgHoverVar}?"var(--bg-hover)":"none",border:"none",borderRadius:9,color:"var(--text-muted)",cursor:"pointer",fontSize:12,opacity:1,transition:"background 0.12s, color 0.12s"`;
  });
}

function repairStreamingSendShortcuts(content) {
  // 原生上游在 isStreaming 状态下默认将 Enter 发送为 "steer"（引导），仅在 Alt+Enter 时发送为 "followup"（后续消息）
  // 彻底固化修复：普通 Enter 100% 只能是加入队列（后续消息），Ctrl/Cmd+Enter 100% 才能触发立即引导
  const pattern = /tT\(e\.altKey&&[A-Za-z0-9_$]+\|\|![A-Za-z0-9_$]+\?"followup":"steer"\)/g;
  return content.replace(pattern, 'tT((e.ctrlKey||e.metaKey)&&n?"steer":"followup")');
}

function repairComposerInitialMount(content) {
  if (typeof content !== "string" || !content) return content;

  // Only touch the native composer prefix ending at its textarea. Similar
  // relative-position wrappers elsewhere in the app are not composer nodes.
  const composerPrefix = /(?:className:"pi-enh-cursor-composer",)*style:\{maxWidth:"var\(--chat-content-max-width, 820px\)",margin:"0 auto"\},children:\[[\s\S]{0,40000}?className:"chat-input-textarea"/g;
  return content.replace(composerPrefix, (content) => {
  // 1. 清洗并精准规范化 outerCard:
  // 匹配已知 composer 外层卡片结构，清洗可能存在的重复 className，注入终态一体化 className:"pi-enh-cursor-composer pi-enh-composer-model-pill"
  const outerCardPattern = /(?:className:"pi-enh-cursor-composer(?: pi-enh-composer-model-pill)?",)*style:\{maxWidth:"var\(--chat-content-max-width, 820px\)",margin:"0 auto"\},children:\[/g;
  content = content.replace(outerCardPattern, 'className:"pi-enh-cursor-composer pi-enh-composer-model-pill",style:{maxWidth:"var(--chat-content-max-width, 820px)",margin:"0 auto"},children:[');

  // 2. 清洗并精准规范化 innerContents:
  // 匹配已知 composer 内层相对定位容器，清洗可能存在的重复 className，注入单一且精准的 className:"pi-enh-cursor-contents"
  const innerContentsPattern = /(?:className:"pi-enh-cursor-contents",)*style:\{position:"relative",minWidth:0\},children:\[/g;
  content = content.replace(innerContentsPattern, 'className:"pi-enh-cursor-contents",style:{position:"relative",minWidth:0},children:[');

  // 3. 清洗并精准规范化 editorBox:
  // 修复之前将 className 错误注入到 style 对象内部的残留（如 style:{className:"pi-enh-cursor-contents",...}）
  const stylePollutionPattern = /style:\{(?:\s*className:"pi-enh-cursor-contents",\s*)+(minWidth:0,display:"flex",flexDirection:([a-zA-Z0-9_$]+)\?"column":"row",gap:8,alignItems:\2\?"stretch":"center",background:"var\(--bg\)")/g;
  content = content.replace(stylePollutionPattern, 'style:{$1');

  // 改为精准元素 props 注入，且支持清洗外层重复的 className，确保重复运行相同输出（幂等），只限定已知 composer 结构
  const editorBoxPattern = /(\("div",\s*\{)(?:className:"pi-enh-cursor-contents",)*(style:\{minWidth:0,display:"flex",flexDirection:([a-zA-Z0-9_$]+)\?"column":"row",gap:8,alignItems:\3\?"stretch":"center",background:"var\(--bg\)")/g;
  content = content.replace(editorBoxPattern, '$1className:"pi-enh-cursor-contents",$2');

  return content;
  });
}

function patchUserMessageReconcile(content) {
  if (typeof content !== "string" || !content) return content;

  // 1. 在乐观消息创建时给其添加非枚举 __piEnhOptimistic 标记（仅新乐观对象，幂等，严禁写其他消息）
  if (!content.includes("__piEnhOptimistic")) {
    const optimisticPattern = /([a-zA-Z0-9_$]+)=(\{role:"user",content:[\s\S]*?,timestamp:Date\.now\(\)\});(\s*)([a-zA-Z0-9_$]+)\(\s*([a-zA-Z0-9_$]+)\s*=>\s*\[\.\.\.\5,\1\]\),\s*([a-zA-Z0-9_$]+)\.current=([a-zA-Z0-9_$]+)\(\1\)/;
    if (optimisticPattern.test(content)) {
      content = content.replace(optimisticPattern, (match, msgVar, msgInit, space, setMessages, prevVar, refVar, fpFn) => {
        return `${msgVar}=${msgInit};try{Object.defineProperty(${msgVar},"__piEnhOptimistic",{value:!0,configurable:!0})}catch(_){};${space}${setMessages}(${prevVar}=>[...${prevVar},${msgVar}]),${refVar}.current=${fpFn}(${msgVar})`;
      });
    }
  }

  // 2. 注入服务端接收 message_end 阶段的 reconcile hook 调用
  if (!content.includes("__PI_ENH_RECONCILE_USER_MESSAGE__")) {
    const pattern = /let\s+([a-zA-Z0-9_$]+)=([a-zA-Z0-9_$]+)\(([a-zA-Z0-9_$]+)\),([a-zA-Z0-9_$]+)=([a-zA-Z0-9_$]+)\(\1\),([a-zA-Z0-9_$]+)=([a-zA-Z0-9_$]+)\.current;\7\.current=null,([a-zA-Z0-9_$]+)\(\s*([a-zA-Z0-9_$]+)\s*=>\s*\{\s*let\s+([a-zA-Z0-9_$]+)=\9\[\9\.length-1\];\s*return\s+\6&&\10\?\.role==="user"&&\5\(\10\)===\6\?\6===\4\?\9:\[\.\.\.\9\.slice\(0,-1\),\1\]:\[\.\.\.\9,\1\]\s*\}\)/;

    if (pattern.test(content)) {
      content = content.replace(pattern, (match, serverMsg, reFn, rawMsg, serverFp, fpFn, lastFp, refVar, setMessages, prevList, lastItem) => {
        return `let ${serverMsg}=${reFn}(${rawMsg}),${serverFp}=${fpFn}(${serverMsg}),${lastFp}=${refVar}.current;${refVar}.current=null,${setMessages}(${prevList}=>{let ${lastItem}=${prevList}[${prevList}.length-1],fallback=()=>${lastFp}&&${lastItem}?.role==="user"&&${fpFn}(${lastItem})===${lastFp}?${lastFp}===${serverFp}?${prevList}:[...${prevList}.slice(0,-1),${serverMsg}]:[...${prevList},${serverMsg}];try{let hook=typeof window!=="undefined"&&window.__PI_ENH_RECONCILE_USER_MESSAGE__;if(typeof hook==="function")return hook(${prevList},${serverMsg},{lastFingerprint:${lastFp},serverFingerprint:${serverFp},fingerprintFn:${fpFn},fallback})}catch(err){}return fallback()})`;
      });
    } else {
      console.warn("[patch-pi-web] patchUserMessageReconcile: upstream message_end pattern not found or changed");
    }
  }

  return content;
}

function patchDirectToolbarControls(content) {
  let s_idx = -1;
  let e_idx = -1;
  let end_len = 0;

  const startMarker = "/* PI_PATCH_DIRECT_TOOLBAR */";
  const endMarker = "/* PI_PATCH_DIRECT_TOOLBAR_END */";

  if (content.includes(startMarker)) {
    s_idx = content.indexOf(startMarker);
    const endCommentIdx = content.indexOf(endMarker, s_idx);
    if (endCommentIdx !== -1) {
      e_idx = endCommentIdx;
      end_len = endMarker.length;
    } else {
      const legacyEnd = 'children:[(0,r.jsx)("svg",{width:"10",height:"10",viewBox:"0 0 10 10",fill:"none",children:(0,r.jsx)("rect",{x:"1.5",y:"1.5",width:"7",height:"7",rx:"1.5",fill:"currentColor"})}),X("chat.stop")]})]})]})';
      const legacyIdx = content.indexOf(legacyEnd, s_idx);
      if (legacyIdx !== -1) {
        e_idx = legacyIdx;
        end_len = legacyEnd.length;
      }
    }
  } else {
    const s_marker = "!U&&(0,r.jsxs)(\"div\",{style:{marginTop:8";
    const e_marker = "children:[(0,r.jsx)(\"line\",{x1:\"18\",y1:\"6\",x2:\"6\",y2:\"18\"}),(0,r.jsx)(\"line\",{x1:\"6\",y1:\"6\",x2:\"18\",y2:\"18\"})]})})]})]})]})";
    s_idx = content.indexOf(s_marker);
    const markerIdx = content.indexOf(e_marker, s_idx);
    if (markerIdx !== -1) {
      e_idx = markerIdx;
      end_len = e_marker.length;
    }
  }

  if (s_idx === -1 || e_idx === -1) return content;

  const end_idx = e_idx + end_len;

  const isWinBuild = content.includes("{t:Q}") || content.includes("page-5c5b1233");

  let newBlock = "";
  if (isWinBuild) {
    // Windows build (page-5c5b1233): adapt mangled variables accurately
    newBlock = `/* PI_PATCH_DIRECT_TOOLBAR */!U&&(0,r.jsxs)("div",{"data-pi-composer-toolbar":!0,className:"pi-enh-cursor-contents",style:{marginTop:8,display:"flex",alignItems:"center",justifyContent:"space-between",gap:4},children:[(0,r.jsxs)("div",{"data-pi-composer-left":!0,className:"pi-enh-cursor-left",style:{flex:"1 1 auto",minWidth:0,display:"flex",alignItems:"center",gap:2},children:[(0,r.jsx)("button",{type:"button",className:"pi-enh-composer-add-btn","data-pi-composer-add":!0,title:"添加或切换模式","aria-label":"添加或切换模式",style:{width:28,minWidth:28,height:28,padding:0,margin:0,borderRadius:8,border:"1px solid transparent",background:"none",color:"var(--text-muted)",cursor:"pointer",display:"inline-flex",alignItems:"center",justifyContent:"center",flexShrink:0},children:(0,r.jsxs)("svg",{width:"15",height:"15",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"1.8",strokeLinecap:"round",strokeLinejoin:"round",children:[(0,r.jsx)("line",{x1:"12",y1:"5",x2:"12",y2:"19"}),(0,r.jsx)("line",{x1:"5",y1:"12",x2:"19",y2:"12"})]})}),(0,r.jsx)("button",{"data-pi-attach-image":!0,onClick:()=>eX.current?.click(),title:Q("chat.attachImage"),"aria-label":Q("chat.attachImage"),style:{flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",width:32,height:32,padding:0,background:"none",border:"none",borderRadius:9,color:ec.length?"var(--accent)":"var(--text-muted)",cursor:"pointer",opacity:1,transition:"background 0.12s, color 0.12s"},onMouseEnter:e=>{e.currentTarget.style.background="var(--bg-hover)",e.currentTarget.style.color=ec.length?"var(--accent)":"var(--text)"},onMouseLeave:e=>{e.currentTarget.style.background="none",e.currentTarget.style.color=ec.length?"var(--accent)":"var(--text-muted)"},children:(0,r.jsxs)("svg",{width:"15",height:"15",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"1.8",strokeLinecap:"round",strokeLinejoin:"round",children:[(0,r.jsx)("rect",{x:"3",y:"3",width:"18",height:"18",rx:"2",ry:"2"}),(0,r.jsx)("circle",{cx:"8.5",cy:"8.5",r:"1.5"}),(0,r.jsx)("polyline",{points:"21 15 16 10 5 21"})]})}),(tN.length>0||a)&&g&&(0,r.jsx)(nj,{options:tN,value:a,onChange:g,disabled:!1,busy:f,isAutoSelection:d})]}),(0,r.jsx)("div",{className:"pi-enh-cursor-spacer",style:{flex:"0 0 auto",width:4}}),(0,r.jsxs)("div",{ref:eY,className:"pi-enh-cursor-right",style:{flex:"0 0 auto",display:"flex",alignItems:"center",justifyContent:"flex-end",position:"relative",gap:4},children:[l&&(0,r.jsxs)("button",{className:"pi-enh-cursor-stop",onClick:t,title:Q("chat.stopAgent"),style:{display:"flex",alignItems:"center",gap:6,padding:"8px 14px",height:32,background:"rgba(239,68,68,0.08)",border:"1px solid rgba(239,68,68,0.3)",borderRadius:9,color:"#ef4444",cursor:"pointer",fontSize:12,fontWeight:600,whiteSpace:"nowrap",letterSpacing:"-0.01em",transition:"background 0.12s"},onMouseEnter:e=>{e.currentTarget.style.background="rgba(239,68,68,0.16)"},onMouseLeave:e=>{e.currentTarget.style.background="rgba(239,68,68,0.08)"},children:[(0,r.jsx)("svg",{width:"10",height:"10",viewBox:"0 0 10 10",fill:"none",children:(0,r.jsx)("rect",{x:"1.5",y:"1.5",width:"7",height:"7",rx:"1.5",fill:"currentColor"})}),Q("chat.stop")]}),S&&(0,r.jsxs)("div",{ref:eJ,"data-pi-thinking-control":!0,style:{position:"relative",flexShrink:0,display:"inline-flex",alignItems:"center"},children:[(0,r.jsxs)("button",{"data-pi-thinking-button":!0,onClick:()=>eo(e=>!e),disabled:!1,title:Q("chat.changeReasoning",{level:tP}),"aria-label":Q("chat.changeReasoningLabel"),style:{display:"flex",alignItems:"center",justifyContent:"center",gap:4,padding:ee?"0 6px":"6px 10px",height:32,background:ei?"var(--bg-hover)":"none",border:"none",borderRadius:9,color:"var(--text-muted)",cursor:"pointer",fontSize:12,opacity:1,whiteSpace:"nowrap",flexShrink:0,transition:"background 0.12s, color 0.12s"},onMouseEnter:e=>{e.currentTarget.style.background="var(--bg-hover)",e.currentTarget.style.color="var(--text)"},onMouseLeave:e=>{e.currentTarget.style.background=ei?"var(--bg-hover)":"none",e.currentTarget.style.color="var(--text-muted)"},children:[(0,r.jsxs)("svg",{width:"11",height:"11",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",style:{flexShrink:0},children:[(0,r.jsx)("path",{d:"M9.5 2A5.5 5.5 0 0 0 4 7.5c0 1.7.78 3.21 2 4.21V14a1 1 0 0 0 1 1h5a1 1 0 0 0 1-1v-2.29c1.22-1 2-2.51 2-4.21A5.5 5.5 0 0 0 9.5 2z"}),(0,r.jsx)("line",{x1:"7",y1:"18",x2:"12",y2:"18"}),(0,r.jsx)("line",{x1:"8",y1:"21",x2:"11",y2:"21"})]}),(0,r.jsx)("span",{style:{whiteSpace:"nowrap"},children:tP})]}),ei&&(0,r.jsx)("div",{style:{position:"absolute",bottom:"calc(100% + 6px)",right:0,zIndex:100,background:"var(--bg)",border:"1px solid var(--border)",borderRadius:8,boxShadow:"0 -4px 16px rgba(0,0,0,0.10)",overflow:"hidden",minWidth:180,maxWidth:"calc(100vw - 32px)"},children:(Array.isArray(E)&&E.length>0?E.filter(e=>e!=="auto"):["off","minimal","low","medium","high","xhigh","max"]).map(e=>{let t=((S??"auto")==="auto"?tP===e:S===e),n=Q(T?.[e]||e),i="auto"!==e&&T?T[e]:void 0,o=null!=i&&i!==e?i:e,l=null!=i&&i!==e;return(0,r.jsxs)("button",{onClick:()=>{eo(!1),t||(typeof C==="function"&&C(e))},style:{display:"flex",alignItems:"center",gap:8,width:"100%",padding:"7px 12px",background:t?"var(--bg-selected)":"none",border:"none",color:t?"var(--text)":"var(--text-muted)",cursor:"pointer",fontSize:12,textAlign:"left",fontWeight:t?600:400,whiteSpace:"nowrap"},onMouseEnter:e=>{t||(e.currentTarget.style.background="var(--bg-hover)")},onMouseLeave:e=>{t||(e.currentTarget.style.background="none")},children:[t?(0,r.jsx)("svg",{width:"10",height:"10",viewBox:"0 0 10 10",fill:"none",stroke:"var(--accent)",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",style:{flexShrink:0},children:(0,r.jsx)("polyline",{points:"1.5 5 4 7.5 8.5 2.5"})}):(0,r.jsx)("span",{style:{width:10,flexShrink:0}}),(0,r.jsxs)("span",{style:{flex:1},children:[o,l&&(0,r.jsxs)("span",{style:{fontSize:10,color:"var(--text-dim)",fontFamily:"var(--font-mono)",marginLeft:5},children:["(",e,")"]})]}),(0,r.jsx)("span",{style:{fontSize:11,color:"var(--text-dim)",marginLeft:8},children:n})]},e)})})]})]})]})/* PI_PATCH_DIRECT_TOOLBAR_END */`;
  } else {
    // Linux/default official build (page-d979ae06): mangled variables
    newBlock = `/* PI_PATCH_DIRECT_TOOLBAR */!U&&(0,r.jsxs)("div",{"data-pi-composer-toolbar":!0,className:"pi-enh-cursor-contents",style:{marginTop:8,display:"flex",alignItems:"center",justifyContent:"space-between",gap:4},children:[(0,r.jsxs)("div",{"data-pi-composer-left":!0,className:"pi-enh-cursor-left",style:{flex:"1 1 auto",minWidth:0,display:"flex",alignItems:"center",gap:2},children:[(0,r.jsx)("button",{type:"button",className:"pi-enh-composer-add-btn","data-pi-composer-add":!0,title:"添加或切换模式","aria-label":"添加或切换模式",style:{width:28,minWidth:28,height:28,padding:0,margin:0,borderRadius:8,border:"1px solid transparent",background:"none",color:"var(--text-muted)",cursor:"pointer",display:"inline-flex",alignItems:"center",justifyContent:"center",flexShrink:0},children:(0,r.jsxs)("svg",{width:"15",height:"15",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"1.8",strokeLinecap:"round",strokeLinejoin:"round",children:[(0,r.jsx)("line",{x1:"12",y1:"5",x2:"12",y2:"19"}),(0,r.jsx)("line",{x1:"5",y1:"12",x2:"19",y2:"12"})]})}),(0,r.jsx)("button",{"data-pi-attach-image":!0,onClick:()=>eG.current?.click(),title:X("chat.attachImage"),"aria-label":X("chat.attachImage"),style:{flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",width:32,height:32,padding:0,background:"none",border:"none",borderRadius:9,color:ed.length?"var(--accent)":"var(--text-muted)",cursor:"pointer",opacity:1,transition:"background 0.12s, color 0.12s"},onMouseEnter:e=>{e.currentTarget.style.background="var(--bg-hover)",e.currentTarget.style.color=ed.length?"var(--accent)":"var(--text)"},onMouseLeave:e=>{e.currentTarget.style.background="none",e.currentTarget.style.color=ed.length?"var(--accent)":"var(--text-muted)"},children:(0,r.jsxs)("svg",{width:"15",height:"15",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"1.8",strokeLinecap:"round",strokeLinejoin:"round",children:[(0,r.jsx)("rect",{x:"3",y:"3",width:"18",height:"18",rx:"2",ry:"2"}),(0,r.jsx)("circle",{cx:"8.5",cy:"8.5",r:"1.5"}),(0,r.jsx)("polyline",{points:"21 15 16 10 5 21"})]})}),(t$.length>0||s||u)&&h&&(0,r.jsx)(nb,{options:t$,value:s,onChange:h,disabled:!1,busy:g,isAutoSelection:a})]}),(0,r.jsx)("div",{className:"pi-enh-cursor-spacer",style:{flex:"0 0 auto",width:4}}),(0,r.jsxs)("div",{ref:eY,className:"pi-enh-cursor-right",style:{flex:"0 0 auto",display:"flex",alignItems:"center",justifyContent:"flex-end",position:"relative",gap:4},children:[l&&(0,r.jsxs)("button",{className:"pi-enh-cursor-stop",onClick:t,title:X("chat.stopAgent"),style:{display:"flex",alignItems:"center",gap:6,padding:"8px 14px",height:32,background:"rgba(239,68,68,0.08)",border:"1px solid rgba(239,68,68,0.3)",borderRadius:9,color:"#ef4444",cursor:"pointer",fontSize:12,fontWeight:600,whiteSpace:"nowrap",letterSpacing:"-0.01em",transition:"background 0.12s"},onMouseEnter:e=>{e.currentTarget.style.background="rgba(239,68,68,0.16)"},onMouseLeave:e=>{e.currentTarget.style.background="rgba(239,68,68,0.08)"},children:[(0,r.jsx)("svg",{width:"10",height:"10",viewBox:"0 0 10 10",fill:"none",children:(0,r.jsx)("rect",{x:"1.5",y:"1.5",width:"7",height:"7",rx:"1.5",fill:"currentColor"})}),X("chat.stop")]}),S&&(0,r.jsxs)("div",{ref:eJ,"data-pi-thinking-control":!0,style:{position:"relative",flexShrink:0,display:"inline-flex",alignItems:"center"},children:[(0,r.jsxs)("button",{"data-pi-thinking-button":!0,onClick:()=>el(e=>!e),disabled:!1,title:X("chat.changeReasoning",{level:tz}),"aria-label":X("chat.changeReasoningLabel"),style:{display:"flex",alignItems:"center",justifyContent:"center",gap:4,padding:ee?"0 6px":"6px 10px",height:32,background:eo?"var(--bg-hover)":"none",border:"none",borderRadius:9,color:"var(--text-muted)",cursor:"pointer",fontSize:12,opacity:1,whiteSpace:"nowrap",flexShrink:0,transition:"background 0.12s, color 0.12s"},onMouseEnter:e=>{e.currentTarget.style.background="var(--bg-hover)",e.currentTarget.style.color="var(--text)"},onMouseLeave:e=>{e.currentTarget.style.background=eo?"var(--bg-hover)":"none",e.currentTarget.style.color="var(--text-muted)"},children:[(0,r.jsxs)("svg",{width:"11",height:"11",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",style:{flexShrink:0},children:[(0,r.jsx)("path",{d:"M9.5 2A5.5 5.5 0 0 0 4 7.5c0 1.7.78 3.21 2 4.21V14a1 1 0 0 0 1 1h5a1 1 0 0 0 1-1v-2.29c1.22-1 2-2.51 2-4.21A5.5 5.5 0 0 0 9.5 2z"}),(0,r.jsx)("line",{x1:"7",y1:"18",x2:"12",y2:"18"}),(0,r.jsx)("line",{x1:"8",y1:"21",x2:"11",y2:"21"})]}),(0,r.jsx)("span",{style:{whiteSpace:"nowrap"},children:tz})]}),eo&&(0,r.jsx)("div",{style:{position:"absolute",bottom:"calc(100% + 6px)",right:0,zIndex:100,background:"var(--bg)",border:"1px solid var(--border)",borderRadius:8,boxShadow:"0 -4px 16px rgba(0,0,0,0.10)",overflow:"hidden",minWidth:180,maxWidth:"calc(100vw - 32px)"},children:nT.filter(e=>e!=="auto"&&(!C||C.includes(e))).map(e=>{let t=((k??"auto")==="auto"?tz===e:k===e),n=X(nE[e]),i="auto"!==e&&M?M[e]:void 0,o=null!=i&&i!==e?i:e,l=null!=i&&i!==e;return(0,r.jsxs)("button",{onClick:()=>{el(!1),t||S(e)},style:{display:"flex",alignItems:"center",gap:8,width:"100%",padding:"7px 12px",background:t?"var(--bg-selected)":"none",border:"none",color:t?"var(--text)":"var(--text-muted)",cursor:"pointer",fontSize:12,textAlign:"left",fontWeight:t?600:400,whiteSpace:"nowrap"},onMouseEnter:e=>{t||(e.currentTarget.style.background="var(--bg-hover)")},onMouseLeave:e=>{t||(e.currentTarget.style.background="none")},children:[t?(0,r.jsx)("svg",{width:"10",height:"10",viewBox:"0 0 10 10",fill:"none",stroke:"var(--accent)",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",style:{flexShrink:0},children:(0,r.jsx)("polyline",{points:"1.5 5 4 7.5 8.5 2.5"})}):(0,r.jsx)("span",{style:{width:10,flexShrink:0}}),(0,r.jsxs)("span",{style:{flex:1},children:[o,l&&(0,r.jsxs)("span",{style:{fontSize:10,color:"var(--text-dim)",fontFamily:"var(--font-mono)",marginLeft:5},children:["(",e,")"]})]}),(0,r.jsx)("span",{style:{fontSize:11,color:"var(--text-dim)",marginLeft:8},children:n})]},e)})})]})]})]})/* PI_PATCH_DIRECT_TOOLBAR_END */`;
  }

  const existingBlock = content.slice(s_idx, end_idx);
  if (existingBlock === newBlock) return content;

  return content.slice(0, s_idx) + newBlock + content.slice(end_idx);
}

function patchSidebarBottomShortcuts(content) {
  if (typeof content !== "string" || !content) return content;
  if (content.includes("/* PI_PATCH_SIDEBAR_SHORTCUTS */")) return content;

  const targetStr = '{style:{padding:"8px",flexShrink:0,display:"flex",justifyContent:"space-between",gap:4},children:[[["models"';
  const idx = content.indexOf(targetStr);
  if (idx === -1) return content;

  const sub = content.slice(idx, idx + 400);
  const setterMatch = sub.match(/onClick:\(\)=>([a-zA-Z0-9_$]+)\(e\)/);
  const setterName = setterMatch ? setterMatch[1] : "ew";

  const replacement = `{/* PI_PATCH_SIDEBAR_SHORTCUTS */"data-pi-enh-shortcuts-host":!0,ref:e=>{if(e&&typeof window!=="undefined"){window.__PI_OPEN_SETTINGS__=${setterName}}},style:{padding:"8px",flexShrink:0,display:"flex",justifyContent:"space-between",gap:4},children:[[["models"`;

  return content.slice(0, idx) + replacement + content.slice(idx + targetStr.length);
}

function patchSessionStateRoute(pkgDir) {
  const stateRoute = path.join(
    pkgDir,
    ".next",
    "server",
    "app",
    "api",
    "sessions",
    "[id]",
    "state",
    "route.js",
  );
  if (!fs.existsSync(stateRoute)) return false;

  let content = fs.readFileSync(stateRoute, "utf8");
  const liveMetricsCall = /let tm=calcTurnMetrics\(b\.sessionFile\|\|getSFile\(c\)\);return e\.NextResponse\.json\(\{running:!0,state:\{\.\.\.b,turnMetrics:tm\}\}\)/;
  const idleMetricsCall = /let tm=calcTurnMetrics\(getSFile\(c\)\);return e\.NextResponse\.json\(\{running:!1,state:\{turnMetrics:tm\}\}\)/;
  const withoutLiveMetrics = "return e.NextResponse.json({running:!0,state:b})";
  const withoutIdleMetrics = "return e.NextResponse.json({running:!1})";
  const patched = content
    .replace(liveMetricsCall, withoutLiveMetrics)
    .replace(idleMetricsCall, withoutIdleMetrics);
  if (patched === content) return false;

  safeWriteFileSync(stateRoute, patched, "utf8");
  return true;
}

function patchOpenAIResponsesReasoningFile(targetFile) {
  if (!fs.existsSync(targetFile)) return false;
  let content = fs.readFileSync(targetFile, "utf8");
  if (content.includes("[PATCH] Codex single reasoning block reuse")) return false;

  const oldCreateSlot = `        if (item.type === "reasoning") {
            const block = { type: "thinking", thinking: "" };
            output.content.push(block);
            const slot = {
                type: "thinking",
                block,
                contentIndex: output.content.length - 1,
            };
            outputSlots.set(outputIndex, slot);
            stream.push({ type: "thinking_start", contentIndex: slot.contentIndex, partial: output });
            return slot;
        }`;

  const newCreateSlot = `        if (item.type === "reasoning") {
            // [PATCH] Codex single reasoning block reuse: prevent thousands of empty thinking blocks
            const lastBlock = output.content[output.content.length - 1];
            if (lastBlock && lastBlock.type === "thinking") {
                const slot = {
                    type: "thinking",
                    block: lastBlock,
                    contentIndex: output.content.length - 1,
                };
                outputSlots.set(outputIndex, slot);
                return slot;
            }
            const block = { type: "thinking", thinking: "" };
            output.content.push(block);
            const slot = {
                type: "thinking",
                block,
                contentIndex: output.content.length - 1,
            };
            outputSlots.set(outputIndex, slot);
            stream.push({ type: "thinking_start", contentIndex: slot.contentIndex, partial: output });
            return slot;
        }`;

  const oldDoneSlot = `            if (item.type === "reasoning" && slot?.type === "thinking") {
                const summaryText = item.summary?.map((s) => s.text).join("\\n\\n") || "";
                const contentText = item.content?.map((c) => c.text).join("\\n\\n") || "";
                slot.block.thinking = summaryText || contentText || slot.block.thinking;
                slot.block.thinkingSignature = JSON.stringify(item);
                reasoningBlocksById.set(item.id, slot.block);
                stream.push({
                    type: "thinking_end",
                    contentIndex: slot.contentIndex,
                    content: slot.block.thinking,
                    partial: output,
                });
                outputSlots.delete(event.output_index);
            }`;

  const newDoneSlot = `            if (item.type === "reasoning" && slot?.type === "thinking") {
                const summaryText = item.summary?.map((s) => s.text).join("\\n\\n") || "";
                const contentText = item.content?.map((c) => c.text).join("\\n\\n") || "";
                const newChunk = summaryText || contentText || "";
                if (newChunk) {
                    slot.block.thinking = slot.block.thinking ? (slot.block.thinking + "\\n\\n" + newChunk) : newChunk;
                }
                slot.block.thinkingSignature = JSON.stringify(item);
                reasoningBlocksById.set(item.id, slot.block);
                stream.push({
                    type: "thinking_end",
                    contentIndex: slot.contentIndex,
                    content: slot.block.thinking,
                    partial: output,
                });
                outputSlots.delete(event.output_index);
            }`;

  let patched = content;
  if (patched.includes(oldCreateSlot)) {
    patched = patched.replace(oldCreateSlot, newCreateSlot);
  }
  if (patched.includes(oldDoneSlot)) {
    patched = patched.replace(oldDoneSlot, newDoneSlot);
  }

  if (patched !== content) {
    safeWriteFileSync(targetFile, patched, "utf8");
    console.log("[patch-pi-web] Patched single reasoning block reuse in:", targetFile);
    return true;
  }
  return false;
}

function patchAllOpenAIResponsesReasoning(pkgDir) {
  const candidates = [
    path.join(pkgDir, "node_modules", "@earendil-works", "pi-ai", "dist", "api", "openai-responses-shared.js"),
    path.join(pkgDir, "node_modules", "@earendil-works", "pi-coding-agent", "node_modules", "@earendil-works", "pi-ai", "dist", "api", "openai-responses-shared.js"),
    path.join(home, "AppData", "Roaming", "npm", "node_modules", "@earendil-works", "pi-coding-agent", "node_modules", "@earendil-works", "pi-ai", "dist", "api", "openai-responses-shared.js"),
  ];
  for (const c of candidates) {
    try { patchOpenAIResponsesReasoningFile(c); } catch (e) {}
  }
}

function patchPackage(pkgDir, options = {}) {
  try {
    if (!fs.existsSync(pkgDir)) return;

    // Fail closed before changing any assets: code updates must never replace user-state archives.
    require(path.join(home, ".pi", "agent", "scripts", "pi-enhancement-state-archive.cjs"))
      .archiveEnhancementState({ agentDir: path.join(home, ".pi", "agent"), reason: "before-plugin-update" });

    // Apply server-side usage delete guard route patch safely if pi-web is completely stopped.
    // Must be positioned before "if (staticOnly) return" so entrypoint --static-only can invoke it,
    // while options.publicOnly continues to bypass all server/route changes.
    if (!options.publicOnly) {
      try {
        const usageDeletePatch = require("./pi-usage-delete-patch.cjs");
        const patchRes = usageDeletePatch.applyIfStopped(pkgDir);
        if (patchRes.applied) {
          console.log(`[patch-pi-web] Applied usage delete guard route patch to ${pkgDir}`);
        }
      } catch (patchErr) {
        console.warn(`[patch-pi-web] Failed to evaluate usage delete guard route patch: ${patchErr.message}`);
      }
    }

    const staticOnly = options.staticOnly === true || options.publicOnly === true;
    if (!staticOnly) patchAllOpenAIResponsesReasoning(pkgDir);

    let enhCode = "";
    if (fs.existsSync(ENHANCEMENT_SOURCE)) {
      enhCode = fs.readFileSync(ENHANCEMENT_SOURCE, "utf8");
    }

    // A passive, bounded recorder loads before the app/enhancement runtime.
    const diagnosticsPath = path.join(home, ".pi", "agent", "scripts", "pi-web-crash-diagnostics.js");
    const diagnosticsCode = fs.existsSync(diagnosticsPath) ? fs.readFileSync(diagnosticsPath, "utf8") : "";
    const usageModules = ["usage-ledger-core.js", "pi-usage-panel.js"].map(file => {
      const source = path.join(home, ".pi", "agent", "scripts", file);
      return fs.existsSync(source) ? fs.readFileSync(source, "utf8") : "";
    }).join("\n;\n");
    const assetBuild = require("node:crypto").createHash("sha256").update(enhCode + diagnosticsCode + usageModules).digest("hex").slice(0, 16);
    const durableStateEnabled = fs.existsSync(path.join(home, ".pi", "agent", "state", "enhancement-state", "journal.jsonl"));
    const diagnosticBootstrap = `window.__PI_ENH_DURABLE_STATE_ENABLED__ = ${JSON.stringify(durableStateEnabled)};\nwindow.__PI_ENH_ASSET_BUILD__ = ${JSON.stringify(assetBuild)};\n${diagnosticsCode}\n`;

    // 1. Copy enhancements script to public/. Next's production server only
    // serves public files known at build time, so a newly added JSON manifest
    // can 404 even though the existing enhancement script remains available.
    // Bundle the canonical archive manifest into that served script instead.
    const publicDir = path.join(pkgDir, "public");
    const manifestSource = path.join(home, ".pi", "agent", "scripts", "pi-archived-manifest.json");
    const webmanifestSource = path.join(home, ".pi", "agent", "scripts", "manifest.webmanifest");
    if (fs.existsSync(publicDir) && fs.existsSync(webmanifestSource)) {
      const destWebmanifest = path.join(publicDir, "manifest.webmanifest");
      safeWriteFileSync(destWebmanifest, fs.readFileSync(webmanifestSource, "utf8"), "utf8");
    }
    let archivedManifest = [];
    if (fs.existsSync(manifestSource)) {
      try {
        const parsedManifest = JSON.parse(fs.readFileSync(manifestSource, "utf8"));
        if (Array.isArray(parsedManifest)) archivedManifest = parsedManifest;
      } catch (e) {}
    }

    const shortcutsSource = path.join(home, ".pi", "agent", "scripts", "pi-shortcuts-manifest.json");
    let shortcutsManifest = [
      { id: "enhancements", label: "增强插件" },
      { id: "archived", label: "已归档" },
      { id: "usage", label: "用量大盘" },
      { id: "settings", label: "设置" }
    ];
    if (fs.existsSync(shortcutsSource)) {
      try {
        const parsedShortcuts = JSON.parse(fs.readFileSync(shortcutsSource, "utf8"));
        if (Array.isArray(parsedShortcuts) && parsedShortcuts.length > 0) shortcutsManifest = parsedShortcuts;
      } catch (e) {}
    }

    const pinnedSource = path.join(home, ".pi", "agent", "scripts", "pi-pinned-manifest.json");
    let pinnedManifest = [];
    if (fs.existsSync(pinnedSource)) {
      try {
        const parsedPinned = JSON.parse(fs.readFileSync(pinnedSource, "utf8"));
        if (Array.isArray(parsedPinned)) pinnedManifest = parsedPinned;
        else if (parsedPinned && typeof parsedPinned === "object") {
          if (Array.isArray(parsedPinned.pinned)) pinnedManifest = parsedPinned.pinned;
          else if (Array.isArray(parsedPinned.sessions)) pinnedManifest = parsedPinned.sessions;
        }
      } catch (e) {}
    }

    const usageLedgerSource = path.join(home, ".pi", "agent", "scripts", "pi-usage-ledger.json");
    let usageLedger = null;
    if (fs.existsSync(usageLedgerSource)) {
      try {
        usageLedger = JSON.parse(fs.readFileSync(usageLedgerSource, "utf8"));
      } catch (e) {}
    }

    const odooAddonsSource = path.join(home, ".pi", "agent", "scripts", "pi-odoo-addons-manifest.json");
    let odooAddonsManifest = null;
    if (fs.existsSync(odooAddonsSource)) {
      try {
        odooAddonsManifest = JSON.parse(fs.readFileSync(odooAddonsSource, "utf8"));
      } catch (e) {}
    }

    const tagsSource = path.join(home, ".pi", "agent", "scripts", "pi-tags-manifest.json");
    let tagsManifest = null;
    if (fs.existsSync(tagsSource)) {
      try {
        tagsManifest = JSON.parse(fs.readFileSync(tagsSource, "utf8"));
      } catch (e) {}
    }
    // 兜底从 models.json 提取标签配置
    if (!tagsManifest || !Array.isArray(tagsManifest.definitions) || tagsManifest.definitions.length === 0) {
      const modelsJsonPath = path.join(home, ".pi", "agent", "models.json");
      if (fs.existsSync(modelsJsonPath)) {
        try {
          const modelsCfg = JSON.parse(fs.readFileSync(modelsJsonPath, "utf8"));
          if (Array.isArray(modelsCfg.sessionTagsDefinitions) && modelsCfg.sessionTagsDefinitions.length > 0) {
            tagsManifest = {
              definitions: modelsCfg.sessionTagsDefinitions,
              mappings: modelsCfg.sessionTagMappings || {},
              revision: Number(modelsCfg.sessionTagsRevision) || Date.now()
            };
            safeWriteFileSync(tagsSource, JSON.stringify(tagsManifest, null, 2), "utf8");
          }
        } catch (e) {}
      }
    }

    if (fs.existsSync(publicDir) && enhCode) {
      if (enhCode.length < 500000 || !enhCode.includes("window.__PI_WEB_ENHANCEMENTS_LOADED__")) {
        console.warn(`[patch-pi-web] Refusing to deploy truncated or malformed script (${enhCode.length} bytes) to ${publicDir}`);
        return;
      }
      const destEnhancement = path.join(publicDir, "pi-web-enhancements.js");
      const manifestBootstrap = `window.__PI_ENH_ARCHIVED_MANIFEST__ = ${JSON.stringify(archivedManifest)};\nwindow.__PI_ENH_PINNED_MANIFEST__ = ${JSON.stringify(pinnedManifest)};\nwindow.__PI_ENH_SHORTCUTS_MANIFEST__ = ${JSON.stringify(shortcutsManifest)};\nwindow.__PI_ENH_USAGE_LEDGER__ = ${JSON.stringify(usageLedger)};\nwindow.__PI_ENH_ODOO_ADDONS_MANIFEST__ = ${JSON.stringify(odooAddonsManifest)};\nwindow.__PI_ENH_TAGS_MANIFEST__ = ${JSON.stringify(tagsManifest)};\n`;
      safeWriteFileSync(destEnhancement, diagnosticBootstrap + manifestBootstrap + usageModules + "\n;\n" + enhCode, "utf8");
    }

    if (fs.existsSync(publicDir) && fs.existsSync(manifestSource)) {
      const destManifest = path.join(publicDir, "pi-archived-manifest.json");
      safeWriteFileSync(destManifest, fs.readFileSync(manifestSource, "utf8"), "utf8");
    }

    if (fs.existsSync(publicDir) && fs.existsSync(pinnedSource)) {
      const destPinned = path.join(publicDir, "pi-pinned-manifest.json");
      safeWriteFileSync(destPinned, fs.readFileSync(pinnedSource, "utf8"), "utf8");
    }

    if (fs.existsSync(publicDir) && fs.existsSync(shortcutsSource)) {
      const destShortcuts = path.join(publicDir, "pi-shortcuts-manifest.json");
      safeWriteFileSync(destShortcuts, fs.readFileSync(shortcutsSource, "utf8"), "utf8");
    }

    if (fs.existsSync(publicDir) && fs.existsSync(usageLedgerSource)) {
      const destUsageLedger = path.join(publicDir, "pi-usage-ledger.json");
      safeWriteFileSync(destUsageLedger, fs.readFileSync(usageLedgerSource, "utf8"), "utf8");
    }

    if (fs.existsSync(publicDir) && fs.existsSync(odooAddonsSource)) {
      const destOdooAddons = path.join(publicDir, "pi-odoo-addons-manifest.json");
      safeWriteFileSync(destOdooAddons, fs.readFileSync(odooAddonsSource, "utf8"), "utf8");
    }

    if (fs.existsSync(publicDir) && fs.existsSync(tagsSource)) {
      const destTags = path.join(publicDir, "pi-tags-manifest.json");
      safeWriteFileSync(destTags, fs.readFileSync(tagsSource, "utf8"), "utf8");
    }

    // Lightweight dynamic hot-loader definition with retry & watchdog
    const loaderCode = `${diagnosticBootstrap};(function(){
  if (typeof window === "undefined" || window.__PI_WEB_LOADER_INJECTED__) return;
  window.__PI_WEB_LOADER_INJECTED__ = true;

  // 1. Zero-FOUC Pre-Hydration: DOM 绘制前瞬间应用深色主题与背景色，100% 杜绝白屏闪烁
  var isDark = true;
  try {
    var mode = localStorage.getItem("pi-web-theme-mode") || localStorage.getItem("theme") || "system";
    isDark = mode === "dark" || (mode === "system" && window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
    var root = document.documentElement;
    if (isDark) {
      root.classList.add("dark");
      root.style.backgroundColor = "#09090b";
      root.style.colorScheme = "dark";
    } else {
      root.classList.remove("dark");
      root.style.backgroundColor = "#ffffff";
      root.style.colorScheme = "light";
    }
  } catch(e) {}

  // 1.1 Zero-FOUC Shortcuts Style & Fast Pre-Mount: 100% 杜绝侧边栏左下角原生按钮闪现，直接呈现增强快捷入口
  try {
    if (!document.getElementById('pi-zero-fouc-shortcuts-style')) {
      var sStyle = document.createElement('style');
      sStyle.id = 'pi-zero-fouc-shortcuts-style';
      sStyle.textContent = [
        '[data-pi-enh-shortcuts-host] > button:not(.pi-enh-shortcut-btn),',
        '.sidebar-container > div:last-child:not([data-pi-enh-shortcuts-disabled]) > button:not(.pi-enh-shortcut-btn) {',
        '  display: none !important;',
        '}',
        '.pi-enh-shortcuts-bar {',
        '  display: flex !important;',
        '  align-items: center;',
        '  gap: 2px;',
        '  width: 100%;',
        '  flex-wrap: nowrap !important;',
        '}',
        '.pi-enh-shortcut-btn {',
        '  flex: 1 1 0%;',
        '  display: flex;',
        '  align-items: center;',
        '  justify-content: center;',
        '  gap: 2px;',
        '  height: 32px;',
        '  padding: 0 1px;',
        '  background: none;',
        '  border: none;',
        '  border-radius: 8px;',
        '  color: var(--text-muted);',
        '  cursor: pointer;',
        '  font-size: 11px;',
        '  letter-spacing: -0.02em;',
        '  transition: background 0.12s, color 0.12s;',
        '  min-width: 0;',
        '  white-space: nowrap;',
        '  user-select: none;',
        '}',
        '.pi-enh-shortcut-btn:hover {',
        '  background: var(--bg-hover);',
        '  color: var(--text);',
        '}',
        '.pi-enh-shortcut-btn svg {',
        '  width: 13px;',
        '  height: 13px;',
        '  flex-shrink: 0;',
        '}',
        '.pi-enh-shortcut-btn span {',
        '  display: inline-block;',
        '  line-height: 1.4;',
        '  overflow: hidden;',
        '  text-overflow: ellipsis;',
        '  white-space: nowrap;',
        '  font-size: 10.5px;',
        '}',
        'html[data-pi-opening-tab="usage"] .settings-dialog-surface .settings-general,',
        'html[data-pi-opening-tab="enhancements"] .settings-dialog-surface .settings-general,',
        'html[data-pi-opening-tab="archived"] .settings-dialog-surface .settings-general,',
        'html[data-pi-opening-tab="notifications"] .settings-dialog-surface .settings-general,',
        'html[data-pi-opening-tab="tags"] .settings-dialog-surface .settings-general {',
        '  display: none !important;',
        '}'
      ].join(String.fromCharCode(10));
      (document.head || document.documentElement).appendChild(sStyle);
    }
  } catch(e) {}

  // 1.2 Fast Pre-Mount: 在首帧绘制前同步嗅探并挂载增强快捷入口
  try {
    var SHORTCUT_ICONS_MIN = {
      usage: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="settings-section-icon"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg>',
      enhancements: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="settings-section-icon"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"></path></svg>',
      archived: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="settings-section-icon"><path d="M21 8v13H3V8"></path><path d="M1 3h22v5H1z"></path><path d="M10 12h4"></path></svg>',
      settings: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 7h-9M14 17H5"></path><circle cx="7" cy="7" r="3"></circle><circle cx="17" cy="17" r="3"></circle></svg>'
    };

    function getFastShortcutList() {
      try {
        var raw = localStorage.getItem('pi-web-quick-shortcuts');
        if (raw) {
          var parsed = JSON.parse(raw);
          if (Array.isArray(parsed) && parsed.length > 0) return parsed;
        }
      } catch(e) {}
      if (Array.isArray(window.__PI_ENH_SHORTCUTS_MANIFEST__) && window.__PI_ENH_SHORTCUTS_MANIFEST__.length > 0) {
        return window.__PI_ENH_SHORTCUTS_MANIFEST__;
      }
      return [
        { id: 'usage', label: 'Usage' },
        { id: 'enhancements', label: '增强插件' },
        { id: 'archived', label: '已归档' },
        { id: 'settings', label: '设置' }
      ];
    }

    function mountFastShortcuts(host) {
      if (!host || host.querySelector('.pi-enh-shortcuts-bar')) return;
      host.setAttribute('data-pi-enh-shortcuts-host', 'true');
      var list = getFastShortcutList();
      var bar = document.createElement('div');
      bar.className = 'pi-enh-shortcuts-bar';
      bar.setAttribute('data-signature', JSON.stringify(list));
      bar.setAttribute('data-count', String(list.length));
      bar.innerHTML = list.map(function(item) {
        var icon = item.iconHtml || SHORTCUT_ICONS_MIN[item.id] || SHORTCUT_ICONS_MIN.settings;
        return '<button type="button" class="pi-enh-shortcut-btn" data-shortcut-id="' + item.id + '" title="' + item.label + ' (点击直达，双击可移除)">' +
          icon + '<span>' + item.label + '</span></button>';
      }).join('');

      bar.addEventListener('click', function(e) {
        var btn = e.target && e.target.closest ? e.target.closest('.pi-enh-shortcut-btn') : null;
        if (!btn) return;
        e.preventDefault();
        e.stopPropagation();
        var id = btn.getAttribute('data-shortcut-id');
        if (typeof window.__PI_ENH_TRIGGER_SHORTCUT__ === 'function') {
          window.__PI_ENH_TRIGGER_SHORTCUT__(id);
        } else {
          document.documentElement.setAttribute('data-pi-opening-tab', id);
          window.__PI_PENDING_SHORTCUT_TARGET__ = id;
          if (typeof window.__PI_OPEN_SETTINGS__ === 'function') {
            window.__PI_OPEN_SETTINGS__(id === 'settings' ? 'general' : id);
          }
        }
      });
      host.appendChild(bar);
    }

    var shortcutsObserver = new MutationObserver(function() {
      var host = document.querySelector('[data-pi-enh-shortcuts-host]');
      if (!host) {
        var sidebar = document.querySelector('.sidebar-container');
        if (sidebar) {
          var last = sidebar.lastElementChild;
          if (last && last.querySelector('button')) host = last;
        }
      }
      if (host) {
        mountFastShortcuts(host);
      }
    });

    if (document.documentElement) {
      shortcutsObserver.observe(document.documentElement, { childList: true, subtree: true });
    }
  } catch(e) {}

    // 2. PWA Manifest & Meta 自动注入
  try {
    if (!document.querySelector('link[rel="manifest"]')) {
      var link = document.createElement("link");
      link.rel = "manifest";
      link.href = "/manifest.webmanifest";
      (document.head || document.documentElement).appendChild(link);
    }
    if (!document.querySelector('meta[name="theme-color"]')) {
      var metaTheme = document.createElement("meta");
      metaTheme.name = "theme-color";
      metaTheme.content = isDark ? "#09090b" : "#ffffff";
      (document.head || document.documentElement).appendChild(metaTheme);
    }
    if (!document.querySelector('link[rel="apple-touch-icon"]')) {
      var appleIcon = document.createElement("link");
      appleIcon.rel = "apple-touch-icon";
      appleIcon.href = "/icons/apple-touch-icon.png";
      (document.head || document.documentElement).appendChild(appleIcon);
    }
  } catch(e) {}

  // 3. 注册 Service Worker (离线与后台通知，使用固定路径，由标准 HTTP 缓存与 SW 字节比对触发更新，彻底杜绝多版本抢占死锁)
  try {
    if ("serviceWorker" in navigator && window.location.protocol.startsWith("http")) {
      navigator.serviceWorker.register("/sw.js").catch(function() {});
    }
  } catch(e) {}

  var retryCount = 0;
  var maxRetries = 3;
  function loadScript() {
    if (window.__PI_WEB_ENHANCEMENTS_LOADED__) return;
    var existing = document.getElementById("pi-web-enhancements-script");
    if (existing) existing.remove();
    var script = document.createElement("script");
    script.id = "pi-web-enhancements-script";
    script.src = "/pi-web-enhancements.js?v=" + Date.now();
    script.async = true;
    script.onerror = function() {
      if (retryCount < maxRetries) {
        retryCount++;
        setTimeout(loadScript, 1000 * retryCount);
      }
    };
    (document.head || document.documentElement).appendChild(script);
  }
  if (document.head || document.documentElement) {
    loadScript();
  } else if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", loadScript, { once: true });
  } else {
    loadScript();
  }
  setTimeout(function() {
    if (!window.__PI_WEB_ENHANCEMENTS_LOADED__ && retryCount < maxRetries) {
      retryCount++;
      loadScript();
    }
  }, 6000);
  try {
    document.addEventListener("visibilitychange", function() {
      if (document.visibilityState === "visible" && !window.__PI_WEB_ENHANCEMENTS_LOADED__) {
        loadScript();
      }
    });
  } catch(e) {}
  window.__PI_ENH_RELOAD__ = loadScript;
})();`;

    if (fs.existsSync(publicDir)) {
      const destLoader = path.join(publicDir, "pi-web-enhancement-loader.js");
      safeWriteFileSync(destLoader, loaderCode, "utf8");
    }

    // Explicit live deployment mode: never touch running server/SDK or client bundles.
    if (options.publicOnly === true) return;

    // If an optional source-owned loader bridge is present in public/,
    // keep it, but always continue patching layout/page chunks so guardian
    // health checks, tail throttling, and client runtime hooks stay consistent.

    // 2. Patch layout chunks (static/chunks/app/layout-*.js) with lightweight dynamic hot-loader
    const chunksDir = path.join(pkgDir, ".next", "static", "chunks", "app");
    if (fs.existsSync(chunksDir)) {

      for (const file of fs.readdirSync(chunksDir)) {
        if (file.startsWith("layout-") && file.endsWith(".js")) {
          const layoutPath = path.join(chunksDir, file);
          let content = fs.readFileSync(layoutPath, "utf8");
          const splitMarker = "\n;/* PI_WEB_ENHANCEMENTS_START */";
          if (content.includes(splitMarker)) {
            content = content.split(splitMarker)[0];
          } else if (content.includes("__PI_WEB_ENHANCEMENTS_LOADED__")) {
            // older format without marker
            const idx = content.indexOf("\n;/**\n * Pi Web Enhancements:");
            if (idx !== -1) {
              content = content.slice(0, idx);
            }
          }
          content = content + splitMarker + "\n" + loaderCode;
          safeWriteFileSync(layoutPath, content, "utf8");
        }
      }
    }

    // 3. Patch client-side static page chunks (Escape key)
    if (fs.existsSync(chunksDir)) {
      for (const file of fs.readdirSync(chunksDir)) {
        if (file.startsWith("page-") && file.endsWith(".js")) {
          const fullPath = path.join(chunksDir, file);
          let content = fs.readFileSync(fullPath, "utf8");
          let modified = false;

          const splitMarker = "\n;/* PI_WEB_ENHANCEMENTS_START */";
          if (content.includes(splitMarker)) {
            content = content.split(splitMarker)[0] + splitMarker + "\n" + loaderCode;
            modified = true;
          }

          const repairedDurationCopy = repairMalformedClientDurationCopy(content);
          if (repairedDurationCopy !== content) {
            content = repairedDurationCopy;
            modified = true;
          }

          const repairedThinking = repairStreamingThinkingLevel(content);
          if (repairedThinking !== content) {
            content = repairedThinking;
            modified = true;
          }

          const repairedShortcuts = repairStreamingSendShortcuts(content);
          if (repairedShortcuts !== content) {
            content = repairedShortcuts;
            modified = true;
          }

          const repairedMount = repairComposerInitialMount(content);
          if (repairedMount !== content) {
            content = repairedMount;
            modified = true;
          }

          // 确保新会话与草稿态下始终提供思考深度、工具预设与压缩功能，绝不漏掉
          const draftThinkingRegex = /onToolPresetChange:e\|\|[A-Za-z0-9_$]+\?([A-Za-z0-9_$]+):void 0,thinkingLevel:([A-Za-z0-9_$]+),onThinkingLevelChange:e\|\|[A-Za-z0-9_$]+\?([A-Za-z0-9_$]+):void 0/g;
          if (draftThinkingRegex.test(content)) {
            content = content.replace(draftThinkingRegex, 'onToolPresetChange:$1,thinkingLevel:$2,onThinkingLevelChange:$3');
            modified = true;
          }
          const draftCompactRegex = /onCompact:e\|\|[A-Za-z0-9_$]+\?([A-Za-z0-9_$]+):void 0/g;
          if (draftCompactRegex.test(content)) {
            content = content.replace(draftCompactRegex, 'onCompact:$1');
            modified = true;
          }

          // 彻底从原生标签页中剥离 - Pi Web 标识
          const titlePattern = /`\$\{([A-Za-z0-9_$]+)\}\s*-\s*Pi\s*Web`:\s*["']Pi\s*Web["']/g;
          if (titlePattern.test(content)) {
            content = content.replace(titlePattern, '`\${$1}`:"work"');
            modified = true;
          }

          const repairedToolbar = patchDirectToolbarControls(content);
          if (repairedToolbar !== content) {
            content = repairedToolbar;
            modified = true;
          }

          const repairedSidebarShortcuts = patchSidebarBottomShortcuts(content);
          if (repairedSidebarShortcuts !== content) {
            content = repairedSidebarShortcuts;
            modified = true;
          }

          const repairedUserMessageReconcile = patchUserMessageReconcile(content);
          if (repairedUserMessageReconcile !== content) {
            content = repairedUserMessageReconcile;
            modified = true;
          }

          // Browser GET caching can resurrect an old empty queue after the
          // selected session is remounted. SSE does not replay queue_update,
          // so every state snapshot must bypass the HTTP cache.
          const noStoreStateReads = (value) => value
            .replace(/fetch\((`\/api\/sessions\/\$\{encodeURIComponent\([^)]*\)\}\/state`)\)(?!,\{cache:"no-store"\})/g, 'fetch($1,{cache:"no-store"})')
            .replace(/fetch\((`\/api\/agent\/\$\{encodeURIComponent\([^)]*\)\}`)\)(?!,\{cache:"no-store"\})/g, 'fetch($1,{cache:"no-store"})');
          const stateReadsPatched = noStoreStateReads(content);
          if (stateReadsPatched !== content) {
            content = stateReadsPatched;
            modified = true;
          }

          const p1 = 'if("Escape"===e.key&&!a&&l&&t){e.preventDefault(),t();return}';
          const r1 = 'if(false&&"Escape"===e.key&&!a&&l&&t){e.preventDefault(),t();return}';
          if (content.includes(p1)) {
            content = content.replace(p1, r1);
            modified = true;
          }

          const p2 = 'if("Escape"===e.key){if(!l)return;let t=e.target?.tagName;if("TEXTAREA"===t||"INPUT"===t)return;e.preventDefault(),l();return}';
          const r2 = 'if(false&&"Escape"===e.key){if(!l)return;let t=e.target?.tagName;if("TEXTAREA"===t||"INPUT"===t)return;e.preventDefault(),l();return}';
          if (content.includes(p2)) {
            content = content.replace(p2, r2);
            modified = true;
          }

          // Remove the legacy total-duration injection from core chunks. The
          // durable enhancement script is the only renderer of this value.
          const pDur = ',K&&!t&&(0,r.jsxs)("button",{onClick:()=>{tn(K)';
          const rDur = ',e.turnSec&&!t&&(0,r.jsx)("div",{style:{fontSize:11,color:"#38bdf8",display:"flex",alignItems:"center",gap:3,marginLeft:e.usage?4:0,cursor:"pointer",fontWeight:500},title:"任务执行总耗时","data-total-sec":e.turnSec,"data-queue-sec":e.turnMetrics?.queueSec||0,"data-tools":JSON.stringify(e.turnMetrics?.toolCounts||{}),children:[(e.usage?"· ⏱️ ":"⏱️ "),e.turnSec<60?e.turnSec+"s":Math.floor(e.turnSec/60)+"m "+(e.turnSec%60)+"s"]})' + pDur;
          if (content.includes(rDur)) {
            content = content.replace(rDur, pDur);
            modified = true;
          }

          const turnSecCalc = 'let turnMetrics=null;if("assistant"===i.role&&u&&i.timestamp){let uIdx=-1;for(let m=t-1;m>=0;m--){if("user"===ee[m]?.role&&ee[m]?.timestamp){uIdx=m;break}}if(uIdx!==-1){let uMsg=ee[uIdx],firstAMsg=ee[uIdx+1]||i,totalSec=Math.max(1,Math.round((i.timestamp-uMsg.timestamp)/1e3)),queueSec=Math.max(0,Math.round(((firstAMsg.timestamp||i.timestamp)-uMsg.timestamp)/1e3)),toolCounts={};for(let j=uIdx+1;j<=t;j++){let cList=ee[j]?.content||[];for(let b of cList)if("toolCall"===b.type){let name=b.toolName||b.name||"tool";toolCounts[name]=(toolCounts[name]||0)+1}}turnMetrics={totalSec,queueSec,toolCounts}}}if(turnMetrics)i={...i,turnMetrics,turnSec:turnMetrics.totalSec};';
          if (content.includes(turnSecCalc)) {
            content = content.replace(turnSecCalc, "");
            modified = true;
          }

          // Older releases used slightly different JSX attributes. Match the
          // injected title and surrounding original copy-button marker rather
          // than assuming a particular minified style-object layout.
          const legacyDurationRenderer = /,e\.turnSec&&!t&&\(0,r\.jsx\)\("div",\{style:\{[^}]*\},title:"任务执行总耗时",[\s\S]*?\}\),K&&!t&&/;
          if (legacyDurationRenderer.test(content)) {
            content = content.replace(legacyDurationRenderer, ",K&&!t&&");
            modified = true;
          }
          const legacyTurnMetrics = /let turnMetrics=null;if\("assistant"===i\.role&&u&&i\.timestamp\)\{[\s\S]*?if\(turnMetrics\)i=\{\.\.\.i,turnMetrics,turnSec:turnMetrics\.totalSec\};/;
          if (legacyTurnMetrics.test(content)) {
            content = content.replace(legacyTurnMetrics, "");
            modified = true;
          }

          // Restore scrollbar on chat scroll container
          if (content.includes("[scrollbar-width:none]")) {
            content = content.replaceAll("[scrollbar-width:none]", "");
            modified = true;
          }

          // Request full history (tail 1000) on initial session load
          const pDeferClient = 'new URLSearchParams({deferThinking:"1",deferMedia:"1"})';
          const rDeferClient = 'new URLSearchParams({deferThinking:"1",deferMedia:"1",tail:"1000"})';
          if (content.includes(pDeferClient)) {
            content = content.replace(pDeferClient, rDeferClient);
            modified = true;
          }

          // Format minimap turn numbers without leading zeros (1, 2, 3... instead of 01, 02)
          const pPadClient = 'String(e.index+1).padStart(2,"0")';
          const rPadClient = 'String(e.index+1)';
          if (content.includes(pPadClient)) {
            content = content.replace(pPadClient, rPadClient);
            modified = true;
          }

          // Keep the React model selector operable while streaming. The independently
          // toggleable running-model-switch plugin owns visibility, styling and the
          // disabled-state guard; this narrow bridge only prevents React's streaming
          // prop from swallowing the native click before the plugin can handle it.
          const runningModelDisabledSource = '(t$.length>0||s||u)&&h&&(0,r.jsx)(nb,{options:t$,value:s,onChange:h,disabled:l,busy:g,isAutoSelection:a})';
          const runningModelInteractiveBridge = '(t$.length>0||s||u)&&h&&(0,r.jsx)(nb,{options:t$,value:s,onChange:h,disabled:!1,busy:g,isAutoSelection:a})';
          if (content.includes(runningModelDisabledSource)) {
            content = content.replace(runningModelDisabledSource, runningModelInteractiveBridge);
            modified = true;
          }

          // Expose a narrow client-only bridge to Pi Web's native paginated
          // context loader. The standalone minimap plugin controls when this
          // is called; keeping the React state update native preserves scroll
          // anchoring and avoids rebuilding the full session in parallel DOM.
          const minimapHistoryBridgeSource = 't1=(0,i.useCallback)(()=>{tC(e=>Math.max(e,2*ee.length))},[ee.length]),t2=';
          const minimapHistoryBridgeTarget = 't1=(0,i.useCallback)(()=>{tC(e=>Math.max(e,2*ee.length))},[ee.length]);window.__PI_ENH_GET_HISTORY_STATE__=()=>({sessionId:e?.id??eV.current??null,totalTurns:e$?.userMessages??0,hasEarlierMessages:!!ei});window.__PI_ENH_LOAD_EARLIER__=async a=>{if(tI.current||!ei||!er)return!1;let n=e?.id??eV.current;if(!n)return!1;let r=Number(a),o=Number.isFinite(r)?Math.max(50,Math.min(500,Math.round(r))):250;tI.current=!0;let l=eJ.current;l&&(tE.current=l.scrollHeight-l.scrollTop);try{return!!await tr(n,ti,er,{tail:o})}finally{tI.current=!1}};let t2=';
          if (content.includes(minimapHistoryBridgeSource)) {
            content = content.replace(minimapHistoryBridgeSource, minimapHistoryBridgeTarget);
            modified = true;
          }

          // Expose a native minimap preview close & open bridge and allow clicking
          // the currently active dot on the rail to toggle/close the preview drawer.
          const minimapCloseBridgeSource = ';(0,o.useEffect)(()=>()=>U(),[U]);';
          const minimapCloseBridgeSourceNew = ';(0,i.useEffect)(()=>()=>_(),[_]);';
          const legacyCloseBridge = ';(0,o.useEffect)(()=>{window.__PI_ENH_CLOSE_MINIMAP__=()=>{try{U();m(!1);y(null)}catch(e){}};return()=>{delete window.__PI_ENH_CLOSE_MINIMAP__;U()}},[U,m,y]);';
          const minimapCloseBridgeTarget = ';(0,o.useEffect)(()=>{window.__PI_ENH_CLOSE_MINIMAP__=()=>{try{U();m(!1);y(null)}catch(e){}};window.__PI_ENH_OPEN_MINIMAP__=(r)=>{try{U();m(!0);if(typeof r==="number")y(Math.max(0,Math.min(1,r)))}catch(e){}};window.__PI_ENH_IS_MINIMAP_OPEN__=()=>Boolean(x);return()=>{delete window.__PI_ENH_CLOSE_MINIMAP__;delete window.__PI_ENH_OPEN_MINIMAP__;delete window.__PI_ENH_IS_MINIMAP_OPEN__;U()}},[U,m,y,x]);';
          const minimapCloseBridgeTargetNew = ';(0,i.useEffect)(()=>{window.__PI_ENH_CLOSE_MINIMAP__=()=>{try{_();m(!1);b(null)}catch(e){}};window.__PI_ENH_OPEN_MINIMAP__=(r)=>{try{_();m(!0);if(typeof r==="number")b(Math.max(0,Math.min(1,r)))}catch(e){}};window.__PI_ENH_IS_MINIMAP_OPEN__=()=>Boolean(x);return()=>{delete window.__PI_ENH_CLOSE_MINIMAP__;delete window.__PI_ENH_OPEN_MINIMAP__;delete window.__PI_ENH_IS_MINIMAP_OPEN__;_()}},[_,m,b,x]);';
          if (content.includes(legacyCloseBridge)) {
            content = content.replace(legacyCloseBridge, minimapCloseBridgeTarget);
            modified = true;
          } else if (content.includes(minimapCloseBridgeSource)) {
            content = content.replace(minimapCloseBridgeSource, minimapCloseBridgeTarget);
            modified = true;
          } else if (content.includes(minimapCloseBridgeSourceNew)) {
            content = content.replace(minimapCloseBridgeSourceNew, minimapCloseBridgeTargetNew);
            modified = true;
          }

          const minimapActiveDotSource = 'let V=(0,o.useCallback)(e=>{if(!a)return;b.current=!0,q();let t=e.currentTarget.getBoundingClientRect();y(Math.max(0,Math.min(1,(e.clientY-t.top)/t.height)));let n=(e,n)=>{let r=H(Math.max(0,Math.min(1,(e-t.top)/t.height)));r&&_(r,n)};n(e.clientY,"smooth");let r=e=>{b.current&&n(e.clientY,"auto")},i=()=>{b.current=!1,window.removeEventListener("mousemove",r),window.removeEventListener("mouseup",i)};window.addEventListener("mousemove",r),window.addEventListener("mouseup",i)},[H,_,q,a])';
          const minimapActiveDotTarget = 'let V=(0,o.useCallback)(e=>{if(!a)return;let t=e.currentTarget.getBoundingClientRect(),trgt=H(Math.max(0,Math.min(1,(e.clientY-t.top)/t.height)));if(x&&trgt&&trgt.index===p){U();m(!1);y(null);return}b.current=!0,q();y(Math.max(0,Math.min(1,(e.clientY-t.top)/t.height)));let n=(e,n)=>{let r=H(Math.max(0,Math.min(1,(e-t.top)/t.height)));r&&_(r,n)};n(e.clientY,"smooth");let r=e=>{b.current&&n(e.clientY,"auto")},i=()=>{b.current=!1,window.removeEventListener("mousemove",r),window.removeEventListener("mouseup",i)};window.addEventListener("mousemove",r),window.addEventListener("mouseup",i)},[H,_,q,a,x,p,U,m,y])';
          if (content.includes(minimapActiveDotSource)) {
            content = content.replace(minimapActiveDotSource, minimapActiveDotTarget);
            modified = true;
          }

          // Route the native session-group list through the standalone
          // enhancement runtime. This preserves the original grouping and
          // recency sort while allowing the plugin to filter archives and
          // raise pinned groups without changing agent session files.
          const sessionGroupSort = 'return[...n.values()].sort((e,t)=>t.latestModified.localeCompare(e.latestModified))}';
          const sessionGroupSortHook = 'let a=[...n.values()].sort((e,t)=>t.latestModified.localeCompare(e.latestModified));try{let e=window.__PI_ENH_PROCESS_SESSION_GROUPS__;return"function"==typeof e?e(a):a}catch{return a}}';
          if (content.includes(sessionGroupSort)) {
            content = content.replace(sessionGroupSort, sessionGroupSortHook);
            modified = true;
          }

          // The enhancement runtime needs the native React refresh callback
          // so an archive or pin action takes effect immediately, without a
          // page reload or a Pi Web service restart.
          const sessionRefreshSuffix = 'finally{n===z.current&&A(!1)}},[]),tp=(0,i.useRef)(!1);';
          const sessionRefreshHook = 'finally{n===z.current&&A(!1)}},[]),tp=(window.__PI_ENH_REFRESH_SESSIONS__=(e=!1,t=!1)=>tu(e,t),window.__PI_ENH_SESSION_DELETED__=e=>{try{p?.(e)}catch{}},window.__PI_ENH_SET_UNREAD_SESSION__=(sId,isU)=>{try{e5(prev=>{let next=new Set(prev);if(isU)next.add(sId);else next.delete(sId);return next;})}catch(e){}},window.__PI_ENH_IS_SESSION_UNREAD__=(sId)=>Boolean(e8?.has?.(sId)),(0,i.useRef)(!1));';
          const previousSessionRefreshHook3 = 'finally{n===z.current&&A(!1)}},[]),tp=(window.__PI_ENH_REFRESH_SESSIONS__=(e=!1,t=!1)=>tu(e,t),window.__PI_ENH_SESSION_DELETED__=e=>{try{p?.(e)}catch{}},(0,i.useRef)(!1));';
          const previousSessionRefreshHook = 'finally{n===z.current&&A(!1)}},[]),tp=(window.__PI_ENH_REFRESH_SESSIONS__=()=>tu(),(0,i.useRef)(!1));';
          const previousSessionRefreshHook2 = 'finally{n===z.current&&A(!1)}},[]),tp=(window.__PI_ENH_REFRESH_SESSIONS__=()=>tu(),window.__PI_ENH_SESSION_DELETED__=e=>{try{p?.(e)}catch{}},(0,i.useRef)(!1));';
          const currentSessionRefreshHook = 'window.__PI_ENH_REFRESH_SESSIONS__=e,()=>{window.__PI_ENH_REFRESH_SESSIONS__===e&&delete window.__PI_ENH_REFRESH_SESSIONS__}}';
          const currentSessionRefreshTarget = 'window.__PI_ENH_REFRESH_SESSIONS__=e,window.__PI_ENH_SESSION_DELETED__=r=>{try{p?.(r)}catch{}},()=>{window.__PI_ENH_REFRESH_SESSIONS__===e&&delete window.__PI_ENH_REFRESH_SESSIONS__;delete window.__PI_ENH_SESSION_DELETED__}}';
          const legacyEffectRefreshFn = 'let e=()=>{tu()};';
          const parameterizedEffectRefreshFn = 'let e=(e=!1,t=!1)=>{tu(e,t)};';
          if (content.includes(sessionRefreshSuffix)) {
            content = content.replace(sessionRefreshSuffix, sessionRefreshHook);
            modified = true;
          } else if (content.includes(previousSessionRefreshHook3)) {
            content = content.replace(previousSessionRefreshHook3, sessionRefreshHook);
            modified = true;
          } else if (content.includes(previousSessionRefreshHook2)) {
            content = content.replace(previousSessionRefreshHook2, sessionRefreshHook);
            modified = true;
          } else if (content.includes(previousSessionRefreshHook)) {
            content = content.replace(previousSessionRefreshHook, sessionRefreshHook);
            modified = true;
          } else if (content.includes(currentSessionRefreshHook)) {
            content = content.replace(currentSessionRefreshHook, currentSessionRefreshTarget);
            modified = true;
          }
          if (content.includes(legacyEffectRefreshFn)) {
            content = content.replace(legacyEffectRefreshFn, parameterizedEffectRefreshFn);
            modified = true;
          }

          // Give the plugin stable, scoped DOM anchors for a Codex-style
          // overflow menu. The original edit/delete actions remain available
          // programmatically through this named container.
          const sessionRowPrefix = 'return(0,r.jsx)("div",{onClick:S||b?void 0:l,onContextMenu:S||b?void 0:A,';
          const sessionRowHook = 'return(0,r.jsx)("div",{"data-pi-enh-session-id":e.id,className:"pi-enh-session-row-host",onClick:S||b?void 0:l,onContextMenu:S||b?void 0:A,';
          if (content.includes(sessionRowPrefix)) {
            content = content.replace(sessionRowPrefix, sessionRowHook);
            modified = true;
          }

          // Render visual section headers (Pinned & Recents) in the sidebar
          // virtual session list with precise offset heights when pinned sessions exist.
          const sessionListHeadersSource = 'tD.length>0&&(0,r.jsx)("div",{style:{position:"relative",height:54*tD.length},children:tH.map(t=>{let n=tD[t],i=[n.root,...n.subagents],o=n.latestModified===n.root.modified?n.root:{...n.root,modified:n.latestModified};return(0,r.jsx)("div",{onFocus:()=>ta(n.root.id),onBlur:()=>ta(null),style:{position:"absolute",top:54*t,left:0,right:0},children:(0,r.jsx)(el,{session:o,isSelected:i.some(t=>t.id===e),isRunning:i.some(e=>e2.has(e.id)),isUnread:i.some(e=>e8.has(e.id)),onClick:()=>tT(n.root),onRenamed:tu,onDeleted:e=>{p?.(e),tu()}})},n.root.id)})})';
          const sessionListHeadersTarget = 'tD.length>0&&(0,r.jsx)("div",{style:{position:"relative",height:54*tD.length+(window.__PI_ENH_GET_SESSION_HEADERS_HEIGHT__?.(tD)||0)},children:[...(window.__PI_ENH_GET_SESSION_HEADERS__?.(r,tD)||[]),...tH.map(t=>{let n=tD[t],i=[n.root,...n.subagents],o=n.latestModified===n.root.modified?n.root:{...n.root,modified:n.latestModified};return(0,r.jsx)("div",{onFocus:()=>ta(n.root.id),onBlur:()=>ta(null),style:{position:"absolute",top:(window.__PI_ENH_GET_SESSION_ITEM_TOP__?.(t,tD)??54*t),left:0,right:0},children:(0,r.jsx)(el,{session:o,isSelected:i.some(t=>t.id===e),isRunning:i.some(e=>e2.has(e.id)),isUnread:i.some(e=>e8.has(e.id)),onClick:()=>tT(n.root),onRenamed:tu,onDeleted:e=>{p?.(e),tu()}})},n.root.id)})]})';
          const sessionListHeadersMalformed = 'tD.length>0&&(0,r.jsx)("div",{style:{position:"relative",height:54*tD.length+(window.__PI_ENH_GET_SESSION_HEADERS_HEIGHT__?.(tD)||0)},children:[...(window.__PI_ENH_GET_SESSION_HEADERS__?.(r,tD)||[]),...tH.map(t=>{let n=tD[t],i=[n.root,...n.subagents],o=n.latestModified===n.root.modified?n.root:{...n.root,modified:n.latestModified};return(0,r.jsx)("div",{onFocus:()=>ta(n.root.id),onBlur:()=>ta(null),style:{position:"absolute",top:(window.__PI_ENH_GET_SESSION_ITEM_TOP__?.(t,tD)??54*t),left:0,right:0},children:(0,r.jsx)(el,{session:o,isSelected:i.some(t=>t.id===e),isRunning:i.some(e=>e2.has(e.id)),isUnread:i.some(e=>e8.has(e.id)),onClick:()=>tT(n.root),onRenamed:tu,onDeleted:e=>{p?.(e),tu()}})},n.root.id)})})';
          const winSessionListHeadersSource = 't_.length>0&&(0,r.jsx)("div",{style:{position:"relative",height:54*t_.length},children:tD.map(t=>{let n=t_[t],i=[n.root,...n.subagents],o=n.latestModified===n.root.modified?n.root:{...n.root,modified:n.latestModified};return(0,r.jsx)("div",{onFocus:()=>ta(n.root.id),onBlur:()=>ta(null),style:{position:"absolute",top:54*t,left:0,right:0},children:(0,r.jsx)(ea,{session:o,isSelected:i.some(t=>t.id===e),isRunning:i.some(e=>e2.has(e.id)),isUnread:i.some(e=>e8.has(e.id)),onClick:()=>tT(n.root),onRenamed:tu,onDeleted:e=>{p?.(e),tu()}})},n.root.id)})})';
          const winSessionListHeadersTarget = 't_.length>0&&(0,r.jsx)("div",{style:{position:"relative",height:54*t_.length+(window.__PI_ENH_GET_SESSION_HEADERS_HEIGHT__?.(t_)||0)},children:[...(window.__PI_ENH_GET_SESSION_HEADERS__?.(r,t_)||[]),...tD.map(t=>{let n=t_[t],i=[n.root,...n.subagents],o=n.latestModified===n.root.modified?n.root:{...n.root,modified:n.latestModified};return(0,r.jsx)("div",{onFocus:()=>ta(n.root.id),onBlur:()=>ta(null),style:{position:"absolute",top:(window.__PI_ENH_GET_SESSION_ITEM_TOP__?.(t,t_)??54*t),left:0,right:0},children:(0,r.jsx)(ea,{session:o,isSelected:i.some(t=>t.id===e),isRunning:i.some(e=>e2.has(e.id)),isUnread:i.some(e=>e8.has(e.id)),onClick:()=>tT(n.root),onRenamed:tu,onDeleted:e=>{p?.(e),tu()}})},n.root.id)})]})';
          if (content.includes(sessionListHeadersMalformed)) {
            content = content.replace(sessionListHeadersMalformed, sessionListHeadersTarget);
            modified = true;
          } else if (content.includes(sessionListHeadersSource)) {
            content = content.replace(sessionListHeadersSource, sessionListHeadersTarget);
            modified = true;
          } else if (content.includes(winSessionListHeadersSource)) {
            content = content.replace(winSessionListHeadersSource, winSessionListHeadersTarget);
            modified = true;
          }

          // 彻底根除 Next.js 路由的 S.replace，直接替换为原生的 window.history.replaceState
          // 彻底杜绝 Next.js 16.3.1 的 RSC 请求与 Minified React error #412 ("Connection closed") 崩溃
          // 同时杜绝嵌套问题：替换后不再包含 S.replace 模式，保证 100% 幂等
          const navRegex = /([a-zA-Z0-9_$]+)\.replace\(`\?session=\$\{encodeURIComponent\(([a-zA-Z0-9_$]+(?:\.id)?)\)\}`,\{scroll:!1\}\)/g;
          if (navRegex.test(content)) {
            content = content.replace(navRegex, '(typeof window!=="undefined"?(window.__PI_ENH_SESSION_MEMORY_NAV__?.($2),window.history.replaceState(null,"",`?session=${encodeURIComponent($2)}`)):void 0)');
            modified = true;
          }

          // 彻底根除 S.replace(window.location.pathname,{scroll:!1})，替换为纯客户端安全重置 window.history.replaceState(null,"","/")
          // 杜绝切换工作区 (onCwdChange)、新建会话 (onNewSession)、删除会话 (onSessionDeleted) 时触发的破坏性 RSC 请求与 404 错误
          const pathnameNavRegex = /([a-zA-Z0-9_$]+)\.replace\(\s*(?:window\.)?location\.pathname\s*,\s*\{\s*scroll:\s*!1\s*\}\s*\)/g;
          if (pathnameNavRegex.test(content)) {
            content = content.replace(pathnameNavRegex, '(typeof window!=="undefined"?window.history.replaceState(null,"","/"):void 0)');
            modified = true;
          }

          // Expose a native session reload bridge so background cache revalidation
          // can transparently stream the latest completed messages into React state
          // without requiring a full manual browser refresh.
          const sessionReloadBridgeSource = 'finally{t&&!r&&w(!1)}},[tb,tE]),tL=';
          const sessionReloadBridgeTarget = 'finally{t&&!r&&w(!1)}},[tb,tE]),tp_enh_reload=(typeof window!=="undefined"?(window.__PI_ENH_RELOAD_CURRENT_SESSION__=(t=!1)=>{let s=e8.current;if(s)return tR(s,t,!0)},null):null),tL=';
          if (content.includes(sessionReloadBridgeSource)) {
            content = content.replace(sessionReloadBridgeSource, sessionReloadBridgeTarget);
            modified = true;
          }

          const sessionReloadBridgeSourceV2 = 'finally{t&&!r&&b(!1)}},[ty,tC]),tR=';
          const sessionReloadBridgeTargetV2 = 'finally{t&&!r&&b(!1)}},[ty,tC]),tp_enh_reload=(typeof window!=="undefined"?(window.__PI_WEB_RELOAD_SESSION__=(...args)=>tI(...args),window.__PI_ENH_RELOAD_CURRENT_SESSION__=(t=!1)=>{let s=e4.current;if(s)return tI(s,t,!0)},null):null),tR=';
          if (content.includes(sessionReloadBridgeSourceV2)) {
            content = content.replace(sessionReloadBridgeSourceV2, sessionReloadBridgeTargetV2);
            modified = true;
          }

          const nativeSessionActions = 'x&&!e.transient&&(0,r.jsxs)("div",{style:{display:"flex",gap:4,flexShrink:0},children:';
          const legacyNamedNativeSessionActions = 'x&&!e.transient&&(0,r.jsxs)("div",{className:"pi-enh-native-session-actions",style:{display:"flex",gap:4,flexShrink:0},children:';
          const namedNativeSessionActions = '!e.transient&&(0,r.jsxs)("div",{className:"pi-enh-native-session-actions",style:{display:"flex",gap:4,flexShrink:0},children:';
          if (content.includes(legacyNamedNativeSessionActions)) {
            content = content.replace(legacyNamedNativeSessionActions, namedNativeSessionActions);
            modified = true;
          } else if (content.includes(nativeSessionActions)) {
            content = content.replace(nativeSessionActions, namedNativeSessionActions);
            modified = true;
          }

          const searchResultsMap = 'h?.results.map(({session:e,entryId:t,blockIndex:n,before:i,match:o,after:a})=>(0,r.jsxs)("button",{';
          const legacySearchResultsHook = '(typeof window!=="undefined"&&window.__PI_ENH_PROCESS_SEARCH_RESULTS__?window.__PI_ENH_PROCESS_SEARCH_RESULTS__(h?.results):h?.results)?.map(({session:e,entryId:t,blockIndex:n,before:i,match:o,after:a})=>(0,r.jsxs)("button",{"data-search-session-id":e.id,';
          const legacySearchResultsHook2 = '(typeof window!=="undefined"&&window.__PI_ENH_PROCESS_SEARCH_RESULTS__?window.__PI_ENH_PROCESS_SEARCH_RESULTS__(h?.results):h?.results)?.map(({session:e,entryId:t,blockIndex:n,before:i,match:o,after:a,isArchived:d,isFirstArchived:c,archivedSearchCount:u})=>(0,r.jsxs)("button",{"data-search-session-id":e.id,"data-search-archived":d?"true":void 0,"data-search-archived-first":c?"true":void 0,"data-search-archive-divider":c?`已归档会话 · ${u} 个匹配`:void 0,';
          const legacySearchResultsHook3 = '(typeof window!=="undefined"&&window.__PI_ENH_PROCESS_SEARCH_RESULTS__?window.__PI_ENH_PROCESS_SEARCH_RESULTS__(h?.results):h?.results)?.map(({session:e,entryId:t,blockIndex:n,before:i,match:o,after:a,isArchived:d,isFirstArchived:c,archivedSearchCount:u,searchGroup:g,isOtherProject:p,isFirstOther:f,otherSearchCount:k})=>(0,r.jsxs)("button",{"data-search-session-id":e.id,"data-search-group":g||(d?"archived":"current"),"data-search-archived":d?"true":void 0,"data-search-archived-first":c?"true":void 0,"data-search-archive-divider":c?`已归档会话 · ${u} 个匹配`:void 0,"data-search-other":p?"true":void 0,"data-search-other-first":f?"true":void 0,"data-search-other-count":f?k:void 0,';
          // Keep the grouping marker in React's element props. Unlike a
          // post-render sibling insertion, React will reconcile it on every
          // keystroke and cannot leave duplicate archived dividers behind.
          const searchResultsHook = '(typeof window!=="undefined"&&window.__PI_ENH_PROCESS_SEARCH_RESULTS__?window.__PI_ENH_PROCESS_SEARCH_RESULTS__(h?.results):h?.results)?.map(({session:e,entryId:t,blockIndex:n,before:i,match:o,after:a,isArchived:d,isFirstArchived:c,archivedSearchCount:u,searchGroup:g,isOtherProject:p,isFirstOther:f,otherSearchCount:k,searchProjectKey:w,searchProjectTitle:j})=>(0,r.jsxs)("button",{"data-search-session-id":e.id,"data-search-group":g||(d?"archived":"current"),"data-search-project-key":w||void 0,"data-search-project-title":j||void 0,"data-search-archived":d?"true":void 0,"data-search-archived-first":c?"true":void 0,"data-search-archive-divider":c?`已归档会话 · ${u} 个匹配`:void 0,"data-search-other":p?"true":void 0,"data-search-other-first":f?"true":void 0,"data-search-other-count":f?k:void 0,';
          if (content.includes(searchResultsMap)) {
            content = content.replace(searchResultsMap, searchResultsHook);
            modified = true;
          } else if (content.includes(legacySearchResultsHook)) {
            content = content.replace(legacySearchResultsHook, searchResultsHook);
            modified = true;
          } else if (content.includes(legacySearchResultsHook2)) {
            content = content.replace(legacySearchResultsHook2, searchResultsHook);
            modified = true;
          } else if (content.includes(legacySearchResultsHook3)) {
            content = content.replace(legacySearchResultsHook3, searchResultsHook);
            modified = true;
          }

          // 将搜索输入防抖从 300ms 优化为 120ms，大幅提升交互灵敏度
          const searchDebounceSource = 'catch{t.signal.aborted||u({query:p,failed:!0})}},300);return()=>{clearTimeout(n),t.abort()}},[e,p,n])';
          const searchDebounceTarget = 'catch{t.signal.aborted||u({query:p,failed:!0})}},120);return()=>{clearTimeout(n),t.abort()}},[e,p,n])';
          if (content.includes(searchDebounceSource)) {
            content = content.replace(searchDebounceSource, searchDebounceTarget);
            modified = true;
          }

          // Default process details groups (ProcessDetailsGroup / rM) to
          // collapsed on mount when the task-tool-auto-collapse plugin is active.
          const rMInternalSource = 'function rM({messageCount:e,toolCallCount:t,defaultExpanded:n=!1,reveal:o=!1,children:l,t:s}){let[a,d]=(0,i.useState)(n);(0,i.useLayoutEffect)(()=>{o&&d(!0)},[o]);';
          const rMInternalTarget = 'function rM({messageCount:e,toolCallCount:t,defaultExpanded:n=!1,reveal:o=!1,children:l,t:s}){let[a,d]=(0,i.useState)((typeof window!=="undefined"&&window.__PI_ENH_IS_PLUGIN_ENABLED__&&window.__PI_ENH_IS_PLUGIN_ENABLED__("task-tool-auto-collapse"))?!1:n);(0,i.useLayoutEffect)(()=>{if(typeof window!=="undefined"&&window.__PI_ENH_IS_PLUGIN_ENABLED__&&window.__PI_ENH_IS_PLUGIN_ENABLED__("task-tool-auto-collapse"))return;o&&d(!0)},[o]);';
          if (content.includes(rMInternalSource)) {
            content = content.replace(rMInternalSource, rMInternalTarget);
            modified = true;
          }

          const processDetailsGroupSource = '(0,r.jsx)(rM,{messageCount:f.length,toolCallCount:x,defaultExpanded:!p,reveal:m,t:F,children:f})';
          const processDetailsGroupTarget = '(0,r.jsx)(rM,{messageCount:f.length,toolCallCount:x,defaultExpanded:(typeof window!=="undefined"&&window.__PI_ENH_IS_PLUGIN_ENABLED__&&window.__PI_ENH_IS_PLUGIN_ENABLED__("task-tool-auto-collapse")?!1:!p),reveal:(typeof window!=="undefined"&&window.__PI_ENH_IS_PLUGIN_ENABLED__&&window.__PI_ENH_IS_PLUGIN_ENABLED__("task-tool-auto-collapse")?!1:m),t:F,children:f})';
          if (content.includes(processDetailsGroupSource)) {
            content = content.replace(processDetailsGroupSource, processDetailsGroupTarget);
            modified = true;
          }

          // Force client-side session reload (tI) to fetch authoritative non-cached data
          // and expose window.__PI_WEB_RELOAD_SESSION__ for instant guaranteed sync on task finish
          const sessionFetchOld = 'let i=new URLSearchParams({deferThinking:"1",deferMedia:"1",tail:"1000"}),o=await fetch(`/api/sessions/${encodeURIComponent(e)}?${i}`);';
          const sessionFetchNew = 'let i=new URLSearchParams({deferThinking:"1",deferMedia:"1",tail:"1000"}),o=await fetch(`/api/sessions/${encodeURIComponent(e)}?${i}`,{cache:"no-store"});';
          if (content.includes(sessionFetchOld)) {
            content = content.replace(sessionFetchOld, sessionFetchNew);
            modified = true;
          }

          const tiEndMatch = /(finally\{t&&!r&&b\(!1\)\}\},\[[\w$,]+\]),/.exec(content);
          if (tiEndMatch && !content.includes("window.__PI_WEB_RELOAD_SESSION__")) {
            content = content.replace(tiEndMatch[0], `${tiEndMatch[1]},(typeof window!=="undefined"&&(window.__PI_WEB_RELOAD_SESSION__=tI)),`);
            modified = true;
          }

          const nativeCollapse = require("./pi-web-native-collapse-patch.js").patchNativeProcessCollapse(content);
          if (nativeCollapse.code !== content) {
            content = nativeCollapse.code;
            modified = true;
          }

          if (modified) {
            safeWriteFileSync(fullPath, content, "utf8");
          }
        }
      }
    }

    // 3.5 Patch public/sw.js to prevent stale immutable static caching
    const swPath = path.join(pkgDir, "public", "sw.js");
    if (fs.existsSync(swPath)) {
      let sw = fs.readFileSync(swPath, "utf8");
      let swMod = false;

      if (sw.includes("&& key !== STATIC_CACHE")) {
        sw = sw.replace("&& key !== STATIC_CACHE", "");
        swMod = true;
      }

      // 静态资源与增强脚本彻底移交浏览器原生网络栈，杜绝 SW 内部转发和 cache: "reload" 导致的移动端死锁与掉帧
      const checkApiOnly = 'if (url.pathname.startsWith("/api/") || url.pathname === "/sw.js") return;';
      const checkBypassStatic = 'if (url.pathname.startsWith("/api/") || url.pathname === "/sw.js" || url.pathname.startsWith("/_next/static/") || url.pathname === "/pi-web-enhancements.js") return;';
      if (sw.includes(checkApiOnly)) {
        sw = sw.replace(checkApiOnly, checkBypassStatic);
        swMod = true;
      }

      // 彻底清理旧的 PI_PATCH_SW_STATIC_RELOAD 块，全面放行原生网络栈
      const staticFetchMarker = "/* PI_PATCH_SW_STATIC_RELOAD */";
      if (sw.includes(staticFetchMarker)) {
        const sIdx = sw.indexOf(staticFetchMarker);
        const eIdx = sw.indexOf("return;\n  }", sIdx);
        if (eIdx !== -1) {
          sw = sw.slice(0, sIdx) + sw.slice(eIdx + "return;\n  }".length);
          swMod = true;
        }
      }

      if (!sw.includes("// no-esc-patch")) {
        sw = "// no-esc-patch\n" + sw;
        swMod = true;
      }

      if (!sw.includes("event.respondWith(Response.redirect(redirectUrl.href, 302))")) {
        const navSearch = 'if (request.mode === "navigate") {';
        const navPatch = `if (request.mode === "navigate") {
    const rawPath = url.pathname.replace(/^\\/+|\\/+$/g, "");
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawPath)) {
      const redirectUrl = new URL("/", self.location.origin);
      redirectUrl.search = url.search;
      redirectUrl.searchParams.set("session", rawPath);
      event.respondWith(Response.redirect(redirectUrl.href, 302));
      return;
    }`;
        if (sw.includes(navSearch)) {
          sw = sw.replace(navSearch, navPatch);
          swMod = true;
        }
      }

      if (swMod) {
        safeWriteFileSync(swPath, sw, "utf8");
      }
    }

    // Static-only deployment is the safe path for a running Pi Web service:
    // public assets and client chunks are updated, while .next/server stays
    // entirely untouched until the user chooses a separate restart window.
    if (staticOnly) return;

    // 4. Remove the retired server-HTML runtime. It can remain cached by a
    // running Next server and prevent the current layout chunk from loading.
    const indexHtmlPath = path.join(pkgDir, ".next", "server", "app", "index.html");
    if (fs.existsSync(indexHtmlPath)) {
      let html = fs.readFileSync(indexHtmlPath, "utf8");
      const tagStart = '<script id="pi-web-enhancements">';
      const tagEnd = "</script>";
      let start = html.indexOf(tagStart);
      while (start !== -1) {
        const end = html.indexOf(tagEnd, start);
        if (end === -1) break;
        html = html.slice(0, start) + html.slice(end + tagEnd.length);
        start = html.indexOf(tagStart);
      }
      safeWriteFileSync(indexHtmlPath, html, "utf8");
    }

    // 5. Patch server-side page.js (Escape key)
    const serverPage = path.join(pkgDir, ".next", "server", "app", "page.js");
    if (fs.existsSync(serverPage)) {
      let content = fs.readFileSync(serverPage, "utf8");

      // Keep server-rendered state reads consistent with the client bundle;
      // otherwise a remounted session can receive a cached empty queue.
      const stateReadsPatched = content
        .replace(/fetch\((`\/api\/sessions\/\$\{encodeURIComponent\([^)]*\)\}\/state`)\)(?!,\{cache:"no-store"\})/g, 'fetch($1,{cache:"no-store"})')
        .replace(/fetch\((`\/api\/agent\/\$\{encodeURIComponent\([^)]*\)\}`)\)(?!,\{cache:"no-store"\})/g, 'fetch($1,{cache:"no-store"})');
      if (stateReadsPatched !== content) {
        content = stateReadsPatched;
      }

      const p3 = 'if("Escape"===a.key&&!i&&e&&b){a.preventDefault(),b();return}';
      const r3 = 'if(false&&"Escape"===a.key&&!i&&e&&b){a.preventDefault(),b();return}';
      if (content.includes(p3)) {
        content = content.replace(p3, r3);
      }

      // Remove the old core-bundle duration renderer and calculation. It was
      // a duplicate, brittle injection path that could disagree with API data.
      const pDurS = ',Q&&!b&&(0,r.jsxs)("button",{onClick:()=>{pq(Q)';
      const rDurS = ',a.turnSec&&!b&&(0,r.jsx)("div",{style:{fontSize:11,color:"#38bdf8",display:"flex",alignItems:"center",gap:3,marginLeft:a.usage?4:0,cursor:"pointer",fontWeight:500},title:"任务执行总耗时","data-total-sec":a.turnSec,"data-queue-sec":a.turnMetrics?.queueSec||0,"data-tools":JSON.stringify(a.turnMetrics?.toolCounts||{}),"data-u-time":a.turnMetrics?.uTime||0,"data-a-time":a.turnMetrics?.aTime||0,children:[(a.usage?"· ⏱️ ":"⏱️ "),a.turnSec<60?a.turnSec+"s":Math.floor(a.turnSec/60)+"m "+(a.turnSec%60)+"s"]})' + pDurS;
      if (content.includes(rDurS)) {
        content = content.replace(rDurS, pDurS);
      }

      const turnSecCalcS = 'let turnMetrics=null;if("assistant"===d.role&&k&&d.timestamp){let uIdx=-1;for(let m=b-1;m>=0;m--){if("user"===$[m]?.role&&$[m]?.timestamp){uIdx=m;break}}if(uIdx!==-1){let uMsg=$[uIdx],firstAMsg=$[uIdx+1]||d,totalSec=Math.max(1,Math.round((d.timestamp-uMsg.timestamp)/1e3)),queueSec=Math.max(0,Math.round(((firstAMsg.timestamp||d.timestamp)-uMsg.timestamp)/1e3)),toolCounts={};for(let j=uIdx+1;j<=b;j++){let cList=$[j]?.content||[];for(let b of cList)if("toolCall"===b.type){let name=b.toolName||b.name||"tool";toolCounts[name]=(toolCounts[name]||0)+1}}turnMetrics={totalSec,queueSec,toolCounts,uTime:uMsg.timestamp,aTime:d.timestamp}}}if(turnMetrics)d={...d,turnMetrics,turnSec:turnMetrics.totalSec};';
      if (content.includes(turnSecCalcS)) {
        content = content.replace(turnSecCalcS, "");
      }

      const legacyServerDurationRenderer = /,a\.turnSec&&!b&&\(0,r\.jsx\)\("div",\{style:\{[^}]*\},title:"任务执行总耗时",[\s\S]*?\}\),Q&&!b&&/;
      if (legacyServerDurationRenderer.test(content)) {
        content = content.replace(legacyServerDurationRenderer, ",Q&&!b&&");
      }
      const legacyServerTurnMetrics = /let turnMetrics=null;if\("assistant"===d\.role&&k&&d\.timestamp\)\{[\s\S]*?if\(turnMetrics\)d=\{\.\.\.d,turnMetrics,turnSec:turnMetrics\.totalSec\};/;
      if (legacyServerTurnMetrics.test(content)) {
        content = content.replace(legacyServerTurnMetrics, "");
      }

      if (content.includes("[scrollbar-width:none]")) {
        content = content.replaceAll("[scrollbar-width:none]", "");
      }

      const pDeferServer = 'new URLSearchParams({deferThinking:"1",deferMedia:"1"})';
      const rDeferServer = 'new URLSearchParams({deferThinking:"1",deferMedia:"1",tail:"1000"})';
      if (content.includes(pDeferServer)) {
        content = content.replace(pDeferServer, rDeferServer);
      }

      const pPadServer = 'String(a.index+1).padStart(2,"0")';
      const rPadServer = 'String(a.index+1)';
      if (content.includes(pPadServer)) {
        content = content.replace(pPadServer, rPadServer);
      }

      safeWriteFileSync(serverPage, content, "utf8");
    }

    // 6. Repair the state route if an older duration patch left undefined
    // calcTurnMetrics/getSFile calls in the compiled handler. The client uses
    // this snapshot to hydrate queuedMessages after switching sessions.
    patchSessionStateRoute(pkgDir);

    // 7. Patch sessions/[id]/route.js to increase default tail from 50 to 1000
    const apiSessionRoute = path.join(pkgDir, ".next", "server", "app", "api", "sessions", "[id]", "route.js");
    if (fs.existsSync(apiSessionRoute)) {
      let apiContent = fs.readFileSync(apiSessionRoute, "utf8");
      const pApiTail = 'A=Number.isFinite(z)&&z>0?Math.min(z,1e3):50';
      const rApiTail = 'A=Number.isFinite(z)&&z>0?Math.min(z,1e4):1e3';
      if (apiContent.includes(pApiTail)) {
        apiContent = apiContent.replace(pApiTail, rApiTail);
        safeWriteFileSync(apiSessionRoute, apiContent, "utf8");
      }
    }

    // 8. Sync bin/patch-no-escape.js inside the package
    const binPatch = path.join(pkgDir, "bin", "patch-no-escape.js");
    if (fs.existsSync(binPatch)) {
      try {
        const ownScript = fs.readFileSync(__filename, "utf8");
        safeWriteFileSync(binPatch, ownScript, "utf8");
        // Keep the client render patch available to the package's self-healer.
        const nativePatchSource = path.join(__dirname, "pi-web-native-collapse-patch.js");
        safeWriteFileSync(path.join(pkgDir, "bin", "pi-web-native-collapse-patch.js"), fs.readFileSync(nativePatchSource, "utf8"), "utf8");
      } catch {}
    }
  } catch (err) {
    console.error("[patch-pi-web] error:", err);
    process.exitCode = 1;
  }
}

function run(options = {}) {
  const staticOnly = options.staticOnly ?? process.argv.includes("--static-only");
  const publicOnly = options.publicOnly ?? process.argv.includes("--public-only");
  const patchOptions = { staticOnly, publicOnly };

  // Candidate global package directories across Windows and Linux / Docker
  const candidates = [
    process.env.PI_WEB_DIR,
    path.join(home, "AppData", "Roaming", "npm", "node_modules", "@agegr", "pi-web"),
    "/usr/local/lib/node_modules/@agegr/pi-web",
    "/usr/lib/node_modules/@agegr/pi-web",
    path.join(home, ".workbuddy", "binaries", "node", "versions", "22.22.2-3", "lib", "node_modules", "@agegr", "pi-web"),
    "/opt/homebrew/lib/node_modules/@agegr/pi-web",
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      patchPackage(candidate, patchOptions);
    }
  }

  const localAppData = process.env.LOCALAPPDATA || path.join(home, "AppData", "Local");
  const npxBase = path.join(localAppData, "npm-cache", "_npx");
  if (fs.existsSync(npxBase)) {
    try {
      for (const hashDir of fs.readdirSync(npxBase)) {
        const candidate = path.join(npxBase, hashDir, "node_modules", "@agegr", "pi-web");
        if (fs.existsSync(candidate)) {
          patchPackage(candidate, patchOptions);
        }
      }
    } catch {}
  }
}

if (require.main === module) {
  run();
}

module.exports = { run, patchPackage, patchNoEscape: run, repairStreamingThinkingLevel, patchDirectToolbarControls, patchSidebarBottomShortcuts, repairStreamingSendShortcuts, repairComposerInitialMount, patchUserMessageReconcile };
