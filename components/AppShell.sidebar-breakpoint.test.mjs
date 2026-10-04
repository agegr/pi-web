import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Script, createContext } from "node:vm";
import ts from "typescript";

const source = ts.createSourceFile("AppShell.tsx", await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const nodes = [];
function visit(node) { nodes.push(node); ts.forEachChild(node, visit); }
visit(source);
function script(text) {
  return new Script(ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ESNext } }).outputText);
}
function setup(collapsed = false) {
  const preference = nodes.find((node) => ts.isVariableDeclaration(node) && node.name.getText(source) === "desktopSidebarOpenRef");
  assert.ok(preference, "desktop preference must be independent of drawer state");
  const effect = nodes.find((node) => ts.isCallExpression(node) && node.expression.getText(source) === "useEffect" && node.arguments[1]?.getText(source) === "[isMobile]" && node.arguments[0].getText(source).includes("setSidebarOpen"));
  const toggle = nodes.find((node) => ts.isVariableDeclaration(node) && node.name.getText(source) === "handleSidebarToggle");
  const context = createContext({
    initialNavigation: { sidebarCollapsed: collapsed }, isMobile: false, sidebarOpen: !collapsed,
    useRef: (current) => ({ current }), setActiveTopPanel() {}, setMobileToolbarMoreOpen() {},
  });
  context.desktopSidebarOpenRef = script(preference.initializer.getText(source)).runInContext(context);
  context.setSidebarOpen = (value) => { context.sidebarOpen = typeof value === "function" ? value(context.sidebarOpen) : value; };
  const runEffect = () => script(`(${effect.arguments[0].getText(source)})()`).runInContext(context);
  const runToggle = () => script(`(${toggle.initializer.arguments[0].getText(source)})()`).runInContext(context);
  return { context, runToggle, resize: (mobile) => { context.isMobile = mobile; runEffect(); } };
}

test("closing a mobile drawer restores the previously open desktop sidebar", () => {
  const state = setup();
  state.resize(true); assert.equal(state.context.sidebarOpen, false);
  state.runToggle(); assert.equal(state.context.sidebarOpen, true);
  state.runToggle(); assert.equal(state.context.sidebarOpen, false);
  state.resize(false); assert.equal(state.context.sidebarOpen, true);
});

test("opening a mobile drawer does not reopen an explicitly collapsed desktop sidebar", () => {
  const state = setup(); state.runToggle();
  assert.equal(state.context.sidebarOpen, false);
  state.resize(true); state.runToggle();
  state.resize(false); assert.equal(state.context.sidebarOpen, false);
  state.runToggle(); state.resize(true); state.resize(false);
  assert.equal(state.context.sidebarOpen, true);
});

test("URL sidebar collapse survives hydration and repeated breakpoint crossings", () => {
  const state = setup(true);
  state.resize(false); assert.equal(state.context.sidebarOpen, false);
  state.resize(true); state.runToggle(); state.resize(false);
  assert.equal(state.context.sidebarOpen, false);
  state.resize(true); state.resize(false); assert.equal(state.context.sidebarOpen, false);
});
