"use strict";

const fs = require("node:fs");
const path = require("node:path");

const MARKER = "/* PI_PATCH_USAGE_DELETE_GUARD_V1 */";

const ANCHOR_DELETE = 'for(let[a,b]of(await (0,k.A4)(c)?.shutdown(),s)){try{(0,f.unlinkSync)(b)}catch(a){if("ENOENT"!==a.code)throw a}(0,i.BR)(a)}';
const REPLACEMENT_DELETE = 'await (0,k.A4)(c)?.shutdown(),__usageDeleteGuard.sealAndDeleteSync(s,a=>(0,i.BR)(a));';

const ANCHOR_IMPORTS = '[h,i,k,o]=r.then?(await r)():r,d()';
const REPLACEMENT_IMPORTS = '[h,i,k,o]=r.then?(await r)():r,__usageDeleteGuard.installSessionWriteGuard(h.SessionManager),d()';

const ANCHOR_GET = 'return(0,q.Y)(a,{sessionId:c,filePath:s,info:M,leafId:u,tree:v,context:B,stats:D,totalActiveMs:C,...void 0!==L?{toolNames:L}:{}})';
const REPLACEMENT_GET = 'return(0,q.Y)(a,{sessionId:c,filePath:s,info:M,leafId:u,tree:v,context:B,stats:D,totalActiveMs:C,...void 0!==L?{toolNames:L}:{},usageDeleteGuard:__usageDeleteGuard.GUARD_VERSION})';

function countOccurrences(str, sub) {
  let count = 0;
  let pos = 0;
  while ((pos = str.indexOf(sub, pos)) !== -1) {
    count++;
    pos += sub.length;
  }
  return count;
}

/**
 * 纯变换函数：精确匹配编译路由源码并进行补丁转换。
 * 任何 anchor 缺失或不唯一时抛错拒绝修改（fail-closed）。
 */
function transform(routeText, options = {}) {
  if (typeof routeText !== "string") {
    throw new Error("[usage-delete-patch] routeText must be a string");
  }

  if (routeText.includes(MARKER)) {
    return routeText;
  }

  const guardPath = options.guardPath || "/root/.pi/agent/scripts/pi-usage-delete-guard.cjs";
  const countDelete = countOccurrences(routeText, ANCHOR_DELETE);
  const countImports = countOccurrences(routeText, ANCHOR_IMPORTS);
  const countGet = countOccurrences(routeText, ANCHOR_GET);

  if (countDelete !== 1 || countImports !== 1 || countGet !== 1) {
    throw new Error(
      `[usage-delete-patch] Incompatible route structure: anchor mismatch (delete: ${countDelete}, imports: ${countImports}, get: ${countGet})`
    );
  }

  let patched = routeText;

  // 1. 顶层 require guard
  const topRequire = `${MARKER}\nconst __usageDeleteGuard=require(${JSON.stringify(guardPath)});\n`;
  if (patched.startsWith('"use strict";')) {
    patched = '"use strict";' + topRequire + patched.slice(12);
  } else {
    patched = topRequire + patched;
  }

  // 2. 替换 DELETE 逻辑
  patched = patched.replace(ANCHOR_DELETE, REPLACEMENT_DELETE);

  // 3. 替换异步导入完成逻辑以安装 write guard
  patched = patched.replace(ANCHOR_IMPORTS, REPLACEMENT_IMPORTS);

  // 4. 在 GET 响应中附加 usageDeleteGuard 版本
  patched = patched.replace(ANCHOR_GET, REPLACEMENT_GET);

  return patched;
}

/**
 * 检查当前 Linux 系统是否存活任何 pi-web launcher 或 next-server 进程
 */
function checkPiWebRunning(options = {}) {
  if (process.platform !== "linux") {
    return { running: true, reason: "Non-linux platform (fail-safe skip)" };
  }

  const procDir = options.procDir || "/proc";
  let pids;
  try {
    pids = fs.readdirSync(procDir).filter(name => /^\d+$/.test(name));
  } catch (err) {
    return { running: true, reason: `Cannot read ${procDir}: ${err.message}` };
  }

  const detected = [];
  for (const pidStr of pids) {
    const pid = Number(pidStr);
    if (pid === process.pid) continue;

    try {
      const cmdlinePath = path.join(procDir, pidStr, "cmdline");
      let cmdline;
      try {
        cmdline = fs.readFileSync(cmdlinePath, "utf8");
      } catch (err) {
        if (err.code === "ENOENT" || err.code === "ESRCH") {
          continue; // 瞬时退出的进程跳过
        }
        return { running: true, reason: `Fail-safe: error reading ${cmdlinePath}: ${err.message}` };
      }

      const tokens = cmdline.split("\0").filter(Boolean);
      if (tokens.length === 0) continue;

      // 排除 patch 脚本自身及测试运行器
      if (tokens.some(t => t.includes("patch-pi-web") || t.includes("usage-delete-transaction.test"))) {
        continue;
      }

      // 1. argv0 进程 title 识别：
      // - argv0 基础文件名为 pi-web 或 pi-web.js
      // - 或以 next-server 开头（例如 "next-server" 或 "next-server (v16.3.1)"）
      const argv0 = tokens[0] || "";
      const argv0Base = path.basename(argv0).toLowerCase();
      const isArgv0PiWeb = argv0Base === "pi-web" || argv0Base === "pi-web.js";
      const isArgv0NextServer = argv0Base === "next-server" || argv0.startsWith("next-server");

      // 2. Node 解释器脚本 argv1 识别：
      // 仅当 argv0 是 node 解释器时，argv1 (tokens[1]) 文件名为 pi-web 或 pi-web.js
      let isNodePiWeb = false;
      if (argv0Base === "node" || argv0Base.startsWith("node")) {
        const argv1 = tokens[1] || "";
        const argv1Base = path.basename(argv1).toLowerCase();
        if (argv1Base === "pi-web" || argv1Base === "pi-web.js") {
          isNodePiWeb = true;
        }
      }

      // 3. 检测 comm 进程名字
      let isCommMatch = false;
      try {
        const commPath = path.join(procDir, pidStr, "comm");
        if (fs.existsSync(commPath)) {
          const comm = fs.readFileSync(commPath, "utf8").trim();
          if (comm === "pi-web" || comm === "next-server") {
            isCommMatch = true;
          }
        }
      } catch (commErr) {
        if (commErr.code !== "ENOENT" && commErr.code !== "ESRCH") {
          return { running: true, reason: `Fail-safe: error reading comm for pid ${pid}: ${commErr.message}` };
        }
      }

      if (isArgv0PiWeb || isArgv0NextServer || isNodePiWeb || isCommMatch) {
        detected.push({ pid, cmdline: tokens.slice(0, 3).join(" ") });
      }
    } catch (unexpectedErr) {
      if (unexpectedErr.code === "ENOENT" || unexpectedErr.code === "ESRCH") {
        continue;
      }
      return { running: true, reason: `Fail-safe: unexpected error for pid ${pidStr}: ${unexpectedErr.message}` };
    }
  }

  if (detected.length > 0) {
    return {
      running: true,
      detected,
      reason: `pi-web launcher or next-server process active (${detected.map(d => d.pid).join(", ")})`,
    };
  }

  return { running: false };
}

/**
 * 启动期应用补丁：
 * 仅在 Linux 且确认 /proc 中没有任何运行的 Web 进程时才执行修改
 */
function applyIfStopped(pkgDir, options = {}) {
  const routePath = path.join(pkgDir, ".next", "server", "app", "api", "sessions", "[id]", "route.js");
  if (!fs.existsSync(routePath)) {
    return { applied: false, reason: `Target route not found: ${routePath}` };
  }

  const status = checkPiWebRunning(options);
  if (status.running) {
    return { applied: false, reason: status.reason, detected: status.detected };
  }

  const original = fs.readFileSync(routePath, "utf8");
  if (original.includes(MARKER)) {
    return { applied: false, reason: "Already patched with usage delete guard" };
  }

  const patched = transform(original, options);

  if (options.dryRun) {
    return { applied: false, dryRun: true, willApply: true };
  }

  // 原子备份原文件
  const backupDir = path.join(pkgDir, ".next", "server", "app", "api", "sessions", "[id]", "backups");
  fs.mkdirSync(backupDir, { recursive: true });
  const backupPath = path.join(backupDir, `route.js.bak.${Date.now()}`);
  fs.writeFileSync(backupPath, original, "utf8");

  // 原子写入新补丁文件
  const tmpPath = `${routePath}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmpPath, patched, "utf8");
  fs.renameSync(tmpPath, routePath);

  return { applied: true, backupPath, routePath };
}

module.exports = {
  MARKER,
  ANCHOR_DELETE,
  REPLACEMENT_DELETE,
  ANCHOR_IMPORTS,
  REPLACEMENT_IMPORTS,
  ANCHOR_GET,
  REPLACEMENT_GET,
  transform,
  checkPiWebRunning,
  applyIfStopped,
};
