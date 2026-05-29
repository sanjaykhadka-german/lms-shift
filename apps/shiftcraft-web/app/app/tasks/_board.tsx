"use client";

import { useOptimistic, useState, useTransition } from "react";
import Link from "next/link";
import {
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { fmtShortDate } from "~/lib/date-format";
import { moveTaskAction } from "./actions";

export type TaskStatus = "open" | "in_progress" | "done";
export type TaskPriority = "low" | "normal" | "high" | "urgent";

export interface BoardTask {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string | null;
  assigneeUserId: string | null;
  assigneeName: string | null;
  locationName: string | null;
}

const COLUMNS: Array<{ status: TaskStatus; label: string }> = [
  { status: "open", label: "Open" },
  { status: "in_progress", label: "In progress" },
  { status: "done", label: "Done" },
];

// Solid-fill badges for clear contrast under the app's themed palette.
const PRIORITY_BADGE: Record<TaskPriority, string> = {
  low: "bg-[var(--ink-3)] text-white",
  normal: "bg-[var(--accent-deep)] text-[var(--accent-ink)]",
  high: "bg-[var(--warn)] text-white",
  urgent: "bg-[var(--danger)] text-white",
};

function fmtDue(due: string | null): string | null {
  if (!due) return null;
  const d = new Date(`${due}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return fmtShortDate(d);
}

function isOverdue(due: string | null, status: TaskStatus): boolean {
  if (!due || status === "done") return false;
  const d = new Date(`${due}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return d.getTime() < today.getTime();
}

interface OptimisticMove {
  taskId: string;
  status: TaskStatus;
}

export function TaskBoard({ initialTasks }: { initialTasks: BoardTask[] }) {
  const [activeTask, setActiveTask] = useState<BoardTask | null>(null);
  const [, startTransition] = useTransition();
  const [tasks, applyMove] = useOptimistic<BoardTask[], OptimisticMove>(
    initialTasks,
    (state, move) =>
      state.map((t) =>
        t.id === move.taskId ? { ...t, status: move.status } : t,
      ),
  );

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  function handleDragStart(event: DragStartEvent) {
    const taskId = String(event.active.id);
    const task = tasks.find((t) => t.id === taskId) ?? null;
    setActiveTask(task);
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveTask(null);
    const { active, over } = event;
    if (!over) return;

    const taskId = String(active.id);
    const overId = String(over.id);
    // Dropped onto a column header → overId is the status itself.
    // Dropped onto a sibling card → overId is the card id; look up its column.
    const overTask = tasks.find((t) => t.id === overId);
    const targetStatus: TaskStatus | null = overTask
      ? overTask.status
      : COLUMNS.some((c) => c.status === overId)
        ? (overId as TaskStatus)
        : null;
    if (!targetStatus) return;

    const sourceTask = tasks.find((t) => t.id === taskId);
    if (!sourceTask || sourceTask.status === targetStatus) return;

    // Optimistic update + server confirmation. useOptimistic must be called
    // inside a transition or async server action (React 19 requirement).
    startTransition(async () => {
      applyMove({ taskId, status: targetStatus });
      const fd = new FormData();
      fd.append("id", taskId);
      fd.append("status", targetStatus);
      await moveTaskAction(fd);
    });
  }

  const byStatus = new Map<TaskStatus, BoardTask[]>();
  for (const t of tasks) {
    const arr = byStatus.get(t.status) ?? [];
    arr.push(t);
    byStatus.set(t.status, arr);
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="grid gap-4 md:grid-cols-3">
        {COLUMNS.map((col) => {
          const items = byStatus.get(col.status) ?? [];
          return (
            <Column key={col.status} status={col.status} label={col.label} count={items.length}>
              <SortableContext
                items={items.map((t) => t.id)}
                strategy={verticalListSortingStrategy}
              >
                <ul className="divide-y divide-border">
                  {items.length === 0 ? (
                    <li className="px-4 py-6 text-center text-xs text-muted-foreground">
                      Drop a card here.
                    </li>
                  ) : (
                    items.map((t) => <TaskCard key={t.id} task={t} />)
                  )}
                </ul>
              </SortableContext>
            </Column>
          );
        })}
      </div>

      <DragOverlay>
        {activeTask ? (
          <div className="rounded-md border border-border bg-card px-4 py-3 shadow-lg">
            <div className="flex items-start justify-between gap-2">
              <div className="text-sm font-medium">{activeTask.title}</div>
              <span
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${PRIORITY_BADGE[activeTask.priority]}`}
              >
                {activeTask.priority}
              </span>
            </div>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function Column({
  status,
  label,
  count,
  children,
}: {
  status: TaskStatus;
  label: string;
  count: number;
  children: React.ReactNode;
}) {
  const { isOver, setNodeRef } = useDroppable({ id: status });
  return (
    <section
      ref={setNodeRef}
      className={`rounded-lg border bg-card shadow-sm transition-colors ${
        isOver ? "border-primary/60 bg-primary/5" : "border-border"
      }`}
    >
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <h2 className="text-sm font-semibold">{label}</h2>
        <span className="text-xs text-muted-foreground">{count}</span>
      </div>
      {children}
    </section>
  );
}

function TaskCard({ task }: { task: BoardTask }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: task.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };
  const due = fmtDue(task.dueDate);
  const overdue = isOverdue(task.dueDate, task.status);
  return (
    <li
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className="cursor-grab space-y-2 px-4 py-3 hover:bg-muted/30 active:cursor-grabbing"
    >
      <div className="flex items-start justify-between gap-2">
        <Link
          href={`/app/tasks/${task.id}/edit`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          className="block min-w-0 flex-1 text-sm font-medium hover:underline"
        >
          {task.title}
        </Link>
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${PRIORITY_BADGE[task.priority]}`}
        >
          {task.priority}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        {task.assigneeName && <span>👤 {task.assigneeName}</span>}
        {task.locationName && <span>📍 {task.locationName}</span>}
        {due && (
          <span
            className={
              overdue ? "font-medium text-[color:var(--destructive)]" : ""
            }
          >
            📅 {due}
            {overdue ? " · overdue" : ""}
          </span>
        )}
      </div>
    </li>
  );
}
