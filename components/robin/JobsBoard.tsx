"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import {
  DEFAULT_JOB_PROFILE,
  JOB_STATUSES,
  appliedJobs,
  type Job,
  type JobProfile,
  type JobStatus,
} from "@/extension/robin/jobs";
import { ChatLink } from "./ChatLink";
import { JobFilterDialog, type FilterCatalogue } from "./JobFilterDialog";
import { JobLinks } from "./JobLinks";
import { JobRow } from "./JobRow";
import type { JobsResponse } from "./JobsPanel";
import { mutate, usePolledResource } from "./usePolledResource";

interface SweepState {
  running: boolean;
  boardsTotal: number;
  boardsDone: number;
  unreachable: number;
  scanned: number;
  matched: number;
  added: number;
  finishedAt: string | null;
  error: string | null;
  directories: { id: string; label: string; status: string; boards: number; matched: number }[];
}

interface ScoringState {
  running: boolean;
  round: number;
  totalRounds: number;
  startedWith: number;
  remaining: number;
  model: string | null;
  finishedAt: string | null;
  error: string | null;
}

interface ProfileResponse extends FilterCatalogue {
  profile: JobProfile;
}

type Filter = JobStatus | "all";

function Section({ title, children, actions }: { title: string; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <section className="pi-card flex flex-col gap-3 p-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="pi-label">{title}</h2>
        {actions}
      </header>
      {children}
    </section>
  );
}

/** First few entries, then a count — the bar summarises, the dialog details. */
function summarise(values: string[], limit: number): string {
  if (values.length === 0) return "—";
  const head = values.slice(0, limit).join(" · ");
  return values.length > limit ? `${head} +${values.length - limit}` : head;
}

/**
 * The job-hunt workspace: the sites you open, what came back, and one button
 * to the filter behind it all.
 *
 * The filter is a dialog rather than a form down the page because the two have
 * opposite rhythms — you read the discoveries daily and touch the keywords
 * monthly, so an inline form spends every day pushing the thing you came for
 * below the fold.
 */
export function JobsBoard() {
  const { t, locale } = useI18n();
  const { data, error, refresh } = usePolledResource<JobsResponse>("/api/robin/jobs", 30000);

  const [profile, setProfile] = useState<JobProfile | null>(null);
  const [catalogue, setCatalogue] = useState<FilterCatalogue | null>(null);
  const [editing, setEditing] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [busyJob, setBusyJob] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("new");
  const [preview, setPreview] = useState<string | null>(null);
  const [sweeping, setSweeping] = useState(false);

  // Polled fast only while a sweep is live — it is a progress bar, and at rest
  // it is one stale line nobody is watching.
  const sweep = usePolledResource<{ sweep: SweepState | null }>("/api/robin/jobs/sweep", 4000);
  const sweepState = sweep.data?.sweep ?? null;

  const scoring = usePolledResource<{ scoring: ScoringState | null; pending: number; model: string | null }>(
    "/api/robin/jobs/score",
    4000,
  );
  const scoringState = scoring.data?.scoring ?? null;
  const pendingCount = scoring.data?.pending ?? 0;

  const loadProfile = useCallback(async () => {
    try {
      const response = await fetch("/api/robin/jobs/profile");
      const body = await response.json().catch(() => null) as (ProfileResponse & { error?: string }) | null;
      if (!response.ok) throw new Error(body?.error ?? `Request failed (${response.status})`);
      if (!body) return;
      setProfile(body.profile);
      setCatalogue({
        providers: body.providers,
        presets: body.presets,
        starterCompanies: body.starterCompanies ?? [],
      });
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : String(caught));
    }
  }, []);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  const saveProfile = async (next: JobProfile) => {
    const response = await fetch("/api/robin/jobs/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(next),
    });
    const body = await response.json().catch(() => null) as (ProfileResponse & { error?: string }) | null;
    if (!response.ok) throw new Error(body?.error ?? `Save failed (${response.status})`);
    if (body?.profile) setProfile(body.profile);
    setNotice(t("robin.jobs.saved"));
    await refresh();
  };

  const scan = async () => {
    setScanning(true);
    setActionError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/robin/jobs/scan", { method: "POST" });
      const body = await response.json().catch(() => null) as
        {
          scan?: {
            scanned: number;
            matched: number;
            added: number;
            sources: { name: string; error?: string }[];
          };
          error?: string;
        } | null;
      if (!response.ok) throw new Error(body?.error ?? `Scan failed (${response.status})`);
      await refresh();
      if (body?.scan) {
        const failed = body.scan.sources.filter((source) => source.error);
        // A scan with no sources finishes in milliseconds and reports zero of
        // everything, which reads exactly like "nothing new today". Say which
        // one it was, or the empty result looks like a broken scanner.
        setNotice(body.scan.sources.length === 0
          ? t("robin.jobs.scanNoSources")
          : t("robin.jobs.scanDone", {
            scanned: String(body.scan.scanned),
            matched: String(body.scan.matched),
            added: String(body.scan.added),
          }));
        // A board that 404s is the single most likely reason a scan came back
        // thin, and it is invisible unless the page says so.
        if (failed.length > 0) {
          setActionError(t("robin.jobs.scanFailures", {
            detail: failed.map((source) => `${source.name}: ${source.error}`).join(" · "),
          }));
        }
      }
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setScanning(false);
    }
  };

  /**
   * Start the reverse sweep. It returns immediately — the run outlives the
   * request, and the progress line below is how you watch it.
   */
  const startSweep = async () => {
    setSweeping(true);
    setActionError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/robin/jobs/sweep", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resume: true }),
      });
      const body = await response.json().catch(() => null) as
        { started?: boolean; reason?: string; error?: string } | null;
      if (!response.ok) throw new Error(body?.error ?? `Sweep failed (${response.status})`);
      setNotice(body?.started ? t("robin.jobs.sweepStarted") : t("robin.jobs.sweepAlreadyRunning"));
      await sweep.refresh();
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSweeping(false);
    }
  };

  /** Score the backlog. Returns at once; the bar below is how you watch it. */
  const startScoring = async () => {
    setActionError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/robin/jobs/score", { method: "POST" });
      const body = await response.json().catch(() => null) as
        { started?: boolean; reason?: string; error?: string } | null;
      if (!response.ok) throw new Error(body?.error ?? `Scoring failed (${response.status})`);
      setNotice(body?.started
        ? t("robin.jobs.scoringStarted")
        : body?.reason === "nothing-pending"
          ? t("robin.jobs.scoringNothing")
          : t("robin.jobs.scoringAlreadyRunning"));
      await scoring.refresh();
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  /** Shows what the next push would carry without consuming the queue. */
  const previewDigest = async () => {
    setActionError(null);
    try {
      const response = await fetch("/api/robin/jobs/digest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preview: true, locale: locale.startsWith("zh") ? "zh" : "en" }),
      });
      const body = await response.json().catch(() => null) as { text?: string; error?: string } | null;
      if (!response.ok) throw new Error(body?.error ?? `Request failed (${response.status})`);
      setPreview(body?.text ?? "");
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  const act = async (id: string, action: () => Promise<void>) => {
    setBusyJob(id);
    setActionError(null);
    try {
      await action();
      await refresh();
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusyJob(null);
    }
  };

  // Memoised so the identity is stable: `data?.jobs ?? []` would hand the
  // counts a fresh array on every render and re-tally the whole list each time.
  const jobs = useMemo(() => data?.jobs ?? [], [data]);
  const counts = useMemo(() => {
    const tally = new Map<Filter, number>([["all", jobs.length]]);
    for (const status of JOB_STATUSES) {
      tally.set(status, jobs.filter((job) => job.status === status).length);
    }
    return tally;
  }, [jobs]);
  // The applied list is a log, not a ranking: you browse it by when you sent
  // things, and the score that got it there stopped mattering the moment you did.
  const visible = filter === "all"
    ? jobs
    : filter === "applied"
      ? appliedJobs(jobs)
      : jobs.filter((job) => job.status === filter);

  const enabledCompanies = profile?.companies.filter((company) => company.enabled).length ?? 0;

  return (
    <div className="robin-dashboard flex-1 overflow-y-auto" style={{ minHeight: 0 }}>
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4 desktop:p-6">
        <header className="flex flex-wrap items-baseline justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-3xl" style={{ fontStyle: "italic", fontWeight: 400, color: "var(--text)" }}>
              {t("robin.jobs.title")}
            </h1>
            <p className="pi-eyebrow">{t("robin.jobs.subtitle")}</p>
          </div>
          <nav className="flex items-baseline gap-3">
            <button
              type="button"
              onClick={() => void scan()}
              disabled={scanning}
              className="ui-action pi-chrome-label pi-bracket text-xs disabled:opacity-40"
            >
              {scanning ? t("robin.jobs.scanning") : t("robin.jobs.scan")}
            </button>
            <button
              type="button"
              onClick={() => void startScoring()}
              disabled={scoringState?.running === true || pendingCount === 0}
              className="ui-action pi-chrome-label pi-bracket text-xs disabled:opacity-40"
              data-state={pendingCount > 0 && !scoringState?.running ? "accent" : "muted"}
            >
              {scoringState?.running
                ? t("robin.jobs.scoringBusy")
                : t("robin.jobs.score", { count: String(pendingCount) })}
            </button>
            <button
              type="button"
              onClick={() => void startSweep()}
              disabled={sweeping || sweepState?.running === true}
              className="ui-action pi-chrome-label pi-bracket text-xs disabled:opacity-40"
            >
              {sweepState?.running ? t("robin.jobs.sweeping") : t("robin.jobs.sweep")}
            </button>
            <Link href="/dashboard" className="ui-action pi-chrome-label pi-bracket text-xs">
              {t("robin.nav.back")}
            </Link>
            <ChatLink />
          </nav>
        </header>

        {(actionError || error) && (
          <p className="text-sm" style={{ color: "var(--danger)" }}>{actionError ?? error}</p>
        )}
        {notice && <p className="text-sm" style={{ color: "var(--accent)" }}>{notice}</p>}

        <JobLinks group={profile?.linkGroup || DEFAULT_JOB_PROFILE.linkGroup} />

        {/* ── Filter summary ──────────────────────────────────────────── */}
        {profile && (
          <Section
            title={t("robin.jobs.filterTitle")}
            actions={(
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="ui-action pi-chrome-label pi-bracket text-xs"
                data-state="accent"
              >
                {t("robin.jobs.filterEdit")}
              </button>
            )}
          >
            <dl className="grid gap-x-6 gap-y-2 split:grid-cols-2">
              {[
                { key: "roles", value: summarise(profile.titles, 4) },
                {
                  key: "locations",
                  value: profile.locationAllow.length === 0
                    ? t("robin.jobs.summaryAnywhere")
                    : summarise(profile.locationAllow, 4),
                },
                {
                  key: "sources",
                  value: t("robin.jobs.summarySources", {
                    companies: String(enabledCompanies),
                    feeds: String(profile.boards.length),
                  }),
                },
                {
                  key: "delivery",
                  value: t("robin.jobs.summaryDelivery", {
                    days: String(profile.sinceDays),
                    score: profile.minScore.toFixed(1),
                    count: String(profile.digestSize),
                  }),
                },
              ].map(({ key, value }) => (
                <div key={key} className="flex min-w-0 gap-3">
                  <dt className="pi-eyebrow shrink-0" style={{ width: "5.5rem" }}>
                    {t(`robin.jobs.summary.${key}`)}
                  </dt>
                  <dd className="min-w-0 flex-1 truncate text-sm" style={{ color: "var(--copy)" }} title={value}>
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
            {profile.excludeTitles.length > 0 && (
              <p className="text-xs" style={{ color: "var(--text-dim)" }}>
                {t("robin.jobs.summaryExcluding", { list: summarise(profile.excludeTitles, 6) })}
              </p>
            )}
          </Section>
        )}

        {/* ── Scoring progress ────────────────────────────────────────── */}
        {scoringState && (scoringState.running || scoringState.startedWith > 0) && (
          <Section title={t("robin.jobs.scoringTitle")}>
            <div className="flex flex-col gap-2">
              <div
                className="h-1.5 w-full overflow-hidden"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={scoringState.startedWith || 1}
                aria-valuenow={scoringState.startedWith - scoringState.remaining}
                aria-label={t("robin.jobs.scoringTitle")}
                style={{ background: "var(--bg-subtle)", border: "1px solid var(--border)" }}
              >
                <div
                  style={{
                    width: `${Math.min(100, ((scoringState.startedWith - scoringState.remaining)
                      / Math.max(scoringState.startedWith, 1)) * 100)}%`,
                    height: "100%",
                    background: "var(--accent)",
                    transition: "width 0.4s linear",
                  }}
                />
              </div>
              <p className="pi-eyebrow tabular-nums">
                {t(scoringState.running ? "robin.jobs.scoringProgress" : "robin.jobs.scoringFinished", {
                  done: String(scoringState.startedWith - scoringState.remaining),
                  total: String(scoringState.startedWith),
                  round: String(scoringState.round),
                  rounds: String(scoringState.totalRounds),
                  model: scoringState.model ?? t("robin.jobs.scoreModelDefault"),
                })}
              </p>
              {scoringState.error && (
                <p className="text-xs" style={{ color: "var(--danger)" }}>{scoringState.error}</p>
              )}
            </div>
          </Section>
        )}

        {/* ── Sweep progress ──────────────────────────────────────────── */}
        {sweepState && (sweepState.running || sweepState.boardsDone > 0) && (
          <Section title={t("robin.jobs.sweepTitle")}>
            <div className="flex flex-col gap-2">
              <div
                className="h-1.5 w-full overflow-hidden"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={sweepState.boardsTotal || 1}
                aria-valuenow={sweepState.boardsDone}
                aria-label={t("robin.jobs.sweepTitle")}
                style={{ background: "var(--bg-subtle)", border: "1px solid var(--border)" }}
              >
                <div
                  style={{
                    width: `${Math.min(100, (sweepState.boardsDone / Math.max(sweepState.boardsTotal, 1)) * 100)}%`,
                    height: "100%",
                    background: "var(--accent)",
                    transition: "width 0.4s linear",
                  }}
                />
              </div>
              <p className="pi-eyebrow tabular-nums">
                {t(sweepState.running ? "robin.jobs.sweepProgress" : "robin.jobs.sweepFinished", {
                  done: String(sweepState.boardsDone),
                  total: String(sweepState.boardsTotal),
                  scanned: String(sweepState.scanned),
                  matched: String(sweepState.matched),
                  dead: String(sweepState.unreachable),
                })}
              </p>
              {sweepState.error && (
                <p className="text-xs" style={{ color: "var(--danger)" }}>{sweepState.error}</p>
              )}
              {sweepState.directories.some((entry) => entry.status === "stale") && (
                <p className="text-xs" style={{ color: "var(--text-dim)" }}>{t("robin.jobs.sweepStale")}</p>
              )}
            </div>
          </Section>
        )}

        {/* ── Discoveries ─────────────────────────────────────────────── */}
        <Section
          title={t("robin.jobs.listTitle")}
          actions={(
            <button
              type="button"
              onClick={() => void previewDigest()}
              className="ui-action pi-chrome-label pi-bracket text-xs"
            >
              {t("robin.jobs.previewDigest")}
            </button>
          )}
        >
          <div className="flex flex-wrap gap-2">
            {(["new", "shortlist", "applied", "dropped", "all"] as Filter[]).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setFilter(option)}
                className="ui-action ui-action--chip pi-eyebrow px-2 py-1"
                data-state={filter === option ? "accent" : "muted"}
                aria-pressed={filter === option}
              >
                {t(`robin.jobs.filter.${option}`)} {counts.get(option) ?? 0}
              </button>
            ))}
          </div>

          {preview !== null && (
            <div className="flex flex-col gap-1">
              <span className="pi-eyebrow">{t("robin.jobs.previewDigest")}</span>
              <pre
                className="overflow-x-auto p-3 text-xs"
                style={{ background: "var(--bg-deep)", border: "1px solid var(--border)", color: "var(--copy)" }}
              >{preview || t("robin.jobs.emptyToday")}</pre>
              <button
                type="button"
                onClick={() => setPreview(null)}
                className="ui-action pi-eyebrow self-start"
              >
                {t("robin.common.cancel")}
              </button>
            </div>
          )}

          {visible.length === 0
            ? <p className="py-2 text-sm" style={{ color: "var(--text-dim)" }}>{t("robin.jobs.emptyList")}</p>
            : (
              <div className="flex flex-col gap-1">
                {visible.map((job: Job) => (
                  <JobRow
                    key={job.id}
                    job={job}
                    minScore={data?.minScore ?? DEFAULT_JOB_PROFILE.minScore}
                    busy={busyJob === job.id}
                    onStatus={(status) => void act(job.id, () =>
                      mutate("/api/robin/jobs", "PATCH", { id: job.id, status }))}
                    onNote={(note) => void act(job.id, () =>
                      mutate("/api/robin/jobs", "PATCH", { id: job.id, note }))}
                    onDelete={() => void act(job.id, () =>
                      mutate("/api/robin/jobs", "DELETE", { id: job.id }))}
                  />
                ))}
              </div>
            )}
        </Section>
      </main>

      {editing && profile && catalogue && (
        <JobFilterDialog
          profile={profile}
          catalogue={catalogue}
          onSave={saveProfile}
          onClose={() => setEditing(false)}
        />
      )}
    </div>
  );
}
