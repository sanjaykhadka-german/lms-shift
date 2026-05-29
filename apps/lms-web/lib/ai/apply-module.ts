import "server-only";
import { and, asc, eq } from "drizzle-orm";
import {
  forTenant,
  lmsChoices,
  lmsContentItems,
  lmsModules,
  lmsQuestions,
} from "@tracey/db";
import { tenantWhere } from "~/lib/lms/tenant-scope";

type Tx = Parameters<Parameters<ReturnType<typeof forTenant>["run"]>[0]>[0];

// Ports app.py:_module_description_from + _section_kind_and_body +
// _add_question_with_choices + import_module_from_json + apply_module_json_to_existing.

const RICH_KINDS = new Set(["section", "story", "scenario", "takeaway"]);

interface AnyModule {
  title?: string;
  subtitle?: string;
  summary?: string;
  keyTakeaway?: string;
  sections?: unknown[];
  quiz?: { questions?: unknown[] };
}

function moduleDescriptionFrom(m: AnyModule): string {
  const parts: string[] = [];
  if (m.subtitle) parts.push(m.subtitle);
  if (m.summary) parts.push(m.summary);
  if (m.keyTakeaway) parts.push(`Key takeaway: ${m.keyTakeaway}`);
  return parts.join("\n\n");
}

function sectionKindAndBody(s: Record<string, unknown>): {
  kind: string;
  title: string;
  body: string;
} {
  const rawType = String(s.type ?? "section").toLowerCase();
  const kind = RICH_KINDS.has(rawType) ? rawType : "section";
  const title = String(s.heading ?? "").trim() || "Section";
  let body: string;
  if (kind === "story" || kind === "takeaway") {
    body = String(s.body ?? "");
  } else if (kind === "scenario") {
    body = JSON.stringify({
      body: String(s.body ?? ""),
      answerBody: String(s.answerBody ?? ""),
    });
  } else {
    body = JSON.stringify({
      body: String(s.body ?? ""),
      bullets: Array.isArray(s.bullets) ? s.bullets : [],
      groups: Array.isArray(s.groups) ? s.groups : [],
    });
  }
  return { kind, title, body };
}

async function addQuestionWithChoices(
  tx: Tx,
  moduleId: number,
  tenantId: string,
  qpos: number,
  q: Record<string, unknown>,
) {
  const prompt = String(q.question ?? "").trim();
  if (!prompt) return;
  const [inserted] = await tx
    .insert(lmsQuestions)
    .values({
      moduleId,
      prompt,
      kind: "single",
      position: qpos,
      traceyTenantId: tenantId,
    })
    .returning({ id: lmsQuestions.id });
  if (!inserted) return;

  const qtype = String(q.type ?? "multiple_choice").toLowerCase();
  if (qtype === "true_false") {
    const correct = q.correctAnswer;
    const pairs: Array<[string, boolean]> = [
      ["True", true],
      ["False", false],
    ];
    let cpos = 0;
    for (const [label, val] of pairs) {
      await tx.insert(lmsChoices).values({
        questionId: inserted.id,
        text: label,
        isCorrect: val === correct,
        position: cpos,
        traceyTenantId: tenantId,
      });
      cpos += 1;
    }
  } else {
    const options = Array.isArray(q.options) ? q.options : [];
    const correctIdx = typeof q.correctAnswer === "number" ? q.correctAnswer : -1;
    for (let cpos = 0; cpos < options.length; cpos++) {
      await tx.insert(lmsChoices).values({
        questionId: inserted.id,
        text: String(options[cpos]),
        isCorrect: cpos === correctIdx,
        position: cpos,
        traceyTenantId: tenantId,
      });
    }
  }
}

export class ApplyModuleError extends Error {}

export async function importModuleFromJson(opts: {
  data: unknown;
  tenantId: string;
  createdById: number;
}): Promise<number[]> {
  const payload = Array.isArray(opts.data) ? opts.data : [opts.data];
  const createdIds: number[] = [];
  await forTenant(opts.tenantId).run(async (tx) => {
    for (let i = 0; i < payload.length; i++) {
      const mod = payload[i];
      if (!mod || typeof mod !== "object") {
        throw new ApplyModuleError(`Module #${i + 1}: expected a JSON object.`);
      }
      const data = mod as AnyModule;
      const title = String(data.title ?? "").trim();
      if (!title) {
        throw new ApplyModuleError(`Module #${i + 1}: missing required 'title' field.`);
      }
      const [created] = await tx
        .insert(lmsModules)
        .values({
          title,
          description: moduleDescriptionFrom(data),
          isPublished: true,
          createdById: opts.createdById,
          traceyTenantId: opts.tenantId,
        })
        .returning({ id: lmsModules.id });
      if (!created) throw new Error("Insert module returned no id");
      createdIds.push(created.id);

      const sections = Array.isArray(data.sections) ? data.sections : [];
      for (let pos = 0; pos < sections.length; pos++) {
        const s = sections[pos];
        if (!s || typeof s !== "object") continue;
        const { kind, title: heading, body } = sectionKindAndBody(
          s as Record<string, unknown>,
        );
        await tx.insert(lmsContentItems).values({
          moduleId: created.id,
          kind,
          title: heading,
          body,
          position: pos,
          traceyTenantId: opts.tenantId,
        });
      }

      const quiz = (data.quiz ?? {}) as { questions?: unknown[] };
      const questions = Array.isArray(quiz.questions) ? quiz.questions : [];
      for (let qpos = 0; qpos < questions.length; qpos++) {
        const q = questions[qpos];
        if (q && typeof q === "object") {
          await addQuestionWithChoices(
            tx,
            created.id,
            opts.tenantId,
            qpos,
            q as Record<string, unknown>,
          );
        }
      }
    }
  });
  return createdIds;
}

export async function applyModuleJsonToExisting(opts: {
  data: unknown;
  moduleId: number;
  tenantId: string;
}): Promise<void> {
  if (!opts.data || typeof opts.data !== "object" || Array.isArray(opts.data)) {
    throw new ApplyModuleError("Expected a single module object.");
  }
  const data = opts.data as AnyModule;
  const title = String(data.title ?? "").trim();
  if (!title) throw new ApplyModuleError("Module is missing a 'title' field.");

  await forTenant(opts.tenantId).run(async (tx) => {
    // Update title + description.
    const updated = await tx
      .update(lmsModules)
      .set({ title, description: moduleDescriptionFrom(data) })
      .where(
        and(eq(lmsModules.id, opts.moduleId), tenantWhere(lmsModules, opts.tenantId)),
      )
      .returning({ id: lmsModules.id });
    if (updated.length === 0) {
      throw new ApplyModuleError("Module not found in this workspace.");
    }

    // Positional merge of sections — preserves file_path on existing rows.
    const newSections = (Array.isArray(data.sections) ? data.sections : [])
      .filter((s): s is Record<string, unknown> => !!s && typeof s === "object");
    const existing = await tx
      .select()
      .from(lmsContentItems)
      .where(
        and(
          eq(lmsContentItems.moduleId, opts.moduleId),
          tenantWhere(lmsContentItems, opts.tenantId),
        ),
      )
      .orderBy(asc(lmsContentItems.position));
    for (let i = 0; i < newSections.length; i++) {
      const { kind, title: heading, body } = sectionKindAndBody(newSections[i]!);
      if (i < existing.length) {
        await tx
          .update(lmsContentItems)
          .set({ kind, title: heading, body, position: i })
          .where(eq(lmsContentItems.id, existing[i]!.id));
      } else {
        await tx.insert(lmsContentItems).values({
          moduleId: opts.moduleId,
          kind,
          title: heading,
          body,
          position: i,
          traceyTenantId: opts.tenantId,
        });
      }
    }
    // Trailing existing sections beyond what AI returned are left alone.

    // Wipe + replace all questions (cascade-deletes choices).
    const oldQs = await tx
      .select({ id: lmsQuestions.id })
      .from(lmsQuestions)
      .where(
        and(
          eq(lmsQuestions.moduleId, opts.moduleId),
          tenantWhere(lmsQuestions, opts.tenantId),
        ),
      );
    for (const { id } of oldQs) {
      await tx.delete(lmsChoices).where(eq(lmsChoices.questionId, id));
      await tx.delete(lmsQuestions).where(eq(lmsQuestions.id, id));
    }

    const quiz = (data.quiz ?? {}) as { questions?: unknown[] };
    const questions = Array.isArray(quiz.questions) ? quiz.questions : [];
    for (let qpos = 0; qpos < questions.length; qpos++) {
      const q = questions[qpos];
      if (q && typeof q === "object") {
        await addQuestionWithChoices(
          tx,
          opts.moduleId,
          opts.tenantId,
          qpos,
          q as Record<string, unknown>,
        );
      }
    }
  });
}
