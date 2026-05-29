import type { LearnerContentItem, LearnerMediaItem } from "~/lib/lms/learner";
import { mediaKindFromPath } from "~/lib/lms/scoring";

export function ContentRenderer({ items }: { items: LearnerContentItem[] }) {
  return (
    <div className="space-y-6">
      {items.map((ci) => (
        <ContentBlock key={ci.id} item={ci} />
      ))}
    </div>
  );
}

function ContentBlock({ item }: { item: LearnerContentItem }) {
  switch (item.kind) {
    case "story":
      return (
        <Section className="border-l-4 border-emerald-600 pl-4">
          <Eyebrow>Story from the floor</Eyebrow>
          <Heading>{item.title}</Heading>
          <Prose body={item.body} />
          <SectionMedia item={item} />
        </Section>
      );
    case "scenario": {
      const sc = safeJson(item.body, { body: "", answerBody: "" });
      return (
        <Section className="rounded-md border border-amber-300/50 bg-amber-50/40 p-4 dark:bg-amber-900/10">
          <Eyebrow>Quick scenario — what would you do?</Eyebrow>
          <Heading>{item.title}</Heading>
          <Prose body={sc.body} />
          {sc.answerBody && (
            <details className="mt-3 text-sm">
              <summary className="cursor-pointer font-medium">Show the right move</summary>
              <p className="mt-2 whitespace-pre-line">
                <strong>The right move:</strong> {sc.answerBody}
              </p>
            </details>
          )}
          <SectionMedia item={item} />
        </Section>
      );
    }
    case "takeaway":
      return (
        <Section className="rounded-md bg-[color:var(--secondary)] p-5">
          {item.title && <Eyebrow>{item.title}</Eyebrow>}
          <Prose body={item.body} className="text-base font-medium" />
          <SectionMedia item={item} />
        </Section>
      );
    case "section": {
      const s = safeJson<{ body?: string; bullets?: string[]; groups?: Array<{ role?: string; bullets?: string[] }> }>(
        item.body,
        {},
      );
      return (
        <Section>
          <Heading>{item.title}</Heading>
          {s.body && <Prose body={s.body} />}
          {Array.isArray(s.bullets) && s.bullets.length > 0 && (
            <ul className="mt-2 list-disc space-y-1 pl-6 text-sm">
              {s.bullets.map((b, i) => (
                <li key={i}>{b}</li>
              ))}
            </ul>
          )}
          {Array.isArray(s.groups) &&
            s.groups.map((g, i) => (
              <div key={i} className="mt-3">
                {g.role && <div className="text-sm font-semibold">{g.role}</div>}
                {Array.isArray(g.bullets) && (
                  <ul className="mt-1 list-disc space-y-1 pl-6 text-sm">
                    {g.bullets.map((b, j) => (
                      <li key={j}>{b}</li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          <SectionMedia item={item} />
        </Section>
      );
    }
    case "text":
      return (
        <Section>
          <Heading>{item.title}</Heading>
          <Prose body={item.body} />
        </Section>
      );
    case "link":
      return (
        <Section>
          <Heading>{item.title}</Heading>
          <a className="text-sm text-[color:var(--primary)] underline" href={item.body} target="_blank" rel="noreferrer">
            {item.body}
          </a>
        </Section>
      );
    case "pdf":
      return (
        <Section>
          <Heading>{item.title}</Heading>
          {item.filePath && (
            <>
              <embed
                src={`/uploads/${encodeURIComponent(item.filePath)}`}
                type="application/pdf"
                className="h-[70vh] w-full rounded-md border border-[color:var(--border)]"
              />
              <a
                className="mt-1 inline-block text-xs text-[color:var(--muted-foreground)] underline"
                href={`/uploads/${encodeURIComponent(item.filePath)}`}
                target="_blank"
                rel="noreferrer"
              >
                Open PDF
              </a>
            </>
          )}
        </Section>
      );
    case "doc":
      return (
        <Section>
          <Heading>{item.title}</Heading>
          {item.filePath && (
            <a
              href={`/uploads/${encodeURIComponent(item.filePath)}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-9 items-center rounded-md border border-[color:var(--border)] px-4 text-sm font-medium hover:bg-[color:var(--accent)]"
            >
              Open document
            </a>
          )}
        </Section>
      );
    case "audio":
      return (
        <Section>
          <Heading>{item.title}</Heading>
          {item.filePath && (
            <audio controls className="w-full">
              <source src={`/uploads/${encodeURIComponent(item.filePath)}`} />
            </audio>
          )}
        </Section>
      );
    case "video":
      return (
        <Section>
          <Heading>{item.title}</Heading>
          {item.filePath && (
            <video controls className="w-full rounded-md">
              <source src={`/uploads/${encodeURIComponent(item.filePath)}`} />
            </video>
          )}
        </Section>
      );
    case "image":
      return (
        <Section>
          <Heading>{item.title}</Heading>
          {item.filePath && (
            <img
              src={`/uploads/${encodeURIComponent(item.filePath)}`}
              alt={item.title}
              className="w-full rounded-md"
            />
          )}
        </Section>
      );
    default:
      return null;
  }
}

function SectionMedia({ item }: { item: LearnerContentItem }) {
  const items: LearnerMediaItem[] = [];
  if (item.filePath) items.push({ id: -1, kind: "", filePath: item.filePath });
  for (const m of item.mediaItems) items.push(m);
  if (items.length === 0) return null;
  return (
    <div className="mt-3 space-y-3">
      {items.map((m, i) => (
        <Media key={`${m.id}-${i}`} filePath={m.filePath} />
      ))}
    </div>
  );
}

export function Media({ filePath }: { filePath: string }) {
  const kind = mediaKindFromPath(filePath);
  const url = `/uploads/${encodeURIComponent(filePath)}`;
  if (kind === "image") return <img src={url} alt="" className="w-full rounded-md" />;
  if (kind === "video")
    return (
      <video controls className="w-full rounded-md">
        <source src={url} />
      </video>
    );
  if (kind === "audio")
    return (
      <audio controls className="w-full">
        <source src={url} />
      </audio>
    );
  if (kind === "pdf")
    return (
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="inline-flex h-9 items-center rounded-md border border-[color:var(--border)] px-4 text-sm hover:bg-[color:var(--accent)]"
      >
        Open reference PDF
      </a>
    );
  return null;
}

function Section({ children, className }: { children: React.ReactNode; className?: string }) {
  return <section className={className}>{children}</section>;
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-xs font-semibold uppercase tracking-wider text-[color:var(--muted-foreground)]">
      {children}
    </div>
  );
}

function Heading({ children }: { children: React.ReactNode }) {
  return <h2 className="mt-1 text-lg font-semibold tracking-tight">{children}</h2>;
}

function Prose({ body, className }: { body: string; className?: string }) {
  return (
    <p className={`mt-2 whitespace-pre-line text-sm ${className ?? ""}`}>{body}</p>
  );
}

function safeJson<T>(raw: string, fallback: T): T {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed as T;
  } catch {
    // ignore
  }
  return fallback;
}
