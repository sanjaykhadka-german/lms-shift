import { describe, it, expect } from "vitest";
import { normalizeHeader, parseCsv } from "../lib/lms/csv";

describe("parseCsv", () => {
  it("returns empty headers/rows on empty input", () => {
    expect(parseCsv("")).toEqual({ headers: [], rows: [] });
  });

  it("strips a UTF-8 BOM before parsing the header", () => {
    const csv = "﻿name,email\nJane,j@x.com\n";
    const out = parseCsv(csv);
    expect(out.headers).toEqual(["name", "email"]);
    expect(out.rows[0]).toEqual({ name: "Jane", email: "j@x.com" });
  });

  it("respects quoted fields with embedded commas + escaped quotes", () => {
    const csv = `name,note\n"Smith, John","She said ""hi"""\n`;
    const out = parseCsv(csv);
    expect(out.rows[0]).toEqual({
      name: "Smith, John",
      note: 'She said "hi"',
    });
  });

  it("handles CRLF, LF, and lone CR line endings", () => {
    const csv = "a,b\r\n1,2\r3,4\n5,6";
    const out = parseCsv(csv);
    expect(out.rows.map((r) => `${r.a}-${r.b}`)).toEqual(["1-2", "3-4", "5-6"]);
  });

  it("skips blank lines between rows", () => {
    const csv = "a,b\n1,2\n\n3,4\n";
    const out = parseCsv(csv);
    expect(out.rows).toEqual([
      { a: "1", b: "2" },
      { a: "3", b: "4" },
    ]);
  });

  it("fills missing trailing cells with empty strings", () => {
    const csv = "a,b,c\n1,2\n";
    const out = parseCsv(csv);
    expect(out.rows[0]).toEqual({ a: "1", b: "2", c: "" });
  });
});

describe("normalizeHeader", () => {
  it("lowercases + collapses whitespace, like Flask's _norm", () => {
    expect(normalizeHeader("First Name")).toBe("first name");
    expect(normalizeHeader("  EMAIL  ")).toBe("email");
    expect(normalizeHeader("first  name")).toBe("first name");
    expect(normalizeHeader("")).toBe("");
  });
});
