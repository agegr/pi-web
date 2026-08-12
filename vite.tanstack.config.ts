import { isAbsolute, join, relative, sep } from "node:path";
import { tmpdir } from "node:os";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

const EXTERNAL_PACKAGES = [
  "undici",
  "@earendil-works/pi-coding-agent",
  "@earendil-works/pi-agent-core",
  "@earendil-works/pi-ai",
  "@earendil-works/pi-tui",
];

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
      }),
      viteReact(),
    ],
  };
});
