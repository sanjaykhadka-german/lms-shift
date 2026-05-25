import { describe, it, expect, vi } from "vitest";

vi.mock("@tracey/db", () => ({
  forTenant: () => ({ run: async () => [] }),
  scLeaveTypes: {},
  scTimeOffRequests: {},
}));

const { deriveSlugFromName } = await import("~/lib/leave-types");

describe("deriveSlugFromName", () => {
  it("lowercases + underscores spaces", () => {
    expect(deriveSlugFromName("Annual leave")).toBe("annual_leave");
  });

  it("collapses runs of non-alphanumeric chars", () => {
    expect(deriveSlugFromName("Personal / Sick")).toBe("personal_sick");
    expect(deriveSlugFromName("Carer's leave")).toBe("carer_s_leave");
  });

  it("strips leading + trailing underscores", () => {
    expect(deriveSlugFromName("---  Long  Service ---")).toBe("long_service");
  });

  it("caps at 40 chars (matches the check constraint)", () => {
    const long = "a very long leave type name that exceeds forty characters in total";
    const out = deriveSlugFromName(long);
    expect(out.length).toBeLessThanOrEqual(40);
    expect(out.startsWith("a_very_long_leave_type_name")).toBe(true);
  });

  it("falls back to a random slug when input has no leading letter", () => {
    const out = deriveSlugFromName("123 numbers only");
    expect(out).toMatch(/^type_[a-z0-9]{2,6}$/);
  });

  it("falls back to a random slug for whitespace-only input", () => {
    const out = deriveSlugFromName("    ");
    expect(out).toMatch(/^type_/);
  });

  it("produces a slug that satisfies the DB check constraint", () => {
    const re = /^[a-z][a-z0-9_]*$/;
    for (const input of [
      "Annual leave",
      "Personal/Sick",
      "Unpaid time off",
      "RDO",
      "Long-service leave",
      "Compassionate leave",
    ]) {
      const slug = deriveSlugFromName(input);
      expect(slug, `slug from "${input}"`).toMatch(re);
      expect(slug.length).toBeGreaterThanOrEqual(2);
      expect(slug.length).toBeLessThanOrEqual(40);
    }
  });
});
