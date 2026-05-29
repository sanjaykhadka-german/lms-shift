import "server-only";
import { and, eq } from "drizzle-orm";
import { forTenant, aiStudioSessions, type AiStudioSession } from "@tracey/db";
import type { ChatTurn } from "./claude";

export interface StoredFile {
  id: string;
  kind: "pdf" | "docx" | "image";
  name: string;
  mime: string;
  size: number;
  // For PDFs and images: base64-encoded body (sent to Claude as a content block).
  // For DOCX: extracted plain text.
  body: string;
}

export interface StudioState {
  history: ChatTurn[];
  files: StoredFile[];
  currentModuleJson: string | null;
  moduleId: number | null;
}

const EMPTY: StudioState = {
  history: [],
  files: [],
  currentModuleJson: null,
  moduleId: null,
};

export async function getStudioSession(
  userId: string,
  tenantId: string,
): Promise<StudioState> {
  const rows = await forTenant(tenantId).run((tx) =>
    tx
      .select()
      .from(aiStudioSessions)
      .where(
        and(eq(aiStudioSessions.userId, userId), eq(aiStudioSessions.tenantId, tenantId)),
      )
      .limit(1),
  );
  const row = rows[0];
  if (!row) return EMPTY;
  return rowToState(row);
}

export async function saveStudioSession(
  userId: string,
  tenantId: string,
  state: Partial<StudioState>,
): Promise<StudioState> {
  const current = await getStudioSession(userId, tenantId);
  const next: StudioState = { ...current, ...state };
  await forTenant(tenantId).run((tx) =>
    tx
      .insert(aiStudioSessions)
      .values({
        userId,
        tenantId,
        history: next.history as unknown,
        files: next.files as unknown,
        currentModuleJson: next.currentModuleJson,
        moduleId: next.moduleId,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [aiStudioSessions.userId, aiStudioSessions.tenantId],
        set: {
          history: next.history as unknown,
          files: next.files as unknown,
          currentModuleJson: next.currentModuleJson,
          moduleId: next.moduleId,
          updatedAt: new Date(),
        },
      }),
  );
  return next;
}

export async function resetStudioSession(
  userId: string,
  tenantId: string,
): Promise<void> {
  await forTenant(tenantId).run((tx) =>
    tx
      .delete(aiStudioSessions)
      .where(
        and(eq(aiStudioSessions.userId, userId), eq(aiStudioSessions.tenantId, tenantId)),
      ),
  );
}

function rowToState(row: AiStudioSession): StudioState {
  return {
    history: (row.history ?? []) as ChatTurn[],
    files: (row.files ?? []) as StoredFile[],
    currentModuleJson: row.currentModuleJson ?? null,
    moduleId: row.moduleId ?? null,
  };
}
