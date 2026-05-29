import { describe, it, expect } from "vitest";
import {
  auditModeKeepActiveEmployee,
  auditModeKeepCompletedAssignment,
  auditModeKeepPassedAttempt,
  auditModeKeepPublishedModule,
  auditModeKeepUnexpiredWhs,
} from "../lib/lms/queries/audit-predicates";

const TODAY = new Date("2026-05-21T00:00:00Z");

describe("auditModeKeepPublishedModule", () => {
  it("keeps published modules", () => {
    expect(auditModeKeepPublishedModule({ isPublished: true })).toBe(true);
  });

  it("drops unpublished modules", () => {
    expect(auditModeKeepPublishedModule({ isPublished: false })).toBe(false);
  });

  it("treats null isPublished as drop", () => {
    expect(auditModeKeepPublishedModule({ isPublished: null })).toBe(false);
  });
});

describe("auditModeKeepCompletedAssignment", () => {
  it("keeps completed assignments", () => {
    expect(
      auditModeKeepCompletedAssignment({ completedAt: new Date() }),
    ).toBe(true);
  });

  it("drops incomplete assignments", () => {
    expect(auditModeKeepCompletedAssignment({ completedAt: null })).toBe(false);
  });
});

describe("auditModeKeepPassedAttempt", () => {
  it("keeps passing attempts", () => {
    expect(auditModeKeepPassedAttempt({ passed: true })).toBe(true);
  });

  it("drops failed attempts", () => {
    expect(auditModeKeepPassedAttempt({ passed: false })).toBe(false);
  });

  it("drops null-passed attempts (defensive)", () => {
    expect(auditModeKeepPassedAttempt({ passed: null })).toBe(false);
  });
});

describe("auditModeKeepActiveEmployee", () => {
  it("keeps active employees", () => {
    expect(
      auditModeKeepActiveEmployee({ isActiveFlag: true, terminationDate: null }),
    ).toBe(true);
  });

  it("keeps employees whose termination date is in the future", () => {
    expect(
      auditModeKeepActiveEmployee({
        isActiveFlag: true,
        terminationDate: "2099-01-01",
      }),
    ).toBe(true);
  });

  it("drops disabled employees", () => {
    expect(
      auditModeKeepActiveEmployee({
        isActiveFlag: false,
        terminationDate: null,
      }),
    ).toBe(false);
  });

  it("drops terminated employees (past termination_date)", () => {
    expect(
      auditModeKeepActiveEmployee({
        isActiveFlag: true,
        terminationDate: "2020-01-01",
      }),
    ).toBe(false);
  });
});

describe("auditModeKeepUnexpiredWhs", () => {
  it("keeps records with no expiry (incidents, open licences)", () => {
    expect(auditModeKeepUnexpiredWhs({ expiresOn: null }, TODAY)).toBe(true);
  });

  it("keeps records expiring in the future", () => {
    expect(
      auditModeKeepUnexpiredWhs({ expiresOn: "2027-01-01" }, TODAY),
    ).toBe(true);
  });

  it("keeps records expiring today (inclusive)", () => {
    expect(
      auditModeKeepUnexpiredWhs({ expiresOn: "2026-05-21" }, TODAY),
    ).toBe(true);
  });

  it("drops records expired in the past", () => {
    expect(
      auditModeKeepUnexpiredWhs({ expiresOn: "2025-12-31" }, TODAY),
    ).toBe(false);
  });
});
