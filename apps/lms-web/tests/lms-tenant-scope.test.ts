import { describe, it, expect } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { lmsAttempts, lmsDepartments, lmsEmployers, lmsMachines } from "@tracey/db";
import { tenantWhere } from "../lib/lms/tenant-scope";

const dialect = new PgDialect();

describe("tenantWhere", () => {
  it("renders to `tracey_tenant_id = $1` and binds the supplied id", () => {
    const tid = "abc-123";
    const { sql, params } = dialect.sqlToQuery(tenantWhere(lmsDepartments, tid));
    expect(sql).toContain('"tracey_tenant_id"');
    expect(sql).toMatch(/=\s*\$1\b/);
    expect(params).toContain(tid);
  });

  it("works against every LMS table that carries the column", () => {
    const tid = "tenant-xyz";
    for (const table of [lmsDepartments, lmsEmployers, lmsMachines, lmsAttempts]) {
      const { sql, params } = dialect.sqlToQuery(tenantWhere(table, tid));
      expect(sql).toContain('"tracey_tenant_id"');
      expect(params).toContain(tid);
    }
  });

  it("isolates tenants — different ids produce different bound params", () => {
    const a = dialect.sqlToQuery(tenantWhere(lmsDepartments, "tenant-A"));
    const b = dialect.sqlToQuery(tenantWhere(lmsDepartments, "tenant-B"));
    expect(a.params).toEqual(["tenant-A"]);
    expect(b.params).toEqual(["tenant-B"]);
  });
});
