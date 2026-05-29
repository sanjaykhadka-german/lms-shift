"use client";

import { useMemo, useState } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { updateContentItemAction } from "./content/actions";

const CONTENT_KINDS = [
  "section",
  "story",
  "scenario",
  "takeaway",
  "text",
  "link",
  "pdf",
  "doc",
  "audio",
  "video",
  "image",
] as const;

type Kind = (typeof CONTENT_KINDS)[number];

const FILE_KINDS = new Set(["pdf", "doc", "audio", "video", "image"]);

interface SectionState {
  body: string;
  bullets: string[];
  groups: unknown[]; // opaque — only edited via "advanced JSON"
  answerBody: string;
}

function parseInitial(rawBody: string, kind: string): SectionState {
  const fallback: SectionState = {
    body: rawBody,
    bullets: [],
    groups: [],
    answerBody: "",
  };
  if (kind !== "section" && kind !== "scenario") return fallback;
  const trimmed = rawBody.trim();
  if (!trimmed.startsWith("{")) return fallback;
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    return {
      body: typeof parsed.body === "string" ? parsed.body : "",
      bullets: Array.isArray(parsed.bullets)
        ? parsed.bullets.map(String)
        : [],
      groups: Array.isArray(parsed.groups) ? parsed.groups : [],
      answerBody:
        typeof parsed.answerBody === "string" ? parsed.answerBody : "",
    };
  } catch {
    // Body has stale / malformed JSON — show plain text fallback, user can fix.
    return fallback;
  }
}

export function SectionForm({
  itemId,
  moduleId,
  initialKind,
  initialTitle,
  initialBody,
  filePath,
}: {
  itemId: number;
  moduleId: number;
  initialKind: string;
  initialTitle: string;
  initialBody: string;
  filePath: string | null;
}) {
  const [kind, setKind] = useState<Kind>(
    (CONTENT_KINDS as readonly string[]).includes(initialKind)
      ? (initialKind as Kind)
      : "section",
  );
  const initialState = useMemo(
    () => parseInitial(initialBody, initialKind),
    [initialBody, initialKind],
  );
  const [body, setBody] = useState(initialState.body);
  const [bullets, setBullets] = useState<string[]>(initialState.bullets);
  const [answerBody, setAnswerBody] = useState(initialState.answerBody);
  const groups = initialState.groups; // not editable here
  const showFile = FILE_KINDS.has(kind) || Boolean(filePath);

  return (
    <form
      action={updateContentItemAction}
      className="space-y-3"
    >
      <input type="hidden" name="id" value={itemId} />
      <input type="hidden" name="module_id" value={moduleId} />

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor={`ci-${itemId}-kind`}>Kind</Label>
          <select
            id={`ci-${itemId}-kind`}
            name="kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as Kind)}
            className="flex h-9 w-full rounded-md border border-[color:var(--input)] bg-transparent px-3 text-sm shadow-sm"
          >
            {CONTENT_KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2 space-y-1">
          <Label htmlFor={`ci-${itemId}-title`}>Title</Label>
          <Input
            id={`ci-${itemId}-title`}
            name="title"
            defaultValue={initialTitle}
            required
          />
        </div>
      </div>

      {/* Body field set varies by kind. */}
      <div className="space-y-1">
        <Label htmlFor={`ci-${itemId}-body`}>Body</Label>
        <textarea
          id={`ci-${itemId}-body`}
          name="body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={7}
          className="w-full rounded-md border border-[color:var(--input)] bg-transparent px-3 py-2 text-sm shadow-sm"
        />
      </div>

      {kind === "section" && (
        <div className="space-y-2">
          <Label>Bullets</Label>
          {bullets.length === 0 ? (
            <p className="text-xs text-[color:var(--muted-foreground)]">
              No bullets. Click <em>Add bullet</em> to start a list.
            </p>
          ) : (
            <ul className="space-y-1">
              {bullets.map((b, i) => (
                <li key={i} className="flex gap-2">
                  <Input
                    name="bullet"
                    value={b}
                    onChange={(e) =>
                      setBullets((prev) =>
                        prev.map((x, j) => (j === i ? e.target.value : x)),
                      )
                    }
                    placeholder={`Bullet ${i + 1}`}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    tooltip="Remove this bullet point"
                    onClick={() =>
                      setBullets((prev) => prev.filter((_, j) => j !== i))
                    }
                  >
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            tooltip="Add another bullet point"
            onClick={() => setBullets((prev) => [...prev, ""])}
          >
            + Add bullet
          </Button>
          {/* Round-trip the (currently un-editable) groups field. */}
          <input
            type="hidden"
            name="groups_json"
            value={JSON.stringify(groups)}
          />
          {Array.isArray(groups) && groups.length > 0 && (
            <p className="text-xs text-[color:var(--muted-foreground)]">
              {groups.length} role-specific group
              {groups.length === 1 ? "" : "s"} preserved (edit advanced JSON via
              the AI Studio if needed).
            </p>
          )}
        </div>
      )}

      {kind === "scenario" && (
        <div className="space-y-1">
          <Label htmlFor={`ci-${itemId}-answer`}>
            Answer body (revealed during training)
          </Label>
          <textarea
            id={`ci-${itemId}-answer`}
            name="answer_body"
            value={answerBody}
            onChange={(e) => setAnswerBody(e.target.value)}
            rows={5}
            className="w-full rounded-md border border-[color:var(--input)] bg-transparent px-3 py-2 text-sm shadow-sm"
          />
        </div>
      )}

      {showFile && (
        <div className="space-y-1">
          <Label>File</Label>
          {filePath && (
            <div className="text-xs text-[color:var(--muted-foreground)]">
              Current:{" "}
              <a
                className="underline"
                href={`/uploads/${encodeURIComponent(filePath)}`}
                target="_blank"
                rel="noreferrer"
              >
                {filePath}
              </a>
            </div>
          )}
          <input type="file" name="file" />
          {filePath && (
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" name="clear_file" value="1" />
              Remove the current file on save
            </label>
          )}
        </div>
      )}

      <Button type="submit" size="sm">
        Save section
      </Button>
    </form>
  );
}
