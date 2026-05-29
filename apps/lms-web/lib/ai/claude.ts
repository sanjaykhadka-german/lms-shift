import "server-only";
import path from "node:path";
import { promises as fs } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";

// Default to Sonnet 4.6 to preserve parity with the Flask implementation
// (claude_service.py used claude-sonnet-4-6) and keep cost predictable. The
// `ANTHROPIC_MODEL` env var can override — set it to `claude-opus-4-7` for the
// most capable model, or any other supported ID.
const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6";

// Accept either env var name. Flask's claude_service.py reads CLAUDE_API_KEY,
// while Anthropic's SDK convention is ANTHROPIC_API_KEY — support both so the
// AI Studio works with whichever is already configured.
export function getClaudeApiKey(): string | undefined {
  return process.env.ANTHROPIC_API_KEY ?? process.env.CLAUDE_API_KEY;
}

let _client: Anthropic | null = null;
export function anthropic(): Anthropic {
  if (_client) return _client;
  const apiKey = getClaudeApiKey();
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY or CLAUDE_API_KEY must be set");
  }
  _client = new Anthropic({ apiKey });
  return _client;
}

export function aiStudioModel(): string {
  return MODEL;
}

let _systemPromptCache: string | null = null;

// Loads the qa-quiz-creator skill from the repo root. Mirrors what
// claude_service.py reads via _load_system_prompt(). Cached at process scope —
// the prompt only changes on deploy.
export async function loadSystemPrompt(): Promise<string> {
  if (_systemPromptCache) return _systemPromptCache;

  const root = process.cwd();
  // Locally and on Render the cwd is the lms-web app root. Resolve relative.
  const skillRoot = path.resolve(root, "..", "..", "skills", "qa-quiz-creator");
  const [skillMd, schemaMd] = await Promise.all([
    fs.readFile(path.join(skillRoot, "SKILL.md"), "utf8"),
    fs.readFile(path.join(skillRoot, "references", "module-schema.md"), "utf8"),
  ]);

  _systemPromptCache = `${skillMd}\n\n---\n\n${schemaMd}`;
  return _systemPromptCache;
}

// Parse out a leading or fenced module-JSON block from Claude's reply.
// Flask's apply path expects the model to emit a complete module JSON object
// when it has anything substantive to apply; we surface that to the UI so the
// preview pane updates and the "Import / Apply" buttons activate.
const FENCED_JSON_RE = /```(?:json)?\s*([\s\S]*?)\s*```/gm;

export function extractModuleJson(reply: string): string | null {
  return splitReplyAndJson(reply).moduleJson;
}

// Returns the visible (chat-display) reply with any module-JSON block stripped,
// plus the JSON itself for the preview pane. Keeps the chat plain English even
// when Claude inlines a giant JSON object in its turn.
export function splitReplyAndJson(reply: string): {
  visibleReply: string;
  moduleJson: string | null;
} {
  // 1. Try fenced blocks first — they're easy to remove cleanly.
  let lastValid: { json: string; start: number; end: number } | null = null;
  for (const match of reply.matchAll(FENCED_JSON_RE)) {
    const candidate = match[1]?.trim();
    if (!candidate || match.index === undefined) continue;
    if (looksLikeModuleObject(candidate)) {
      lastValid = {
        json: candidate,
        start: match.index,
        end: match.index + match[0].length,
      };
    }
  }
  if (lastValid) {
    const visible =
      reply.slice(0, lastValid.start) + reply.slice(lastValid.end);
    return { visibleReply: cleanWhitespace(visible), moduleJson: lastValid.json };
  }

  // 2. Top-level JSON object (no fence). Walk braces.
  const start = reply.indexOf("{");
  if (start === -1) {
    return { visibleReply: reply, moduleJson: null };
  }
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < reply.length; i++) {
    const ch = reply[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        const candidate = reply.slice(start, i + 1);
        if (looksLikeModuleObject(candidate)) {
          const visible = reply.slice(0, start) + reply.slice(i + 1);
          return {
            visibleReply: cleanWhitespace(visible),
            moduleJson: candidate,
          };
        }
        break;
      }
    }
  }
  return { visibleReply: reply, moduleJson: null };
}

function cleanWhitespace(s: string): string {
  // Collapse the gap left by removing the JSON block — at most one blank line
  // between paragraphs, and trim leading/trailing whitespace.
  return s.replace(/\n{3,}/g, "\n\n").trim();
}

function looksLikeModuleObject(raw: string): boolean {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return false;
    // Module shape per skills/qa-quiz-creator/references/module-schema.md.
    return (
      typeof (parsed as { title?: unknown }).title === "string" &&
      Array.isArray((parsed as { sections?: unknown }).sections) ||
      Array.isArray((parsed as { content_items?: unknown }).content_items)
    );
  } catch {
    return false;
  }
}

export type ChatTurn = {
  role: "user" | "assistant";
  content: Anthropic.ContentBlockParam[];
};

export interface SendMessageInput {
  history: ChatTurn[];
  // Files to attach to the next user turn (PDF base64, image base64, DOCX text).
  attachments: Anthropic.ContentBlockParam[];
  text: string;
}

export interface SendMessageResult {
  // Plain-English chat reply with the module JSON block removed.
  visibleReply: string;
  moduleJson: string | null;
  // Updated history including this turn's user + assistant entries (full
  // content blocks intact — the model needs its prior JSON in context).
  nextHistory: ChatTurn[];
}

export async function sendMessage(opts: SendMessageInput): Promise<SendMessageResult> {
  const system = await loadSystemPrompt();
  const userTurn: ChatTurn = {
    role: "user",
    content: [
      ...opts.attachments,
      { type: "text", text: opts.text },
    ],
  };
  const messages: ChatTurn[] = [...opts.history, userTurn];

  const response = await anthropic().messages.create({
    model: MODEL,
    max_tokens: 16000,
    // Prompt caching: the system prompt is large (~8KB) and stable across
    // turns, so cache it. cache_read_input_tokens drops cost ~10x on
    // subsequent turns within the 5-minute TTL.
    system: [
      {
        type: "text",
        text: system,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages,
  });

  // Reduce content blocks to plain text for chat display + JSON extraction.
  let reply = "";
  for (const block of response.content) {
    if (block.type === "text") reply += block.text;
  }
  const { visibleReply, moduleJson } = splitReplyAndJson(reply);

  const assistantTurn: ChatTurn = {
    role: "assistant",
    content: response.content as Anthropic.ContentBlockParam[],
  };

  return {
    visibleReply: visibleReply || "(Claude returned a module update — see the preview pane.)",
    moduleJson,
    nextHistory: [...messages, assistantTurn],
  };
}
