import { api } from "@/components/sidebar/api";
import { t as sbT } from "@/components/sidebar/locales";
import type { FileContextMenuAdapter } from "@pi-web/file-context-menu";

/** Build the host adapter the standalone @pi-web/file-context-menu package needs:
 *  launchExternal -> pi-web's open.external RPC; labels -> app i18n + the
 *  better-sidebar open-with dictionary. This is the ONLY glue pi-web ships for
 *  the package; the package itself is host-agnostic. */
export function fileContextMenuAdapter(t: (key: string) => string): FileContextMenuAdapter {
  return {
    launchExternal: (payload) => { void api.openExternal(payload).catch(() => { /* opener unavailable */ }); },
    copy: (text) => { void navigator.clipboard?.writeText(text).catch(() => { /* clipboard unavailable */ }); },
    labels: {
      open: t("files.open"),
      openInApp: t("files.openInApp"),
      copyRelative: t("files.copyRelativePath"),
      copyAbsolute: t("files.copyAbsolutePath"),
      download: t("files.download"),
      openWith: {
        explorer: sbT("openWithExplorer"),
        vscode: sbT("openWithVscode"),
        cursor: sbT("openWithCursor"),
        zed: sbT("openWithZed"),
      },
    },
  };
}
