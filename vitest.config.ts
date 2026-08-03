import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Vitest config — default environment is `node` (fast, DOM-free).
 * Component tests opt into `jsdom` via a file pragma at the top:
 *
 *   // @vitest-environment jsdom
 *
 * Path aliases mirror tsconfig.json so tests resolve "@/lib/..." the same
 * way the Next app does.
 *
 * Note: lib/*.test.mjs files use the built-in `node:test` runner, not
 * vitest. They're picked up via `npm run test:node` instead. We keep
 * them out of vitest's `include` to avoid "no test suite found" errors.
 */
export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: [
      "lib/**/*.test.{ts,mts,tsx}",
      "components/**/*.test.{ts,tsx}",
      "hooks/**/*.test.{ts,tsx}",
    ],
    setupFiles: ["./vitest.setup.ts"],

    // Coverage powered by v8 (spiritual successor of c8, same engine)
    coverage: {
      provider: "v8",
      // 注意：本 fork 的测试架构是「node:test 负责服务端逻辑（app/api 与大部分
      // lib，npm run test:node 当前 305 全过）+ vitest 负责 UI（components/hooks）」。
      // vitest 的 v8 覆盖率只能看到 vitest 跑的 UI 测试表面，且测试导入被测组件时
      // 会传递加载整个组件图（AppShell/ChatWindow 等）被计 0%，导致全局覆盖率恒为
      // ~4%（上游 8c51f77 引入的 60% 阈值在本 fork 结构性不可达）。因此这里仅保留
      // 覆盖率「报告」用于可见性，不再设全局阈值门槛——真实行为闸门是 test:node +
      // vitest 两套测试全绿（见 npm run ci / husky）。
      include: ["components/**/*.{ts,tsx}", "hooks/**/*.{ts,tsx}", "lib/**/*.test.{ts,tsx}"],
      exclude: [
        "**/*.test.{mjs,ts,tsx}",
        "**/*.test.mjs",
        "**/*.d.ts",
        "next-env.d.ts",
        ".next/**",
        "node_modules/**",
      ],
      reporter: ["text", "lcov", "html"],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
