"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useI18n } from "@/hooks/useI18n";
import { getInitialNavigation } from "@/lib/initial-navigation";

/**
 * The "Chat →" escape hatch, shared by every dashboard sub-page.
 *
 * Preserves the session or cwd from the URL when one is present, exactly like
 * the main dashboard's chat link, so "go back to the chat" lands in the same
 * conversation rather than a fresh one.
 */
export function ChatLink() {
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const { sessionId, requestedCwd: cwd } = getInitialNavigation(searchParams);

  return (
    <Link
      href={{
        pathname: "/",
        query: sessionId ? { session: sessionId } : cwd ? { cwd } : {},
      }}
      className="ui-action pi-chrome-label pi-bracket text-xs"
      data-state="accent"
    >
      {t("robin.nav.chat")}
    </Link>
  );
}
