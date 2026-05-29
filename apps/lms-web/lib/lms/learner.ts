import "server-only";
import crypto from "node:crypto";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import {
  db,
  forTenant,
  lmsAssignments,
  lmsAttempts,
  lmsChoices,
  lmsContentItems,
  lmsContentItemMedia,
  lmsModuleMedia,
  lmsModules,
  lmsModuleVersions,
  lmsQuestions,
  lmsUploadedFiles,
  lmsUsers,
  lmsWhsRecords,
  members,
  type AuditModeSettings,
  type LmsAssignment,
  type LmsModule,
  type LmsUser,
  type TenantDb,
} from "@tracey/db";
import { requireTenant, requireUser } from "~/lib/auth/current";
import {
  attemptReview,
  scoreAttempt,
  type AnswersMap,
  type QuizQuestion,
  type ReviewEntry,
  type ScoreResult,
} from "./scoring";
import { PASS_THRESHOLD } from "~/lib/site-config";
import { notifyAttempt } from "./notify";
import { createNotifications } from "./notifications";
import { isEffectivelyActive } from "./employee-status";

// ─── Types ────────────────────────────────────────────────────────────────

export interface LearnerMediaItem {
  id: number;
  kind: string;
  filePath: string;
}

export interface LearnerContentItem {
  id: number;
  kind: string;
  title: string;
  body: string;
  filePath: string;
  position: number;
  mediaItems: LearnerMediaItem[];
}

export interface LearnerModule {
  id: number;
  title: string;
  description: string;
  isPublished: boolean;
  coverPath: string;
  mediaItems: LearnerMediaItem[];
  contentItems: LearnerContentItem[];
  questions: QuizQuestion[];
}

export interface LearnerContext {
  traceyUserId: string;
  traceyTenantId: string;
  tenantTimezone: string;
  /** Workspace-level "Audit Mode" master switch. When false, sub-toggles in
   *  `tenantAuditSettings` have no effect. When true, each `hideX` sub-toggle
   *  decides whether its slice (incomplete assignments, failed attempts,
   *  unpublished modules, expired certs, inactive employees in compliance
   *  denominators, audit-only admin pages) is filtered on admin/manager
   *  surfaces. Read on every admin request — flips take effect on the next
   *  page render. */
  tenantAuditMode: boolean;
  /** Per-feature toggles. Only consulted when `tenantAuditMode === true`.
   *  Defaults to all-on so flipping the master ON preserves the pre-granular
   *  behaviour exactly. */
  tenantAuditSettings: AuditModeSettings;
  lmsUser: LmsUser;
  /** Tenant-scoped transaction runner. Use `ctx.db.run(tx => ...)` for any
   *  query that touches a `tracey_tenant_id`-bearing table — it injects
   *  `set_config('app.tenant_id', tid, true)` so Postgres RLS policies can
   *  enforce isolation as a backstop to the explicit tenantWhere() filter. */
  db: TenantDb;
}

// ─── Provisioning ─────────────────────────────────────────────────────────

/** Mirrors Flask /sso/callback's auto-provision path (app.py:1362-1390).
 *  Resolution order: tracey_user_id → email → INSERT. Race-safe via
 *  ON CONFLICT DO NOTHING + refetch by email. */
export async function getOrProvisionLmsUser(opts: {
  traceyUserId: string;
  traceyTenantId: string;
  email: string;
  name: string | null;
}): Promise<LmsUser> {
  const email = opts.email.toLowerCase().trim();
  const name = (opts.name ?? email).trim();

  // public.users is RLS-excluded today (0004_enable_rls.sql:105-115) so this
  // wrap is defensive polish, not strictly required: it puts every legacy
  // LMS query through the same forTenant() chokepoint, removing breakage
  // risk if/when users joins RLS coverage in a future Phase 5.x cleanup.
  // The whole bySub/byEmail/INSERT/refetch dance runs in ONE transaction so
  // the GUC is set once. Race-safety still holds: under READ COMMITTED, a
  // concurrent insert that wins the email-uniqueness race becomes visible
  // to our refetch the moment it commits.
  return forTenant(opts.traceyTenantId).run(async (tx) => {
    const bySub = await tx
      .select()
      .from(lmsUsers)
      .where(eq(lmsUsers.traceyUserId, opts.traceyUserId))
      .limit(1);
    if (bySub[0]) return bySub[0];

    // Existing legacy row (admin imported the user before SSO ever ran).
    // Link tracey_user_id and return.
    const byEmail = await tx
      .select()
      .from(lmsUsers)
      .where(eq(lmsUsers.email, email))
      .limit(1);
    if (byEmail[0]) {
      const linked = await tx
        .update(lmsUsers)
        .set({ traceyUserId: opts.traceyUserId, traceyTenantId: opts.traceyTenantId })
        .where(eq(lmsUsers.id, byEmail[0].id))
        .returning();
      return linked[0] ?? byEmail[0];
    }

    // First-time learner. The bcrypt hash is intentionally unreachable —
    // password login is for legacy Flask-imported admins; SSO learners use
    // Tracey only.
    const [first, ...rest] = name.split(/\s+/);
    const last = rest.join(" ");
    const passwordHash = await bcrypt.hash(crypto.randomBytes(24).toString("base64url"), 12);

    const inserted = await tx
      .insert(lmsUsers)
      .values({
        email,
        name,
        firstName: first ?? "",
        lastName: last ?? "",
        passwordHash,
        role: "employee",
        isActiveFlag: true,
        traceyUserId: opts.traceyUserId,
        traceyTenantId: opts.traceyTenantId,
      })
      .onConflictDoNothing({ target: lmsUsers.email })
      .returning();
    if (inserted[0]) return inserted[0];

    // Lost the race against another concurrent provision — refetch.
    const refetch = await tx
      .select()
      .from(lmsUsers)
      .where(eq(lmsUsers.email, email))
      .limit(1);
    if (!refetch[0]) {
      throw new Error("Failed to provision LMS user (race lost and refetch empty).");
    }
    return refetch[0];
  });
}

/** One-stop helper for learner pages: requires Tracey auth + active tenant,
 *  ensures a Flask `users` row exists, returns the trio. Redirects to
 *  /sign-in / /onboarding via the underlying helpers if preconditions fail. */
export async function requireLearner(): Promise<LearnerContext> {
  const user = await requireUser();
  const { tenant } = await requireTenant();
  const lmsUser = await getOrProvisionLmsUser({
    traceyUserId: user.id,
    traceyTenantId: tenant.id,
    email: user.email,
    name: user.name,
  });
  if (!isEffectivelyActive(lmsUser)) {
    // Match Flask: a deactivated learner can't proceed.
    // Also catches employees whose termination_date has passed.
    redirect("/sign-in?reason=deactivated");
  }
  return {
    traceyUserId: user.id,
    traceyTenantId: tenant.id,
    tenantTimezone: tenant.timezone,
    tenantAuditMode: tenant.auditMode,
    tenantAuditSettings: tenant.auditModeSettings,
    lmsUser,
    db: forTenant(tenant.id),
  };
}

// ─── Reads ────────────────────────────────────────────────────────────────

export interface AssignmentRow {
  assignment: LmsAssignment;
  module: LmsModule;
  attempts: number;
  bestScore: number | null;
  lastAttemptAt: Date | null;
}

export async function listAssignmentsForUser(
  lmsUserId: number,
  traceyTenantId: string,
): Promise<AssignmentRow[]> {
  return forTenant(traceyTenantId).run(async (tx) => {
    const rows = await tx
      .select({ assignment: lmsAssignments, module: lmsModules })
      .from(lmsAssignments)
      .innerJoin(lmsModules, eq(lmsModules.id, lmsAssignments.moduleId))
      .where(eq(lmsAssignments.userId, lmsUserId))
      .orderBy(desc(lmsAssignments.assignedAt));

    if (rows.length === 0) return [];

    const moduleIds = rows.map((r) => r.module.id);
    const aggs = await tx
      .select({
        moduleId: lmsAttempts.moduleId,
        attempts: sql<number>`count(*)::int`,
        bestScore: sql<number | null>`max(${lmsAttempts.score})`,
        lastAt: sql<Date | null>`max(${lmsAttempts.createdAt})`,
      })
      .from(lmsAttempts)
      .where(and(eq(lmsAttempts.userId, lmsUserId), inArray(lmsAttempts.moduleId, moduleIds)))
      .groupBy(lmsAttempts.moduleId);

    const aggByModule = new Map(aggs.map((a) => [a.moduleId, a]));

    return rows.map((r) => {
      const a = aggByModule.get(r.module.id);
      return {
        assignment: r.assignment,
        module: r.module,
        attempts: a?.attempts ?? 0,
        bestScore: a?.bestScore ?? null,
        lastAttemptAt: a?.lastAt ?? null,
      };
    });
  });
}

export async function getAttemptAggregates(
  lmsUserId: number,
  traceyTenantId: string,
): Promise<{ total: number; avgScore: number; passRate: number }> {
  const rows = await forTenant(traceyTenantId).run((tx) =>
    tx
      .select({
        total: sql<number>`count(*)::int`,
        avg: sql<number>`coalesce(avg(${lmsAttempts.score}), 0)::float`,
        passed: sql<number>`count(*) filter (where ${lmsAttempts.passed} = true)::int`,
      })
      .from(lmsAttempts)
      .where(eq(lmsAttempts.userId, lmsUserId)),
  );
  const total = rows[0]?.total ?? 0;
  if (total === 0) return { total: 0, avgScore: 0, passRate: 0 };
  return {
    total,
    avgScore: Math.round((rows[0]?.avg ?? 0) * 10) / 10,
    passRate: Math.round(((rows[0]?.passed ?? 0) * 1000) / total) / 10,
  };
}

export async function listRecentAttempts(
  lmsUserId: number,
  traceyTenantId: string,
  limit = 5,
): Promise<Array<{ id: number; moduleId: number; moduleTitle: string | null; score: number; passed: boolean; createdAt: Date }>> {
  const rows = await forTenant(traceyTenantId).run((tx) =>
    tx
      .select({
        id: lmsAttempts.id,
        moduleId: lmsAttempts.moduleId,
        moduleTitle: lmsModules.title,
        score: lmsAttempts.score,
        passed: lmsAttempts.passed,
        createdAt: lmsAttempts.createdAt,
      })
      .from(lmsAttempts)
      .leftJoin(lmsModules, eq(lmsModules.id, lmsAttempts.moduleId))
      .where(eq(lmsAttempts.userId, lmsUserId))
      .orderBy(desc(lmsAttempts.createdAt))
      .limit(limit),
  );
  return rows.map((r) => ({
    id: r.id,
    moduleId: r.moduleId,
    moduleTitle: r.moduleTitle ?? null,
    score: r.score ?? 0,
    passed: r.passed ?? false,
    createdAt: r.createdAt ?? new Date(0),
  }));
}

export async function getAssignmentForLearner(
  lmsUserId: number,
  moduleId: number,
  traceyTenantId: string,
): Promise<{ assignment: LmsAssignment; module: LmsModule } | null> {
  const rows = await forTenant(traceyTenantId).run((tx) =>
    tx
      .select({ assignment: lmsAssignments, module: lmsModules })
      .from(lmsAssignments)
      .innerJoin(lmsModules, eq(lmsModules.id, lmsAssignments.moduleId))
      .where(and(eq(lmsAssignments.userId, lmsUserId), eq(lmsAssignments.moduleId, moduleId)))
      .limit(1),
  );
  return rows[0] ?? null;
}

/** Port of module_for_assignment (app.py:716): returns the pinned snapshot
 *  if the assignment has a version_id, otherwise the live module. Falls
 *  back to live on JSON parse error (matches Flask try/except). Tenant
 *  context is read from the assignment row that the caller already loaded. */
export async function getModuleForAssignment(opts: {
  assignment: LmsAssignment;
  liveModule: LmsModule;
}): Promise<LearnerModule> {
  const tid = opts.assignment.traceyTenantId;
  return forTenant(tid).run(async (tx) => {
    if (opts.assignment.versionId !== null && opts.assignment.versionId !== undefined) {
      const snap = await tx
        .select()
        .from(lmsModuleVersions)
        .where(eq(lmsModuleVersions.id, opts.assignment.versionId))
        .limit(1);
      if (snap[0]) {
        const hydrated = tryHydrateSnapshot(snap[0].snapshotJson, opts.liveModule);
        if (hydrated) return hydrated;
      }
    }
    return loadLiveModuleTx(tx, opts.liveModule);
  });
}

// Internal: takes a tx so callers control the tenant transaction. The
// public-facing `loadLiveModule(m)` (kept below as a thin wrapper for any
// out-of-tree caller) opens its own transaction from m.traceyTenantId.
async function loadLiveModuleTx(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  m: LmsModule,
): Promise<LearnerModule> {
  const [contentItems, mediaItems, questions] = await Promise.all([
    tx
      .select()
      .from(lmsContentItems)
      .where(eq(lmsContentItems.moduleId, m.id))
      .orderBy(lmsContentItems.position),
    tx
      .select()
      .from(lmsModuleMedia)
      .where(eq(lmsModuleMedia.moduleId, m.id))
      .orderBy(lmsModuleMedia.position),
    tx
      .select()
      .from(lmsQuestions)
      .where(eq(lmsQuestions.moduleId, m.id))
      .orderBy(lmsQuestions.position),
  ]);

  const ciIds = contentItems.map((c) => c.id);
  const ciMedia = ciIds.length
    ? await tx
        .select()
        .from(lmsContentItemMedia)
        .where(inArray(lmsContentItemMedia.contentItemId, ciIds))
        .orderBy(lmsContentItemMedia.position)
    : [];
  const ciMediaByItem = new Map<number, LearnerMediaItem[]>();
  for (const x of ciMedia) {
    const arr = ciMediaByItem.get(x.contentItemId) ?? [];
    arr.push({ id: x.id, kind: x.kind ?? "", filePath: x.filePath });
    ciMediaByItem.set(x.contentItemId, arr);
  }

  const qIds = questions.map((q) => q.id);
  const choices = qIds.length
    ? await tx
        .select()
        .from(lmsChoices)
        .where(inArray(lmsChoices.questionId, qIds))
        .orderBy(lmsChoices.position)
    : [];
  const choicesByQ = new Map<number, QuizQuestion["choices"]>();
  for (const c of choices) {
    const arr = choicesByQ.get(c.questionId) ?? [];
    arr.push({ id: c.id, text: c.text, isCorrect: c.isCorrect ?? false });
    choicesByQ.set(c.questionId, arr);
  }

  return {
    id: m.id,
    title: m.title,
    description: m.description ?? "",
    isPublished: m.isPublished ?? true,
    coverPath: m.coverPath ?? "",
    mediaItems: mediaItems.map((x) => ({
      id: x.id,
      kind: x.kind ?? "",
      filePath: x.filePath,
    })),
    contentItems: contentItems.map((ci) => ({
      id: ci.id,
      kind: ci.kind,
      title: ci.title,
      body: ci.body ?? "",
      filePath: ci.filePath ?? "",
      position: ci.position ?? 0,
      mediaItems: ciMediaByItem.get(ci.id) ?? [],
    })),
    questions: questions.map((q) => ({
      id: q.id,
      prompt: q.prompt,
      kind: q.kind ?? "single",
      position: q.position ?? 0,
      choices: choicesByQ.get(q.id) ?? [],
    })),
  };
}

function tryHydrateSnapshot(json: string, liveModule: LmsModule): LearnerModule | null {
  let snap: Record<string, unknown>;
  try {
    snap = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof snap !== "object" || snap === null) return null;

  const rawCi = Array.isArray(snap.content_items) ? snap.content_items : [];
  const rawQs = Array.isArray(snap.questions) ? snap.questions : [];
  const rawMedia = Array.isArray(snap.media_items) ? snap.media_items : [];

  return {
    // Always fall back to live id so /my/modules/<id>/quiz keeps resolving
    // (matches hydrate_module_view app.py:706).
    id: liveModule.id,
    title: typeof snap.title === "string" ? snap.title : liveModule.title,
    description:
      typeof snap.description === "string"
        ? snap.description
        : liveModule.description ?? "",
    isPublished:
      typeof snap.is_published === "boolean" ? snap.is_published : liveModule.isPublished ?? true,
    coverPath:
      typeof snap.cover_path === "string" ? snap.cover_path : liveModule.coverPath ?? "",
    mediaItems: rawMedia.map(toMedia).filter(Boolean) as LearnerMediaItem[],
    contentItems: rawCi.map(toContentItem).filter(Boolean) as LearnerContentItem[],
    questions: rawQs.map(toQuestion).filter(Boolean) as QuizQuestion[],
  };
}

function toMedia(x: unknown): LearnerMediaItem | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  if (typeof o.file_path !== "string") return null;
  return {
    id: typeof o.id === "number" ? o.id : 0,
    kind: typeof o.kind === "string" ? o.kind : "",
    filePath: o.file_path,
  };
}

function toContentItem(x: unknown): LearnerContentItem | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  return {
    id: typeof o.id === "number" ? o.id : 0,
    kind: typeof o.kind === "string" ? o.kind : "text",
    title: typeof o.title === "string" ? o.title : "",
    body: typeof o.body === "string" ? o.body : "",
    filePath: typeof o.file_path === "string" ? o.file_path : "",
    position: typeof o.position === "number" ? o.position : 0,
    mediaItems: Array.isArray(o.media_items)
      ? (o.media_items.map(toMedia).filter(Boolean) as LearnerMediaItem[])
      : [],
  };
}

function toQuestion(x: unknown): QuizQuestion | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  if (typeof o.id !== "number" || typeof o.prompt !== "string") return null;
  const choices = Array.isArray(o.choices)
    ? o.choices.map(toChoice).filter(Boolean)
    : [];
  return {
    id: o.id,
    prompt: o.prompt,
    kind: typeof o.kind === "string" ? o.kind : "single",
    position: typeof o.position === "number" ? o.position : 0,
    choices: choices as QuizQuestion["choices"],
  };
}

function toChoice(x: unknown): { id: number; text: string; isCorrect: boolean } | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  if (typeof o.id !== "number" || typeof o.text !== "string") return null;
  return {
    id: o.id,
    text: o.text,
    isCorrect: o.is_correct === true,
  };
}

// ─── Writes ───────────────────────────────────────────────────────────────

export interface SubmitResult {
  attemptId: number;
  score: ScoreResult;
  passed: boolean;
}

/** Submits a quiz attempt: scores, inserts attempt row, conditionally sets
 *  assignment.completed_at — all in one transaction (matches Flask's
 *  app.py:3845-3863 single-commit pattern). */
export async function submitAttempt(opts: {
  lmsUser: LmsUser;
  module: LearnerModule;
  assignment: LmsAssignment;
  answers: AnswersMap;
}): Promise<SubmitResult> {
  const score = scoreAttempt(opts.module.questions, opts.answers);
  const passed = score.percent >= PASS_THRESHOLD;

  // Tenant comes from the assignment row, which was loaded under
  // requireLearner() and is therefore the user's own tenant. Stamp the
  // attempt with the same tenant so cross-tenant queries stay honest.
  const tid = opts.assignment.traceyTenantId;

  const attemptId = await forTenant(tid).run(async (tx) => {
    const inserted = await tx
      .insert(lmsAttempts)
      .values({
        userId: opts.lmsUser.id,
        moduleId: opts.module.id,
        score: score.percent,
        correct: score.correct,
        total: score.total,
        passed,
        answersJson: JSON.stringify(opts.answers),
        traceyTenantId: tid,
      })
      .returning({ id: lmsAttempts.id });
    const id = inserted[0]?.id;
    if (id === undefined) throw new Error("Insert attempt returned no id");

    if (passed && opts.assignment.completedAt === null) {
      await tx
        .update(lmsAssignments)
        .set({ completedAt: new Date() })
        .where(eq(lmsAssignments.id, opts.assignment.id));
    }
    return id;
  });

  // Fire-and-forget — don't block the redirect on email I/O.
  void notifyAttempt({
    tenantId: tid,
    learnerEmail: opts.lmsUser.email,
    learnerName: opts.lmsUser.name,
    moduleTitle: opts.module.title,
    score: score.percent,
    passed,
  });

  // Mirror the email summary as in-app notifs to tenant admins/owners.
  void (async () => {
    const tdb = forTenant(tid);
    const adminMembers = await tdb.run((tx) =>
      tx
        .select({ userId: members.userId })
        .from(members)
        .where(
          and(
            eq(members.tenantId, tid),
            or(eq(members.role, "owner"), eq(members.role, "admin")),
          ),
        ),
    );
    if (adminMembers.length === 0) return;
    const verdict = passed ? "passed" : "did not pass";
    await createNotifications(
      tdb,
      adminMembers.map((m) => ({
        recipientUserId: m.userId,
        kind: "quiz.completed",
        title: `${opts.lmsUser.name} ${verdict} ${opts.module.title}`,
        body: `Score: ${score.percent}%`,
        actionUrl: `/app/admin/modules/${opts.module.id}`,
      })),
    );
  })();

  return { attemptId, score, passed };
}

// ─── Result page helpers ──────────────────────────────────────────────────

export async function getAttemptForLearner(
  attemptId: number,
  lmsUserId: number,
  traceyTenantId: string,
): Promise<{
  attempt: typeof lmsAttempts.$inferSelect;
  module: LearnerModule;
  review: ReviewEntry[];
} | null> {
  const result = await forTenant(traceyTenantId).run(async (tx) => {
    const rows = await tx
      .select()
      .from(lmsAttempts)
      .where(eq(lmsAttempts.id, attemptId))
      .limit(1);
    const attempt = rows[0];
    if (!attempt) return null;
    if (attempt.userId !== lmsUserId) return null; // 403 → 404

    const moduleRow = await tx
      .select()
      .from(lmsModules)
      .where(eq(lmsModules.id, attempt.moduleId))
      .limit(1);
    if (!moduleRow[0]) return null;

    const liveModule = await loadLiveModuleTx(tx, moduleRow[0]);
    return { attempt, module: liveModule };
  });
  if (!result) return null;

  let answers: AnswersMap = {};
  try {
    const parsed = JSON.parse(result.attempt.answersJson ?? "{}");
    if (parsed && typeof parsed === "object") answers = parsed as AnswersMap;
  } catch {
    // empty
  }
  return {
    attempt: result.attempt,
    module: result.module,
    review: attemptReview(result.module.questions, answers),
  };
}

// ─── Uploads helpers ──────────────────────────────────────────────────────

/** Returns the upload row only if the filename is referenced by a module
 *  the learner is currently assigned to. Closes the obscurity-only hole
 *  in Flask's @login_required-only `/uploads/<name>`. */
export async function getUploadForLearner(
  filename: string,
  lmsUserId: number,
  traceyTenantId: string,
): Promise<typeof lmsUploadedFiles.$inferSelect | null> {
  return forTenant(traceyTenantId).run(async (tx) => {
    const assignedModuleIds = (
      await tx
        .select({ moduleId: lmsAssignments.moduleId })
        .from(lmsAssignments)
        .where(eq(lmsAssignments.userId, lmsUserId))
    ).map((r) => r.moduleId);
    if (assignedModuleIds.length === 0) return null;

    const referenced = await isFileReferencedByModulesTx(tx, filename, assignedModuleIds);
    if (!referenced) return null;

    const file = await tx
      .select()
      .from(lmsUploadedFiles)
      .where(eq(lmsUploadedFiles.filename, filename))
      .limit(1);
    return file[0] ?? null;
  });
}

/** Admin viewer: any file referenced by any module OR by any user
 *  (photo_filename) in the tenant. Photos in particular need this — they
 *  aren't referenced by any module. */
export async function getUploadForAdmin(
  filename: string,
  traceyTenantId: string,
): Promise<typeof lmsUploadedFiles.$inferSelect | null> {
  return forTenant(traceyTenantId).run(async (tx) => {
    // user.photo_filename for any user in the tenant?
    const photoHit = await tx
      .select({ id: lmsUsers.id })
      .from(lmsUsers)
      .where(
        and(
          eq(lmsUsers.photoFilename, filename),
          eq(lmsUsers.traceyTenantId, traceyTenantId),
        ),
      )
      .limit(1);
    if (!photoHit[0]) {
      // whs_records.document_filename — WHS docs aren't module-referenced.
      const whsHit = await tx
        .select({ id: lmsWhsRecords.id })
        .from(lmsWhsRecords)
        .where(
          and(
            eq(lmsWhsRecords.documentFilename, filename),
            eq(lmsWhsRecords.traceyTenantId, traceyTenantId),
          ),
        )
        .limit(1);
      if (!whsHit[0]) {
        // Fall back to checking module-referenced files for any module the
        // tenant has staff assigned to. Cheap to do via assignments → users.
        const moduleIds = (
          await tx
            .selectDistinct({ moduleId: lmsAssignments.moduleId })
            .from(lmsAssignments)
            .innerJoin(lmsUsers, eq(lmsUsers.id, lmsAssignments.userId))
            .where(eq(lmsUsers.traceyTenantId, traceyTenantId))
        ).map((r) => r.moduleId);
        if (moduleIds.length === 0) return null;
        const referenced = await isFileReferencedByModulesTx(tx, filename, moduleIds);
        if (!referenced) return null;
      }
    }
    const file = await tx
      .select()
      .from(lmsUploadedFiles)
      .where(eq(lmsUploadedFiles.filename, filename))
      .limit(1);
    return file[0] ?? null;
  });
}

async function isFileReferencedByModulesTx(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  filename: string,
  moduleIds: number[],
): Promise<boolean> {
  // Check Module.cover_path
  const cover = await tx
    .select({ id: lmsModules.id })
    .from(lmsModules)
    .where(and(eq(lmsModules.coverPath, filename), inArray(lmsModules.id, moduleIds)))
    .limit(1);
  if (cover[0]) return true;

  // Check ModuleMedia.file_path
  const modMedia = await tx
    .select({ id: lmsModuleMedia.id })
    .from(lmsModuleMedia)
    .where(
      and(eq(lmsModuleMedia.filePath, filename), inArray(lmsModuleMedia.moduleId, moduleIds)),
    )
    .limit(1);
  if (modMedia[0]) return true;

  // Check ContentItem.file_path (legacy single slot)
  const ci = await tx
    .select({ id: lmsContentItems.id })
    .from(lmsContentItems)
    .where(
      and(
        eq(lmsContentItems.filePath, filename),
        inArray(lmsContentItems.moduleId, moduleIds),
      ),
    )
    .limit(1);
  if (ci[0]) return true;

  // Check ContentItemMedia.file_path (one extra join through content_items)
  const ciMedia = await tx
    .select({ id: lmsContentItemMedia.id })
    .from(lmsContentItemMedia)
    .innerJoin(
      lmsContentItems,
      eq(lmsContentItems.id, lmsContentItemMedia.contentItemId),
    )
    .where(
      and(
        eq(lmsContentItemMedia.filePath, filename),
        inArray(lmsContentItems.moduleId, moduleIds),
      ),
    )
    .limit(1);
  return Boolean(ciMedia[0]);
}
