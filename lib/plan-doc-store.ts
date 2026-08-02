// 方案文档落盘模块
// 用户在 Plan 讨论模式确认方案时（无论选择「自主编程引擎模式」还是「普通模式」），
// 都会先把方案以 Markdown 完整保存到 <repoRoot>/docs/plans/<task-slug>.md。
// 这是「自主编程引擎」改为人工决策分支后的统一产物：普通模式仅产出此文档、不启动引擎。
//
// 设计要点：
// - 纯 fs 实现，可在 node 单测中直接 import（参考 lib/unified-engine/persistence.ts）。
// - slug 支持中文（保留 CJK），与 lib/unified-engine/unified-engine-runtime.ts 内部的
//   ASCII-only slug 区分——后者用于 comet changeName，不可改动。
// - 仓库根解析：从 cwd 向上找 .git 目录或 package.json；找不到则落 cwd/docs/plans/。
// - 原子写入：tmp + rename（best-effort）。
// - 通用模板：验证命令按目标项目 package.json scripts 动态探测，缺失则用通用 npm 示例。

import { writeFileSync, existsSync, renameSync, readFileSync, mkdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import type {
  RecommendationPlan,
  OrchestratedTask,
} from "./agent-orchestrator/orchestrator-types.ts";

/** 方案执行模式（人工决策结果）。 */
export type PlanDocMode = "engine" | "plan";

/** savePlanDoc 的输入（字段与 OrchestrationSnapshot 子集对齐，便于 confirm 路由直接传入）。 */
export interface SavePlanDocInput {
  cwd: string;
  requirement: string;
  plan: RecommendationPlan;
  tasks: OrchestratedTask[];
  mode: PlanDocMode;
  /** 编排会话 id（用于追溯，可选）。 */
  orchestratorId?: string;
}

/** savePlanDoc 的返回。 */
export interface SavePlanDocResult {
  /** 方案文档绝对路径。 */
  path: string;
  /** 文件名 slug（不含扩展名）。 */
  slug: string;
}

/**
 * 方案文档 slug：保留中文/英文/数字/连字符。
 * 与引擎内部 slug（ASCII-only）不同——此处优先可读性，文件系统支持 UTF-8 文件名。
 * 规则：小写化 → 非字母数字/中文/连字符替换为 "-" → 收敛连续 "-" → trim 首尾 → 截断 40。
 * 空值兜底："plan-" + 时间戳。
 */
export function slugifyForPlanDoc(title: string): string {
  const raw = title
    .toLowerCase()
    // 保留：a-z 0-9 连字符 下划线 中文范围（CJK 统一汉字 + 扩展 A）
    .replace(/[^\p{L}\p{N}-]+/gu, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .trim();
  if (!raw) return `plan-${Date.now().toString(36)}`;
  return raw;
}

/**
 * 从 cwd 向上解析仓库根（含 .git 目录或 package.json 的最近祖先）。
 * 找不到则返回 cwd 自身（方案落 cwd/docs/plans/）。
 */
export function resolveRepoRoot(cwd: string): string {
  try {
    let dir = cwd;
    // 上限 20 层，避免极端路径死循环。
    for (let i = 0; i < 20; i++) {
      if (existsSync(join(dir, ".git")) || existsSync(join(dir, "package.json"))) {
        return dir;
      }
      const parent = dirname(dir);
      if (parent === dir) break; // 到达根。
      dir = parent;
    }
  } catch {
    // best-effort：解析失败退回 cwd。
  }
  return cwd;
}

/**
 * 探测目标项目 package.json 的 scripts，返回验证步骤建议（best-effort）。
 * 仅返回存在的脚本；解析失败返回空数组（由模板回退到通用示例）。
 */
export function detectNpmScripts(cwd: string): Array<{ key: string; cmd: string }> {
  try {
    const pkgPath = join(cwd, "package.json");
    if (!existsSync(pkgPath)) return [];
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { scripts?: Record<string, string> };
    const scripts = pkg.scripts ?? {};
    // 按常见验证场景排序筛选。
    const order = ["dev", "test", "type-check", "lint", "build", "test:coverage"];
    const out: Array<{ key: string; cmd: string }> = [];
    for (const key of order) {
      if (typeof scripts[key] === "string") out.push({ key, cmd: `npm run ${key}` });
    }
    return out;
  } catch {
    return [];
  }
}

/** 生成方案文档 Markdown（通用模板，按目标项目动态填充）。 */
export function buildPlanDocMarkdown(input: SavePlanDocInput): string {
  const { cwd, requirement, plan, tasks, mode, orchestratorId } = input;
  const now = new Date();
  const ts = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const modeLabel = mode === "engine" ? "自主编程引擎" : "普通模式（仅生成方案）";
  const scripts = detectNpmScripts(cwd);

  const verifySteps =
    scripts.length > 0
      ? scripts.map((s) => `- \`${s.cmd}\`（${s.key}）`).join("\n")
      : [
          "- `npm run dev`（启动开发服务）",
          "- `npm run type-check`（类型检查）",
          "- `npm test`（运行测试）",
        ].join("\n");

  const taskLines =
    tasks.length > 0
      ? tasks
          .slice()
          .sort((a, b) => a.order - b.order)
          .map(
            (t, i) =>
              `${i + 1}. ${t.title}${t.dependsOn.length > 0 ? `（依赖：${t.dependsOn.join(", ")}）` : ""}`,
          )
          .join("\n")
      : "- （方案未拆分出具体任务，由执行阶段细化）";

  return [
    `# 方案：${plan.title}`,
    ``,
    `> 生成时间：${ts}  `,
    `> 模式：${modeLabel}  `,
    `> 目标项目：${cwd}  `,
    `> 来源：Plan 讨论模式${orchestratorId ? ` · 编排会话 ${orchestratorId}` : ""}`,
    ``,
    `## 一、用户需求`,
    ``,
    requirement.trim() || "（未提供）",
    ``,
    `## 二、确认方案`,
    ``,
    `### 方案概述`,
    ``,
    plan.summary.trim() || "（无概述）",
    ``,
    `### 优点`,
    ...(plan.pros.length ? plan.pros.map((p) => `- ${p}`) : ["- （未列出）"]),
    ``,
    `### 缺点 / 风险`,
    ...(plan.cons.length ? plan.cons.map((c) => `- ${c}`) : ["- （未列出）"]),
    ``,
    `### 适用场景`,
    ...(plan.scenarios.length ? plan.scenarios.map((s) => `- ${s}`) : ["- （未列出）"]),
    ``,
    `## 三、是否进入自主编程引擎（人工决策记录）`,
    ``,
    `- **本次选择**：${modeLabel}`,
    `- **前置条件**（进入引擎需满足）：`,
    `  - comet CLI 可用，或已配置 \`COMET_SKIP_BUILD=1\` 降级`,
    `  - cwd 下存在 \`.comet.yaml\`（或接受默认 \`language=en\`）`,
    `  - autoplan 执行器未显式关闭（\`ENGINE_AUTOPLAN_EXECUTOR\`）`,
    `- **风险点**：`,
    `  - autoplan 执行器当前为内存桩，真实 vendor 委托需 \`ENGINE_AUTOPLAN_VENDOR=1\``,
    `  - 五阶段（open/design/build/verify/archive）全自动推进，中间无停顿`,
    `  - comet 不可用时全部降级为内存态，守卫默认放行（仅可演示，非真实校验）`,
    `- **回退路径**：`,
    `  - 引擎运行中可调 \`POST /api/engine/runs {action:"pause"}\` 暂停`,
    `  - 引擎记录在 \`~/.pi/agent/pi-web-engine-runs.jsonl\`，可清理后重跑`,
    `  - 回退到普通模式：本文件已落盘，按本方案后续章节人工执行`,
    ``,
    `## 四、功能拆分`,
    ``,
    taskLines,
    ``,
    `## 五、受影响文件清单（按目标项目结构）`,
    ``,
    `> 以下目录为参考，按目标 cwd 实际结构填写：`,
    `- \`app/\`：路由处理器（新增 /api/xxx 或改造现有 route）`,
    `- \`components/\`：React 组件（新增 XxxPanel.tsx 或拆分既有组件）`,
    `- \`hooks/\`：业务 hook（新增 useXxx.ts）`,
    `- \`lib/\`：服务端/共享模块（新增 xxx.ts 工具或适配层）`,
    `- 其他：配置文件（package.json / next.config.ts / tsconfig.json 等）`,
    ``,
    `## 六、接口契约`,
    ``,
    `（待填写：新增/改动的函数签名、类型定义、API 端点契约）`,
    ``,
    `## 七、依赖变更`,
    ``,
    `> 按目标项目 package.json 实际依赖填写，例如：`,
    `- 新增：\`@xxx/yyy@^x.y.z\`（用途说明）`,
    `- 升级：\`zzz\` x.y.z → x.y.z+1（原因）`,
    ``,
    `## 八、关键代码示例`,
    ``,
    `（待填写：伪代码或骨架，无需完整实现）`,
    ``,
    `## 九、验收标准`,
    ``,
    `- [ ] 功能验收：可观测行为符合预期`,
    `- [ ] 质量验收：类型检查 / lint 通过`,
    `- [ ] 测试验收：测试套件通过，新增测试覆盖关键场景`,
    `- [ ] 文档验收：相关 docs/ 与 AGENTS.md 索引已更新`,
    ``,
    `## 十、测试与验证步骤`,
    ``,
    `> 按目标项目脚本动态填充：`,
    verifySteps,
    ``,
    `## 十一、回滚方案`,
    ``,
    `- Git 层：\`git revert <commit>\` 或在独立分支开发后丢弃`,
    `- 数据层：清理本方案产生的持久化文件（如 \`openspec/changes/<changeName>/\`、\`pi-web-engine-runs.jsonl\`）`,
    `- 配置层：还原 package.json / 配置文件改动`,
    ``,
  ].join("\n");
}

/**
 * 保存方案文档到 <repoRoot>/docs/plans/<slug>.md。
 * 文件名冲突时追加短随机后缀。原子写入（tmp+rename）。
 * 失败抛错（由调用方决定是否 best-effort 吞掉）。
 */
export function savePlanDoc(input: SavePlanDocInput): SavePlanDocResult {
  const repoRoot = resolveRepoRoot(input.cwd);
  const plansDir = join(repoRoot, "docs", "plans");
  mkdirSync(plansDir, { recursive: true });

  const base = slugifyForPlanDoc(input.plan.title);
  let slug = base;
  let filePath = join(plansDir, `${slug}.md`);
  // 冲突重命名：追加 4 位随机。
  if (existsSync(filePath)) {
    const suffix = Math.random().toString(36).slice(2, 6);
    slug = `${base}-${suffix}`;
    filePath = join(plansDir, `${slug}.md`);
  }

  const content = buildPlanDocMarkdown(input);
  const tmp = `${filePath}.tmp`;
  writeFileSync(tmp, content, "utf8");
  renameSync(tmp, filePath);

  return { path: filePath, slug };
}

/** 仅用于测试/清理：读取已保存的方案文档内容（best-effort，缺失返回 null）。 */
export function readPlanDoc(path: string): string | null {
  try {
    if (!existsSync(path)) return null;
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

/** 仅用于测试：从绝对路径反推 slug（文件名去扩展名）。 */
export function slugFromPath(path: string): string {
  return basename(path).replace(/\.md$/, "");
}
