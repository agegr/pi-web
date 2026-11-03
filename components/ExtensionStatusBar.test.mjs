import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const {
  ExtensionStatusBar,
  extensionStatusCommand,
  formatExtensionStatusLine,
  sanitizeExtensionStatusText,
} = await jiti.import("./ExtensionStatusBar.tsx");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");

function renderStatusBar(props) {
  return renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(ExtensionStatusBar, props),
    ),
  );
}

test("sorts status text by hidden key like the Pi CLI footer", () => {
  const statuses = [
    { key: "20-memory", text: "memory" },
    { key: "90-notify", text: "notify" },
    { key: "10-permissions", text: "permissions" },
    { key: "05-ponytail", text: "ponytail" },
  ];

  assert.equal(
    formatExtensionStatusLine(statuses),
    "ponytail permissions memory notify",
  );
});

test("preserves status line breaks while normalizing horizontal whitespace", () => {
  assert.equal(
    sanitizeExtensionStatusText("  first\tsecond \r\n third  "),
    "first second\nthird",
  );
});

test("renders each status as its own cell without identifier keys", () => {
  const html = renderStatusBar({
    statuses: [
      { key: "20-memory", text: "\x1b[32mmemory\x1b[0m" },
      { key: "05-ponytail", text: "ponytail" },
    ],
  });

  assert.match(html, /aria-label="ponytail memory"/);
  assert.match(html, /extension-status-shelf/);
  assert.match(html, /extension-status-line/);
  assert.match(html, /extension-status-text/);
  assert.equal(html.match(/class="extension-status-item"/g)?.length, 2);
  assert.match(html, /extension-status-item"><span>ponytail<\/span><\/span>/);
  assert.match(html, /<span class="ansi-green-fg">memory<\/span>/);
  assert.doesNotMatch(html, /05-ponytail|20-memory/);
  assert.doesNotMatch(html, /<button/);
});

test("a status with nothing visible to show gets no cell", () => {
  const html = renderStatusBar({
    statuses: [
      { key: "a", text: "   " },
      { key: "b", text: "\x1b[0m" },
      { key: "c", text: "shown" },
    ],
  });

  assert.equal(html.match(/class="extension-status-item"/g)?.length, 1);
  assert.match(html, /aria-label="shown"/);
  assert.equal(renderStatusBar({ statuses: [{ key: "a", text: "" }] }), "");
});

test("renders widgets and status text in one footer", () => {
  const html = renderStatusBar({
    statuses: [{ key: "status", text: "connected" }],
    widgets: [{
      key: "usage",
      lines: ["42%"],
      placement: "aboveEditor",
    }],
  });

  assert.match(html, /extension-status-shelf has-widgets has-status/);
  assert.match(html, /extension-widget-triggers/);
  assert.match(html, /usage/);
  assert.match(html, /connected/);
});

test("reads a slash command from a command: status key", () => {
  assert.equal(extensionStatusCommand("command:/mode toggle"), "/mode toggle");
  assert.equal(extensionStatusCommand("command:  /mode  "), "/mode");
  // Only slash commands are buttons: plain text would reach the model, and
  // "!" would run a shell command.
  assert.equal(extensionStatusCommand("command:hello"), null);
  assert.equal(extensionStatusCommand("command:!ls"), null);
  assert.equal(extensionStatusCommand("command:/"), null);
  assert.equal(extensionStatusCommand("command:"), null);
  assert.equal(extensionStatusCommand("mode"), null);
  assert.equal(extensionStatusCommand("chip:/mode toggle"), null);
});

test("renders a command status as a button cell between the text cells around it, in key order", () => {
  const html = renderStatusBar({
    statuses: [
      { key: "zz-last", text: "last" },
      { key: "command:/mode toggle", text: "\x1b[32m🔨 Build\x1b[0m" },
      { key: "aa-first", text: "first" },
    ],
    onCommand: () => {},
  });

  assert.match(html, /aria-label="first 🔨 Build last"/);
  assert.match(
    html,
    /first<\/span><\/span><button[^>]*class="extension-status-item extension-status-command"[^>]*aria-label="🔨 Build \(\/mode toggle\)"[^>]*>🔨 Build<\/button><span class="extension-status-item"><span>last/,
  );
  assert.doesNotMatch(html, /disabled/);
  // The key is not shown as text.
  assert.doesNotMatch(html, />command:/);
});

test("an onCommand handler changes nothing for statuses without a command", () => {
  const statuses = [
    { key: "20-memory", text: "\x1b[32mmemory\x1b[0m" },
    { key: "05-ponytail", text: "ponytail" },
  ];
  assert.equal(
    renderStatusBar({ statuses, onCommand: () => {} }),
    renderStatusBar({ statuses }),
  );
  assert.doesNotMatch(renderStatusBar({ statuses }), /<button/);
});

test("a command key that is not a slash command stays plain status text", () => {
  const html = renderStatusBar({
    statuses: [{ key: "command:hello", text: "hello" }],
    onCommand: () => {},
  });

  assert.doesNotMatch(html, /<button/);
  assert.match(html, />hello</);
});

test("falls back to the command when the status text is empty", () => {
  const html = renderStatusBar({
    statuses: [{ key: "command:/mode toggle", text: "\x1b[1m \x1b[0m" }],
    onCommand: () => {},
  });

  assert.match(html, /aria-label="\/mode toggle \(\/mode toggle\)"[^>]*>\/mode toggle<\/button>/);
});

test("command buttons are disabled while commands are blocked or nothing can send them", () => {
  const statuses = [{ key: "command:/mode toggle", text: "Plan" }];

  assert.match(renderStatusBar({ statuses, onCommand: () => {}, commandsDisabled: true }), /<button[^>]*disabled/);
  assert.match(renderStatusBar({ statuses }), /<button[^>]*disabled/);
  assert.doesNotMatch(renderStatusBar({ statuses, onCommand: () => {} }), /<button[^>]*disabled/);
});

test("clicking a command button sends its command", () => {
  const sent = [];
  // The component has no hooks, so calling it returns the element tree.
  const tree = ExtensionStatusBar({
    statuses: [{ key: "command:/mode toggle", text: "Plan" }],
    onCommand: (command) => sent.push(command),
  });
  const buttons = [];
  const walk = (node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach(walk);
    if (node.type === "button") buttons.push(node);
    walk(node.props?.children);
  };
  walk(tree);

  assert.equal(buttons.length, 1);
  buttons[0].props.onClick();
  assert.deepEqual(sent, ["/mode toggle"]);
});

test("marks the shelf only when it has a command button", () => {
  const plain = renderStatusBar({ statuses: [{ key: "status", text: "connected" }], onCommand: () => {} });
  const withCommand = renderStatusBar({
    statuses: [{ key: "command:/mode toggle", text: "Plan" }],
    onCommand: () => {},
  });

  assert.doesNotMatch(plain, /has-commands/);
  assert.match(withCommand, /class="extension-status-shelf has-status has-commands"/);
});

test("with widgets, the triggers and the status line share one scrolling row below the panel", () => {
  const html = renderStatusBar({
    statuses: [{ key: "status", text: "connected" }],
    widgets: [{ key: "usage", lines: ["a", "b"], placement: "aboveEditor" }],
  });
  const panel = html.indexOf("extension-widget-panels");
  const row = html.indexOf('class="extension-status-row"');
  const triggers = html.indexOf("extension-widget-triggers");
  const line = html.indexOf("extension-status-line");

  // The expanded panel stays outside the row, so it does not scroll sideways with it.
  assert.ok(panel !== -1 && panel < row, "panel comes before the row");
  assert.ok(row < triggers && triggers < line, "row holds the triggers, then the status line");
  assert.equal(html.match(/class="extension-status-row"/g)?.length, 1);
});

test("without widgets there is no shared row, and without status the row holds only the triggers", () => {
  assert.doesNotMatch(
    renderStatusBar({ statuses: [{ key: "status", text: "connected" }] }),
    /extension-status-row/,
  );

  const html = renderStatusBar({
    statuses: [],
    widgets: [{ key: "usage", lines: ["a"], placement: "aboveEditor" }],
  });
  assert.match(html, /extension-status-row/);
  assert.doesNotMatch(html, /extension-status-line/);
});
