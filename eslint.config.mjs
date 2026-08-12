import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

const eslintConfig = [
  {
    ignores: [
      "node_modules/**",
      ".output/**",
      ".next/**",
      "public/sw.js",
      "src/routeTree.gen.ts",
    ],
  },
  {
    files: ["**/*.mjs", "**/*.cjs", "**/*.js"],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  reactHooks.configs.flat.recommended,
  {
    rules: {
      // Preserve the previous Next-preset behavior for these rules:
      // they were warnings or off under eslint-config-next, and none of
      // these code paths are new in this migration.
      "@typescript-eslint/no-unused-vars": "warn",
      "@typescript-eslint/no-unused-expressions": "warn",
      "no-empty": "off",
      "no-control-regex": "off",
      "no-useless-escape": "off",
      "no-regex-spaces": "off",
      "no-constant-binary-expression": "off",
      "no-unsafe-finally": "off",
      "react-hooks/immutability": "off",
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
];

export default eslintConfig;
