import { describe, it, expect } from "vitest";
import { xeroErrorMessage } from "~/lib/payroll/xero-errors";

// xero-node 9.x rejects HTTP failures as a JSON STRING of
// ApiError.generateError() = { response: { statusCode, body, ... }, body }.
// The old `err instanceof Error ? err.message : "Xero push failed"` discarded
// all of that. These lock in that the real reason now surfaces.

describe("xeroErrorMessage", () => {
  it("decodes the JSON-string envelope xero-node throws on a 400 validation error", () => {
    const xeroBody = {
      ErrorNumber: 10,
      Type: "ValidationException",
      Message: "A validation exception occurred",
      Elements: [
        {
          ValidationErrors: [
            { Message: "Timesheet period does not match a pay calendar period" },
          ],
        },
      ],
    };
    const thrown = JSON.stringify({
      response: { statusCode: 400, body: xeroBody },
      body: xeroBody,
    });
    expect(xeroErrorMessage(thrown)).toBe(
      "Xero 400: A validation exception occurred — Timesheet period does not match a pay calendar period",
    );
  });

  it("decodes the plain-object { response, body } shape", () => {
    const body = { Message: "Employee not found", Elements: [] };
    expect(xeroErrorMessage({ response: { statusCode: 404, body }, body })).toBe(
      "Xero 404: Employee not found",
    );
  });

  it("decodes an RFC-7807 / OAuth style body (Detail, no validation errors)", () => {
    const body = { Type: "https://xero", Title: "Forbidden", Status: 403, Detail: "TokenExpired" };
    const thrown = JSON.stringify({ response: { statusCode: 403, body }, body });
    expect(xeroErrorMessage(thrown)).toBe("Xero 403: TokenExpired");
  });

  it("dedupes repeated validation messages across elements", () => {
    const body = {
      Message: "Validation",
      Elements: [
        { ValidationErrors: [{ Message: "X" }, { Message: "Y" }] },
        { ValidationErrors: [{ Message: "X" }] },
      ],
    };
    expect(xeroErrorMessage({ response: { statusCode: 400, body }, body })).toBe(
      "Xero 400: Validation — X; Y",
    );
  });

  it("passes a real Error through unchanged", () => {
    expect(xeroErrorMessage(new Error("Xero is not connected for this tenant."))).toBe(
      "Xero is not connected for this tenant.",
    );
  });

  it("returns a non-JSON string as-is", () => {
    expect(xeroErrorMessage("boom")).toBe("boom");
  });

  it("never returns the old opaque fallback for a structured rejection", () => {
    const body = { Message: "Pay period is locked" };
    const thrown = JSON.stringify({ response: { statusCode: 400, body }, body });
    expect(xeroErrorMessage(thrown)).not.toBe("Xero push failed");
    expect(xeroErrorMessage(thrown)).toContain("Pay period is locked");
  });
});
