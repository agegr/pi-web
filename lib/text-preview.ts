import fs from "fs";
import { TEXT_PREVIEW_MAX_BYTES } from "./file-types";

export interface TextPreviewChunk {
  content: string;
  nextOffset: number;
  truncated: boolean;
}

function utf8SequenceLength(byte: number): number {
  if ((byte & 0xe0) === 0xc0) return 2;
  if ((byte & 0xf0) === 0xe0) return 3;
  if ((byte & 0xf8) === 0xf0) return 4;
  return 1;
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
  try {
    bytesRead = fs.readSync(descriptor, buffer, 0, length, offset);
  } finally {
    fs.closeSync(descriptor);
  }

  let end = Math.min(bytesRead, TEXT_PREVIEW_MAX_BYTES);
  if (offset + end < fileSize) {
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
    content: buffer.toString("utf8", 0, end),
    nextOffset,
    truncated: nextOffset < fileSize,
  };
}
