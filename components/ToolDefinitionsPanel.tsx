"use client";

import { useEffect, useMemo, useState } from "react";
import type { ToolEntry } from "@/lib/tool-presets";

type Translate = (key: string, params?: Record<string, string | number>) => string;

interface Props {
  loading: boolean;
  tools: ToolEntry[] | null;
  translate: Translate;
}

interface ParameterField {
  name: string;
  type: string;
  description?: string;
  required: boolean;
  allowedValues?: string;
  defaultValue?: string;
}

function formatValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function formatSchemaType(schema: Record<string, unknown>): string {
  const variants = Array.isArray(schema.anyOf)
    ? schema.anyOf
    : Array.isArray(schema.oneOf)
      ? schema.oneOf
      : null;
  if (variants) {
    return variants
      .map((variant) => variant && typeof variant === "object"
        ? formatSchemaType(variant as Record<string, unknown>)
        : "unknown")
      .filter((value, index, values) => values.indexOf(value) === index)
      .join(" | ");
  }

  if (schema.const !== undefined) return formatValue(schema.const);
  if (Array.isArray(schema.enum) && schema.enum.length > 0 && schema.type === undefined) {
    return [...new Set(schema.enum.map((value) => value === null ? "null" : typeof value))].join(" | ");
  }

  const rawType = schema.type;
  const type = Array.isArray(rawType)
    ? rawType.filter((value): value is string => typeof value === "string").join(" | ")
    : typeof rawType === "string"
      ? rawType
      : typeof schema.$ref === "string"
        ? schema.$ref.split("/").pop() ?? "object"
        : "unknown";

  if (type === "array") {
    const items = schema.items;
    const itemType = items && typeof items === "object"
      ? formatSchemaType(items as Record<string, unknown>)
      : "unknown";
    return `${itemType}[]`;
  }
  return type;
}

export function getToolParameterFields(parameters?: Record<string, unknown>): ParameterField[] {
  if (!parameters || !parameters.properties || typeof parameters.properties !== "object") return [];
  const properties = parameters.properties as Record<string, unknown>;
  const required = new Set(
    Array.isArray(parameters.required)
      ? parameters.required.filter((value): value is string => typeof value === "string")
      : [],
  );

  return Object.entries(properties).map(([name, value]) => {
    const schema = value && typeof value === "object" ? value as Record<string, unknown> : {};
    return {
      name,
      type: formatSchemaType(schema),
      description: typeof schema.description === "string" ? schema.description : undefined,
      required: required.has(name),
      allowedValues: Array.isArray(schema.enum) ? schema.enum.map(formatValue).join(", ") : undefined,
      defaultValue: schema.default === undefined ? undefined : formatValue(schema.default),
    };
  });
}

function EmptyState({ children }: { children: string }) {
  return <div className="tool-definitions-empty">{children}</div>;
}

export function ToolDefinitionsPanel({ loading, tools, translate }: Props) {
  const activeTools = useMemo(() => tools?.filter((tool) => tool.active) ?? null, [tools]);
  const [selectedToolName, setSelectedToolName] = useState<string | null>(null);

  useEffect(() => {
    setSelectedToolName((current) => (
      activeTools?.some((tool) => tool.name === current)
        ? current
        : activeTools?.[0]?.name ?? null
    ));
  }, [activeTools]);

  const selectedTool = activeTools?.find((tool) => tool.name === selectedToolName)
    ?? activeTools?.[0]
    ?? null;
  const fields = selectedTool ? getToolParameterFields(selectedTool.parameters) : [];

  return (
    <div className="tool-definitions-panel">
      <nav className="tool-definitions-sidebar" aria-label={translate("tools.title")}>
        <div className="tool-definitions-list">
          {activeTools && activeTools.length > 0 ? activeTools.map((tool) => {
            const selected = tool.name === selectedTool?.name;
            return (
              <button
                key={tool.name}
                type="button"
                className={`tool-definitions-item${selected ? " selected" : ""}`}
                aria-pressed={selected}
                onClick={() => setSelectedToolName(tool.name)}
              >
                <code>{tool.name}</code>
              </button>
            );
          }) : activeTools ? (
            <EmptyState>{translate("tools.noTools")}</EmptyState>
          ) : (
            <EmptyState>{loading ? translate("tools.loading") : translate("tools.load")}</EmptyState>
          )}
        </div>
      </nav>

      <section className="tool-definition-detail" aria-label={translate("tools.details")}>
        {selectedTool ? (
          <div className="tool-definition-scroll">
            {selectedTool.description && (
              <section className="tool-definition-section">
                <div className="tool-definition-section-label">{translate("tools.description")}</div>
                <div className="tool-definition-description">{selectedTool.description}</div>
              </section>
            )}

            <section className="tool-definition-section">
              <div className="tool-definition-section-label">
                <span>{translate("tools.parameters")}</span>
                <span>{translate("tools.parameterCount", { count: fields.length })}</span>
              </div>
              {fields.length > 0 ? (
                <div className="tool-definition-fields">
                  {fields.map((field) => (
                    <div className="tool-definition-field" key={field.name}>
                      <div className="tool-definition-field-name">
                        <code>{field.name}</code>
                        <span className={field.required ? "required" : undefined}>
                          {translate(field.required ? "tools.required" : "tools.optional")}
                        </span>
                      </div>
                      <div className="tool-definition-field-value">
                        <code className="tool-definition-type">{field.type}</code>
                        {field.description && <div>{field.description}</div>}
                        {field.allowedValues && (
                          <div className="tool-definition-meta">
                            {translate("tools.allowedValues")}: <code>{field.allowedValues}</code>
                          </div>
                        )}
                        {field.defaultValue !== undefined && (
                          <div className="tool-definition-meta">
                            {translate("tools.defaultValue")}: <code>{field.defaultValue}</code>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="tool-definition-no-parameters">{translate("tools.noParameters")}</div>
              )}
            </section>

            {selectedTool.promptGuidelines && selectedTool.promptGuidelines.length > 0 && (
              <section className="tool-definition-section">
                <div className="tool-definition-section-label">{translate("tools.guidelines")}</div>
                <ul className="tool-definition-guidelines">
                  {selectedTool.promptGuidelines.map((guideline, index) => (
                    <li key={`${selectedTool.name}:${index}`}>{guideline}</li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        ) : (
          <EmptyState>
            {activeTools
              ? translate("tools.noTools")
              : loading
                ? translate("tools.loading")
                : translate("tools.load")}
          </EmptyState>
        )}
      </section>

      <style>{`
        .tool-definitions-panel {
          display: grid;
          grid-template-columns: clamp(112px, 26%, 220px) minmax(0, 1fr);
          height: min(600px, 75dvh);
          min-height: 240px;
          overflow: hidden;
          background: var(--bg-panel);
          border-bottom: 1px solid var(--border);
        }
        .tool-definitions-sidebar,
        .tool-definition-detail {
          display: flex;
          min-width: 0;
          min-height: 0;
          flex-direction: column;
        }
        .tool-definitions-sidebar {
          border-right: 1px solid var(--border);
          background: color-mix(in srgb, var(--bg-panel) 94%, var(--bg));
        }
        .tool-definitions-list,
        .tool-definition-scroll {
          min-height: 0;
          flex: 1;
          overflow: auto;
        }
        .tool-definitions-item {
          display: flex;
          width: 100%;
          min-height: 38px;
          align-items: center;
          padding: 8px 12px;
          border: none;
          border-bottom: 1px solid var(--border);
          background: transparent;
          color: var(--text-muted);
          cursor: pointer;
          text-align: left;
        }
        .tool-definitions-item:hover {
          background: var(--bg-hover);
          color: var(--text);
        }
        .tool-definitions-item.selected {
          background: var(--bg-selected);
          box-shadow: inset 2px 0 0 var(--accent);
          color: var(--text);
        }
        .tool-definitions-item code {
          max-width: 100%;
          color: inherit;
          font-size: 11px;
          font-weight: 600;
          overflow-wrap: anywhere;
        }
        .tool-definition-scroll {
          padding: 14px 16px 20px;
        }
        .tool-definition-section + .tool-definition-section {
          margin-top: 18px;
        }
        .tool-definition-section-label {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          margin-bottom: 7px;
          color: var(--text-dim);
          font-size: 11px;
          font-weight: 600;
        }
        .tool-definition-section-label > span:last-child {
          font-weight: 400;
          white-space: nowrap;
        }
        .tool-definition-description {
          color: var(--text-muted);
          font-size: 12px;
          line-height: 1.55;
          overflow-wrap: anywhere;
          white-space: pre-wrap;
        }
        .tool-definition-fields {
          border-top: 1px solid var(--border);
        }
        .tool-definition-field {
          display: grid;
          grid-template-columns: minmax(88px, 0.75fr) minmax(0, 1.5fr);
          gap: 12px;
          padding: 9px 0;
          border-bottom: 1px solid var(--border);
          font-size: 11px;
          line-height: 1.45;
        }
        .tool-definition-field-name {
          display: flex;
          min-width: 0;
          flex-direction: column;
          gap: 3px;
          color: var(--text);
        }
        .tool-definition-field-name code {
          overflow-wrap: anywhere;
        }
        .tool-definition-field-name span {
          color: var(--text-dim);
          font-size: 10px;
        }
        .tool-definition-field-name span.required {
          color: var(--accent);
        }
        .tool-definition-field-value {
          min-width: 0;
          color: var(--text-muted);
          overflow-wrap: anywhere;
        }
        .tool-definition-type {
          display: block;
          margin-bottom: 3px;
          color: var(--text);
        }
        .tool-definition-meta {
          margin-top: 4px;
          color: var(--text-dim);
        }
        .tool-definition-meta code {
          color: var(--text-muted);
        }
        .tool-definition-no-parameters {
          padding: 2px 0 10px;
          color: var(--text-dim);
          font-size: 11px;
        }
        .tool-definition-guidelines {
          margin: 0;
          padding-left: 18px;
          color: var(--text-muted);
          font-size: 11px;
          line-height: 1.5;
        }
        .tool-definitions-empty {
          padding: 14px 12px;
          color: var(--text-muted);
          font-size: 12px;
          font-style: italic;
          overflow-wrap: anywhere;
        }
        @media (max-width: 640px) {
          .tool-definitions-panel {
            grid-template-columns: 112px minmax(0, 1fr);
          }
          .tool-definitions-item {
            padding: 8px 10px;
          }
          .tool-definition-scroll {
            padding: 12px;
          }
          .tool-definition-field {
            grid-template-columns: minmax(74px, 0.7fr) minmax(0, 1.3fr);
            gap: 9px;
          }
        }
      `}</style>
    </div>
  );
}
