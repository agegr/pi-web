"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/hooks/useI18n";
import {
  isPresetActive,
  togglePreset,
  type JobPreset,
  type JobProfile,
  type TrackedCompany,
} from "@/extension/robin/jobs";
import { ChipList } from "./ChipList";

export interface FilterCatalogue {
  providers: {
    companies: { id: string; label: string }[];
    boards: { id: string; label: string }[];
  };
  presets: { titles: JobPreset[]; excludes: JobPreset[]; locations: JobPreset[] };
  starterCompanies: { name: string; url: string }[];
}

type SectionId = "roles" | "location" | "sources" | "delivery" | "cv";

const SECTIONS: SectionId[] = ["roles", "location", "sources", "delivery", "cv"];

const inputStyle = {
  background: "var(--bg)",
  border: "1px solid var(--border)",
  color: "var(--text)",
} as const;

function PresetChips({
  presets,
  profile,
  onToggle,
  t,
}: {
  presets: JobPreset[];
  profile: JobProfile;
  onToggle: (preset: JobPreset) => void;
  t: (key: string, params?: Record<string, string>) => string;
}) {
  if (presets.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {presets.map((preset) => {
        const active = isPresetActive(preset, profile);
        return (
          <button
            key={preset.id}
            type="button"
            onClick={() => onToggle(preset)}
            aria-pressed={active}
            className="ui-action ui-action--chip pi-eyebrow px-2 py-1"
            data-state={active ? "accent" : "muted"}
            style={active ? { background: "var(--accent-soft)", borderColor: "var(--accent-line)" } : undefined}
          >
            {active ? "− " : "+ "}{t(`robin.jobs.preset.${preset.id}`)}
          </button>
        );
      })}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="pi-eyebrow">{label}</span>
      {children}
      {hint && <span className="text-xs" style={{ color: "var(--text-dim)" }}>{hint}</span>}
    </div>
  );
}

/**
 * The whole filter, in one dialog, one section at a time.
 *
 * It lives behind a button rather than down the page because the filter is
 * something you set up once and then touch rarely, while the list of what came
 * back is what you actually open this app for. Keeping the form inline pushed
 * the discoveries off the top of the screen every day to serve an edit you
 * make once a month.
 *
 * Every edit is local until Save, so abandoning the dialog changes nothing.
 */
export function JobFilterDialog({
  profile: saved,
  catalogue,
  onSave,
  onClose,
}: {
  profile: JobProfile;
  catalogue: FilterCatalogue;
  onSave: (profile: JobProfile) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [profile, setProfile] = useState<JobProfile>(saved);
  const [section, setSection] = useState<SectionId>("roles");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [portalTarget, setPortalTarget] = useState<Element | null>(null);
  const [models, setModels] = useState<{ id: string; name: string; provider: string }[]>([]);

  useEffect(() => setPortalTarget(document.body), []);

  // The model list comes from pi itself, so the options are the models this
  // machine actually has credentials for rather than a hardcoded menu.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/models");
        const body = await response.json().catch(() => null) as
          { modelList?: { id: string; name: string; provider: string }[] } | null;
        if (!cancelled && body?.modelList) setModels(body.modelList);
      } catch {
        // No list means the select falls back to "pi's default" only, which is
        // exactly what an unset scoreModel does anyway.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const patch = (changes: Partial<JobProfile>) => setProfile((current) => ({ ...current, ...changes }));

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave(profile);
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSaving(false);
    }
  };

  const updateCompany = (id: string, changes: Partial<TrackedCompany>) => {
    patch({
      companies: profile.companies.map((company) =>
        company.id === id ? { ...company, ...changes } : company),
    });
  };

  const addStarters = () => {
    const known = new Set(profile.companies.map((company) => company.url.trim().toLowerCase()));
    const fresh = catalogue.starterCompanies
      .filter((entry) => !known.has(entry.url.toLowerCase()))
      .map((entry, index) => ({
        id: `starter-${Date.now()}-${index}`,
        name: entry.name,
        url: entry.url,
        enabled: true,
      }));
    if (fresh.length > 0) patch({ companies: [...profile.companies, ...fresh] });
  };

  if (!portalTarget) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("robin.jobs.filterTitle")}
      onClick={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !saving) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,0,0,0.35)",
        padding: 8,
      }}
    >
      <div
        className="flex w-full flex-col"
        style={{
          maxWidth: 960,
          height: "min(760px, calc(100dvh - 16px))",
          background: "var(--bg)",
          border: "1px solid var(--border)",
          boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
        }}
      >
        <header
          className="flex shrink-0 items-center justify-between gap-4 px-4 py-3"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          <h2 className="pi-label">{t("robin.jobs.filterTitle")}</h2>
          <div className="flex items-baseline gap-3">
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              className="ui-action pi-chrome-label pi-bracket text-xs disabled:opacity-40"
              data-state="accent"
            >
              {saving ? t("i18n.saving") : t("robin.jobs.filterSave")}
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              aria-label={t("i18n.close")}
              className="ui-action px-1 disabled:opacity-40"
              style={{ fontSize: 20, lineHeight: 1 }}
            >
              ×
            </button>
          </div>
        </header>

        {error && (
          <p className="shrink-0 px-4 py-2 text-sm" style={{ color: "var(--danger)" }}>{error}</p>
        )}

        <div className="flex min-h-0 flex-1 flex-col split:flex-row">
          {/* Section rail. Horizontal on a phone, a column on a wide screen. */}
          <nav
            className="flex shrink-0 gap-1 overflow-x-auto p-2 split:w-48 split:flex-col split:overflow-x-visible"
            style={{ borderBottom: "1px solid var(--border)" }}
          >
            {SECTIONS.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => setSection(id)}
                aria-current={section === id}
                className="ui-action ui-action--surface pi-eyebrow shrink-0 px-2 py-1.5 text-left"
                data-state={section === id ? "accent" : "muted"}
                style={section === id
                  ? { background: "var(--accent-subtle)", borderLeft: "2px solid var(--accent)" }
                  : { borderLeft: "2px solid transparent" }}
              >
                {t(`robin.jobs.section.${id}`)}
              </button>
            ))}
          </nav>

          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
            {section === "roles" && (
              <>
                <Field label={t("robin.jobs.presetsTitle")}>
                  <PresetChips
                    presets={catalogue.presets.titles}
                    profile={profile}
                    onToggle={(preset) => patch(togglePreset(preset, profile, catalogue.presets.titles))}
                    t={t}
                  />
                </Field>
                <Field label={t("robin.jobs.titles")} hint={t("robin.jobs.titlesHint")}>
                  <ChipList
                    values={profile.titles}
                    onChange={(titles) => patch({ titles })}
                    placeholder={t("robin.jobs.titlesPlaceholder")}
                    label={t("robin.jobs.titles")}
                  />
                </Field>
                <Field label={t("robin.jobs.presetsExclude")}>
                  <PresetChips
                    presets={catalogue.presets.excludes}
                    profile={profile}
                    onToggle={(preset) => patch(togglePreset(preset, profile, catalogue.presets.excludes))}
                    t={t}
                  />
                </Field>
                <Field label={t("robin.jobs.excludeTitles")} hint={t("robin.jobs.excludeHint")}>
                  <ChipList
                    values={profile.excludeTitles}
                    onChange={(excludeTitles) => patch({ excludeTitles })}
                    placeholder={t("robin.jobs.excludePlaceholder")}
                    label={t("robin.jobs.excludeTitles")}
                    tone="muted"
                  />
                </Field>
              </>
            )}

            {section === "location" && (
              <>
                <Field label={t("robin.jobs.presetsTitle")}>
                  <PresetChips
                    presets={catalogue.presets.locations}
                    profile={profile}
                    onToggle={(preset) => patch(togglePreset(preset, profile, catalogue.presets.locations))}
                    t={t}
                  />
                </Field>
                <Field label={t("robin.jobs.locationAllow")} hint={t("robin.jobs.locationAllowHint")}>
                  <ChipList
                    values={profile.locationAllow}
                    onChange={(locationAllow) => patch({ locationAllow })}
                    placeholder={t("robin.jobs.locationPlaceholder")}
                    label={t("robin.jobs.locationAllow")}
                  />
                </Field>
                <Field label={t("robin.jobs.locationAlways")} hint={t("robin.jobs.locationAlwaysHint")}>
                  <ChipList
                    values={profile.locationAlways}
                    onChange={(locationAlways) => patch({ locationAlways })}
                    placeholder={t("robin.jobs.locationPlaceholder")}
                    label={t("robin.jobs.locationAlways")}
                  />
                </Field>
                <Field label={t("robin.jobs.locationBlock")}>
                  <ChipList
                    values={profile.locationBlock}
                    onChange={(locationBlock) => patch({ locationBlock })}
                    placeholder={t("robin.jobs.locationPlaceholder")}
                    label={t("robin.jobs.locationBlock")}
                    tone="muted"
                  />
                </Field>
              </>
            )}

            {section === "sources" && (
              <>
                <Field label={t("robin.jobs.boards")} hint={t("robin.jobs.boardsHint")}>
                  <div className="flex flex-wrap gap-3">
                    {catalogue.providers.boards.map((board) => (
                      <label key={board.id} className="flex items-center gap-1.5 text-sm">
                        <input
                          type="checkbox"
                          checked={profile.boards.includes(board.id)}
                          onChange={(event) => patch({
                            boards: event.target.checked
                              ? [...profile.boards, board.id]
                              : profile.boards.filter((id) => id !== board.id),
                          })}
                          className="cursor-pointer"
                        />
                        {board.label}
                      </label>
                    ))}
                  </div>
                </Field>

                <div className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="pi-eyebrow">
                      {t("robin.jobs.companiesCount", { count: String(profile.companies.length) })}
                    </span>
                    <div className="flex items-baseline gap-3">
                      <button
                        type="button"
                        onClick={addStarters}
                        className="ui-action pi-chrome-label pi-bracket text-xs"
                      >
                        {t("robin.jobs.addStarters", { count: String(catalogue.starterCompanies.length) })}
                      </button>
                      <button
                        type="button"
                        onClick={() => patch({
                          companies: [
                            ...profile.companies,
                            { id: `draft-${Date.now()}`, name: "", url: "", enabled: true },
                          ],
                        })}
                        className="ui-action pi-chrome-label pi-bracket text-xs"
                      >
                        {t("robin.common.add")}
                      </button>
                    </div>
                  </div>
                  <p className="text-xs" style={{ color: "var(--text-dim)" }}>
                    {t("robin.jobs.companiesHint", {
                      providers: catalogue.providers.companies.map((entry) => entry.label).join(" · "),
                    })}
                  </p>
                  {profile.companies.length === 0 && (
                    <p className="text-sm" style={{ color: "var(--text-dim)" }}>
                      {t("robin.jobs.noCompaniesHint")}
                    </p>
                  )}
                  {profile.companies.map((company) => (
                    <div key={company.id} className="flex flex-wrap items-center gap-2">
                      <input
                        type="checkbox"
                        checked={company.enabled}
                        onChange={(event) => updateCompany(company.id, { enabled: event.target.checked })}
                        aria-label={t("robin.jobs.companyEnabled", { name: company.name || company.url })}
                        className="shrink-0 cursor-pointer"
                      />
                      <input
                        value={company.name}
                        onChange={(event) => updateCompany(company.id, { name: event.target.value })}
                        placeholder={t("robin.jobs.companyName")}
                        aria-label={t("robin.jobs.companyName")}
                        className="w-36 rounded px-2 py-1 text-sm outline-none"
                        style={inputStyle}
                      />
                      <input
                        value={company.url}
                        onChange={(event) => updateCompany(company.id, { url: event.target.value })}
                        placeholder="https://job-boards.greenhouse.io/acme"
                        aria-label={t("robin.jobs.companyUrl")}
                        spellCheck={false}
                        className="min-w-0 flex-1 rounded px-2 py-1 font-mono text-xs outline-none"
                        style={inputStyle}
                      />
                      <button
                        type="button"
                        onClick={() => patch({
                          companies: profile.companies.filter((entry) => entry.id !== company.id),
                        })}
                        aria-label={t("robin.jobs.removeCompany", { name: company.name || company.url })}
                        className="ui-action px-1 text-xs"
                        data-hover="danger"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>

                <Field label={t("robin.jobs.blacklist")} hint={t("robin.jobs.blacklistHint")}>
                  <ChipList
                    values={profile.blacklist}
                    onChange={(blacklist) => patch({ blacklist })}
                    placeholder={t("robin.jobs.blacklistPlaceholder")}
                    label={t("robin.jobs.blacklist")}
                    tone="muted"
                  />
                </Field>
              </>
            )}

            {section === "delivery" && (
              <>
                <div className="grid grid-cols-2 gap-3 split:grid-cols-5">
                  <Field label={t("robin.jobs.sinceDays")}>
                    <input
                      type="number"
                      min={0}
                      max={365}
                      value={profile.sinceDays}
                      onChange={(event) => patch({ sinceDays: Number(event.target.value) })}
                      className="rounded px-2 py-1 text-sm tabular-nums outline-none"
                      style={inputStyle}
                    />
                  </Field>
                  <Field label={t("robin.jobs.minScore")}>
                    <input
                      type="number"
                      min={1}
                      max={5}
                      step={0.1}
                      value={profile.minScore}
                      onChange={(event) => patch({ minScore: Number(event.target.value) })}
                      className="rounded px-2 py-1 text-sm tabular-nums outline-none"
                      style={inputStyle}
                    />
                  </Field>
                  <Field label={t("robin.jobs.maxYears")}>
                    <input
                      type="number"
                      min={0}
                      max={20}
                      value={profile.maxYears}
                      onChange={(event) => patch({ maxYears: Number(event.target.value) })}
                      className="rounded px-2 py-1 text-sm tabular-nums outline-none"
                      style={inputStyle}
                    />
                  </Field>
                  <Field label={t("robin.jobs.digestSize")}>
                    <input
                      type="number"
                      min={1}
                      max={50}
                      value={profile.digestSize}
                      onChange={(event) => patch({ digestSize: Number(event.target.value) })}
                      className="rounded px-2 py-1 text-sm tabular-nums outline-none"
                      style={inputStyle}
                    />
                  </Field>
                  <Field label={t("robin.jobs.scoreBatch")}>
                    <input
                      type="number"
                      min={1}
                      max={40}
                      value={profile.scoreBatch}
                      onChange={(event) => patch({ scoreBatch: Number(event.target.value) })}
                      className="rounded px-2 py-1 text-sm tabular-nums outline-none"
                      style={inputStyle}
                    />
                  </Field>
                </div>
                <p className="text-xs" style={{ color: "var(--text-dim)" }}>{t("robin.jobs.deliveryHint")}</p>
                <label className="flex min-h-11 items-center gap-2 text-sm" style={{ color: "var(--text)" }}>
                  <input
                    type="checkbox"
                    checked={profile.readUnknownBoards}
                    onChange={(event) => patch({ readUnknownBoards: event.target.checked })}
                    className="shrink-0 cursor-pointer"
                  />
                  {t("robin.jobs.readUnknownBoards")}
                </label>
                <p className="text-xs" style={{ color: "var(--text-dim)" }}>{t("robin.jobs.readUnknownBoardsHint")}</p>

                <Field label={t("robin.jobs.scoreModel")} hint={t("robin.jobs.scoreModelHint")}>
                  <select
                    value={profile.scoreModel ? `${profile.scoreModel.provider}/${profile.scoreModel.modelId}` : ""}
                    onChange={(event) => {
                      const raw = event.target.value;
                      if (!raw) return patch({ scoreModel: null });
                      const cut = raw.indexOf("/");
                      patch({ scoreModel: { provider: raw.slice(0, cut), modelId: raw.slice(cut + 1) } });
                    }}
                    className="rounded px-2 py-1 text-sm outline-none"
                    style={inputStyle}
                  >
                    <option value="">{t("robin.jobs.scoreModelDefault")}</option>
                    {models.map((model) => (
                      <option key={`${model.provider}/${model.id}`} value={`${model.provider}/${model.id}`}>
                        {model.provider} / {model.name || model.id}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={t("robin.jobs.linkGroup")} hint={t("robin.jobs.linkGroupHint")}>
                  <input
                    value={profile.linkGroup}
                    onChange={(event) => patch({ linkGroup: event.target.value })}
                    className="rounded px-2 py-1 text-sm outline-none"
                    style={inputStyle}
                  />
                </Field>
              </>
            )}

            {section === "cv" && (
              <>
                <Field label={t("robin.jobs.notes")} hint={t("robin.jobs.notesHint")}>
                  <textarea
                    value={profile.notes}
                    onChange={(event) => patch({ notes: event.target.value })}
                    rows={5}
                    className="rounded px-2 py-1 text-sm outline-none"
                    style={inputStyle}
                  />
                </Field>
                <Field
                  label={t("robin.jobs.cvLength", { count: String(profile.cv.length) })}
                  hint={t("robin.jobs.cvHint")}
                >
                  <textarea
                    value={profile.cv}
                    onChange={(event) => patch({ cv: event.target.value })}
                    rows={20}
                    spellCheck={false}
                    placeholder={t("robin.jobs.cvPlaceholder")}
                    className="rounded px-2 py-2 font-mono text-xs outline-none"
                    style={inputStyle}
                  />
                </Field>
              </>
            )}
          </div>
        </div>
      </div>
    </div>,
    portalTarget,
  );
}
