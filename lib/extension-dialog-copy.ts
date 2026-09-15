type SelectLikeRequest = { method: "select"; title: string; options: string[] };
type ConfirmLikeRequest = { method: "confirm"; title: string; message: string };
type OtherDialogRequest = { method: "input" | "editor"; title: string };

export type ExtensionDialogCopyRequest = SelectLikeRequest | ConfirmLikeRequest | OtherDialogRequest;

export function firstNonEmptyLine(text: string): string | undefined {
  return text.split("\n").find((line) => line.trim())?.trim();
}

function splitSelectTitle(title: string): { heading: string; prompt?: string } {
  if (!title.includes("\n")) return { heading: title };
  const lines = title.split("\n");
  const firstIndex = lines.findIndex((line) => line.trim());
  if (firstIndex < 0) return { heading: title };
  const heading = lines[firstIndex].trim();
  const remainder = lines.slice(firstIndex + 1).join("\n").replace(/^\n+/, "");
  if (!remainder.trim()) return { heading };
  return { heading, prompt: remainder };
}

export function getExtensionDialogHeading(request: ExtensionDialogCopyRequest): string {
  if (request.method !== "select") return request.title;
  return splitSelectTitle(request.title).heading;
}

export function getExtensionDialogPrompt(request: ExtensionDialogCopyRequest): string | undefined {
  if (request.method !== "select") return undefined;
  return splitSelectTitle(request.title).prompt;
}

export function getExtensionDialogSummary(request: ExtensionDialogCopyRequest): string | undefined {
  if (request.method === "select") {
    return firstNonEmptyLine(getExtensionDialogPrompt(request) ?? "")
      ?? (request.options.length > 0 ? request.options[0] : undefined);
  }
  if (request.method === "confirm") {
    return firstNonEmptyLine(request.message);
  }
  return undefined;
}
