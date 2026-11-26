import { useEffect, useState } from "react";
import { fetchSettingsSections } from "@/lib/settings-sections-client";
import type { SettingsSectionDescriptor } from "@/lib/settings-sections";

const NONE: readonly SettingsSectionDescriptor[] = Object.freeze([]);

/**
 * The Settings sections a pi extension registered (`docs/integrations.md`).
 * Empty before the extensions answer, in a page whose server has none, and when
 * the route fails — the dialog then shows the built-in sections only.
 *
 * Read on mount, which for `SettingsPanel` is once per opening: that is what
 * makes a section from a package installed meanwhile appear without a reload.
 */
export function useSettingsSections(): readonly SettingsSectionDescriptor[] {
  const [sections, setSections] = useState<readonly SettingsSectionDescriptor[]>(NONE);
  useEffect(() => {
    const controller = new AbortController();
    void fetchSettingsSections(controller.signal)
      .then((next) => { if (!controller.signal.aborted) setSections(next); })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);
  return sections;
}
