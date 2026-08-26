import {
  DefaultPackageManager,
  getAgentDir,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type { PluginScope, PluginUpdateResult } from "@/lib/api-types";
import { isPluginSourceCheckable, pluginUpdateKey } from "@/lib/plugin-update-utils";
import { getProjectTrustStatus } from "@/lib/project-trust";
import { runPiExtensionsUpdate } from "@/lib/pi-cli";

type PackageUpdate = {
  source: string;
  displayName: string;
  type: "npm" | "git";
  scope: "user" | "project";
};

function toPluginScope(scope: PackageUpdate["scope"]): PluginScope {
  return scope === "project" ? "project" : "global";
}

function createPackageManager(cwd: string): DefaultPackageManager {
  const agentDir = getAgentDir();
  const projectTrust = getProjectTrustStatus(cwd, agentDir);
  const settingsManager = SettingsManager.create(cwd, agentDir, {
    projectTrusted: projectTrust.trusted,
  });
  return new DefaultPackageManager({ cwd, agentDir, settingsManager });
}

function result(
  update: Pick<PackageUpdate, "source" | "displayName" | "type" | "scope">,
  state: PluginUpdateResult["state"],
  message?: string,
): PluginUpdateResult {
  const scope = toPluginScope(update.scope);
  return {
    source: update.source,
    scope,
    displayName: update.displayName,
    type: update.type,
    state,
    message,
  };
}

export async function checkPluginUpdates(
  cwd: string,
  filter?: { source?: string; scope?: PluginScope },
): Promise<PluginUpdateResult[]> {
  if (process.env.PI_OFFLINE === "1") {
    const packageManager = createPackageManager(cwd);
    const packages = packageManager.listConfiguredPackages().filter((pkg) => {
      const scope = toPluginScope(pkg.scope);
      if (filter?.source && (filter.source !== pkg.source || filter.scope !== scope)) return false;
      return isPluginSourceCheckable(pkg.source);
    });
    return packages.map((pkg) => result(
      {
        source: pkg.source,
        displayName: pkg.source,
        type: pkg.source.startsWith("npm:") ? "npm" : "git",
        scope: pkg.scope,
      },
      "error",
      "Update checks are disabled while PI_OFFLINE=1.",
    ));
  }

  const packageManager = createPackageManager(cwd);
  let available: PackageUpdate[];
  try {
    available = await packageManager.checkForAvailableUpdates();
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }

  const availableByKey = new Map(
    available.map((update) => [pluginUpdateKey(update.source, toPluginScope(update.scope)), update]),
  );

  const configured = packageManager.listConfiguredPackages().filter((pkg) => {
    const scope = toPluginScope(pkg.scope);
    if (filter?.source && (filter.source !== pkg.source || filter.scope !== scope)) return false;
    return true;
  });

  return configured.map((pkg) => {
    const scope = toPluginScope(pkg.scope);
    const match = availableByKey.get(pluginUpdateKey(pkg.source, scope));
    if (match) return result(match, "update-available");
    if (!isPluginSourceCheckable(pkg.source)) {
      return result(
        {
          source: pkg.source,
          displayName: pkg.source,
          type: pkg.source.startsWith("npm:") ? "npm" : "git",
          scope: pkg.scope,
        },
        "unsupported",
        "Pinned or local packages cannot be checked automatically.",
      );
    }
    return result(
      {
        source: pkg.source,
        displayName: pkg.source,
        type: pkg.source.startsWith("npm:") ? "npm" : "git",
        scope: pkg.scope,
      },
      "up-to-date",
    );
  });
}

export async function updateAllPlugins(cwd: string): Promise<{ stdout: string; stderr: string }> {
  if (process.env.PI_OFFLINE === "1") {
    throw new Error("Plugin updates are disabled while PI_OFFLINE=1.");
  }
  return runPiExtensionsUpdate(cwd);
}
