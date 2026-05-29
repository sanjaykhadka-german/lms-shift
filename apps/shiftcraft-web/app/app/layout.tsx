import { redirect } from "next/navigation";
import { currentMembership, currentUser } from "~/lib/auth/current";
import { Sidebar } from "~/components/Sidebar";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await currentUser();
  if (!user) redirect("/sign-in?returnTo=/app");

  const membership = await currentMembership();
  const displayName = user.name ?? user.email;
  const roleLabel = membership?.role ?? "member";

  return (
    <div className="flex min-h-screen">
      <Sidebar name={displayName} role={roleLabel} />
      <main className="flex-1">{children}</main>
    </div>
  );
}
