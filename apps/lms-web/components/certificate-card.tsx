// Presentational completion certificate. Server-safe (no client hooks) so it
// can be rendered by both the learner certificate page and the admin
// employee-certificate page. The caller supplies already-formatted values.
export function CertificateCard({
  workspace,
  recipientName,
  moduleTitle,
  score,
  dateStr,
}: {
  workspace: string;
  recipientName: string;
  moduleTitle: string;
  score: number;
  dateStr: string;
}) {
  return (
    <div className="rounded-xl border-[6px] border-[color:var(--primary)]/70 bg-white px-10 py-14 text-center shadow-sm print:border print:shadow-none">
      {workspace && (
        <div className="text-sm font-semibold uppercase tracking-[0.2em] text-[color:var(--muted-foreground)]">
          {workspace}
        </div>
      )}
      <h1
        className="mt-6 text-4xl tracking-tight text-[color:var(--foreground)]"
        style={{ fontFamily: "var(--font-heading), ui-serif, Georgia, serif" }}
      >
        Certificate of Completion
      </h1>
      <p className="mt-10 text-sm uppercase tracking-wider text-[color:var(--muted-foreground)]">
        This certifies that
      </p>
      <p className="mt-2 text-3xl font-semibold tracking-tight text-[color:var(--foreground)]">
        {recipientName}
      </p>
      <p className="mt-8 text-sm uppercase tracking-wider text-[color:var(--muted-foreground)]">
        has successfully completed
      </p>
      <p className="mt-2 text-2xl font-medium text-[color:var(--foreground)]">
        {moduleTitle}
      </p>

      <div className="mx-auto mt-12 flex max-w-md items-center justify-between border-t pt-6 text-sm text-[color:var(--muted-foreground)]">
        <div>
          <div className="font-medium text-[color:var(--foreground)]">{dateStr}</div>
          <div className="text-xs uppercase tracking-wider">Date</div>
        </div>
        <div>
          <div className="font-medium text-[color:var(--foreground)]">{score}%</div>
          <div className="text-xs uppercase tracking-wider">Score</div>
        </div>
      </div>
    </div>
  );
}
