/** Sample plugin packages and skills.sh search results for the settings panels. */
import type { PluginsResponse, SkillSearchResult } from "@/lib/api-types";
import { AGENT_DIR, PROJECT_ROOT } from "../paths";

const notifyPath = `${AGENT_DIR}/npm/node_modules/@demo/pi-notify`;
const reviewPath = `${PROJECT_ROOT}/.pi/git/github.com/demo/pi-review-kit`;

export const PLUGINS_RESPONSE: PluginsResponse = {
  packages: [
    {
      source: "npm:@demo/pi-notify",
      scope: "global",
      canCheckForUpdates: true,
      filtered: false,
      disabled: false,
      installedPath: notifyPath,
      packageName: "@demo/pi-notify",
      version: "1.4.0",
      description: "Desktop notifications and a status-bar timer while the agent is working.",
      counts: { extensions: 1, skills: 0, prompts: 0, themes: 0 },
      resources: [
        { kind: "extension", name: "notify", path: `${notifyPath}/extensions/notify.ts`, relativePath: "extensions/notify.ts" },
      ],
      status: "loaded",
    },
    {
      source: "git:github.com/demo/pi-review-kit",
      scope: "project",
      canCheckForUpdates: true,
      filtered: false,
      disabled: false,
      installedPath: reviewPath,
      packageName: "pi-review-kit",
      version: "0.3.2",
      description: "Code review prompt templates, a reviewer skill and a high-contrast theme.",
      counts: { extensions: 0, skills: 1, prompts: 2, themes: 1 },
      resources: [
        { kind: "skill", name: "code-review", path: `${reviewPath}/skills/code-review/SKILL.md`, relativePath: "skills/code-review/SKILL.md" },
        { kind: "prompt", name: "review", path: `${reviewPath}/prompts/review.md`, relativePath: "prompts/review.md" },
        { kind: "prompt", name: "security-review", path: `${reviewPath}/prompts/security-review.md`, relativePath: "prompts/security-review.md" },
        { kind: "theme", name: "high-contrast", path: `${reviewPath}/themes/high-contrast.json`, relativePath: "themes/high-contrast.json" },
      ],
      status: "loaded",
    },
  ],
  standaloneExtensions: [],
  totals: { extensions: 1, skills: 1, prompts: 2, themes: 1 },
  diagnostics: [],
  projectResourcesLoaded: true,
};

export const SKILL_SEARCH_RESULTS: SkillSearchResult[] = [
  { package: "anthropics/skills@frontend-design", installs: "48.2K", url: "https://skills.sh/anthropics/skills/frontend-design" },
  { package: "anthropics/skills@webapp-testing", installs: "21.7K", url: "https://skills.sh/anthropics/skills/webapp-testing" },
  { package: "anthropics/skills@mcp-builder", installs: "19.9K", url: "https://skills.sh/anthropics/skills/mcp-builder" },
  { package: "anthropics/skills@skill-creator", installs: "17.3K", url: "https://skills.sh/anthropics/skills/skill-creator" },
  { package: "anthropics/skills@pdf", installs: "15.8K", url: "https://skills.sh/anthropics/skills/pdf" },
  { package: "anthropics/skills@docx", installs: "12.4K", url: "https://skills.sh/anthropics/skills/docx" },
];
