import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

/**
 * ESLint v9 flat config.
 *
 * Layers (last wins):
 *  1. eslint-config-next/core-web-vitals — React, accessibility, Core Web Vitals
 *  2. eslint-config-next/typescript   — @typescript-eslint rules for Next.js
 *  3. Custom overrides                 — project-specific rule tuning
 */
const eslintConfig = [
  // Flat-config compatible presets from Next.js 16
  ...coreWebVitals,
  ...typescript,

  // Global settings
  {
    name: "pi-web/global",
    linterOptions: {
      reportUnusedDisableDirectives: true,
    },
  },

  // Project-specific rule overrides
  {
    name: "pi-web/rules",
    rules: {
      // ---- React Hooks relaxations ----
      "react-hooks/immutability": "off",
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",

      // ---- @typescript-eslint additional strictness ----
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/consistent-type-imports": [
        "warn",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/array-type": ["warn", { default: "array-simple" }],
      "@typescript-eslint/no-non-null-assertion": "warn",
      // Note: type-aware rules (e.g. prefer-optional-chain, no-misused-promises)
      // are NOT enabled here. They require parserOptions.project, which
      // conflicts with eslint-config-next and would force a full type-check on
      // every lint run. Type safety is instead enforced by `tsc --noEmit` in
      // the pipeline (CI / pre-commit `npm run typecheck`).

      // ---- General code quality ----
      "no-console": ["warn", { allow: ["warn", "error"] }],
    },
  },

  // Ignore patterns (flat config equivalent of .eslintignore)
  {
    name: "pi-web/ignores",
    ignores: [
      ".next/**",
      "node_modules/**",
      "dist/**",
      "coverage/**",
      "*.min.js",
      // 已弃用/非应用目录：与 .prettierignore 对齐，避免 lint 未跟踪的 vendored 代码
      // （vendor 为第三方 SDK，.codebuddy/.atl 为内部工具，openspec/.comet 为生成态）
      "vendor/**",
      ".codebuddy/**",
      ".atl/**",
      "openspec/**/.comet",
    ],
  },
];

export default eslintConfig;
