"use strict";

// These small functions run inside the client chunk, before the asynchronous
// enhancement loader. Completed history therefore has a deterministic first render.
function piEnhCollapseEnabled(id = "task-tool-auto-collapse") {
  if (typeof window === "undefined") return true;
  if (typeof window.__PI_ENH_IS_PLUGIN_ENABLED__ === "function") return window.__PI_ENH_IS_PLUGIN_ENABLED__(id);
  try {
    const config = JSON.parse(window.localStorage.getItem("pi-enh-settings-v1") || "{}");
    if (config.modules?.["conversation-navigation"]?.enabled === false) return false;
    const enabled = config.features?.[id]?.enabled;
    if (typeof enabled === "boolean") return enabled;
    return window.localStorage.getItem(`pi-enh-plugin-${id}`) !== "false";
  } catch { return true; }
}

function piEnhUseCollapsePolicy(React) {
  const [, update] = React.useState(0);
  React.useEffect(() => {
    const refresh = () => update(value => value + 1);
    window.addEventListener("pi-enh-process-collapse-change", refresh);
    return () => window.removeEventListener("pi-enh-process-collapse-change", refresh);
  }, []);
}

function withLoadedHistoryIds(code, entryIds) {
  return entryIds ? code.replace(/hasEarlierMessages:(\w+)\}\),n=async\(t=250/, `hasEarlierMessages:$1,entryIds:${entryIds}}),n=async(t=250`) : code;
}

function piEnhCollectPublicOutput(messages, startIndex, endIndex) {
  const visibleBlocks = [];
  const processByIndex = new Map();
  for (let index = Math.max(0, startIndex + 1); index <= endIndex; index += 1) {
    const message = messages[index];
    if (message?.role !== "assistant") continue;
    const processBlocks = [];
    for (const block of message.content ?? []) {
      if (block?.type === "text") {
        if (block.text?.trim()) visibleBlocks.push(block);
      } else if (block?.type === "thinking" || block?.type === "toolCall") {
        processBlocks.push(block);
      } else {
        // Unknown/future output types fail open: never hide them by default.
        visibleBlocks.push(block);
      }
    }
    processByIndex.set(index, processBlocks);
  }
  return { visibleBlocks, processByIndex };
}

// Pi Web's stock splitter treats only text after the last non-text block as an
// answer. A report followed by select_quick_action therefore disappears inside
// Process details. Keep every substantive text/image block public and fold only
// thinking/tool blocks, regardless of their position in the assistant message.
function preserveVisibleAssistantOutput(code) {
  if (code.includes("/* PI_VISIBLE_ASSISTANT_OUTPUT_V2 */")) return { code, patched: true };
  if (code.includes("/* PI_VISIBLE_ASSISTANT_OUTPUT_V1 */")) {
    const start = code.indexOf("/* PI_VISIBLE_ASSISTANT_OUTPUT_V1 */");
    const end = code.indexOf("function piEnhCollapseEnabled", start);
    if (end < 0) return { code, patched: false };
    const helper = `/* PI_VISIBLE_ASSISTANT_OUTPUT_V2 */\n${piEnhCollectPublicOutput.toString()}\n`;
    return { code: code.slice(0, start) + helper + code.slice(end), patched: true };
  }

  // Robust regex patterns supporting various minified builds and variable renamings
  const selectionRegex = /let o=function\(e,t,n\)\{for\(let i=n-1;i>t;i--\)\{var r;if\("assistant"===\(r=e\[i\]\)\.role&&(\w+)\(r\)\.answerBlocks\.some\(e=>"image"===e\.type\|\|"text"===e\.type&&e\.text\.trim\(\)\.length>0\)\)return i\}for\(let r=n-1;r>t;r--\)if\(e\[r\]\?\.role==="assistant"\)return r;return -1\}\((\w+),n,i\);/;
  const splitRegex = /let a=(\w+)\[o\],u=(\w+)\(a\),p=u\.answerBlocks\.length>0\|\|(\w+)\(a\)\?(\w+)\(a,u\.answerBlocks\):null,h=a\.content\.indexOf\(u\.answerBlocks\[0\]\),g=a\.content\.slice\(0,h<0\?void 0:h\),f=\[\],x=0,m=!1;/;
  const processMessageRegex = /let r=e===o\?(\w+)\(n,g,\{omitUsage:!!p\}\):n,i=(\w+)\(r\);/;

  const selMatch = selectionRegex.exec(code);
  const splitMatch = splitRegex.exec(code);
  const pmMatch = processMessageRegex.exec(code);

  if (selMatch && splitMatch && pmMatch) {
    const messagesVar = selMatch[2];
    const selectLastAssistant = `let o=function(e,t,n){for(let r=n-1;r>t;r--)if(e[r]?.role==="assistant")return r;return -1}(${messagesVar},n,i);`;
    const isErrorFn = splitMatch[3];
    const cloneMsgFn = splitMatch[4];
    const safeSplit = `let a=${messagesVar}[o],u=piEnhCollectPublicOutput(${messagesVar},n,o),p=u.visibleBlocks.length>0||${isErrorFn}(a)?${cloneMsgFn}(a,u.visibleBlocks):null,g=u.processByIndex,f=[],x=0,m=!1;`;
    const safeProcessMessage = `let q=g.get(e),r=${cloneMsgFn}(n,q??[],{omitUsage:e===o&&!!p}),i=${pmMatch[2]}(r);`;

    let next = code.replace(selMatch[0], selectLastAssistant)
                   .replace(splitMatch[0], safeSplit)
                   .replace(pmMatch[0], safeProcessMessage);

    const marker = /\/\* PI_NATIVE_PROCESS_COLLAPSE_V\d+ \*\//.exec(next);
    if (!marker) return { code, patched: false };
    next = next.replace(marker[0], `${marker[0]}\n/* PI_VISIBLE_ASSISTANT_OUTPUT_V2 */\n${piEnhCollectPublicOutput.toString()}`);
    return { code: next, patched: true };
  }

  // Fallback to legacy string match for historical static bundles
  const selection = 'let o=function(e,t,n){for(let i=n-1;i>t;i--){var r;if("assistant"===(r=e[i]).role&&ej(r).answerBlocks.some(e=>"image"===e.type||"text"===e.type&&e.text.trim().length>0))return i}for(let r=n-1;r>t;r--)if(e[r]?.role==="assistant")return r;return -1}(et,n,i);';
  const selectLastAssistant = 'let o=function(e,t,n){for(let r=n-1;r>t;r--)if(e[r]?.role==="assistant")return r;return -1}(et,n,i);';
  const split = 'let a=et[o],u=ej(a),p=u.answerBlocks.length>0||ew(a)?rT(a,u.answerBlocks):null,h=a.content.indexOf(u.answerBlocks[0]),g=a.content.slice(0,h<0?void 0:h),f=[],x=0,m=!1;';
  const safeSplit = 'let a=et[o],u=piEnhCollectPublicOutput(et,n,o),p=u.visibleBlocks.length>0||ew(a)?rT(a,u.visibleBlocks):null,g=u.processByIndex,f=[],x=0,m=!1;';
  const processMessage = 'let r=e===o?rT(n,g,{omitUsage:!!p}):n,i=eb(r);';
  const safeProcessMessage = 'let q=g.get(e),r=rT(n,q??[],{omitUsage:e===o&&!!p}),i=eb(r);';
  if (!code.includes(selection) || !code.includes(split) || !code.includes(processMessage)) return { code, patched: false };
  let next = code.replace(selection, selectLastAssistant).replace(split, safeSplit).replace(processMessage, safeProcessMessage);
  const marker = /\/\* PI_NATIVE_PROCESS_COLLAPSE_V\d+ \*\//.exec(next);
  if (!marker) return { code, patched: false };
  next = next.replace(marker[0], `${marker[0]}\n/* PI_VISIBLE_ASSISTANT_OUTPUT_V2 */\n${piEnhCollectPublicOutput.toString()}`);
  return { code: next, patched: true };
}

// V4 compacted completed tool steps while the task was still running. Keep the
// process visible until the turn completes; this migration removes only that
// unique live-tail insertion from already-served static client chunks.
function removeLegacyLiveFolding(code) {
  const liveFold = /;if\(__piFold&&n>=0&&\(\w+\|\|\w+\.isStreaming\)&&i===\w+\.length&&n===\w+&&i>n\+2\)i-=1/g;
  const next = code.replace(liveFold, "");
  return { code: next, patched: next !== code };
}

// Repairs the short-lived V2 patch which accidentally wrote literal `$1` / `$4`
// replacement tokens into the client chunk. Keep this path so an already-served
// static chunk self-heals on the next safe static-only synchronization.
function repairInvalidV2(code) {
  const broken = /;\$1;if\(__piFold&&\((\w+)\|\|(\w+)\.isStreaming\)&&i===(\w+)\.length&&n===(\w+)&&i>n\+2\)i-=1\$4/.exec(code);
  if (!broken) return { code, patched: false };

  const [, , , messages, lastAnchor] = broken;
  const anchor = new RegExp(`let ${lastAnchor}=-1;for\\(let e=${messages}\\.length-1;e>=0;e--\\)if\\((\\w+)\\(${messages}\\[e\\]\\)\\)\\{${lastAnchor}=e;break\\}`).exec(code);
  if (!anchor) return { code, patched: false };

  const isAnchor = anchor[1];
  const replacement = `;let __piFold=piEnhCollapseEnabled();for(let e=0;e<${messages}.length;){let t;if(!${isAnchor}(${messages}[e])&&!(e===0&&__piFold)){c.push(d(e)),e+=1;continue}let n=${isAnchor}(${messages}[e])?e:-1,i=n+1;for(;i<${messages}.length&&!${isAnchor}(${messages}[i]);)i+=1;let o=function`;
  return {
    code: code.slice(0, broken.index) + replacement + code.slice(broken.index + broken[0].length),
    patched: true,
  };
}

function patchNativeProcessCollapse(source) {
  if (source.includes('/* PI_NATIVE_PROCESS_COLLAPSE_V5 */')) {
    const visible = preserveVisibleAssistantOutput(source);
    const ids = /`process-group-\$\{(\w+)\[o\]\?\?o\}`/.exec(visible.code);
    return { code: withLoadedHistoryIds(visible.code, ids?.[1]), supported: visible.patched };
  }
  if (source.includes('/* PI_NATIVE_PROCESS_COLLAPSE_V4 */') || source.includes('/* PI_NATIVE_PROCESS_COLLAPSE_V3 */')) {
    const visible = preserveVisibleAssistantOutput(removeLegacyLiveFolding(source).code);
    if (!visible.patched) return { code: source, supported: false };
    const upgraded = visible.code.replace(/\/\* PI_NATIVE_PROCESS_COLLAPSE_V[34] \*\//, '/* PI_NATIVE_PROCESS_COLLAPSE_V5 */');
    const ids = /`process-group-\$\{(\w+)\[o\]\?\?o\}`/.exec(upgraded);
    return { code: withLoadedHistoryIds(upgraded, ids?.[1]), supported: true };
  }
  if (source.includes('/* PI_NATIVE_PROCESS_COLLAPSE_V2 */')) {
    const repaired = repairInvalidV2(source);
    const visible = preserveVisibleAssistantOutput(removeLegacyLiveFolding(repaired.patched ? repaired.code : source).code);
    if (!visible.patched) return { code: source, supported: false };
    const upgraded = visible.code.replace('/* PI_NATIVE_PROCESS_COLLAPSE_V2 */', '/* PI_NATIVE_PROCESS_COLLAPSE_V5 */');
    const ids = /`process-group-\$\{(\w+)\[o\]\?\?o\}`/.exec(upgraded);
    return { code: withLoadedHistoryIds(upgraded, ids?.[1]), supported: true };
  }
  if (source.includes('/* PI_NATIVE_PROCESS_COLLAPSE_V1 */')) {
    const visible = preserveVisibleAssistantOutput(removeLegacyLiveFolding(source).code);
    if (!visible.patched) return { code: source, supported: false };
    const upgraded = visible.code.replace('/* PI_NATIVE_PROCESS_COLLAPSE_V1 */', '/* PI_NATIVE_PROCESS_COLLAPSE_V5 */');
    const ids = /`process-group-\$\{(\w+)\[o\]\?\?o\}`/.exec(upgraded);
    return { code: withLoadedHistoryIds(upgraded, ids?.[1]), supported: true };
  }
  // Match component contracts, not its minified function name. Unknown builds
  // remain untouched rather than receiving a partial React patch.
  const group = /function (\w+)\(\{messageCount:(\w+),toolCallCount:(\w+),defaultExpanded:(\w+)=!1,reveal:(\w+)=!1,children:(\w+),t:(\w+)\}\)\{let\[(\w+),(\w+)\]=\(0,(\w+)\.useState\)\([\s\S]*?let (\w+)=\[/.exec(source);
  const chat = /function \w+\(\{session:\w+,searchTarget:[\s\S]*?\}\)\{var \w+;/.exec(source);
  const loop = /for\(let e=0;e<(\w+)\.length;\)\{let t;if\(!([\w$]+)\(\1\[e\]\)\)\{c\.push\(d\(e\)\),e\+=1;continue\}let n=e,i=n\+1;/.exec(source);
  if (!group || !chat || !loop || chat.index <= group.index) return { code: source, supported: false };
  const [, , , , initial, reveal, , , expanded, setExpanded, react, parts] = group;
  const [, messages, isAnchor] = loop;
  const emitAnchor = 'c.push(d(n));let a=';
  const liveRange = 'for(let e=n;e<i;e++)c.push(d(e));';
  const groupKey = /`process-group-\$\{(\w+)\[n\]\?\?n\}`/.exec(source);
  if (!source.includes(emitAnchor) || !source.includes(liveRange) || !groupKey) return { code: source, supported: false };

  let component = source.slice(group.index, chat.index);
  component = component.replace(group[0], group[0].slice(0, group[0].indexOf('{let[') + 1) +
    `let __piCollapsed=piEnhCollapseEnabled(),[${expanded},${setExpanded}]=(0,${react}.useState)(()=>!__piCollapsed&&${initial});` +
    `${reveal}=${reveal}&&!__piCollapsed;(0,${react}.useLayoutEffect)(()=>{${setExpanded}(!__piCollapsed&&${initial})},[__piCollapsed]);` +
    `(0,${react}.useLayoutEffect)(()=>{${reveal}&&${setExpanded}(!0)},[${reveal}]);let ${parts}=[`);
  component = component.replace('style:{marginBottom:14}', '"data-pi-enh-native-process":"true",style:{marginBottom:14}');
  const bootstrap = '/* PI_NATIVE_PROCESS_COLLAPSE_V5 */\n' + piEnhCollapseEnabled.toString() + '\n' + piEnhUseCollapsePolicy.toString() +
    '\nif(typeof window!=="undefined")window.__PI_ENH_NATIVE_PROCESS_COLLAPSE__=1;\n';
  let code = source.slice(0, group.index) + bootstrap + component + source.slice(chat.index);
  code = code.replace(chat[0], chat[0] + `piEnhUseCollapsePolicy(${react});`);
  code = code.replace(loop[0], `let __piFold=piEnhCollapseEnabled();for(let e=0;e<${messages}.length;){let t;if(!${isAnchor}(${messages}[e])&&!(e===0&&__piFold)){c.push(d(e)),e+=1;continue}let n=${isAnchor}(${messages}[e])?e:-1,i=n+1;`);
  code = code.replace(liveRange, 'for(let e=Math.max(0,n);e<i;e++)c.push(d(e));');
  code = code.replace(emitAnchor, 'n>=0&&c.push(d(n));let a=');
  // The final assistant entry is stable as older pages are prepended. Moving
  // from an orphan prefix to its real user anchor must not reset manual expansion.
  code = code.replace(groupKey[0], '`process-group-${' + groupKey[1] + '[o]??o}`');
  const visible = preserveVisibleAssistantOutput(code);
  if (!visible.patched) return { code: source, supported: false };
  code = visible.code;

  // Replace post-paint/request-time compensation with one native pre-paint
  // commit. The fetch wrapper refreshes this ref at response time, without DOM
  // scans or a 12-frame loop. Other client builds keep their native behavior.
  const restore = /\(0,(\w+)\.useEffect\)\(\(\)=>\{if\(null==(\w+)\.current\)return;let e=(\w+)\.current;if\(e\)\{var t;t=e.scrollHeight,e.scrollTop=Math.max\(0,t-\2.current\),\2.current=null\}\},\[(\w+),\3\]\)/.exec(code);
  if (restore) {
    const [, react, distance, scroll, count] = restore;
    const prepare = `(0,${react}.useLayoutEffect)(()=>{let f=()=>{let e=${scroll}.current;if(e&&piEnhCollapseEnabled("history-scroll-stability"))${distance}.current=e.scrollHeight-e.scrollTop};window.__PI_ENH_PREPARE_HISTORY_COMMIT__=f;return()=>{if(window.__PI_ENH_PREPARE_HISTORY_COMMIT__===f)delete window.__PI_ENH_PREPARE_HISTORY_COMMIT__}},[${scroll}]),`;
    code = code.replace(restore[0], prepare + restore[0].replace('.useEffect)', '.useLayoutEffect)').replace(`[${count},${scroll}]`, `[${count},${scroll},${messages}]`));
  }
  return { code: withLoadedHistoryIds(code, groupKey[1]), supported: true };
}

module.exports = { patchNativeProcessCollapse };
