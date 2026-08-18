"use client";

import Link from "next/link";
import { useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { Job } from "@/extension/robin/jobs";
import { JobRow } from "./JobRow";
import { usePolledResource } from "./usePolledResource";

/** Enough to be worth a glance on the dashboard; the rest is one click away. */
const PREVIEW_COUNT = 5;

export interface JobsResponse {
  jobs: Job[];
  scan: {
    finishedAt: string;
    scanned: number;
    matched: number;
    added: number;
    sources: { id: string; name: string; count: number; error?: string }[];
  } | null;
  minScore: number;
  digestSize: number;
  configured: boolean;
}

/**
 * The dashboard's window onto the job hunt.
 *
 * Deliberately read-only apart from the scan button: this panel sits under the
 * calendar in a page you open to see your day, so it answers "is there
 * anything today" and hands off to /dashboard/jobs for everything else.
 */
export function JobsPanel() {
  const { t } = useI18n();
  const { data, error, loading, refresh } = usePolledResource<JobsResponse>("/api/robin/jobs", 60000);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  const jobs = data?.jobs ?? [];
  const fresh = jobs.filter((job) => job.status === "new");
  const preview = fresh.slice(0, PREVIEW_COUNT);

  const scan = async () => {
    setScanning(true);
    setScanError(null);
    try {
      const response = await fetch("/api/robin/jobs/scan", { method: "POST" });
      const body = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(body?.error ?? `Scan failed (${response.status})`);
      await refresh();
    } catch (caught) {
      setScanError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setScanning(false);
    }
  };

  return (
    <section className="pi-card flex flex-col gap-3 p-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-3">
          <h2 className="pi-label">{t("robin.jobs.title")}</h2>
          <span className="text-xs tabular-nums" style={{ color: "var(--text-dim)" }}>
            {t("robin.jobs.newCount", { count: String(fresh.length) })}
          </span>
        </div>
        <div className="flex items-baseline gap-3">
          <button
            type="button"
            onClick={() => void scan()}
            disabled={scanning}
            className="ui-action pi-chrome-label pi-bracket text-xs disabled:opacity-40"
          >
            {scanning ? t("robin.jobs.scanning") : t("robin.jobs.scan")}
          </button>
          <Link
            href="/dashboard/jobs"
            className="ui-action pi-chrome-label pi-bracket text-xs"
            data-state="accent"
          >
            {t("robin.jobs.manage")}
          </Link>
        </div>
      </header>

      {(error || scanError) && (
        <p className="text-xs" style={{ color: "var(--danger)" }}>{scanError ?? error}</p>
      )}

      {!loading && data && !data.configured && (
        <p className="py-2 text-sm" style={{ color: "var(--text-dim)" }}>
          {t("robin.jobs.unconfigured")}{" "}
          <Link href="/dashboard/jobs" className="underline" style={{ color: "var(--accent)" }}>
            {t("robin.jobs.manage")}
          </Link>
        </p>
      )}

      {!loading && data?.configured && preview.length === 0 && (
        <p className="py-2 text-sm" style={{ color: "var(--text-dim)" }}>{t("robin.jobs.emptyToday")}</p>
      )}

      {preview.length > 0 && (
        <div className="flex flex-col gap-1">
          {preview.map((job) => (
            <JobRow key={job.id} job={job} minScore={data?.minScore ?? 0} />
          ))}
        </div>
      )}

      {data?.scan && data.scan.sources.length === 0 && (
        <p className="pi-eyebrow">{t("robin.jobs.scanNoSources")}</p>
      )}

      {data?.scan && data.scan.sources.length > 0 && (
        <p className="pi-eyebrow">
          {t("robin.jobs.lastScan", {
            time: new Date(data.scan.finishedAt).toLocaleString(),
            scanned: String(data.scan.scanned),
            matched: String(data.scan.matched),
          })}
        </p>
      )}
    </section>
  );
}
