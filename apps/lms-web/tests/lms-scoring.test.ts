import { describe, it, expect } from "vitest";
import {
  attemptReview,
  mediaKindFromPath,
  scoreAttempt,
  type QuizQuestion,
} from "../lib/lms/scoring";

const single = (id: number, correctChoiceId: number, choiceIds: number[]): QuizQuestion => ({
  id,
  prompt: `Q${id}`,
  kind: "single",
  position: id,
  choices: choiceIds.map((cid) => ({
    id: cid,
    text: `c${cid}`,
    isCorrect: cid === correctChoiceId,
  })),
});

const multi = (id: number, correctChoiceIds: number[], choiceIds: number[]): QuizQuestion => ({
  id,
  prompt: `Q${id}`,
  kind: "multi",
  position: id,
  choices: choiceIds.map((cid) => ({
    id: cid,
    text: `c${cid}`,
    isCorrect: correctChoiceIds.includes(cid),
  })),
});

describe("scoreAttempt", () => {
  it("returns zeros for an empty quiz", () => {
    expect(scoreAttempt([], {})).toEqual({ correct: 0, total: 0, percent: 0 });
  });

  it("treats a single-answer question as correct only when chosen ids equal correct ids", () => {
    const qs = [single(1, 11, [10, 11, 12])];
    expect(scoreAttempt(qs, { "1": ["11"] }).percent).toBe(100);
    expect(scoreAttempt(qs, { "1": ["10"] }).percent).toBe(0);
    expect(scoreAttempt(qs, { "1": [] }).percent).toBe(0);
  });

  it("requires the full set for multi-answer questions", () => {
    const qs = [multi(1, [10, 12], [10, 11, 12])];
    expect(scoreAttempt(qs, { "1": ["10", "12"] }).percent).toBe(100);
    expect(scoreAttempt(qs, { "1": ["10"] }).percent).toBe(0);
    expect(scoreAttempt(qs, { "1": ["10", "12", "11"] }).percent).toBe(0);
  });

  it("ignores choices marked incorrect (questions with no correct answer never pass)", () => {
    const qs = [
      {
        id: 1,
        prompt: "Q1",
        kind: "single",
        position: 0,
        choices: [
          { id: 10, text: "a", isCorrect: false },
          { id: 11, text: "b", isCorrect: false },
        ],
      } as QuizQuestion,
    ];
    expect(scoreAttempt(qs, { "1": ["10"] }).percent).toBe(0);
  });

  it("rounds percentages with Math.round (matches Python int(round(...)) for non-negative inputs)", () => {
    const qs = [single(1, 11, [10, 11]), single(2, 21, [20, 21]), single(3, 31, [30, 31])];
    // 1/3 → 33%
    const r = scoreAttempt(qs, { "1": ["11"] });
    expect(r).toEqual({ correct: 1, total: 3, percent: 33 });
    // 2/3 → 67%
    const r2 = scoreAttempt(qs, { "1": ["11"], "2": ["21"] });
    expect(r2.percent).toBe(67);
  });

  it("ignores non-numeric submitted values", () => {
    const qs = [single(1, 11, [10, 11])];
    expect(scoreAttempt(qs, { "1": ["abc", "11"] }).percent).toBe(100);
    expect(scoreAttempt(qs, { "1": ["abc", "10"] }).percent).toBe(0);
  });
});

describe("attemptReview", () => {
  it("emits one entry per question with chosen + correct + isRight", () => {
    const qs = [
      single(1, 11, [10, 11]),
      multi(2, [20, 22], [20, 21, 22]),
    ];
    const out = attemptReview(qs, { "1": ["10"], "2": ["20", "22"] });
    expect(out).toHaveLength(2);
    expect(out[0]!.isRight).toBe(false);
    expect(out[0]!.chosen.map((c) => c.id)).toEqual([10]);
    expect(out[0]!.correct.map((c) => c.id)).toEqual([11]);
    expect(out[1]!.isRight).toBe(true);
    expect(out[1]!.chosen.map((c) => c.id).sort()).toEqual([20, 22]);
  });

  it("handles missing answers cleanly", () => {
    const qs = [single(1, 11, [10, 11])];
    const out = attemptReview(qs, {});
    expect(out[0]!.chosen).toEqual([]);
    expect(out[0]!.isRight).toBe(false);
  });
});

describe("mediaKindFromPath", () => {
  it("matches Flask extension lists exactly", () => {
    expect(mediaKindFromPath("a.png")).toBe("image");
    expect(mediaKindFromPath("a.jpg")).toBe("image");
    expect(mediaKindFromPath("a.jpeg")).toBe("image");
    expect(mediaKindFromPath("a.gif")).toBe("image");
    expect(mediaKindFromPath("a.webp")).toBe("image");
    // svg is NOT in Flask's list
    expect(mediaKindFromPath("a.svg")).toBe("");

    expect(mediaKindFromPath("v.mp4")).toBe("video");
    expect(mediaKindFromPath("v.mov")).toBe("video");
    expect(mediaKindFromPath("v.webm")).toBe("video");
    expect(mediaKindFromPath("v.m4v")).toBe(""); // not in Flask's list

    expect(mediaKindFromPath("s.mp3")).toBe("audio");
    expect(mediaKindFromPath("doc.pdf")).toBe("pdf");
    expect(mediaKindFromPath("doc.docx")).toBe("doc");
    expect(mediaKindFromPath("doc.txt")).toBe("doc");
    expect(mediaKindFromPath("doc.md")).toBe("doc");

    expect(mediaKindFromPath("nofile")).toBe("");
    expect(mediaKindFromPath("")).toBe("");
    expect(mediaKindFromPath(null)).toBe("");
    expect(mediaKindFromPath("FILE.PDF")).toBe("pdf"); // case-insensitive
  });
});
