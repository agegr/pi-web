import fs from "fs";
import { TEXT_PREVIEW_MAX_BYTES } from "./file-types";

export interface TextPreviewChunk {
  content: string;
  nextOffset: number;
  truncated: boolean;
  // No text preview: the viewer offers the download instead of decoded bytes.
  binary: boolean;
}

// Git's own test (buffer_is_binary): a NUL byte among the first 8000 bytes.
// Invalid UTF-8 alone stays text, so a Latin-1 file still shows as before.
const BINARY_SNIFF_BYTES = 8000;

function utf8SequenceLength(byte: number): number {
  if ((byte & 0xe0) === 0xc0) return 2;
  if ((byte & 0xf0) === 0xe0) return 3;
  if ((byte & 0xf8) === 0xf0) return 4;
  return 1;
}

function looksBinary(buffer: Buffer, length: number): boolean {
  // UTF-16 text is full of NULs; a byte order mark keeps it the text view it had.
  if (length >= 2 && ((buffer[0] === 0xff && buffer[1] === 0xfe) || (buffer[0] === 0xfe && buffer[1] === 0xff))) {
    return false;
  }
  return buffer.subarray(0, Math.min(length, BINARY_SNIFF_BYTES)).includes(0);
}

export function readTextPreviewChunk(
  filePath: string,
  fileSize: number,
  offset: number,
): TextPreviewChunk {
  const length = Math.min(TEXT_PREVIEW_MAX_BYTES + 1, fileSize - offset);
  const buffer = Buffer.alloc(length);
  const descriptor = fs.openSync(filePath, "r");
  let bytesRead: number;
  const header = Buffer.alloc(2);
  try {
    fs.readSync(descriptor, header, 0, 2, 0);
    bytesRead = fs.readSync(descriptor, buffer, 0, length, offset);
  } finally {
    fs.closeSync(descriptor);
  }

  // Only the start of a file decides; Load more continues a file shown as text.
  if (offset === 0 && looksBinary(buffer, bytesRead)) {
    return { content: "", nextOffset: 0, truncated: false, binary: true };
  }

  let end = Math.min(bytesRead, TEXT_PREVIEW_MAX_BYTES);
  const utf16 = header[0] === 0xff && header[1] === 0xfe ? "utf-16le"
    : header[0] === 0xfe && header[1] === 0xff ? "utf-16be" : null;
  if (utf16 && offset + end < fileSize) {
    end -= end % 2;
    const last = utf16 === "utf-16le" ? buffer.readUInt16LE(end - 2) : buffer.readUInt16BE(end - 2);
    if (last >= 0xd800 && last <= 0xdbff) end -= 2;
  } else if (!utf16 && offset + end < fileSize) {
    let sequenceStart = end;
    while (sequenceStart > end - 3 && (buffer[sequenceStart] & 0xc0) === 0x80) {
      sequenceStart--;
    }
    if (utf8SequenceLength(buffer[sequenceStart]) > end - sequenceStart) {
      end = sequenceStart;
    }
  }
  const nextOffset = offset + end;

  return {
    content: utf16
      ? new TextDecoder(utf16, { ignoreBOM: true }).decode(buffer.subarray(offset === 0 ? 2 : 0, end))
      : buffer.toString("utf8", 0, end),
    nextOffset,
    truncated: nextOffset < fileSize,
    binary: false,
  };
}
