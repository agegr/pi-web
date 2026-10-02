"use client";

import { useId, useMemo } from "react";
import type { McpServerConfig } from "@earendil-works/pi-coding-agent";
import type { McpResponse, McpScope } from "@/lib/api-types";
import { useI18n } from "@/hooks/useI18n";
import { shortenPath } from "@/lib/display-path";
import type { McpImportField, McpImportNote } from "@/lib/mcp-import";
import { isReferenceOnly } from "@/lib/mcp-secrets";
import { mcpFieldLabel, mcpVariableChips, revealHiddenCharacters } from "@/lib/mcp-server-display";
import {
  ConfigAddSourcePanel,
  ConfigButton,
  ConfigDetailGrid,
  ConfigDetailGridRow,
  ConfigField,
  ConfigScopeSwitch,
  ConfigSectionTitle,
} from "./SettingsUi";
import {
  MCP_ADD_BREADTH_KEYS,
  MCP_IMPORT_FIELD_REASON_KEYS,
  MCP_IMPORT_SOURCE_KEYS,
  mcpAddAnalysis,
  mcpAddDraftWithPaste,
  mcpAddOffersRawPi,
  mcpAddProjectBlockText,
  mcpAddRequest,
  mcpFieldSuggestedVariableName,
  mcpFieldTakesVariable,
  mcpImportNoteSeverity,
  mcpImportNoteText,
  mcpSecretPathTakesVariable,
  mcpSuggestedVariableName,
  type McpAddDraft,
  type McpAddSubmitBlock,
} from "./mcp-add-helpers";
import type { McpActionFailure, McpActionRequest } from "./mcp-config-helpers";

type Translate = ReturnType<typeof useI18n>["t"];
export type McpAddActionRequest = Extract<McpActionRequest, { action: "add" }>;

/** Pastes the box offers to fill in: an address, a command line, another client's command, a config. */
export const MCP_ADD_EXAMPLES = [
  "https://mcp.example.com/mcp",
  "npx -y @modelcontextprotocol/server-everything",
  "claude mcp add --transport http docs https://mcp.example.com/mcp",
  '{ "mcpServers": { "fetch": { "command": "uvx", "args": ["mcp-server-fetch"] } } }',
] as const;

function displayPath(path: string): string {
  return revealHiddenCharacters(shortenPath(path));
}

function scopeLabel(scope: McpScope, t: Translate): string {
  return scope === "project" ? t("skills.scope.project") : t("skills.scope.global");
}

/** The importer's notes as a list, errors first; each says what it is about in words. */
function McpImportNotes({ notes, fields = [] }: { notes: readonly McpImportNote[]; fields?: readonly McpImportField[] }) {
  const { t } = useI18n();
  if (notes.length === 0) return null;
  const order = { error: 0, warning: 1, info: 2 } as const;
  const sorted = [...notes].sort((a, b) => order[mcpImportNoteSeverity(a)] - order[mcpImportNoteSeverity(b)]);
  return (
    <ul className="mcp-add-notes">
      {sorted.map((note, index) => (
        <li key={`${index}\0${note.code}`} className={`mcp-add-note is-${mcpImportNoteSeverity(note)}`}>
          {mcpImportNoteText(note, t, fields)}
        </li>
      ))}
    </ul>
  );
}

/** Why Add waits, as the line its button points at. */
function submitBlockText(block: McpAddSubmitBlock, t: Translate, fields: readonly McpImportField[] = []): string {
  switch (block.kind) {
    case "mcp-off":
      return t("mcp.reason.mcp-off");
    case "nothing":
      return t("mcp.add.blocked.nothing");
    case "name-invalid":
      return t("mcp.add.nameInvalid");
    case "name-taken":
      return t("mcp.add.nameTaken", { name: revealHiddenCharacters(block.name), path: block.path ? displayPath(block.path) : "mcp.json" });
    case "fields":
      return t("mcp.add.blocked.fields", { fields: block.fields.map(revealHiddenCharacters).join(", ") });
    case "field-invalid":
      return t("mcp.add.blocked.fieldsInvalid", { fields: block.fields.map(revealHiddenCharacters).join(", ") });
    case "config-invalid":
      return mcpImportNoteText(block.note, t, fields);
    case "web-password":
      return t("mcp.add.blocked.web-password");
    case "scope":
      return mcpAddProjectBlockText(block.block, t, displayPath);
  }
}

/**
 * Refusals the add pane words as an Add's, before the generic `mcp.reason.*`
 * words, which were written for switching, testing and connecting.
 */
export const MCP_ADD_REFUSAL_KEYS: Partial<Record<NonNullable<McpActionFailure["reason"]>, string>> = {
  "server-invalid": "mcp.add.refused.server-invalid",
  "web-password": "mcp.add.blocked.web-password",
};

/** Why the route refused the last Add, in the add pane's words where the reason has them. */
function failureText(failure: McpActionFailure, t: Translate): string {
  if (failure.timedOut) return t("mcp.actionTimedOut");
  if (failure.reason === "trust-too-broad" && failure.breadth) {
    return t(MCP_ADD_BREADTH_KEYS[failure.breadth.kind], { path: displayPath(failure.breadth.path) });
  }
  if (failure.reason === "secret-global-only" && failure.fields) {
    const fixed = !failure.fields.every(mcpSecretPathTakesVariable);
    return t(fixed ? "mcp.add.projectBlocked.secretFixed" : "mcp.add.projectBlocked.secret", { fields: failure.fields.join(", ") });
  }
  if (failure.reason === "name-taken" && failure.name) {
    return t("mcp.add.nameTaken", { name: revealHiddenCharacters(failure.name), path: failure.path ? displayPath(failure.path) : "mcp.json" });
  }
  const addKey = failure.reason ? MCP_ADD_REFUSAL_KEYS[failure.reason] : undefined;
  // The SDK validator's words name the field, never a value.
  if (addKey) return t(addKey, { error: revealHiddenCharacters(failure.error) });
  if (failure.reason && failure.reason !== "internal") return t(`mcp.reason.${failure.reason}`);
  return revealHiddenCharacters(failure.error);
}

/**
 * Settings › MCP's add pane: one paste box for a URL, a command line,
 * `pi | claude | codex | gemini mcp add …`, another client's JSON or an
 * install link, read in the browser by the importer the route parses it with
 * again (`lib/mcp-import.ts`). Before Add it shows what would be written:
 * the masked command line or URL, env and header names, the values that run a
 * shell command and the host variables it reads, what the importer changed or
 * dropped, the values to fill in, the name, and the scope, whose Project
 * option says why it is unavailable. A fresh folder is trusted in the same
 * step, and the button says so. The box never takes focus on a touch screen,
 * and only its button or Cmd/Ctrl+Enter adds; the panel tests the server once
 * that explicit Add has written it.
 */
export function McpAddServer({
  data,
  cwd,
  draft,
  busy,
  controlsBusy,
  failure,
  onDraftChange,
  onSubmit,
  onTrustProject,
}: {
  data: McpResponse;
  cwd: string | null;
  draft: McpAddDraft;
  /** The Add request is on its way. */
  busy: boolean;
  /** Another change, a save or a load is on its way. */
  controlsBusy: boolean;
  /** Why the route refused the last Add. */
  failure: McpActionFailure | null;
  onDraftChange: (draft: McpAddDraft) => void;
  onSubmit: (request: McpAddActionRequest) => void;
  /** Opens the trust dialog, for a project that needs a trust decision first. */
  onTrustProject?: () => void;
}) {
  const { t } = useI18n();
  const blockId = useId();
  const scopeBlockId = useId();
  const nameId = useId();
  const analysis = useMemo(() => mcpAddAnalysis(draft, data, cwd), [draft, data, cwd]);
  const offersRawPi = useMemo(() => mcpAddOffersRawPi(draft.text), [draft.text]);
  const { parsed, server, preview, projectBlock, submitBlock } = analysis;
  // The paste's secrets that can be read from a variable have their own rows below, which say it.
  const notes = server ? [...server.notes, ...parsed.notes].filter((note) => (
    note.code !== "literal-secret" || !analysis.pasteSecrets.includes(String(note.params?.field))
  )) : [];
  const canSubmit = !busy && !controlsBusy && submitBlock === undefined;
  const submit = () => {
    if (canSubmit) onSubmit(mcpAddRequest(draft, analysis));
  };
  const change = (patch: Partial<McpAddDraft>) => onDraftChange({ ...draft, ...patch });
  const targetFile = data.files.find((file) => file.scope === analysis.scope)?.path
    ?? (analysis.scope === "project" && cwd ? `${cwd.replace(/[\\/]+$/, "")}/.pi/mcp.json` : "mcp.json");
  // Project picked, then blocked (a secret typed since): the switch shows its reason only under a
  // disabled option, so the line is the pane's own, and Add points at it.
  const scopeLine = analysis.scope === "project" && projectBlock ? mcpAddProjectBlockText(projectBlock, t, displayPath) : undefined;
  const blockSaidByScopeLine = submitBlock?.kind === "scope" && scopeLine !== undefined && submitBlock.block === projectBlock;
  const ownBlockLine = submitBlock && !blockSaidByScopeLine && (draft.text.trim() !== "" || submitBlock.kind === "mcp-off")
    ? submitBlockText(submitBlock, t, server?.fields)
    : undefined;
  const describedBy = [scopeLine ? scopeBlockId : undefined, ownBlockLine ? blockId : undefined].filter(Boolean).join(" ") || undefined;
  const trustable = projectBlock?.kind === "project-untrusted" && projectBlock.trustable && onTrustProject;
  // The preview leaves out what is not set: no working directory, no env or header names.
  const names = preview ? (preview.transport === "http" ? preview.headerNames : preview.envNames) : [];

  return (
    <ConfigAddSourcePanel
      title={t("mcp.add.title")}
      catalogHref="https://github.com/mcp"
      catalogLabel="github.com/mcp"
      location={displayPath(targetFile)}
      inputLabel={t("mcp.add.inputLabel")}
      inputId="mcp-add-source"
      placeholder={t("mcp.add.placeholder")}
      value={draft.text}
      canSubmit={canSubmit}
      onValueChange={(text) => onDraftChange(mcpAddDraftWithPaste(draft, { text }))}
      onSubmit={submit}
      examplesLabel={t("config.examples")}
      // Examples only while the box is empty: clicking one replaces the paste.
      examples={draft.text.trim() === "" ? MCP_ADD_EXAMPLES : []}
      multiline
      hint={t("mcp.add.hint")}
    >
      {offersRawPi && (
        <label className="mcp-add-toggle">
          <input type="checkbox" checked={draft.rawPi} onChange={(event) => onDraftChange(mcpAddDraftWithPaste(draft, { rawPi: event.target.checked }))} />
          <span className="mcp-config-lines">
            <span className="mcp-config-line">{t("mcp.add.rawPi")}</span>
            {draft.rawPi && <span className="mcp-config-line is-dim">{t("mcp.add.rawPiOn")}</span>}
          </span>
        </label>
      )}

      {!parsed.ok && draft.text.trim() !== "" && <McpImportNotes notes={parsed.notes} />}

      {parsed.ok && parsed.servers.length > 1 && (
        <ConfigField label={t("mcp.add.serverLabel")}>
          <select
            className="mcp-add-input"
            aria-label={t("mcp.add.serverLabel")}
            value={String(parsed.servers.indexOf(server ?? parsed.servers[0]))}
            onChange={(event) => change({ server: Number(event.target.value), name: undefined, values: {}, references: {}, secretReferences: {} })}
          >
            {parsed.servers.map((item, index) => (
              <option key={`${index}\0${item.name}`} value={index}>{revealHiddenCharacters(item.name)}</option>
            ))}
          </select>
          <span className="mcp-config-line is-dim">{t("mcp.add.serverCount", { count: parsed.servers.length })}</span>
        </ConfigField>
      )}

      {server && preview && (
        <>
          <ConfigSectionTitle>{t("mcp.add.preview")}</ConfigSectionTitle>
          <ConfigDetailGrid>
            <ConfigDetailGridRow label={t("mcp.add.readAs")}>{t(MCP_IMPORT_SOURCE_KEYS[preview.source])}</ConfigDetailGridRow>
            <ConfigDetailGridRow label={t("mcp.detail.transport")}>{t(`mcp.transport.${preview.transport}`)}</ConfigDetailGridRow>
            <ConfigDetailGridRow label={preview.transport === "http" ? t("mcp.detail.url") : t("mcp.detail.command")} tone="plain" mono>
              {preview.target}
            </ConfigDetailGridRow>
            {preview.transport === "stdio" && preview.cwd !== undefined && (
              <ConfigDetailGridRow label={t("mcp.detail.cwd")} mono>{preview.cwd}</ConfigDetailGridRow>
            )}
            {names.length > 0 && (
              <ConfigDetailGridRow label={preview.transport === "http" ? t("mcp.detail.headers") : t("mcp.detail.env")}>
                <McpAddNames names={names} />
              </ConfigDetailGridRow>
            )}
            {preview.commandFields.length > 0 && (
              <ConfigDetailGridRow label={t("mcp.detail.shellCommands")} tone="plain">
                <span className="mcp-config-lines">
                  <span className="mcp-config-line is-warning">{t("mcp.server.commandFields")}</span>
                  <span className="mcp-config-chips">
                    {preview.commandFields.map((field) => {
                      const label = mcpFieldLabel(field);
                      return <code key={`${field.kind}\0${field.name ?? ""}`} className="mcp-config-chip">{t(label.key, label.params)}</code>;
                    })}
                  </span>
                </span>
              </ConfigDetailGridRow>
            )}
            {preview.variableReferences.length > 0 && (
              <ConfigDetailGridRow label={t("mcp.detail.variables")} tone="plain">
                <span className="mcp-config-lines">
                  <span className="mcp-config-line is-warning">
                    {t(preview.transport === "http" ? "mcp.server.sendsVariables" : "mcp.server.passesVariables")}
                  </span>
                  <span className="mcp-config-chips">
                    {mcpVariableChips(preview.variableReferences).map(({ variable, field }) => {
                      const label = mcpFieldLabel(field);
                      return (
                        <code key={`${variable}\0${field.kind}\0${field.name ?? ""}`} className="mcp-config-chip">
                          {t("mcp.server.variableIn", { variable: revealHiddenCharacters(variable), field: t(label.key, label.params) })}
                        </code>
                      );
                    })}
                  </span>
                </span>
              </ConfigDetailGridRow>
            )}
          </ConfigDetailGrid>
          <div className="mcp-config-lines">
            {preview.unfilled && <span className="mcp-config-line is-dim">{t("mcp.add.previewUnfilled")}</span>}
            {preview.masked && <span className="mcp-config-line is-dim">{t("mcp.server.masked")}</span>}
          </div>
          <McpImportNotes notes={notes} fields={server.fields} />

          {server.fields.length > 0 && (
            <>
              <ConfigSectionTitle>{t("mcp.add.fields")}</ConfigSectionTitle>
              {server.fields.map((field) => (
                <McpAddFieldInput
                  key={field.id}
                  field={field}
                  draft={draft}
                  suggestedName={mcpFieldSuggestedVariableName(field, analysis.name)}
                  problem={analysis.fieldProblems[field.id]}
                  onDraftChange={onDraftChange}
                />
              ))}
            </>
          )}

          {analysis.pasteSecrets.length > 0 && (
            <>
              <ConfigSectionTitle>{t("mcp.add.secrets")}</ConfigSectionTitle>
              {analysis.pasteSecrets.map((label) => (
                <McpAddSecretInput
                  key={label}
                  label={label}
                  draft={draft}
                  suggestedName={mcpSuggestedVariableName(label, analysis.name)}
                  stored={analysis.fill?.ok ? storedValue(analysis.fill.config, label) : undefined}
                  problem={analysis.fieldProblems[label]}
                  onDraftChange={onDraftChange}
                />
              ))}
            </>
          )}

          <ConfigField label={t("config.name")}>
            <input
              id={nameId}
              className="mcp-add-input"
              aria-label={t("config.name")}
              value={analysis.name}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              onChange={(event) => change({ name: event.target.value })}
            />
          </ConfigField>
          {submitBlock?.kind === "name-taken" && (
            <span className="mcp-config-line">
              <ConfigButton size="small" onClick={() => change({ name: submitBlock.suggestedName })}>
                {t("mcp.add.useName", { name: revealHiddenCharacters(submitBlock.suggestedName) })}
              </ConfigButton>
            </span>
          )}
        </>
      )}

      <ConfigScopeSwitch
        value={analysis.scope}
        label={t("config.scope")}
        options={[
          { value: "global", label: scopeLabel("global", t) },
          { value: "project", label: scopeLabel("project", t), disabled: projectBlock !== undefined && analysis.scope !== "project" },
        ]}
        disabledReason={projectBlock ? mcpAddProjectBlockText(projectBlock, t, displayPath) : null}
        onChange={(scope) => change({ scope })}
      >
        <ConfigButton
          variant="primary"
          className="is-pushed-right"
          disabled={!canSubmit}
          aria-busy={busy || undefined}
          aria-describedby={describedBy}
          onClick={submit}
        >
          {busy ? t("mcp.add.adding") : analysis.trustFolder ? t("mcp.add.buttonTrust") : t("mcp.add.button")}
        </ConfigButton>
      </ConfigScopeSwitch>
      {scopeLine && <p id={scopeBlockId} className="mcp-config-line is-warning">{scopeLine}</p>}
      {trustable && (
        <span className="mcp-config-line">
          <ConfigButton size="small" onClick={onTrustProject}>{t("mcp.trust.trustButton")}</ConfigButton>
        </span>
      )}
      {analysis.trustFolder && analysis.projectMode.kind === "trust-and-write" && (
        <p className="mcp-config-line is-warning">{t("mcp.add.trustExplain", { path: displayPath(analysis.projectMode.folder) })}</p>
      )}
      {ownBlockLine && <p id={blockId} className="mcp-config-line is-dim">{ownBlockLine}</p>}
      {server && !submitBlock && <p className="mcp-config-line is-dim">{t("mcp.add.afterAdd")}</p>}

      {failure && (
        <div role="alert" className="mcp-add-failure">
          <span className="mcp-config-line is-error">{t("mcp.add.failed")} {failureText(failure, t)}</span>
          {failure.trustKept && (
            <span className="mcp-config-line is-warning">
              {t("mcp.add.trustKept", { folder: displayPath(failure.trust?.decisionPath ?? cwd ?? "") })}
            </span>
          )}
          {failure.notes && failure.notes.length > 0 && <McpImportNotes notes={failure.notes} fields={server?.fields} />}
          {failure.reason === "name-taken" && failure.suggestedName && submitBlock?.kind !== "name-taken" && (
            <span className="mcp-config-line">
              <ConfigButton size="small" onClick={() => change({ name: failure.suggestedName })}>
                {t("mcp.add.useName", { name: revealHiddenCharacters(failure.suggestedName) })}
              </ConfigButton>
            </span>
          )}
          {failure.reason === "host-env-confirm" && failure.names && failure.names.length > 0 && (
            <>
              <span className="mcp-config-line is-warning">
                {t("mcp.add.hostEnv.body", { names: failure.names.map(revealHiddenCharacters).join(", ") })}
              </span>
              <span className="mcp-config-line">
                <ConfigButton
                  variant="danger"
                  size="small"
                  disabled={busy || controlsBusy || submitBlock !== undefined}
                  onClick={() => onSubmit(mcpAddRequest(draft, analysis, failure.names))}
                >
                  {t("mcp.add.hostEnv.confirm")}
                </ConfigButton>
              </span>
            </>
          )}
        </div>
      )}
    </ConfigAddSourcePanel>
  );
}

/** Env or header names; their values are never shown. */
function McpAddNames({ names }: { names: readonly string[] }) {
  const { t } = useI18n();
  return (
    <span className="mcp-config-lines">
      <span className="mcp-config-chips">
        {names.map((name) => <code key={name} className="mcp-config-chip">{revealHiddenCharacters(name)}</code>)}
      </span>
      <span className="mcp-config-line is-dim">{t("mcp.detail.valuesHidden")}</span>
    </span>
  );
}

/**
 * One value the paste left to fill in: its label and description as the
 * source gave them, why it is asked for, and a box (a password box for a
 * secret, a list for a choice). Where pi resolves every value it fills, the
 * user may name a host variable instead, stored as `${NAME}`, which keeps a
 * secret out of the file; its box opens with the name the pane suggests.
 */
function McpAddFieldInput({
  field,
  draft,
  suggestedName,
  problem,
  onDraftChange,
}: {
  field: McpImportField;
  draft: McpAddDraft;
  /** The variable the box opens with (`mcpFieldSuggestedVariableName()`), always a valid name. */
  suggestedName?: string;
  /** Why what was filled in cannot be used, shown under the box it is about. */
  problem?: McpImportNote;
  onDraftChange: (draft: McpAddDraft) => void;
}) {
  const { t } = useI18n();
  const problemId = useId();
  const invalid = problem ? { "aria-invalid": true as const, "aria-describedby": problemId } : {};
  const takesVariable = mcpFieldTakesVariable(field);
  const reference = takesVariable ? draft.references[field.id] : undefined;
  const usesVariable = reference !== undefined;
  const label = revealHiddenCharacters(field.label);
  const value = draft.values[field.id] ?? field.defaultValue ?? "";
  const setValue = (next: string) => onDraftChange({ ...draft, values: { ...draft.values, [field.id]: next } });
  const setReference = (next: string | undefined) => {
    const references = { ...draft.references };
    if (next === undefined) delete references[field.id];
    else references[field.id] = next;
    onDraftChange({ ...draft, references });
  };
  return (
    <div className="mcp-add-field">
      <ConfigField label={label}>
        {usesVariable ? (
          <input
            className="mcp-add-input"
            aria-label={t("mcp.add.field.variableName", { field: label })}
            value={reference}
            placeholder={suggestedName ?? "GITHUB_TOKEN"}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            {...invalid}
            onChange={(event) => setReference(event.target.value)}
          />
        ) : field.kind === "select" ? (
          <select className="mcp-add-input" aria-label={label} value={value} {...invalid} onChange={(event) => setValue(event.target.value)}>
            {!field.options?.includes(value) && <option value="">{t("mcp.add.field.choose")}</option>}
            {(field.options ?? []).map((option) => <option key={option} value={option}>{revealHiddenCharacters(option)}</option>)}
          </select>
        ) : (
          <input
            className="mcp-add-input"
            type={field.kind === "password" ? "password" : "text"}
            aria-label={label}
            value={value}
            autoComplete="off"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            {...invalid}
            onChange={(event) => setValue(event.target.value)}
          />
        )}
      </ConfigField>
      {problem && <span id={problemId} className="mcp-config-line is-error">{mcpImportNoteText(problem, t, [field])}</span>}
      <span className="mcp-config-lines">
        <span className="mcp-config-line is-dim">
          {t(MCP_IMPORT_FIELD_REASON_KEYS[field.reason])}
          {field.optional && <> {t("mcp.add.field.optional")}</>}
        </span>
        {field.description && <span className="mcp-config-line is-dim">{revealHiddenCharacters(field.description)}</span>}
        {field.placeholder && (
          <span className="mcp-config-line is-dim">{t("mcp.add.field.inPaste", { placeholder: revealHiddenCharacters(field.placeholder) })}</span>
        )}
        {usesVariable && <span className="mcp-config-line is-dim">{t("mcp.add.field.variableHint")}</span>}
        {!usesVariable && field.kind === "password" && <span className="mcp-config-line is-dim">{t("mcp.add.field.secret")}</span>}
      </span>
      {takesVariable && (
        <label className="mcp-add-toggle">
          <input type="checkbox" checked={usesVariable} onChange={(event) => setReference(event.target.checked ? suggestedName ?? "" : undefined)} />
          <span className="mcp-config-line">{t("mcp.add.field.useVariable")}</span>
        </label>
      )}
    </div>
  );
}

/** A stored value where it is safe to show: a reference the user chose (`Bearer ${API_TOKEN}`), never a literal. */
function storedValue(config: McpServerConfig, label: string): string | undefined {
  const value = label === "oauth.clientSecret"
    ? ("url" in config ? config.oauth?.clientSecret : undefined)
    : label.startsWith("headers.")
      ? ("url" in config ? config.headers?.[label.slice("headers.".length)] : undefined)
      : label.startsWith("env.") && "command" in config
        ? config.env?.[label.slice("env.".length)]
        : undefined;
  return value !== undefined && isReferenceOnly(value) ? value : undefined;
}

/**
 * One of the paste's own literal secrets, in a value pi resolves (ADR 0006,
 * "Secrets typed in the panel"): saved as written it keeps the server global,
 * so it can be read from a variable of the computer running Pi Web instead,
 * stored as `${NAME}` (after a header's `Bearer `), which lets the server go
 * to the project. Its box opens with the name the pane suggests. The secret
 * itself is never shown.
 */
function McpAddSecretInput({
  label,
  draft,
  suggestedName,
  stored,
  problem,
  onDraftChange,
}: {
  label: string;
  draft: McpAddDraft;
  /** The variable the box opens with (`mcpSuggestedVariableName()`), always a valid name. */
  suggestedName?: string;
  /** The value as it will be stored, once it reads a variable. */
  stored?: string;
  problem?: McpImportNote;
  onDraftChange: (draft: McpAddDraft) => void;
}) {
  const { t } = useI18n();
  const problemId = useId();
  const reference = draft.secretReferences[label];
  const usesVariable = reference !== undefined;
  const shown = revealHiddenCharacters(label);
  const setReference = (next: string | undefined) => {
    const secretReferences = { ...draft.secretReferences };
    if (next === undefined) delete secretReferences[label];
    else secretReferences[label] = next;
    onDraftChange({ ...draft, secretReferences });
  };
  return (
    <div className="mcp-add-field">
      <span className="mcp-config-lines">
        <span className="mcp-config-line">
          <code className="mcp-config-chip">{shown}</code> {t("mcp.add.secret.holds")}
        </span>
      </span>
      <label className="mcp-add-toggle">
        <input type="checkbox" checked={usesVariable} onChange={(event) => setReference(event.target.checked ? suggestedName ?? "" : undefined)} />
        <span className="mcp-config-line">{t("mcp.add.field.useVariable")}</span>
      </label>
      {usesVariable && (
        <ConfigField label={t("mcp.add.field.variableName", { field: shown })}>
          <input
            className="mcp-add-input"
            aria-label={t("mcp.add.field.variableName", { field: shown })}
            value={reference}
            placeholder={suggestedName ?? "API_TOKEN"}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            {...(problem ? { "aria-invalid": true as const, "aria-describedby": problemId } : {})}
            onChange={(event) => setReference(event.target.value)}
          />
        </ConfigField>
      )}
      {problem && <span id={problemId} className="mcp-config-line is-error">{mcpImportNoteText(problem, t)}</span>}
      <span className="mcp-config-line is-dim">
        {usesVariable
          ? stored !== undefined
            ? t("mcp.add.secret.storedAs", { value: revealHiddenCharacters(stored) })
            : t("mcp.add.field.variableHint")
          : t("mcp.add.secret.asPasted")}
      </span>
    </div>
  );
}
