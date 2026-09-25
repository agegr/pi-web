/**
 * Behavioral seams for the directory picker's manage-mode row actions
 * (wi pi#52): per-row DELETE and per-row inline PATH RENAME, as plain
 * injectable-callback factories so node --test drives the real rules with
 * in-memory storage and no DOM — mirroring createRowPinHandler /
 * createCreateFlow in components/DirectoryPicker.tsx and
 * createDirectoryPinFlow in lib/custom-directory-pin.ts.
 *
 * Refusals are TYPED REASONS (never locale text): the store owner (the
 * sidebar) maps a reason to an i18n message for the UI. Every refusal
 * leaves the store unmutated.
 *
 * - delete refuses with reason "lastEntry" when the list holds exactly one
 *   entry (the guard is picker-surface only; the sidebar's group-header
 *   unpin stays unguarded per the spec's Non-Goal),
 * - a successful delete removes the entry AND discards its persisted
 *   expansion key (no stale accordion reference survives),
 * - rename maps the store primitive's refusals: empty → "empty",
 *   other-entry identity collision → "duplicate"; the same-identity
 *   no-op is silent success.
 *
 * The store accessors are INJECTED with no production default writes (the
 * same review blocker as pi#47's pin flow): the sidebar owns the store.
 * `customDirectoryIdentity` — a pure helper, not a write — is used to derive
 * the expansion key handed to discardExpandedKey.
 */

import {
  customDirectoryIdentity,
  type CustomDirectoryEntry,
  type CustomDirectoryPathRenameOutcome,
} from "./custom-directories";

/** Typed refusal reasons; the UI maps these to i18n keys. */
export type ManageRefusalReason = "lastEntry" | "empty" | "duplicate";

/** Uniform row-action outcome: success (silent) or a typed refusal. */
export type RowManageOutcome = { ok: true } | { ok: false; reason: ManageRefusalReason };

/**
 * Per-row delete: the last remaining entry can never be deleted (reason
 * "lastEntry", store NOT mutated); any other delete removes the entry and
 * discards its persisted expansion key so no stale accordion reference
 * survives. The injected onError(reason) fires on every refusal.
 */
export function createRowDeleteHandler(deps: {
  /** The current listed entries (injected store read). */
  list: () => readonly CustomDirectoryEntry[];
  /** Store removal (injected; list operation only — disk is untouched). */
  remove: (path: string) => void;
  /** Expansion-key discard (injected persistence seam). */
  discardExpandedKey: (key: string) => void;
  /** Push notification of every refusal (the outcome also carries it). */
  onError: (reason: ManageRefusalReason) => void;
}): (path: string) => RowManageOutcome {
  return (path) => {
    const entries = deps.list();
    if (entries.length <= 1) {
      deps.onError("lastEntry");
      return { ok: false, reason: "lastEntry" };
    }
    deps.remove(path);
    deps.discardExpandedKey(customDirectoryIdentity(path));
    return { ok: true };
  };
}

/**
 * Per-row inline path rename: delegates to the injected store primitive
 * (renameCustomDirectoryPath) and maps its typed outcome — a refusal keeps
 * the entry untouched and reports the reason; the same-identity no-op is
 * silent success (the editor closes with no error).
 */
export function createRowPathRenameHandler(deps: {
  /** The store's path-edit primitive (injected). */
  renamePath: (currentPath: string, nextPath: string) => CustomDirectoryPathRenameOutcome;
  /** Push notification of every refusal (the outcome also carries it). */
  onError: (reason: ManageRefusalReason) => void;
}): (currentPath: string, nextPath: string) => RowManageOutcome {
  return (currentPath, nextPath) => {
    const outcome = deps.renamePath(currentPath, nextPath);
    if (outcome.status === "refused") {
      deps.onError(outcome.reason);
      return { ok: false, reason: outcome.reason };
    }
    // "updated" and the same-identity "noop" are both silent success.
    return { ok: true };
  };
}
