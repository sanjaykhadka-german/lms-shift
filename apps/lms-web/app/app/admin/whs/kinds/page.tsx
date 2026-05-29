import Link from "next/link";
import { BackLink } from "~/components/ui/back-link";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { requireAdmin } from "~/lib/auth/admin";
import { ensureSystemKinds, listWhsKinds } from "~/lib/lms/whs-kinds";
import { DeleteRowForm } from "../../_components/DeleteRowForm";
import { WhsKindForm } from "./_form";
import { createWhsKindAction, deleteWhsKindAction } from "./actions";

export const metadata = { title: "WHS kinds" };

export default async function WhsKindsPage() {
  const ctx = await requireAdmin();
  await ensureSystemKinds({ db: ctx.db, traceyTenantId: ctx.traceyTenantId });
  const kinds = await listWhsKinds({ db: ctx.db, traceyTenantId: ctx.traceyTenantId });

  return (
    <div className="space-y-6">
      <div>
        <BackLink href="/app/admin/whs">Back to register</BackLink>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">WHS kinds</h1>
        <p className="text-sm text-[color:var(--muted-foreground)]">
          The types of records you keep in the WHS register — licences, certifications, incident
          categories. <span className="font-medium">Expiry</span> kinds get issued/expiry dates;{" "}
          <span className="font-medium">Incident</span> kinds get severity and reporter fields.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Add a kind</CardTitle>
          <CardDescription>Names must be unique within your workspace.</CardDescription>
        </CardHeader>
        <CardContent>
          <WhsKindForm action={createWhsKindAction} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">All kinds ({kinds.length})</CardTitle>
        </CardHeader>
        <CardContent className="divide-y divide-[color:var(--border)] p-0">
          {kinds.length === 0 ? (
            <p className="px-6 py-4 text-sm text-[color:var(--muted-foreground)]">No kinds yet.</p>
          ) : (
            kinds.map((k) => (
              <div key={k.id} className="flex items-center justify-between gap-3 px-6 py-3">
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium">{k.label}</span>
                  <Badge variant={k.category === "incident" ? "warning" : "secondary"}>
                    {k.category}
                  </Badge>
                  {k.isSystem && (
                    <Badge variant="secondary" className="opacity-70">
                      system
                    </Badge>
                  )}
                </div>
                {k.isSystem ? (
                  <Button variant="outline" size="sm" disabled title="System kinds can't be deleted">
                    System
                  </Button>
                ) : (
                  <DeleteRowForm
                    action={deleteWhsKindAction}
                    id={k.id}
                    confirmMessage={`Delete '${k.label}'? Existing WHS records using this kind will keep working but the kind won't be selectable.`}
                  />
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
