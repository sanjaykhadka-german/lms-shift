// ─── Xero SDK error decoding (pure, SDK-free) ───────────────────────
//
// xero-node 9.x does NOT reject with Error instances. On an HTTP error the
// generated client (see payrollAUApi.createTimesheet) catches the axios error
// and rejects with `JSON.stringify(ApiError.generateError())` — i.e. a STRING
// of `{ response: { statusCode, body, ... }, body }`. On a non-2xx that axios
// didn't throw for, it rejects with the plain object `{ response, body }`.
// Either way `err instanceof Error` is false, so a naive
// `err instanceof Error ? err.message : "…"` discards Xero's real reason.
//
// This decodes all three shapes (Error | JSON string | plain object) into a
// human-readable message, pulling out Payroll-AU validation errors and the
// common generic body fields. Use it in every catch around a Xero SDK call.
//
// Kept free of `server-only` and the xero-node import so it's unit-testable.

function extractXeroBodyMessage(body: unknown): string | null {
  if (body == null) return null;
  if (typeof body === "string") return body.slice(0, 800) || null;
  if (typeof body !== "object") return String(body);
  const b = body as Record<string, unknown>;

  // Payroll-AU validation envelope: { Message, Elements: [{ ValidationErrors:
  // [{ Message }] }] }. Some endpoints surface a top-level ValidationErrors.
  const msgs: string[] = [];
  const collect = (arr: unknown) => {
    if (!Array.isArray(arr)) return;
    for (const ve of arr) {
      const m = (ve as Record<string, unknown> | null)?.Message;
      if (typeof m === "string" && m) msgs.push(m);
    }
  };
  if (Array.isArray(b.Elements)) {
    for (const el of b.Elements) {
      collect((el as Record<string, unknown> | null)?.ValidationErrors);
    }
  }
  collect(b.ValidationErrors);
  if (msgs.length > 0) {
    const base = typeof b.Message === "string" ? `${b.Message} — ` : "";
    return `${base}${[...new Set(msgs)].join("; ")}`;
  }

  // Generic shapes: RFC-7807 ({ Detail/Title }), accounting ({ Message }),
  // OAuth ({ error_description / error }).
  const pick = (...keys: string[]): string | null => {
    for (const k of keys) {
      const v = b[k];
      if (typeof v === "string" && v) return v;
    }
    return null;
  };
  return (
    pick(
      "Detail",
      "detail",
      "Message",
      "message",
      "Title",
      "title",
      "error_description",
      "error",
    ) ?? JSON.stringify(b).slice(0, 800)
  );
}

export function xeroErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;

  let parsed: unknown = err;
  if (typeof err === "string") {
    try {
      parsed = JSON.parse(err);
    } catch {
      return err; // already a plain message, not a JSON envelope
    }
  }
  if (!parsed || typeof parsed !== "object") {
    return String(err ?? "Unknown Xero error");
  }

  const obj = parsed as Record<string, unknown>;
  const resp = obj.response as Record<string, unknown> | undefined;
  const statusCode =
    (typeof resp?.statusCode === "number" ? resp.statusCode : undefined) ??
    (typeof obj.statusCode === "number" ? obj.statusCode : undefined);
  const detail = extractXeroBodyMessage(obj.body ?? resp?.body);
  const prefix = statusCode ? `Xero ${statusCode}` : "Xero error";
  return detail ? `${prefix}: ${detail}` : prefix;
}
