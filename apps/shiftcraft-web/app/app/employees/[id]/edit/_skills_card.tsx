import { Button } from "~/components/ui/button";
import {
  addEmployeeSkillAction,
  removeEmployeeSkillAction,
} from "~/app/app/admin/skills/actions";

interface SkillOption {
  id: string;
  name: string;
}

export function SkillsCard({
  employeeId,
  allSkills,
  assignedSkillIds,
  canEdit,
}: {
  employeeId: string;
  allSkills: SkillOption[];
  assignedSkillIds: Set<string>;
  canEdit: boolean;
}) {
  return (
    <section className="rounded-lg border border-border bg-card p-6 shadow-sm">
      <h2 className="text-sm font-semibold">Skills</h2>
      <p className="mt-1 mb-4 text-xs text-muted-foreground">
        Tags the auto-scheduler uses to match this person to shifts that
        require a specific skill. Click a chip to toggle.
        {!canEdit && " Read-only — only managers can edit."}
      </p>
      {allSkills.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No skills defined yet. Add some at{" "}
          <a href="/app/admin/skills" className="underline">
            /app/admin/skills
          </a>{" "}
          first.
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {allSkills.map((s) => {
            const assigned = assignedSkillIds.has(s.id);
            const action = assigned
              ? removeEmployeeSkillAction
              : addEmployeeSkillAction;
            return canEdit ? (
              <form key={s.id} action={action}>
                <input type="hidden" name="employeeId" value={employeeId} />
                <input type="hidden" name="skillId" value={s.id} />
                <Button
                  type="submit"
                  size="sm"
                  variant={assigned ? "default" : "outline"}
                >
                  {assigned ? "✓ " : ""}
                  {s.name}
                </Button>
              </form>
            ) : (
              <span
                key={s.id}
                className={`inline-flex items-center rounded-md px-3 py-1.5 text-sm ${
                  assigned
                    ? "bg-primary text-primary-foreground"
                    : "border border-border text-muted-foreground"
                }`}
              >
                {assigned ? "✓ " : ""}
                {s.name}
              </span>
            );
          })}
        </div>
      )}
    </section>
  );
}
