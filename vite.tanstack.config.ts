import { isAbsolute, join, relative, sep, resolve } from "node:path";
import { existsSync } from "node:fs";
import { cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
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

export default defineConfig(({ command }) => {
  const configuredOutputDir = process.env.PI_WEB_TANSTACK_OUTPUT_DIR?.trim();
  const relativeOutputDir = configuredOutputDir
    ? relative(process.cwd(), configuredOutputDir)
    : "";
  const outputIsOutsideRepository = relativeOutputDir === ".."
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
    ssr: { external: EXTERNAL_PACKAGES },
    plugins: [
      tanstackStart({ srcDirectory: "src" }),
      nitro({
        preset: "node-server",
        output: { dir: outputDir },
        traceDeps: EXTERNAL_PACKAGES,
        exportConditions: ["node", "import", "production", "default"],
      }),
      viteReact(),
      copyExternalPackages(outputDir),
    ],
  };
});
