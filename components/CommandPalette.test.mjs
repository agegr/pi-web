import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  filterCommandItems,
  getNextSelectedIndex,
  isCommandPaletteShortcut,
  shouldIgnoreGlobalShortcut,
} from "./command-palette-helpers.ts";

const sampleItems = [
  { id: "1", label: "New Session", group: "Actions", keywords: "create chat", onSelect: () => {} },
  { id: "2", label: "Toggle Sidebar", group: "Actions", keywords: "sessions panel", onSelect: () => {} },
  { id: "3", label: "Fix auth bug", group: "Sessions", detail: "/workspace/app", keywords: "sess-3", onSelect: () => {} },
  { id: "4", label: "Open Terminal", group: "Actions", keywords: "shell bash", onSelect: () => {} },
];

describe("filterCommandItems", () => {
  it("returns all items when query is empty or whitespace", () => {
    assert.equal(filterCommandItems(sampleItems, "").length, 4);
    assert.equal(filterCommandItems(sampleItems, "   ").length, 4);
  });

  it("filters case-insensitively across label, group, detail, and keywords", () => {
    const byLabel = filterCommandItems(sampleItems, "sidebar");
    assert.deepEqual(byLabel.map((i) => i.id), ["2"]);

    const byDetail = filterCommandItems(sampleItems, "/workspace/app");
    assert.deepEqual(byDetail.map((i) => i.id), ["3"]);

    const byKeywords = filterCommandItems(sampleItems, "bash");
    assert.deepEqual(byKeywords.map((i) => i.id), ["4"]);
  });

  it("requires all space-separated tokens to match", () => {
    const matches = filterCommandItems(sampleItems, "sessions fix");
    assert.deepEqual(matches.map((i) => i.id), ["3"]);

    const none = filterCommandItems(sampleItems, "sessions nonexistent");
    assert.deepEqual(none, []);
  });
});

describe("getNextSelectedIndex", () => {
  it("wraps around in both directions", () => {
    assert.equal(getNextSelectedIndex(0, 3, "down"), 1);
    assert.equal(getNextSelectedIndex(2, 3, "down"), 0);
    assert.equal(getNextSelectedIndex(0, 3, "up"), 2);
    assert.equal(getNextSelectedIndex(1, 3, "up"), 0);
  });

  it("returns 0 when list is empty", () => {
    assert.equal(getNextSelectedIndex(0, 0, "down"), 0);
    assert.equal(getNextSelectedIndex(2, 0, "up"), 0);
  });
});

describe("isCommandPaletteShortcut", () => {
  it("matches Cmd+K and Ctrl+K", () => {
    assert.equal(isCommandPaletteShortcut({ key: "k", metaKey: true, ctrlKey: false }), true);
    assert.equal(isCommandPaletteShortcut({ key: "K", metaKey: false, ctrlKey: true }), true);
  });

  it("rejects Alt+K or plain k", () => {
    assert.equal(isCommandPaletteShortcut({ key: "k", metaKey: true, ctrlKey: false, altKey: true }), false);
    assert.equal(isCommandPaletteShortcut({ key: "k", metaKey: false, ctrlKey: false }), false);
    assert.equal(isCommandPaletteShortcut({ key: "j", metaKey: true, ctrlKey: false }), false);
  });
});

describe("shouldIgnoreGlobalShortcut", () => {
  it("ignores form inputs and contentEditable elements", () => {
    assert.equal(shouldIgnoreGlobalShortcut({ tagName: "INPUT" }), true);
    assert.equal(shouldIgnoreGlobalShortcut({ tagName: "textarea" }), true);
    assert.equal(shouldIgnoreGlobalShortcut({ tagName: "SELECT" }), true);
    assert.equal(shouldIgnoreGlobalShortcut({ tagName: "DIV", isContentEditable: true }), true);
  });

  it("allows non-input elements and null targets", () => {
    assert.equal(shouldIgnoreGlobalShortcut({ tagName: "DIV" }), false);
    assert.equal(shouldIgnoreGlobalShortcut(null), false);
  });
});
