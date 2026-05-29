import { describe, it, expect } from "vitest";
import { parseJsonResponse } from "../lib/parse-json-response";

function res(
  body: string,
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  return new Response(body, {
    status: init.status ?? 200,
    headers: init.headers ?? { "content-type": "application/json" },
  });
}

describe("parseJsonResponse", () => {
  it("returns parsed JSON on a 2xx response", async () => {
    const out = await parseJsonResponse<{ file: { id: string } }>(
      res(JSON.stringify({ file: { id: "abc" } })),
      "fallback",
    );
    expect(out.file.id).toBe("abc");
  });

  it("treats an empty 2xx body as null (caller's responsibility)", async () => {
    const out = await parseJsonResponse<unknown>(res(""), "fallback");
    expect(out).toBeNull();
  });

  it("throws with the JSON `error` field on a 4xx response", async () => {
    await expect(
      parseJsonResponse(
        res(JSON.stringify({ error: "Not allowed" }), { status: 403 }),
        "fallback",
      ),
    ).rejects.toThrow(/^Not allowed$/);
  });

  it("throws with the raw text body when 4xx body is not JSON", async () => {
    await expect(
      parseJsonResponse(
        res("Unauthorized", { status: 401, headers: { "content-type": "text/plain" } }),
        "fallback",
      ),
    ).rejects.toThrow(/^Unauthorized$/);
  });

  it("throws with the fallback + status when 5xx body is empty", async () => {
    await expect(
      parseJsonResponse(res("", { status: 503 }), "upload failed"),
    ).rejects.toThrow(/upload failed \(HTTP 503\)/);
  });

  it("truncates long plain-text error bodies to 200 chars", async () => {
    const longBody = "x".repeat(500);
    await expect(
      parseJsonResponse(
        res(longBody, { status: 500, headers: { "content-type": "text/html" } }),
        "fallback",
      ),
    ).rejects.toThrow(/^x{200}$/);
  });
});
