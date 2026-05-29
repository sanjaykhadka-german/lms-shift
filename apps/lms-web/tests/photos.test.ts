import { describe, it, expect, vi } from "vitest";

// Mock the DB import surface so importing photos.ts doesn't try to open a
// real postgres connection.
vi.mock("@tracey/db", () => ({
  db: {
    transaction: vi.fn(),
    delete: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })),
  },
  lmsUploadedFiles: {},
}));
vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
}));

import {
  PhotoUploadError,
  saveUserPhoto,
} from "../lib/lms/photos";

function makeFile(opts: { size: number; type: string; name?: string }): File {
  // Build a File whose .size matches opts.size by passing N zero bytes.
  const buf = new Uint8Array(opts.size);
  return new File([buf], opts.name ?? "x.bin", { type: opts.type });
}

describe("saveUserPhoto validation guards", () => {
  it("rejects an empty file", async () => {
    await expect(
      saveUserPhoto({
        file: makeFile({ size: 0, type: "image/png" }),
        traceyTenantId: "tid",
      }),
    ).rejects.toBeInstanceOf(PhotoUploadError);
  });

  it("rejects a file over 8 MB", async () => {
    const tooBig = 9 * 1024 * 1024;
    await expect(
      saveUserPhoto({
        file: makeFile({ size: tooBig, type: "image/png" }),
        traceyTenantId: "tid",
      }),
    ).rejects.toThrow(/too large/i);
  });

  it("rejects an unsupported MIME type", async () => {
    await expect(
      saveUserPhoto({
        file: makeFile({ size: 100, type: "application/pdf", name: "x.pdf" }),
        traceyTenantId: "tid",
      }),
    ).rejects.toThrow(/JPEG, PNG, WebP, or GIF/);
  });
});
