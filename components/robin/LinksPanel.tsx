"use client";

import { useMemo, useState } from "react";
import { groupLinks, type Link } from "@/extension/robin/links";
import { mutate, usePolledResource } from "./usePolledResource";

interface LinksResponse {
  links: Link[];
}

export function LinksPanel() {
  const { data, error, loading, refresh } = usePolledResource<LinksResponse>("/api/robin/links", 30000);
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [group, setGroup] = useState("");
  const [adding, setAdding] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const groups = useMemo(() => groupLinks(data?.links ?? []), [data]);

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
      setAdding(false);
    });
  };

  return (
    <section
      className="flex flex-col gap-3 rounded-lg p-4"
      style={{ background: "var(--bg-panel)", border: "1px solid var(--border)" }}
    >
      <header className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold" style={{ color: "var(--text)" }}>Links</h2>
        <button
          type="button"
          onClick={() => setAdding((value) => !value)}
          className="text-xs"
          style={{ color: "var(--text-dim)" }}
        >
          {adding ? "cancel" : "+ add"}
        </button>
      </header>

      {adding && (
        <form onSubmit={addLink} className="flex flex-col gap-2">
          <input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="example.com/path"
            autoFocus
            className="rounded px-2 py-1 text-sm outline-none"
            style={{ background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text)" }}
          />
          <div className="flex gap-2">
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Name (optional)"
              className="min-w-0 flex-1 rounded px-2 py-1 text-sm outline-none"
              style={{ background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text)" }}
            />
            <input
              value={group}
              onChange={(event) => setGroup(event.target.value)}
              placeholder="Group"
              className="w-24 rounded px-2 py-1 text-sm outline-none"
              style={{ background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text)" }}
            />
            <button
              type="submit"
              disabled={!url.trim()}
              className="rounded px-3 py-1 text-sm disabled:opacity-40"
              style={{ background: "var(--accent)", color: "#fff" }}
            >
              Save
            </button>
          </div>
        </form>
      )}

      {(error || actionError) && (
        <p className="text-xs" style={{ color: "var(--accent)" }}>{actionError ?? error}</p>
      )}

      {!loading && groups.length === 0 && (
        <p className="py-2 text-sm" style={{ color: "var(--text-dim)" }}>No links saved yet.</p>
      )}

      {groups.map(({ group: name, links }) => (
        <div key={name} className="flex flex-col gap-1">
          <h3 className="text-xs font-medium uppercase tracking-wide" style={{ color: "var(--text-dim)" }}>
            {name}
          </h3>
          {links.map((link) => (
            <div
              key={link.id}
              className="group flex items-center gap-2 rounded px-2 py-1"
              style={{ background: "var(--bg-subtle)" }}
            >
              {/* noreferrer matters here: these URLs are user- and agent-supplied. */}
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
              <button
                type="button"
                onClick={() => void run(() => mutate("/api/robin/links", "DELETE", { id: link.id }))}
                aria-label={`Delete ${link.title}`}
                className="shrink-0 px-1 text-xs opacity-0 transition-opacity group-hover:opacity-100"
                style={{ color: "var(--text-dim)" }}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      ))}
    </section>
  );
}
