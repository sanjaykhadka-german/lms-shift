// Minimal CSV parser. Handles quoted fields, embedded quotes ("" -> "), and
// CRLF/LF line endings. UTF-8 BOM is stripped by the caller before this
// runs. Doesn't try to be RFC 4180 perfect — that's overkill for the bulk
// employee import use case where the input is either our own template or
// an Excel export.

export type CsvRow = Record<string, string>;

export interface ParsedCsv {
  headers: string[];
  rows: CsvRow[];
}

export function parseCsv(text: string): ParsedCsv {
  // Strip UTF-8 BOM if present.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const records = splitRecords(text);
  if (records.length === 0) return { headers: [], rows: [] };
  const headers = records[0]!;
  const rows: CsvRow[] = [];
  for (let i = 1; i < records.length; i++) {
    const r = records[i]!;
    if (r.length === 1 && r[0] === "") continue; // blank line
    const obj: CsvRow = {};
    for (let j = 0; j < headers.length; j++) {
      obj[headers[j]!] = r[j] ?? "";
    }
    rows.push(obj);
  }
  return { headers, rows };
}

function splitRecords(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const c = text[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i += 1;
        }
      } else {
        field += c;
        i += 1;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (c === ",") {
      row.push(field);
      field = "";
      i += 1;
      continue;
    }
    if (c === "\r") {
      // CRLF or lone CR — both end the row.
      if (text[i + 1] === "\n") i += 1;
      row.push(field);
      out.push(row);
      row = [];
      field = "";
      i += 1;
      continue;
    }
    if (c === "\n") {
      row.push(field);
      out.push(row);
      row = [];
      field = "";
      i += 1;
      continue;
    }
    field += c;
    i += 1;
  }
  // Flush the last field/row.
  if (field !== "" || row.length > 0) {
    row.push(field);
    out.push(row);
  }
  return out;
}

/** Normalize a header for lookup: lowercase + collapse whitespace. Mirrors
 *  Flask's `_norm` (app.py:3067). */
export function normalizeHeader(h: string): string {
  return (h ?? "").toLowerCase().split(/\s+/).filter(Boolean).join(" ");
}
