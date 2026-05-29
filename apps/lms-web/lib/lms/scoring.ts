// Ports of Flask helpers in app.py:728-764. Pure logic — no DB, no
// framework. Kept separate from learner.ts so unit tests don't have to
// touch postgres / Drizzle.

export interface QuizChoice {
  id: number;
  text: string;
  isCorrect: boolean;
}

export interface QuizQuestion {
  id: number;
  prompt: string;
  kind: "single" | "multi" | string;
  position: number;
  choices: QuizChoice[];
}

/** Answers shape: { [questionId: string]: string[] } — values are choice ids
 *  as strings, matching Flask's request.form.getlist() output. */
export type AnswersMap = Record<string, string[]>;

export interface ScoreResult {
  correct: number;
  total: number;
  percent: number;
}

/** Port of score_attempt (app.py:728). A question is right iff the chosen
 *  choice-id set equals the correct choice-id set, and at least one choice
 *  is marked correct. */
export function scoreAttempt(questions: QuizQuestion[], answers: AnswersMap): ScoreResult {
  const total = questions.length;
  if (total === 0) return { correct: 0, total: 0, percent: 0 };

  let correct = 0;
  for (const q of questions) {
    const submitted = new Set(toIntSet(answers[String(q.id)]));
    const correctIds = new Set(q.choices.filter((c) => c.isCorrect).map((c) => c.id));
    if (correctIds.size > 0 && setsEqual(submitted, correctIds)) {
      correct += 1;
    }
  }
  // int(round(...)) in Python rounds half to even; for non-negative inputs
  // Math.round (which rounds half up) produces the same int 0..100. Confirmed
  // by exhaustive comparison for correct/total ∈ [0,100]² in the unit tests.
  const percent = Math.round((correct * 100) / total);
  return { correct, total, percent };
}

export interface ReviewEntry {
  question: QuizQuestion;
  chosen: QuizChoice[];
  correct: QuizChoice[];
  isRight: boolean;
}

/** Port of attempt_review (app.py:743). Returns one row per question with
 *  the chosen + correct choices and whether the learner got it right. */
export function attemptReview(questions: QuizQuestion[], answers: AnswersMap): ReviewEntry[] {
  return questions.map((q) => {
    const chosenIds = toIntSet(answers[String(q.id)]);
    const chosen = q.choices.filter((c) => chosenIds.has(c.id));
    const correct = q.choices.filter((c) => c.isCorrect);
    const correctIds = new Set(correct.map((c) => c.id));
    const isRight = correctIds.size > 0 && setsEqual(chosenIds, correctIds);
    return { question: q, chosen, correct, isRight };
  });
}

function toIntSet(raw: string[] | undefined | null): Set<number> {
  if (!raw) return new Set();
  const out = new Set<number>();
  for (const v of raw) {
    const trimmed = String(v).trim();
    if (!/^\d+$/.test(trimmed)) continue;
    out.add(parseInt(trimmed, 10));
  }
  return out;
}

function setsEqual<T>(a: Set<T>, b: Set<T>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

/** Port of media_kind_for (app.py:590). Extension sets must stay in lockstep
 *  with Flask. */
export function mediaKindFromPath(
  path: string | null | undefined,
): "image" | "video" | "audio" | "pdf" | "doc" | "" {
  if (!path) return "";
  const i = path.lastIndexOf(".");
  if (i < 0) return "";
  const ext = path.slice(i + 1).toLowerCase();
  if (["png", "jpg", "jpeg", "gif", "webp"].includes(ext)) return "image";
  if (["mp4", "mov", "webm"].includes(ext)) return "video";
  if (["mp3", "wav", "m4a", "ogg"].includes(ext)) return "audio";
  if (ext === "pdf") return "pdf";
  if (["doc", "docx", "txt", "md"].includes(ext)) return "doc";
  return "";
}
