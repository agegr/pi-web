import { isRecord } from "./is-record";
/**
 * Client/server helpers for a models.json model's image size limit, pi's
 * `inputLimits.images.resize.maxBytes`: the most a new image may take in
 * conversation history, counted after base64 encoding. Without it pi uses
 * 4.5 MiB. pi's schema wants an integer of at least 1 and drops the whole
 * models.json on anything else, so Save checks every model that sets it.
 */

/** pi's `DEFAULT_MAX_BYTES` (pi-coding-agent's image-resize-core). */
export const DEFAULT_IMAGE_MAX_BYTES = 4.5 * 1024 * 1024;

/** The raw value in the model entry, a draft string included. */
export function imageMaxBytes(model: { inputLimits?: unknown }): unknown {
  const images = isRecord(model.inputLimits) ? model.inputLimits.images : undefined;
  const resize = isRecord(images) ? images.resize : undefined;
  return isRecord(resize) ? resize.maxBytes : undefined;
}

/**
 * Sets or (undefined) removes `maxBytes`, keeping the other limits and pruning
 * containers left empty. Text that is not a byte count stays a string, so the
 * field keeps showing it and Save refuses it.
 */
export function withImageMaxBytes<T extends { inputLimits?: unknown }>(model: T, value: string | undefined): T {
  const inputLimits = { ...(isRecord(model.inputLimits) ? model.inputLimits : {}) };
  const images = { ...(isRecord(inputLimits.images) ? inputLimits.images : {}) };
  const resize = { ...(isRecord(images.resize) ? images.resize : {}) };
  if (value === undefined) delete resize.maxBytes;
  else resize.maxBytes = parseImageMaxBytes(value) ?? value;
  if (Object.keys(resize).length) images.resize = resize;
  else delete images.resize;
  if (Object.keys(images).length) inputLimits.images = images;
  else delete inputLimits.images;
  const next = { ...model };
  if (Object.keys(inputLimits).length) next.inputLimits = inputLimits;
  else delete next.inputLimits;
  return next;
}

/** A whole number of bytes, at least 1; undefined for anything pi would refuse. */
export function parseImageMaxBytes(value: unknown): number | undefined {
  const parsed = typeof value === "string"
    ? (/^\d+$/.test(value.trim()) ? Number(value.trim()) : 0)
    : value;
  return typeof parsed === "number" && Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : undefined;
}

/** `512 KiB`, `4.5 MiB`: the help line and the Advanced summary. */
export function formatImageBytes(bytes: number): string {
  const units = ["B", "KiB", "MiB", "GiB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = unit === 0 ? String(value) : String(Math.round(value * 10) / 10);
  return `${rounded} ${units[unit]}`;
}

/** `model` is the entry's `provider/id`, so a refused save can name the field. */
export class ImageMaxBytesError extends Error {
  readonly model: string;

  constructor(model: string) {
    super(`Image size limit of ${model} must be a positive whole number of bytes`);
    this.name = "ImageMaxBytesError";
    this.model = model;
  }
}

/** Throws for the first custom model whose limit pi would refuse. */
export function checkImageMaxBytes(config: { providers?: unknown }): void {
  if (!isRecord(config.providers)) return;
  for (const [providerId, provider] of Object.entries(config.providers)) {
    if (!isRecord(provider) || !Array.isArray(provider.models)) continue;
    for (const model of provider.models) {
      // The store drops models with a blank id before writing.
      if (!isRecord(model) || (typeof model.id === "string" && !model.id.trim())) continue;
      const value = imageMaxBytes(model);
      if (value !== undefined && parseImageMaxBytes(value) === undefined) {
        throw new ImageMaxBytesError(`${providerId}/${typeof model.id === "string" ? model.id : "?"}`);
      }
    }
  }
}
