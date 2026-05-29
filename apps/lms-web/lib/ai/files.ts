import "server-only";
import crypto from "node:crypto";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import type Anthropic from "@anthropic-ai/sdk";
import type { StoredFile } from "./sessions";

// Limits mirror claude_service.py.
const MAX_PDF_BYTES = 32 * 1024 * 1024; // 32 MB
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB
const MAX_DOCX_BYTES = 16 * 1024 * 1024; // 16 MB

// Pre-flight guard: PDFs / DOCX with fewer than this many extractable words
// get rejected at upload time so we never burn an Anthropic API call on
// content too thin for Claude to build a module from.
const MIN_CONTENT_WORDS = 20;

const IMAGE_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

export interface ProcessedFile {
  stored: StoredFile;
  // Set the *first* time the file gets included in a turn; we don't re-attach
  // already-cited files because Claude keeps prior content in its own context.
  attachOnce: Anthropic.ContentBlockParam;
}

export class FileTooLargeError extends Error {}
export class UnsupportedFileError extends Error {}
export class ThinContentError extends Error {
  constructor(
    public readonly wordCount: number,
    public readonly filename: string,
  ) {
    super(
      `${filename} only has ${wordCount} word${wordCount === 1 ? "" : "s"} of extractable text — too thin to build a module from.`,
    );
  }
}

function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

export async function processUpload(file: File): Promise<ProcessedFile> {
  const mime = file.type || "application/octet-stream";
  const buf = Buffer.from(await file.arrayBuffer());
  if (mime === "application/pdf") {
    if (buf.length > MAX_PDF_BYTES) throw new FileTooLargeError("PDF over 32 MB");
    const parser = new PDFParse({ data: new Uint8Array(buf) });
    let extracted = "";
    try {
      const result = await parser.getText();
      extracted = result.text ?? "";
    } finally {
      await parser.destroy().catch(() => undefined);
    }
    const words = countWords(extracted);
    if (words < MIN_CONTENT_WORDS) {
      throw new ThinContentError(words, file.name);
    }
    const id = crypto.randomBytes(8).toString("hex");
    const body = buf.toString("base64");
    return {
      stored: { id, kind: "pdf", name: file.name, mime, size: buf.length, body },
      attachOnce: {
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: body },
      },
    };
  }
  if (
    mime ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    file.name.toLowerCase().endsWith(".docx")
  ) {
    if (buf.length > MAX_DOCX_BYTES) throw new FileTooLargeError("DOCX over 16 MB");
    const result = await mammoth.extractRawText({ buffer: buf });
    const text = result.value.trim();
    const words = countWords(text);
    if (words < MIN_CONTENT_WORDS) {
      throw new ThinContentError(words, file.name);
    }
    const id = crypto.randomBytes(8).toString("hex");
    return {
      stored: {
        id,
        kind: "docx",
        name: file.name,
        mime,
        size: buf.length,
        body: text,
      },
      attachOnce: {
        type: "text",
        text:
          `Reference document: ${file.name}\n\n` +
          `--- begin extracted text ---\n${text}\n--- end extracted text ---`,
      },
    };
  }
  if (IMAGE_MIME.has(mime)) {
    if (buf.length > MAX_IMAGE_BYTES) throw new FileTooLargeError("Image over 5 MB");
    const id = crypto.randomBytes(8).toString("hex");
    const body = buf.toString("base64");
    return {
      stored: { id, kind: "image", name: file.name, mime, size: buf.length, body },
      attachOnce: {
        type: "image",
        source: {
          type: "base64",
          media_type: mime as "image/png" | "image/jpeg" | "image/gif" | "image/webp",
          data: body,
        },
      },
    };
  }
  throw new UnsupportedFileError(`Unsupported MIME type: ${mime}`);
}
