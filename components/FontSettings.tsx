"use client";

import { useI18n } from "@/hooks/useI18n";
import { useFontPreferences } from "@/hooks/useFontPreferences";
import { FONT_FAMILY_MAX_LENGTH, FONT_WEIGHT_DEFAULT, FONT_WEIGHT_OPTIONS } from "@/lib/font-preferences";
import { ConfigButton } from "./SettingsUi";

const FONT_FIELDS = [
  { kind: "ui", label: "settings.uiFontFamily", placeholder: "settings.uiFontPlaceholder", reset: "settings.resetUiFont", weightLabel: "settings.uiFontWeight" },
  { kind: "mono", label: "settings.monoFontFamily", placeholder: "settings.monoFontPlaceholder", reset: "settings.resetMonoFont", weightLabel: "settings.monoFontWeight" },
] as const;

/**
 * Rows for the Fonts & layout section, shaped like the size and width rows below:
 * label, name field, weight value and reset in the header line, the weight slider under it.
 * The name field is drawn in the font it names, so it doubles as the preview.
 */
export function FontSettings() {
  const { t } = useI18n();
  const fonts = useFontPreferences();

  // One grid for both rows, so the name fields start at the same x whatever the labels' widths.
  return <div className="settings-font-rows">{FONT_FIELDS.map(({ kind, label, placeholder, reset, weightLabel }) => {
    const weight = fonts[`${kind}Weight`];
    const weightIndex = FONT_WEIGHT_OPTIONS.findIndex((option) => option.value === weight);
    return (
      <div key={kind} className="settings-chat-option settings-chat-range-option settings-font-row">
        <div className="settings-chat-range-header settings-font-header">
          <label htmlFor={`settings-font-${kind}`}>{t(label)}</label>
          <input
            id={`settings-font-${kind}`}
            className={`settings-font-input${kind === "mono" ? " is-mono" : ""}`}
            type="text"
            value={fonts[kind]}
            placeholder={t(placeholder)}
            maxLength={FONT_FAMILY_MAX_LENGTH}
            aria-describedby="settings-typography-description"
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            onChange={(event) => fonts.setFontPreference(kind, event.target.value)}
          />
          <output htmlFor={`settings-font-${kind}-weight`}>{weight}</output>
          <ConfigButton
            variant="ghost"
            size="small"
            className="settings-chat-reset"
            title={t(reset)}
            aria-label={t(reset)}
            disabled={!fonts[kind] && weight === FONT_WEIGHT_DEFAULT}
            onClick={() => fonts.resetFontPreference(kind)}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8M3 3v5h5" />
            </svg>
          </ConfigButton>
        </div>
        <input
          id={`settings-font-${kind}-weight`}
          type="range"
          min={FONT_WEIGHT_OPTIONS[0].value}
          max={FONT_WEIGHT_OPTIONS[FONT_WEIGHT_OPTIONS.length - 1].value}
          step={100}
          value={weight}
          aria-label={t(weightLabel)}
          aria-valuetext={`${weight} ${t(FONT_WEIGHT_OPTIONS[weightIndex].label)}`}
          onChange={(event) => fonts.setFontWeight(kind, Number(event.target.value))}
        />
      </div>
    );
  })}</div>;
}
