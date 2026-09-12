/**
 * Tool-name predicates shared by the chat views.
 *
 * Pi's built-in names are plain `write` / `edit`, but MCP servers expose the
 * same operations under prefixed or namespaced names, so each predicate also
 * accepts the common decorated forms.
 */

export function isWriteToolName(toolName: string): boolean {
  const name = toolName.toLowerCase();
  return name === "write" ||
    name.startsWith("write_") ||
    name.endsWith(".write") ||
    name.endsWith("_write");
}

export function isEditToolName(toolName: string): boolean {
  const name = toolName.toLowerCase();
  return name === "edit" ||
    name.startsWith("edit_") ||
    name.endsWith(".edit") ||
    name.endsWith("_edit") ||
    name.includes("str_replace") ||
    name.includes("replace_editor");
}

export function isReadToolName(toolName: string): boolean {
  const name = toolName.toLowerCase();
  return name === "read" ||
    name.startsWith("read_") ||
    name.endsWith(".read") ||
    name.endsWith("_read");
}

export function isBashToolName(toolName: string): boolean {
  const name = toolName.toLowerCase();
  return name === "bash" ||
    name === "execute_code" ||
    name.startsWith("bash_") ||
    // Synthesized display name for user-run local bash (see BashExecutionView).
    name.startsWith("bash (") ||
    name.endsWith(".bash") ||
    name.endsWith("_bash") ||
    name === "run_bash" ||
    name.includes("shell");
}
