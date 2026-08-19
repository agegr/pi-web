import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  EXTENSION_TAB_LABELS,
  EXTENSION_TAB_ORDER,
  canonicalExtensionTabId,
  normalizeExtensionTabOrder,
} from "./extension-tab-order.ts";

const FIXED = ["filechanges", "details", "tasks", "exec-summary"];

describe("normalizeExtensionTabOrder", () => {
  it("maps arbitrary registration order to File Changes -> Details -> Tasks -> Exec Summary", () => {
    // Worst-case: everything registered in reverse, with the footer inserted
    // mid-way. Output must be the canonical fixed order.
    const ids = ["exec-summary", "plan-todos", "filechanges", "details", "rpc-demo"];
    assert.deepEqual(normalizeExtensionTabOrder(ids), ["rpc-demo", "filechanges", "details", "tasks", "exec-summary"]);
  });

  it("keeps every permutation of the fixed tabs in canonical order", () => {
    const permutations = [
      ["filechanges", "details", "tasks", "exec-summary"],
      ["exec-summary", "tasks", "details", "filechanges"],
      ["tasks", "filechanges", "exec-summary", "details"],
      ["details", "exec-summary", "filechanges", "tasks"],
    ];
    for (const ids of permutations) {
      assert.deepEqual(normalizeExtensionTabOrder(ids), FIXED, `permutation ${ids.join(",")}`);
    }
  });

  it("normal tabs keep their relative order and come before fixed tabs", () => {
    const ids = ["b-tab", "filechanges", "a-tab", "c-tab", "exec-summary", "plan-todos", "details"];
    assert.deepEqual(
      normalizeExtensionTabOrder(ids),
      ["b-tab", "a-tab", "c-tab", "filechanges", "details", "tasks", "exec-summary"],
    );
  });

  it("repeated recreation/updates never move the fixed tabs (idempotent)", () => {
    // Simulate repeated widget updates: array rebuilt with the same keys but
    // fresh ordering on every render. Output must stay stable.
    const rebuilds = [
      ["filechanges", "exec-summary", "plan-todos", "details"],
      ["details", "plan-todos", "exec-summary", "filechanges"],
      ["exec-summary", "details", "filechanges", "plan-todos"],
      ["plan-todos", "filechanges", "details", "exec-summary"],
    ];
    const expected = normalizeExtensionTabOrder(rebuilds[0]);
    for (const ids of rebuilds) {
      assert.deepEqual(normalizeExtensionTabOrder(ids), expected);
    }
  });

  it("Exec Summary is always the final tab when present", () => {
    const ids = ["exec-summary", "filechanges", "plan-todos", "details", "extra"];
    const result = normalizeExtensionTabOrder(ids);
    assert.equal(result[result.length - 1], "exec-summary");
  });

  it("omits fixed tabs that are not present", () => {
    assert.deepEqual(
      normalizeExtensionTabOrder(["filechanges", "details"]),
      ["filechanges", "details"],
    );
    assert.deepEqual(normalizeExtensionTabOrder([]), []);
  });

  it("resolves the plan-todos widget alias to the tasks tab", () => {
    assert.equal(canonicalExtensionTabId("plan-todos"), "tasks");
    assert.equal(canonicalExtensionTabId("filechanges"), "filechanges");
  });

  it("provides user-visible labels for every fixed tab", () => {
    assert.deepEqual(
      EXTENSION_TAB_ORDER.map((id) => EXTENSION_TAB_LABELS[id]),
      ["File Changes", "Details", "Tasks", "Exec Summary"],
    );
  });
});
