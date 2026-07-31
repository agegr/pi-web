import { readFileSync } from "fs";

interface LoadedSkill {
  name: string;
  filePath: string;
  baseDir: string;
}

export interface ExpandedMultiSkillCommand {
  text: string;
  expanded: boolean;
}

function stripFrontmatter(content: string): string {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "").trim();
}

/** 展开 Pi 原生只处理第一个的多 skill 命令；单 skill 仍交给 Pi 自己处理。 */
export function expandMultiSkillCommand(text: string, loadedSkills: LoadedSkill[]): ExpandedMultiSkillCommand {
  const match = text.match(/^((?:\/skill:[^\s]+\s+){2,})([\s\S]*)$/);
  if (!match) return { text, expanded: false };

  const names = [...match[1].matchAll(/\/skill:([^\s]+)/g)].map((item) => item[1]);
  const skills = names.map((name) => loadedSkills.find((skill) => skill.name === name));
  if (skills.some((skill) => !skill)) return { text, expanded: false };

  const blocks = skills.map((skill) => {
    const resolved = skill!;
    const body = stripFrontmatter(readFileSync(resolved.filePath, "utf-8"));
    return `<skill name="${resolved.name}" location="${resolved.filePath}">\nReferences are relative to ${resolved.baseDir}.\n\n${body}\n</skill>`;
  });
  const userMessage = match[2].trim();
  return {
    text: `${blocks.join("\n\n")}${userMessage ? `\n\n${userMessage}` : ""}`,
    expanded: true,
  };
}
