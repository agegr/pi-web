import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const SEARCH_DIRS = [
  path.join(process.env.HOME || "", ".pi", "agent", "prompts"),   // global
  path.join(process.cwd(), ".pi", "prompts"),                      // project
];

interface PromptInfo {
  name: string;
  description: string;
  content: string;
}

export async function GET() {
  const prompts: PromptInfo[] = [];

  for (const dir of SEARCH_DIRS) {
    try {
      if (!fs.existsSync(dir)) continue;
      const files = fs.readdirSync(dir).filter((f) => f.endsWith(".md"));
      for (const file of files) {
        const fullPath = path.join(dir, file);
        const content = fs.readFileSync(fullPath, "utf-8");
        const name = file.replace(/\.md$/, "");

        // Parse frontmatter for description
        const descMatch = content.match(/^---\n[\s\S]*?description:\s*(.+)\n[\s\S]*?^---\n/m);
        const description = descMatch ? descMatch[1].trim() : name;

        // Avoid duplicates (project overrides global)
        if (!prompts.some((p) => p.name === name)) {
          prompts.push({ name, description, content });
        }
      }
    } catch { /* skip dir */ }
  }

  return NextResponse.json({ prompts });
}
