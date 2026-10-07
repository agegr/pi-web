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
  type ConfigAddSourceCatalog,
  ConfigDetailGrid,
  ConfigDetailGridRow,
  ConfigField,
  ConfigSaveTarget,
  ConfigSectionTitle,
} from "./SettingsUi";
import {
  MCP_ADD_BREADTH_KEYS,
  MCP_ADD_EXAMPLES,
  MCP_IMPORT_FIELD_REASON_KEYS,
  MCP_IMPORT_SOURCE_KEYS,
  mcpAddAnalysis,
  mcpAddDraftWithPaste,
  mcpAddOffersRawPi,
  mcpAddProjectBlockText,
  mcpAddRequest,
  mcpFieldOptionalHeader,
  mcpFieldStoredAs,
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

function displayPath(path: string): string {
  return revealHiddenCharacters(shortenPath(path));
}

function scopeLabel(scope: McpScope, t: Translate): string {
  return scope === "project" ? t("skills.scope.project") : t("skills.scope.global");
}

/** MCP server catalogs to browse, linked at the right of the pane's title. */
const MCP_CATALOGS: readonly ConfigAddSourceCatalog[] = [
  { href: "https://glama.ai/mcp/servers", label: "glama.ai" },
  { href: "https://smithery.ai/servers", label: "smithery.ai" },
  { href: "https://mcp.so/", label: "mcp.so" },
  { href: "https://registry.modelcontextprotocol.io/", label: "MCP Registry" },
  { href: "https://github.com/mcp", label: "github.com/mcp" },
];

/** The importer's notes about the server's name, shown under the name box instead of with the rest. */
const NAME_NOTE_CODES: ReadonlySet<string> = new Set(["name-derived", "name-sanitized", "name-deduplicated", "name-taken"]);

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
 * again (`lib/mcp-import.ts`). Under the title, where it is saved: the scope,
 * whose Project option says why it is unavailable, and the file. Before Add it
 * shows what would be written: the masked command line or URL, env and header
 * names, the values that run a shell command and the host variables it reads,
 * what the importer changed or dropped, the values to fill in, and the name.
 * A fresh folder is trusted in the same step, and the button says so. The box
 * never takes focus on a touch screen, and only its button or Cmd/Ctrl+Enter
 * adds; the panel tests the server once that explicit Add has written it.
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
  const nameId = useId();
  const analysis = useMemo(() => mcpAddAnalysis(draft, data, cwd), [draft, data, cwd]);
  const offersRawPi = useMemo(() => mcpAddOffersRawPi(draft.text), [draft.text]);
  const { parsed, server, preview, projectBlock, submitBlock } = analysis;
  // The paste's secrets that can be read from a variable have their own rows below, which say it.
  const allNotes = server ? [...server.notes, ...parsed.notes].filter((note) => (
    note.code !== "literal-secret" || !analysis.pasteSecrets.includes(String(note.params?.field))
  )) : [];
  // The name's notes go under its box, and only while it holds the importer's name: once edited,
  // they would describe a name no longer there.
  const nameEdited = draft.name !== undefined && draft.name !== server?.name;
  const nameNotes = nameEdited ? [] : allNotes.filter((note) => NAME_NOTE_CODES.has(note.code));
  const notes = allNotes.filter((note) => !NAME_NOTE_CODES.has(note.code));
  const canSubmit = !busy && !controlsBusy && submitBlock === undefined;
  const submit = () => {
    if (canSubmit) onSubmit(mcpAddRequest(draft, analysis));
  };
  const change = (patch: Partial<McpAddDraft>) => onDraftChange({ ...draft, ...patch });
  const targetFile = data.files.find((file) => file.scope === analysis.scope)?.path
    ?? (analysis.scope === "project" && cwd ? `${cwd.replace(/[\\/]+$/, "")}/.pi/mcp.json` : "mcp.json");
  // Why Add waits, under it. Project picked, then blocked (a secret typed since) is said here too:
  // the switch at the top explains only a disabled option, and the way out is often in the fields above Add.
  const ownBlockLine = submitBlock && (draft.text.trim() !== "" || submitBlock.kind === "mcp-off")
    ? submitBlockText(submitBlock, t, server?.fields)
    : undefined;
  const trustable = projectBlock?.kind === "project-untrusted" && projectBlock.trustable && onTrustProject;
  // The preview leaves out what is not set: no working directory, no env or header names.
  const names = preview ? (preview.transport === "http" ? preview.headerNames : preview.envNames) : [];

  return (
    <ConfigAddSourcePanel
      title={t("mcp.add.title")}
      catalogs={MCP_CATALOGS}
      target={
        <ConfigSaveTarget
          value={analysis.scope}
          label={t("config.saveTo")}
          options={[
            { value: "global", label: scopeLabel("global", t) },
            { value: "project", label: scopeLabel("project", t), disabled: projectBlock !== undefined && analysis.scope !== "project" },
          ]}
          path={displayPath(targetFile)}
          disabledReason={projectBlock ? mcpAddProjectBlockText(projectBlock, t, displayPath) : null}
          onChange={(scope) => change({ scope })}
        >
          {trustable && (
            <span className="mcp-config-line">
              <ConfigButton size="small" onClick={onTrustProject}>{t("mcp.trust.trustButton")}</ConfigButton>
            </span>
          )}
          {analysis.trustFolder && analysis.projectMode.kind === "trust-and-write" && (
            <p className="mcp-config-line is-warning">{t("mcp.add.trustExplain", { path: displayPath(analysis.projectMode.folder) })}</p>
          )}
        </ConfigSaveTarget>
      }
      inputLabel={t("mcp.add.inputLabel")}
      inputId="mcp-add-source"
      placeholder={t("mcp.add.placeholder")}
      value={draft.text}
      canSubmit={canSubmit}
      onValueChange={(text) => onDraftChange(mcpAddDraftWithPaste(draft, { text }))}
      onSubmit={submit}
      examplesLabel={t("mcp.add.examples")}
      // Every format the importer reads, each with an example, only while the box is empty: clicking one replaces the paste.
      examples={draft.text.trim() === "" ? MCP_ADD_EXAMPLES.map(({ source, text }) => ({ label: t(MCP_IMPORT_SOURCE_KEYS[source]), value: text })) : []}
      multiline
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

      {/* What the server is called comes first: it is its key in mcp.json and its row in the list. */}
      {server && (
        <>
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
          <McpImportNotes notes={nameNotes} fields={server.fields} />
          {submitBlock?.kind === "name-taken" && (
            <span className="mcp-config-line">
              <ConfigButton size="small" onClick={() => change({ name: submitBlock.suggestedName })}>
                {t("mcp.add.useName", { name: revealHiddenCharacters(submitBlock.suggestedName) })}
              </ConfigButton>
            </span>
          )}
        </>
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
                  fields={server.fields}
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
        </>
      )}

      <ConfigButton
        variant="primary"
        className="is-pushed-right"
        disabled={!canSubmit}
        aria-busy={busy || undefined}
        aria-describedby={ownBlockLine ? blockId : undefined}
        onClick={submit}
      >
        {busy ? t("mcp.add.adding") : analysis.trustFolder ? t("mcp.add.buttonTrust") : t("mcp.add.button")}
      </ConfigButton>
      {ownBlockLine && (
        <p id={blockId} className={`mcp-config-line ${submitBlock?.kind === "scope" ? "is-warning" : "is-dim"}`}>{ownBlockLine}</p>
      )}
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
 * source gave them, a box (a password box for a secret, a list for a choice)
 * showing what the paste held there, why it is asked for unless that is a
 * plain placeholder, and what is stored around it (`Bearer ‹your value›`).
 * Where pi resolves every value it fills, the user may name a host variable
 * instead, stored as `${NAME}`, which keeps a secret out of the file; its box
 * opens with the name the pane suggests. That a typed secret keeps the server
 * global is said once, under the scope switch.
 */
function McpAddFieldInput({
  field,
  fields,
  draft,
  suggestedName,
  problem,
  onDraftChange,
}: {
  field: McpImportField;
  /** Every field of the server, for another field's slot in a value this one is part of. */
  fields: readonly McpImportField[];
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
  const reasonKey = MCP_IMPORT_FIELD_REASON_KEYS[field.reason];
  const optionalHeader = field.optional ? mcpFieldOptionalHeader(field) : undefined;
  const storedAs = usesVariable
    ? (reference && !problem ? mcpFieldStoredAs(field, fields, "${" + reference + "}", true) : undefined)
    : mcpFieldStoredAs(field, fields, `‹${t("mcp.add.field.slot")}›`);
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
            placeholder={field.placeholder ? revealHiddenCharacters(field.placeholder) : undefined}
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
        {field.description && <span className="mcp-config-line is-dim">{revealHiddenCharacters(field.description)}</span>}
        {reasonKey && <span className="mcp-config-line is-dim">{t(reasonKey)}</span>}
        {usesVariable ? (
          <span className="mcp-config-line is-dim">
            {storedAs ? t("mcp.add.field.storedAsVariable", { value: storedAs }) : t("mcp.add.field.variableHint")}
          </span>
        ) : (
          <>
            {storedAs && <span className="mcp-config-line is-dim">{t("mcp.add.field.storedAs", { value: storedAs })}</span>}
            {field.optional && (
              <span className="mcp-config-line is-dim">
                {optionalHeader
                  ? t("mcp.add.field.optionalHeader", { name: revealHiddenCharacters(optionalHeader) })
                  : t("mcp.add.field.optional")}
              </span>
            )}
          </>
        )}
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
