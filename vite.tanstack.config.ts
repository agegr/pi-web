import { isAbsolute, join, relative, sep, resolve } from "node:path";
import { cpSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig, type Plugin } from "vite";

const EXTERNAL_PACKAGES = [
  "undici",
  "@earendil-works/pi-coding-agent",
  "@earendil-works/pi-agent-core",
  "@earendil-works/pi-ai",
  "@earendil-works/pi-tui",
];

/**
 * Nitro traces only the import graph of externalized packages, so runtime
 * resource files (theme JSON, assets, prompts) never reach the output.
 * Copy the complete package contents after the build so the generated server
 * can load them at runtime from its own node_modules.
 */
function copyExternalPackages(outputDir: string): Plugin {
  return {
    name: "copy-external-packages",
    apply: "build",
    closeBundle() {
      const targetRoot = resolve(outputDir, "server", "node_modules");
      for (const name of EXTERNAL_PACKAGES) {
        const source = resolve(process.cwd(), "node_modules", name);
        if (!existsSync(source)) {
          console.warn(`[copy-external-packages] source not found: ${source}`);
          continue;
        }
        cpSync(source, resolve(targetRoot, name), { recursive: true, force: true });
      }
    },
  };
}

function readJsonVersion(relativePath: string): string {
  return JSON.parse(readFileSync(resolve(process.cwd(), relativePath), "utf8")).version;
}

const appPackageVersion = readJsonVersion("package.json");
const piPackageVersion = readJsonVersion("node_modules/@earendil-works/pi-coding-agent/package.json");

export default defineConfig(({ command }) => {
  const outputMode = process.env.PI_WEB_TANSTACK_OUTPUT_MODE?.trim() || "standalone";
  if (outputMode !== "standalone" && outputMode !== "publication") {
    throw new Error("PI_WEB_TANSTACK_OUTPUT_MODE must be standalone or publication");
  }
  const configuredOutputDir = process.env.PI_WEB_TANSTACK_OUTPUT_DIR?.trim();
  const relativeOutputDir = configuredOutputDir
    ? relative(process.cwd(), configuredOutputDir)
    : "";
  const outputIsOutsideRepository = relativeOutputDir === ".."
    || isAbsolute(relativeOutputDir)
    || relativeOutputDir.startsWith(`..${sep}`);
  if (
    command === "build"
    && (!configuredOutputDir || !isAbsolute(configuredOutputDir) || !outputIsOutsideRepository)
  ) {
    throw new Error("PI_WEB_TANSTACK_OUTPUT_DIR must be an absolute path outside the repository");
  }
  const outputDir = configuredOutputDir || join(tmpdir(), "pi-web-tanstack-dev");

  return {
    resolve: { tsconfigPaths: true },
    define: {
      "process.env.NEXT_PUBLIC_APP_VERSION": JSON.stringify(appPackageVersion),
      "process.env.NEXT_PUBLIC_PI_VERSION": JSON.stringify(piPackageVersion),
    },
    ssr: { external: EXTERNAL_PACKAGES, noExternal: ["@lobehub/icons"] },
    plugins: [
      tanstackStart({ srcDirectory: "src" }),
      nitro({
        preset: "node-server",
        output: { dir: outputDir },
        traceDeps: EXTERNAL_PACKAGES,
        exportConditions: ["node", "import", "production", "default"],
        routeRules: {
          "/": {
            headers: {
              "Cache-Control": "private, no-cache, max-age=0, must-revalidate",
            },
          },
          "/sw.js": {
            headers: {
              "Cache-Control": "public, max-age=0, must-revalidate",
              "Service-Worker-Allowed": "/",
            },
          },
          "/manifest.webmanifest": {
            headers: {
              "Cache-Control": "public, max-age=0, must-revalidate",
            },
          },
        },
      }),
      viteReact(),
      tailwindcss(),
      copyExternalPackages(outputDir),
    ].filter(Boolean),
  };
});
