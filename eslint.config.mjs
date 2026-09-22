import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

const eslintConfig = [
  ...coreWebVitals,
  ...typescript,
  {
    // The Electron desktop shell (pi#30) is a self-contained CommonJS package
    // with its own runtime (Electron main process); the Next.js/TS rules —
    // including no-require-imports — do not apply to it.
    ignores: ["desktop/**"],
  },
  {
    rules: {
      "react-hooks/immutability": "off",
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
];

export default eslintConfig;
