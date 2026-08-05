const { spawnSync } = require("node:child_process");

// 开发机设 PI_WEB_SKIP_BUILD=1 后 npm install 不再重复全量构建
if (process.env.PI_WEB_SKIP_BUILD) {
  console.log("PI_WEB_SKIP_BUILD set, skipping next build");
  process.exit(0);
}

// Windows 下直接 spawn npm 会找不到 .cmd 入口
const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
const result = spawnSync(npmCmd, ["run", "build"], { stdio: "inherit" });
process.exit(result.status ?? 1);
