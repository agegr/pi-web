"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { groupLinks, iconFallback, type Link } from "@/extension/robin/links";
import { mutate, usePolledResource } from "./usePolledResource";

interface LinksResponse {
  links: Link[];
}

export function LinksPanel() {
  const { t } = useI18n();
  const { data, error, loading, refresh } = usePolledResource<LinksResponse>("/api/robin/links", 30000);
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [group, setGroup] = useState("");
  // Empty string means the panel-level form; a group name means its inline form.
  const [addingGroup, setAddingGroup] = useState<string | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set(["日常入口"]));
  const [actionError, setActionError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftUrl, setDraftUrl] = useState("");
  const [reordering, setReordering] = useState(false);
  const editRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingId) editRef.current?.select();
  }, [editingId]);

  const groups = useMemo(() => groupLinks(data?.links ?? []), [data]);

  // Links saved before icons existed have never been looked up. Backfill them
  // one at a time in the background rather than blocking the list on a batch of
  // outbound requests, and only once each — `iconCheckedAt` records the attempt
  // even when the site turned out to have no icon.
  const backfilling = useRef(false);
  useEffect(() => {
    const pending = (data?.links ?? []).find((link) => !link.iconCheckedAt);
    if (!pending || backfilling.current) return;
    backfilling.current = true;
    void fetch(`/api/robin/links/icon/${pending.id}`, { method: "POST" })
      .catch(() => {})
      .finally(() => {
        backfilling.current = false;
        void refresh();
      });
  }, [data, refresh]);

  async function run(action: () => Promise<void>) {
    try {
      setActionError(null);
      await action();
      await refresh();
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  const addLink = (event: React.FormEvent) => {
    event.preventDefault();
    if (!url.trim()) return;
    void run(async () => {
      await mutate("/api/robin/links", "POST", {
        url,
        ...(title.trim() ? { title } : {}),
        ...(group.trim() ? { group } : {}),
      });
      setUrl("");
      setTitle("");
      setGroup("");
      setAddingGroup(null);
    });
  };

  const startEdit = (link: Link) => {
    setEditingId(link.id);
    setDraftTitle(link.title);
    setDraftUrl(link.url);
  };

  const commitEdit = (id: string) => {
    const title = draftTitle.trim();
    const url = draftUrl.trim();
    const original = data?.links.find((link) => link.id === id);
    setEditingId(null);
    if (!original || !title || !url) return;
    if (title === original.title && url === original.url) return;

    // Both fields go together: changing the address re-fetches the icon, and
    // sending the title alongside keeps an edited name from being overwritten
    // by the new page's own.
    void run(() => mutate("/api/robin/links", "PATCH", { id, title, url }));
  };

  const moveGroup = (index: number, offset: -1 | 1) => {
    const destination = index + offset;
    if (destination < 0 || destination >= groups.length || reordering) return;
    const order = groups.map(({ group: name }) => name);
    [order[index], order[destination]] = [order[destination], order[index]];
    setReordering(true);
    void run(() => mutate("/api/robin/links", "PATCH", {
      action: "reorderGroups",
      groups: order,
    })).finally(() => setReordering(false));
  };

  const toggleGroup = (name: string) => {
    setExpandedGroups((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
    if (expandedGroups.has(name) && addingGroup === name) setAddingGroup(null);
  };

  const toggleAdd = (name: string) => {
    if (addingGroup === name) {
      setAddingGroup(null);
      return;
    }
    setUrl("");
    setTitle("");
    // "Other" represents links without an explicit group in groupLinks().
    setGroup(name === "Other" ? "" : name);
    setAddingGroup(name);
    if (name) setExpandedGroups((current) => new Set(current).add(name));
  };

  const renderAddForm = (showGroup: boolean) => (
    <form onSubmit={addLink} className="flex flex-col gap-2">
      <input
        value={url}
        onChange={(event) => setUrl(event.target.value)}
        placeholder={t("robin.links.urlPlaceholder")}
        autoFocus
        className="rounded px-2 py-1 text-sm outline-none"
        style={{ background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text)" }}
      />
      <div className="flex gap-2">
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder={t("robin.links.namePlaceholder")}
          className="min-w-0 flex-1 rounded px-2 py-1 text-sm outline-none"
        />
        {showGroup && (
          <input
            value={group}
            onChange={(event) => setGroup(event.target.value)}
            placeholder={t("robin.links.groupPlaceholder")}
            className="w-24 rounded px-2 py-1 text-sm outline-none"
            style={{ background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text)" }}
          />
        )}
        <button
          type="submit"
          disabled={!url.trim()}
          className="ui-action ui-action--outline pi-bracket px-3 disabled:opacity-40"
          data-state="accent"
        >
          {t("robin.common.save")}
        </button>
      </div>
    </form>
  );

  return (
    <section
      className="pi-card flex flex-col gap-3 p-4"
    >
      <header className="flex items-baseline justify-between">
        <h2 className="pi-label">{t("robin.links.title")}</h2>
        <button
          type="button"
          onClick={() => toggleAdd("")}
          className="ui-action pi-chrome-label pi-bracket text-xs"
        >
          {addingGroup === "" ? t("robin.common.cancel") : t("robin.common.add")}
        </button>
      </header>

      {addingGroup === "" && renderAddForm(true)}

      {(error || actionError) && (
        <p className="text-xs" style={{ color: "var(--accent)" }}>{actionError ?? error}</p>
      )}

      {!loading && groups.length === 0 && (
        <p className="py-2 text-sm" style={{ color: "var(--text-dim)" }}>{t("robin.links.empty")}</p>
      )}

      <div className="columns-1 gap-4 split:columns-2">
      {groups.map(({ group: name, links }, index) => {
        const expanded = expandedGroups.has(name);
        const displayName = name === "Other" ? t("robin.links.otherGroup") : name;
        return (
        <div key={name} className="mb-1 flex break-inside-avoid flex-col gap-1">
          <div className="flex min-h-8 items-center gap-1">
            <button
              type="button"
              onClick={() => toggleGroup(name)}
              aria-expanded={expanded}
              className="ui-action ui-action--surface flex min-h-8 min-w-0 flex-1 items-center gap-2 rounded px-1 text-left"
            >
              <svg
                aria-hidden="true"
                width="12"
                height="12"
                viewBox="0 0 12 12"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={`shrink-0 transition-transform motion-reduce:transition-none ${expanded ? "rotate-90" : ""}`}
              >
                <polyline points="4 2.5 7.5 6 4 9.5" />
              </svg>
              <h3 className="min-w-0 flex-1 truncate text-xs font-medium uppercase tracking-wide" style={{ color: "var(--text-dim)" }}>
                {displayName}
              </h3>
              <span className="text-xs" style={{ color: "var(--text-dim)" }}>{links.length}</span>
            </button>
            <button
              type="button"
              onClick={() => toggleAdd(name)}
              aria-label={addingGroup === name
                ? t("robin.common.cancel")
                : t("robin.links.addToGroup", { group: displayName })}
              title={addingGroup === name
                ? t("robin.common.cancel")
                : t("robin.links.addToGroup", { group: displayName })}
              className="ui-action ui-action--outline-soft flex size-8 items-center justify-center rounded"
            >
              {addingGroup === name ? (
                <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                  <path d="M2.5 2.5l7 7m0-7-7 7" />
                </svg>
              ) : (
                <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                  <path d="M6 2v8M2 6h8" />
                </svg>
              )}
            </button>
            {expanded && groups.length > 1 && (
              <div className="flex gap-1">
                <button
                  type="button"
                  disabled={reordering || index === 0}
                  onClick={() => moveGroup(index, -1)}
                  aria-label={t("robin.links.moveUp", { group: displayName })}
                  title={t("robin.links.moveUp", { group: displayName })}
                  className="ui-action ui-action--outline-soft flex size-8 items-center justify-center rounded disabled:opacity-30"
                >
                  <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="2.5 7.5 6 4 9.5 7.5" />
                  </svg>
                </button>
                <button
                  type="button"
                  disabled={reordering || index === groups.length - 1}
                  onClick={() => moveGroup(index, 1)}
                  aria-label={t("robin.links.moveDown", { group: displayName })}
                  title={t("robin.links.moveDown", { group: displayName })}
                  className="ui-action ui-action--outline-soft flex size-8 items-center justify-center rounded disabled:opacity-30"
                >
                  <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="2.5 4.5 6 8 9.5 4.5" />
                  </svg>
                </button>
              </div>
            )}
          </div>
          {expanded && (
            <>
              {addingGroup === name && renderAddForm(false)}
              {links.map((link) => (
            <div
              key={link.id}
              className="group flex items-center gap-2 rounded px-2 py-1"
              style={{ background: "var(--bg-subtle)" }}
            >
              <LinkIcon link={link} />
              {editingId === link.id ? (
                // Two fields, so saving is explicit: blur-to-save would fire
                // while moving between them.
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <input
                    ref={editRef}
                    value={draftTitle}
                    onChange={(event) => setDraftTitle(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") commitEdit(link.id);
                      if (event.key === "Escape") setEditingId(null);
                    }}
                    aria-label={t("robin.links.namePlaceholder")}
                    autoFocus
                    className="w-full rounded px-1 py-0.5 text-sm outline-none"
                    style={{ background: "var(--bg)", border: "1px solid var(--accent)", color: "var(--text)" }}
                  />
                  <input
                    value={draftUrl}
                    onChange={(event) => setDraftUrl(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") commitEdit(link.id);
                      if (event.key === "Escape") setEditingId(null);
                    }}
                    aria-label={t("robin.links.urlPlaceholder")}
                    spellCheck={false}
                    className="w-full rounded px-1 py-0.5 text-xs outline-none"
                    style={{ background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text-muted)" }}
                  />
                </div>
              ) : (
                /* noreferrer matters here: these URLs are user- and agent-supplied.
                   Renaming is a button rather than a double-click: the first
                   click of a double-click has already opened the tab, and
                   delaying navigation to wait for a second click would both slow
                   every link down and get window.open caught by popup blockers. */
                <a
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="min-w-0 flex-1 truncate text-sm hover:underline"
                  style={{ color: "var(--text)" }}
                  title={link.url}
                >
                  {link.title}
                </a>
              )}
              {/* Dim rather than hidden: a hover-only control is unreachable on
                  a touch screen, and this dashboard is meant to work on a phone. */}
              <button
                type="button"
                onClick={() => (editingId === link.id ? commitEdit(link.id) : startEdit(link))}
                aria-label={t("robin.links.edit", { title: link.title })}
                title={t("robin.links.edit", { title: link.title })}
                className="shrink-0 px-1 text-xs opacity-40 transition-opacity hover:opacity-100 group-hover:opacity-100"
                style={{ color: editingId === link.id ? "var(--accent)" : "var(--text-dim)" }}
              >
                {editingId === link.id ? "✓" : "✎"}
              </button>
              <button
                type="button"
                onClick={() => (editingId === link.id
                  ? setEditingId(null)
                  : void run(() => mutate("/api/robin/links", "DELETE", { id: link.id })))}
                aria-label={editingId === link.id
                  ? t("robin.common.cancel")
                  : t("robin.links.delete", { title: link.title })}
                className="shrink-0 px-1 text-xs opacity-40 transition-opacity hover:opacity-100 group-hover:opacity-100"
                style={{ color: "var(--text-dim)" }}
              >
                ✕
              </button>
            </div>
              ))}
            </>
          )}
        </div>
        );
      })}
      </div>
    </section>
  );
}

/** The site's own icon when we have one, a deterministic tile when we do not. */
function LinkIcon({ link }: { link: Link }) {
  const [failed, setFailed] = useState(false);
  const { letter, hue } = iconFallback(link);

  if (link.icon && !failed) {
    // Served from our own cache at its natural 16px size; next/image would add
    // an optimisation proxy for no benefit and a remote-pattern allow-list for
    // images that are already local.
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        // The path alone is stable, so a refreshed icon would keep serving the
        // cached old one for a day. Keying on the fetch time changes the URL
        // exactly when the bytes change, which is what makes the long
        // Cache-Control safe.
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
      style={{
        // The hue still distinguishes one site from another, but at pi's
        // saturation: these tiles sit in a page of slate and parchment, and a
        // row of fully saturated chips would be the loudest thing on it.
        background: `hsl(${hue} 22% 42%)`,
        color: "var(--pi-moonstone)",
      }}
    >
      {letter}
    </span>
  );
}
