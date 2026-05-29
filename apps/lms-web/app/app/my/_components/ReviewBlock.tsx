import { Check, X } from "lucide-react";
import type { ReviewEntry } from "~/lib/lms/scoring";

export function ReviewBlock({ review }: { review: ReviewEntry[] }) {
  if (review.length === 0) return null;
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold tracking-tight">Review your answers</h3>
        <p className="text-xs text-[color:var(--muted-foreground)]">
          Green = correct. Red = the answer you chose was wrong; the correct answer is highlighted below it.
        </p>
      </div>
      {review.map((r, i) => (
        <div
          key={r.question.id}
          className={`rounded-xl border p-4 ${
            r.isRight
              ? "border-emerald-300 bg-emerald-50/40 dark:bg-emerald-900/10"
              : "border-rose-300 bg-rose-50/40 dark:bg-rose-900/10"
          }`}
        >
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-[color:var(--muted-foreground)]">
              Q{i + 1}
            </span>
            <span className="text-xs font-medium">
              {r.isRight ? "Correct" : "Incorrect"}
            </span>
          </div>
          <div className="mt-2 font-medium">{r.question.prompt}</div>

          <div className="mt-3">
            <div className="text-xs font-semibold uppercase tracking-wider text-[color:var(--muted-foreground)]">
              Your answer
            </div>
            {r.chosen.length > 0 ? (
              <ul className="mt-1 space-y-1 text-sm">
                {r.chosen.map((c) => (
                  <li
                    key={c.id}
                    className={`flex items-center gap-2 ${
                      c.isCorrect ? "text-emerald-700 dark:text-emerald-300" : "text-rose-700 dark:text-rose-300"
                    }`}
                  >
                    {c.isCorrect ? (
                      <Check className="h-4 w-4" aria-hidden />
                    ) : (
                      <X className="h-4 w-4" aria-hidden />
                    )}
                    {c.text}
                  </li>
                ))}
              </ul>
            ) : (
              <div className="mt-1 text-sm italic text-[color:var(--muted-foreground)]">
                No answer selected.
              </div>
            )}
          </div>

          {!r.isRight && r.correct.length > 0 && (
            <div className="mt-3">
              <div className="text-xs font-semibold uppercase tracking-wider text-[color:var(--muted-foreground)]">
                Correct answer
              </div>
              <ul className="mt-1 space-y-1 text-sm">
                {r.correct.map((c) => (
                  <li
                    key={c.id}
                    className="flex items-center gap-2 text-emerald-700 dark:text-emerald-300"
                  >
                    <Check className="h-4 w-4" aria-hidden />
                    {c.text}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
