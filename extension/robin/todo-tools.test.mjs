import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { readTodos, writeTodos } from "./store.ts";
import { registerTodoTools } from "./todo-tools.ts";

const previousDataDir = process.env.ROBIN_DATA_DIR;
const dataDir = mkdtempSync(join(tmpdir(), "robin-todo-tools-"));
process.env.ROBIN_DATA_DIR = dataDir;

after(() => {
  rmSync(dataDir, { recursive: true, force: true });
  if (previousDataDir === undefined) delete process.env.ROBIN_DATA_DIR;
  else process.env.ROBIN_DATA_DIR = previousDataDir;
});

const tools = new Map();
registerTodoTools({ registerTool: (tool) => tools.set(tool.name, tool) });

function resultText(result) {
  return result.content[0].text;
}

test("todo_update edits a title and due date", async () => {
  writeTodos([{ id: "rent", title: "Pay rent", done: false, createdAt: "2026-08-01T00:00:00.000Z" }]);

  const result = await tools.get("todo_update").execute("call", {
    id: "rent",
    newTitle: "Pay apartment rent",
    due: "2026-08-21",
  });

  assert.match(resultText(result), /Updated/);
  assert.deepEqual(readTodos()[0], {
    id: "rent",
    title: "Pay apartment rent",
    due: "2026-08-21",
    done: false,
    createdAt: "2026-08-01T00:00:00.000Z",
  });
});

test("todo_delete removes only the selected todo", async () => {
  writeTodos([
    { id: "rent", title: "Pay rent", done: false, createdAt: "2026-08-01T00:00:00.000Z" },
    { id: "milk", title: "Buy milk", done: false, createdAt: "2026-08-01T00:00:00.000Z" },
  ]);

  const result = await tools.get("todo_delete").execute("call", { title: "rent" });

  assert.equal(resultText(result), "Deleted \"Pay rent\".");
  assert.deepEqual(readTodos().map((todo) => todo.id), ["milk"]);
});
