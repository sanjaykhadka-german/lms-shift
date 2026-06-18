import { notFound, redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { forTenant, scEmployees } from "@tracey/db";
import { currentMembership, currentUser } from "~/lib/auth/current";
import { isAtLeastManager } from "~/lib/roles";
import { EmployeeOnboardingForm } from "../../_employee-onboarding-form";

export const metadata = { title: "Complete onboarding · ShiftCraft" };
export const dynamic = "force-dynamic";

export default async function CompleteOnboardingPage({
  params,
}: {
  params: Promise<{ employeeId: string }>;
}) {
  const membership = await currentMembership();
  if (!membership) redirect("/app");
  const tenantId = membership.tenant.id;

  const { employeeId } = await params;

  const [employee] = await forTenant(tenantId).run((tx) =>
    tx
      .select({
        id: scEmployees.id,
        appUserId: scEmployees.appUserId,
        fullName: scEmployees.fullName,
        email: scEmployees.email,
        mobile: scEmployees.mobile,
        addressLine: scEmployees.addressLine,
        preferredName: scEmployees.preferredName,
      })
      .from(scEmployees)
      .where(
        and(
          eq(scEmployees.id, employeeId),
          eq(scEmployees.traceyTenantId, tenantId),
        ),
      )
      .limit(1),
  );

  if (!employee) notFound();

  // Access: the employee completing their own onboarding, or any manager/owner.
  // notFound() rather than a 403 so a stray id doesn't confirm an employee
  // exists to someone who shouldn't see it.
  const user = await currentUser();
  const isSelf =
    !!user && !!employee.appUserId && employee.appUserId === user.id;
  if (!isSelf && !isAtLeastManager(membership.role)) notFound();

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8">
      <div className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight text-ink">
          Complete your onboarding
        </h1>
        <p className="mt-1 text-sm text-ink-2">
          A few details so we can set you up for pay, tax and super. Your bank,
          TFN and super details are encrypted.
        </p>
      </div>
      <EmployeeOnboardingForm
        employeeId={employee.id}
        defaults={{
          fullName: employee.fullName,
          email: employee.email ?? undefined,
          mobile: employee.mobile ?? undefined,
          addressLine: employee.addressLine ?? undefined,
          preferredName: employee.preferredName ?? undefined,
        }}
      />
    </div>
  );
}
