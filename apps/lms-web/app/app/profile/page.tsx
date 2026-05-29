import { eq } from "drizzle-orm";
import { db, lmsDepartments, lmsEmployers } from "@tracey/db";
import { requireLearner } from "~/lib/lms/learner";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { ProfileInfoForm } from "./_components/ProfileInfoForm";
import { ChangePasswordForm } from "./_components/ChangePasswordForm";

export const metadata = { title: "Profile" };

export default async function ProfilePage() {
  const ctx = await requireLearner();
  const lmsUser = ctx.lmsUser;

  const [department, employer] = await Promise.all([
    lmsUser.departmentId
      ? ctx.db
          .run((tx) =>
            tx
              .select({ name: lmsDepartments.name })
              .from(lmsDepartments)
              .where(eq(lmsDepartments.id, lmsUser.departmentId!))
              .limit(1),
          )
          .then((r) => r[0]?.name ?? null)
      : Promise.resolve(null),
    lmsUser.employerId
      ? ctx.db
          .run((tx) =>
            tx
              .select({ name: lmsEmployers.name })
              .from(lmsEmployers)
              .where(eq(lmsEmployers.id, lmsUser.employerId!))
              .limit(1),
          )
          .then((r) => r[0]?.name ?? null)
      : Promise.resolve(null),
  ]);

  const photoUrl = lmsUser.photoFilename
    ? `/uploads/${lmsUser.photoFilename}`
    : null;

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Profile</h1>
        <p className="text-sm text-[color:var(--muted-foreground)]">
          Update your personal details, photo, and password.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-12">
        <Card className="lg:col-span-7">
          <CardHeader>
            <CardTitle className="text-lg">Your information</CardTitle>
          </CardHeader>
          <CardContent>
            <ProfileInfoForm
              firstName={lmsUser.firstName ?? ""}
              lastName={lmsUser.lastName ?? ""}
              email={lmsUser.email}
              phone={lmsUser.phone ?? ""}
              photoUrl={photoUrl}
              role={lmsUser.role ?? "employee"}
              department={department}
              employer={employer}
            />
          </CardContent>
        </Card>

        <Card className="lg:col-span-5">
          <CardHeader>
            <CardTitle className="text-lg">Change password</CardTitle>
          </CardHeader>
          <CardContent>
            <ChangePasswordForm />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
