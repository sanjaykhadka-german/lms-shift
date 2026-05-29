"use server";

import { redirect } from "next/navigation";
import {
  getAssignmentForLearner,
  getModuleForAssignment,
  requireLearner,
  submitAttempt,
} from "~/lib/lms/learner";
import { getAuthorAccess } from "~/lib/auth/author";
import { logAuditEvent } from "~/lib/audit";
import { scoreAttempt, type AnswersMap, type QuizQuestion } from "~/lib/lms/scoring";

export async function submitQuizAction(formData: FormData): Promise<void> {
  const moduleId = parseInt(String(formData.get("moduleId") ?? ""), 10);
  if (!Number.isFinite(moduleId)) throw new Error("Bad moduleId");

  const { lmsUser, traceyTenantId } = await requireLearner();
  const row = await getAssignmentForLearner(lmsUser.id, moduleId, traceyTenantId);
  if (!row) throw new Error("Assignment not found");

  const mod = await getModuleForAssignment({
    assignment: row.assignment,
    liveModule: row.module,
  });
  if (mod.questions.length === 0) {
    redirect(`/app/my/modules/${mod.id}`);
  }

  const answers = readAnswers(formData, mod.questions);

  // Author dogfood path: score, don't persist. The admin/owner/qaqc is
  // dogfooding their own quiz — persisting would pollute lmsAttempts /
  // assignments.completedAt, fire the admin email summary, and ring their
  // own bell with quiz.completed. Show the score on the admin preview
  // page via query params; nothing else reads the score URL so URL
  // tampering is harmless self-deception.
  const author = await getAuthorAccess();
  if (author) {
    const score = scoreAttempt(mod.questions, answers);
    await logAuditEvent({
      tenantId: traceyTenantId,
      actorUserId: author.traceyUserId,
      action: "quiz.author_preview",
      targetKind: "module",
      targetId: String(moduleId),
      details: {
        score: score.percent,
        correct: score.correct,
        total: score.total,
        passed: score.percent >= 80,
      },
    });
    redirect(
      `/app/admin/modules/${moduleId}/preview` +
        `?score=${score.percent}&correct=${score.correct}&total=${score.total}`,
    );
  }

  // Learner path — unchanged.
  const result = await submitAttempt({
    lmsUser,
    module: mod,
    assignment: row.assignment,
    answers,
  });
  redirect(`/app/my/results/${result.attemptId}`);
}

function readAnswers(formData: FormData, questions: QuizQuestion[]): AnswersMap {
  const answers: AnswersMap = {};
  for (const q of questions) {
    const raw = formData.getAll(`q_${q.id}`);
    const filtered: string[] = [];
    for (const v of raw) {
      if (typeof v !== "string") continue;
      const trimmed = v.trim();
      if (/^\d+$/.test(trimmed)) filtered.push(trimmed);
    }
    if (filtered.length > 0) answers[String(q.id)] = filtered;
  }
  return answers;
}
