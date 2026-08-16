import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const { TaskHeader } = await jiti.import("./TaskHeader.tsx");
const { I18nProvider } = await jiti.import("../hooks/useI18n.tsx");

test("renders a title, real status, and accessible action buttons", () => {
  const html = renderToStaticMarkup(React.createElement(I18nProvider, null,
    React.createElement(TaskHeader, {
      title: "build a game to play",
      running: true,
      sidebarOpen: true,
      modified: "2026-08-13T08:00:00Z",
      onToggleSidebar() {},
      onViewHistory() {},
      historyDisabled: false,
      onAutoName() {},
      autoNameDisabled: false,
      onOpenBranches() {},
      onOpenSystem() {},
      onToggleFiles() {},
      filePanelOpen: false,
    }),
  ));
  assert.match(html, /build a game to play/);
  assert.match(html, /Running/);
  assert.match(html, /aria-label="Task actions"/);
  assert.match(html, /aria-label="Show file panel"/);
  assert.doesNotMatch(html, /aria-label="Toggle sidebar"/);
});

test("shows the sidebar restore button only while the sidebar is closed", () => {
  const html = renderToStaticMarkup(React.createElement(I18nProvider, null,
    React.createElement(TaskHeader, {
      title: "build a game to play",
      running: false,
      sidebarOpen: false,
      onToggleSidebar() {},
      onViewHistory() {},
      historyDisabled: false,
      onAutoName() {},
      autoNameDisabled: false,
      onOpenBranches() {},
      onOpenSystem() {},
      onToggleFiles() {},
      filePanelOpen: false,
    }),
  ));

  assert.match(html, /aria-label="Toggle sidebar"/);
});
