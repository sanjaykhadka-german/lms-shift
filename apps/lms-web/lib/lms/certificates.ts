import "server-only";
import { and, asc, eq, sql } from "drizzle-orm";
import { forTenant, lmsAttempts, lmsModules } from "@tracey/db";

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
