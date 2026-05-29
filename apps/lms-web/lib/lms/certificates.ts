import "server-only";
import { and, asc, eq, sql } from "drizzle-orm";
import { forTenant, lmsAttempts, lmsModules, lmsUsers } from "@tracey/db";

// A certificate is earned when a learner has at least one PASSING attempt for a
// module. We surface the best passing score and the date of the first pass.
export interface EarnedCertificate {
  moduleId: number;
  moduleTitle: string;
  score: number;
  passedAt: Date;
}

/** All certificates the learner has earned (one per passed module). */
export async function listEarnedCertificates(
  lmsUserId: number,
  traceyTenantId: string,
): Promise<EarnedCertificate[]> {
  return forTenant(traceyTenantId).run(async (tx) => {
    const rows = await tx
      .select({
        moduleId: lmsAttempts.moduleId,
        moduleTitle: lmsModules.title,
        score: sql<number>`max(${lmsAttempts.score})::int`,
        passedAt: sql<Date>`min(${lmsAttempts.createdAt})`,
      })
      .from(lmsAttempts)
      .innerJoin(lmsModules, eq(lmsModules.id, lmsAttempts.moduleId))
      .where(and(eq(lmsAttempts.userId, lmsUserId), eq(lmsAttempts.passed, true)))
      .groupBy(lmsAttempts.moduleId, lmsModules.title)
      .orderBy(asc(lmsModules.title));
    return rows.map((r) => ({
      moduleId: r.moduleId,
      moduleTitle: r.moduleTitle,
      score: r.score,
      passedAt: r.passedAt,
    }));
  });
}

// Admin/compliance view: one row per (employee, passed module) across the
// whole tenant.
export interface TenantCertificateRow {
  userId: number;
  employeeName: string;
  employeeEmail: string;
  moduleId: number;
  moduleTitle: string;
  score: number;
  passedAt: Date;
}

/** Every certificate earned across the tenant (for the admin report + CSV). */
export async function listAllCertificates(
  traceyTenantId: string,
): Promise<TenantCertificateRow[]> {
  return forTenant(traceyTenantId).run(async (tx) => {
    const rows = await tx
      .select({
        userId: lmsAttempts.userId,
        employeeName: lmsUsers.name,
        employeeEmail: lmsUsers.email,
        moduleId: lmsAttempts.moduleId,
        moduleTitle: lmsModules.title,
        score: sql<number>`max(${lmsAttempts.score})::int`,
        passedAt: sql<Date>`min(${lmsAttempts.createdAt})`,
      })
      .from(lmsAttempts)
      .innerJoin(lmsModules, eq(lmsModules.id, lmsAttempts.moduleId))
      .innerJoin(lmsUsers, eq(lmsUsers.id, lmsAttempts.userId))
      .where(eq(lmsAttempts.passed, true))
      .groupBy(
        lmsAttempts.userId,
        lmsUsers.name,
        lmsUsers.email,
        lmsAttempts.moduleId,
        lmsModules.title,
      )
      .orderBy(asc(lmsUsers.name), asc(lmsModules.title));
    return rows.map((r) => ({
      userId: r.userId,
      employeeName: r.employeeName,
      employeeEmail: r.employeeEmail,
      moduleId: r.moduleId,
      moduleTitle: r.moduleTitle,
      score: r.score,
      passedAt: r.passedAt,
    }));
  });
}

export interface VerifiedCertificate {
  recipientName: string;
  moduleTitle: string;
  score: number;
  passedAt: Date;
}

/** Looks up a certificate by (tenant, user, module) for the public verify
 *  route. Returns null if that learner hasn't actually passed that module. */
export async function getCertificateForVerification(ref: {
  tenantId: string;
  userId: number;
  moduleId: number;
}): Promise<VerifiedCertificate | null> {
  return forTenant(ref.tenantId).run(async (tx) => {
    const [r] = await tx
      .select({
        recipientName: lmsUsers.name,
        moduleTitle: lmsModules.title,
        score: sql<number>`max(${lmsAttempts.score})::int`,
        passedAt: sql<Date>`min(${lmsAttempts.createdAt})`,
      })
      .from(lmsAttempts)
      .innerJoin(lmsModules, eq(lmsModules.id, lmsAttempts.moduleId))
      .innerJoin(lmsUsers, eq(lmsUsers.id, lmsAttempts.userId))
      .where(
        and(
          eq(lmsAttempts.userId, ref.userId),
          eq(lmsAttempts.moduleId, ref.moduleId),
          eq(lmsAttempts.passed, true),
        ),
      )
      .groupBy(lmsUsers.name, lmsModules.title);
    if (!r) return null;
    return {
      recipientName: r.recipientName,
      moduleTitle: r.moduleTitle,
      score: r.score,
      passedAt: r.passedAt,
    };
  });
}

/** The certificate for one module, or null if the learner hasn't passed it. */
export async function getEarnedCertificate(
  moduleId: number,
  lmsUserId: number,
  traceyTenantId: string,
): Promise<EarnedCertificate | null> {
  return forTenant(traceyTenantId).run(async (tx) => {
    const [r] = await tx
      .select({
        moduleId: lmsAttempts.moduleId,
        moduleTitle: lmsModules.title,
        score: sql<number>`max(${lmsAttempts.score})::int`,
        passedAt: sql<Date>`min(${lmsAttempts.createdAt})`,
      })
      .from(lmsAttempts)
      .innerJoin(lmsModules, eq(lmsModules.id, lmsAttempts.moduleId))
      .where(
        and(
          eq(lmsAttempts.userId, lmsUserId),
          eq(lmsAttempts.moduleId, moduleId),
          eq(lmsAttempts.passed, true),
        ),
      )
      .groupBy(lmsAttempts.moduleId, lmsModules.title);
    if (!r) return null;
    return {
      moduleId: r.moduleId,
      moduleTitle: r.moduleTitle,
      score: r.score,
      passedAt: r.passedAt,
    };
  });
}
