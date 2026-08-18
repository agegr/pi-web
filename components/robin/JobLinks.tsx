"use client";

import { useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { iconFallback, type Link as SavedLink } from "@/extension/robin/links";
import { mutate, usePolledResource } from "./usePolledResource";

/**
 * The sites you actually open, seeded on request.
 *
 * Explicit titles rather than letting the fetcher find them: all three sit
 * behind a login, so the page a server-side fetch gets back is a sign-in
 * screen whose <title> is not the name of anything you recognise.
 */
const SEEDS = [
  { title: "Jobright", url: "https://jobright.ai/jobs" },
  { title: "LinkedIn Jobs", url: "https://www.linkedin.com/jobs/" },
  { title: "Handshake", url: "https://app.joinhandshake.com/" },
];

/**
 * The workspace strip: every job-hunting site you keep open, one click away.
 *
 * These are ordinary saved links filed under one group, not a second store —
 * so they also show up in the dashboard's links panel, keep their fetched
 * icons, and can be added by the agent with `link_add`. The jobs page just
 * pins one group to the top of the room you do this work in.
 */
export function JobLinks({ group }: { group: string }) {
  const { t } = useI18n();
  const { data, error, refresh } = usePolledResource<{ links: SavedLink[] }>("/api/robin/links", 60000);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const links = (data?.links ?? []).filter((link) => (link.group?.trim() || "") === group);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setActionError(null);
    try {
      await action();
      await refresh();
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  const add = (event: React.FormEvent) => {
    event.preventDefault();
    if (!url.trim()) return;
    void run(async () => {
      await mutate("/api/robin/links", "POST", { url, group });
      setUrl("");
      setAdding(false);
    });
  };

  const seed = () => {
    const known = new Set((data?.links ?? []).map((link) => link.url));
    void run(async () => {
      // One at a time: each add fetches the page's icon, and three parallel
      // outbound requests would race the same file write.
      for (const entry of SEEDS) {
        if (known.has(entry.url)) continue;
        await mutate("/api/robin/links", "POST", { ...entry, group });
      }
    });
  };

  return (
    <section className="pi-card flex flex-col gap-3 p-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="pi-label">{t("robin.jobs.linksTitle")}</h2>
        <div className="flex items-baseline gap-3">
          {links.length === 0 && (
            <button
              type="button"
              onClick={seed}
              disabled={busy}
              className="ui-action pi-chrome-label pi-bracket text-xs disabled:opacity-40"
            >
              {t("robin.jobs.linksSeed")}
            </button>
          )}
          <button
            type="button"
            onClick={() => setAdding((current) => !current)}
            className="ui-action pi-chrome-label pi-bracket text-xs"
          >
            {adding ? t("robin.common.cancel") : t("robin.common.add")}
          </button>
        </div>
      </header>

      {(actionError || error) && (
        <p className="text-xs" style={{ color: "var(--danger)" }}>{actionError ?? error}</p>
      )}

      {adding && (
        <form onSubmit={add} className="flex gap-2">
          <input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder={t("robin.links.urlPlaceholder")}
            aria-label={t("robin.links.urlPlaceholder")}
            autoFocus
            spellCheck={false}
            className="min-w-0 flex-1 rounded px-2 py-1 text-sm outline-none"
            style={{ background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text)" }}
          />
          <button
            type="submit"
            disabled={busy || !url.trim()}
            className="ui-action ui-action--outline pi-bracket px-3 disabled:opacity-40"
            data-state="accent"
          >
            {t("robin.common.save")}
          </button>
        </form>
      )}

      {links.length === 0
        ? <p className="text-sm" style={{ color: "var(--text-dim)" }}>{t("robin.jobs.linksEmpty", { group })}</p>
        : (
          <div className="flex flex-wrap gap-2">
            {links.map((link) => (
              <a
                key={link.id}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                title={link.url}
                className="ui-action ui-action--outline flex items-center gap-2 px-2.5 py-1.5 text-sm"
              >
                <LinkMark link={link} />
                {link.title}
              </a>
            ))}
          </div>
        )}
    </section>
  );
}

/** The site's own icon when the links panel cached one, a letter tile otherwise. */
function LinkMark({ link }: { link: SavedLink }) {
  const [failed, setFailed] = useState(false);
  const { letter, hue } = iconFallback(link);

  if (link.icon && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={`/api/robin/links/icon/${link.id}?v=${encodeURIComponent(link.iconCheckedAt ?? "")}`}
        alt=""
        width={16}
        height={16}
        onError={() => setFailed(true)}
        className="size-4 shrink-0 rounded-sm object-contain"
      />
    );
  }
  return (
    <span
      aria-hidden
      className="flex size-4 shrink-0 items-center justify-center text-[10px]"
      style={{ background: `hsl(${hue} 22% 42%)`, color: "var(--pi-moonstone)" }}
    >
      {letter}
    </span>
  );
}
