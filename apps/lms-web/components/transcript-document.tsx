// Presentational training transcript — a formal, printable record of every
// module a person has completed. Server-safe (no client hooks) so both the
// learner and admin transcript pages can render it. Caller supplies formatted
// values.
export interface TranscriptRow {
  moduleTitle: string;
  dateStr: string;
  score: number;
}

export function TranscriptDocument({
  workspace,
  recipientName,
  recipientEmail,
  generatedDate,
  rows,
}: {
  workspace: string;
  recipientName: string;
  recipientEmail?: string;
  generatedDate: string;
  rows: TranscriptRow[];
}) {
  const avg =
    rows.length === 0
      ? 0
      : Math.round(rows.reduce((s, r) => s + r.score, 0) / rows.length);

  return (
    <div className="rounded-xl border bg-white px-10 py-12 shadow-sm print:border-0 print:px-0 print:shadow-none">
      <div className="flex items-start justify-between border-b pb-6">
        <div>
          {workspace && (
            <div className="text-sm font-semibold uppercase tracking-[0.2em] text-[color:var(--muted-foreground)]">
              {workspace}
            </div>
          )}
          <h1
            className="mt-2 text-3xl tracking-tight text-[color:var(--foreground)]"
            style={{ fontFamily: "var(--font-heading), ui-serif, Georgia, serif" }}
          >
            Training Transcript
          </h1>
        </div>
        <div className="text-right text-xs text-[color:var(--muted-foreground)]">
          Generated
          <div className="font-medium text-[color:var(--foreground)]">{generatedDate}</div>
        </div>
      </div>

      <div className="mt-6 grid gap-1 text-sm">
        <div>
          <span className="text-[color:var(--muted-foreground)]">Name: </span>
          <span className="font-medium">{recipientName}</span>
        </div>
        {recipientEmail && (
          <div>
            <span className="text-[color:var(--muted-foreground)]">Email: </span>
            <span className="font-medium">{recipientEmail}</span>
          </div>
        )}
        <div>
          <span className="text-[color:var(--muted-foreground)]">Completed modules: </span>
          <span className="font-medium">{rows.length}</span>
          {rows.length > 0 && (
            <span className="text-[color:var(--muted-foreground)]"> · average score {avg}%</span>
          )}
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="mt-8 text-sm text-[color:var(--muted-foreground)]">
          No completed training on record.
        </p>
      ) : (
        <table className="mt-8 w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wider text-[color:var(--muted-foreground)]">
            <tr className="border-b">
              <th className="py-2">Module</th>
              <th className="py-2">Completed</th>
              <th className="py-2 text-right">Score</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((r, i) => (
              <tr key={i}>
                <td className="py-2 font-medium">{r.moduleTitle}</td>
                <td className="py-2 text-[color:var(--muted-foreground)]">{r.dateStr}</td>
                <td className="py-2 text-right font-semibold">{r.score}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
