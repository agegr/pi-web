export type ResourceMobileView = "list" | "detail";

/** Nested Settings back contract shared by Models, Skills, and Plugins. */
export interface SettingsSectionController {
  handleBack(): boolean;
  mobileDetailOpen: boolean;
}

export interface SkillNavItem {
  name: string;
  description: string;
  filePath: string;
  disableModelInvocation: boolean;
}

export interface PluginNavItem {
  source: string;
  scope: "global" | "project";
  packageName?: string;
  status: string;
  resources?: { name: string }[];
}
