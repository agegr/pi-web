/**
 * File extension → syntax-highlighter language mapping and path inference.
 * Shared by the chat file views and the diff viewer.
 *
 * Mirrors the server-side EXT_TO_LANGUAGE in app/api/files/[...path]/route.ts.
 */

import { getFileName } from "@/lib/file-paths";

export const EXT_TO_LANGUAGE: Record<string, string> = {
  ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
  mjs: "javascript", cjs: "javascript", py: "python", rb: "ruby",
  go: "go", rs: "rust", java: "java", kt: "kotlin", swift: "swift", sc: "scala", scala: "scala",
  c: "c", cpp: "cpp", h: "c", hpp: "cpp", cs: "csharp",
  html: "html", htm: "html", css: "css", scss: "css", less: "css",
  json: "json", jsonl: "json", yaml: "yaml", yml: "yaml",
  toml: "toml", xml: "xml", md: "markdown", mdx: "markdown",
  sh: "bash", bash: "bash", zsh: "bash", fish: "bash",
  sql: "sql", graphql: "graphql", gql: "graphql",
  dockerfile: "dockerfile", tf: "hcl", hcl: "hcl",
  dart: "dart", php: "php", pl: "perl", pm: "perl", lua: "lua", r: "r",
  clj: "clojure", cljs: "clojure", ex: "elixir", exs: "elixir", erl: "erlang", hs: "haskell",
  sass: "sass", proto: "protobuf", feature: "gherkin", diff: "diff", patch: "diff",
  env: "bash", gitignore: "bash", txt: "text",
};

export function getLanguageFromPath(filePath: string): string {
  const base = getFileName(filePath).toLowerCase();
  if (base === "dockerfile" || base.startsWith("dockerfile.")) return "dockerfile";
  if (base === ".env" || base.startsWith(".env.")) return "bash";
  if (base === "makefile" || base === "gnumakefile") return "makefile";
  const ext = base.split(".").pop() ?? "";
  return EXT_TO_LANGUAGE[ext] ?? "text";
}
