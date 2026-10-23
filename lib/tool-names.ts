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

/** Shell tools (`bash` / `powershell` share one `{ command, timeout? }` schema). */
export function isBashToolName(toolName: string): boolean {
  const name = toolName.toLowerCase();
  return name === "bash" ||
    name === "powershell" ||
    name === "bash (local)" ||
    name.startsWith("bash_") ||
    name.startsWith("powershell_") ||
    name.endsWith(".bash") ||
    name.endsWith("_bash") ||
    name.endsWith(".powershell") ||
    name.endsWith("_powershell");
}

/** Codex-style patch tools (e.g. the pi-apply-patch extension). */
export function isApplyPatchToolName(toolName: string): boolean {
  const name = toolName.toLowerCase();
  return name === "apply_patch" ||
    name.startsWith("apply_patch_") ||
    name.endsWith(".apply_patch") ||
    name.endsWith("_apply_patch");
}
