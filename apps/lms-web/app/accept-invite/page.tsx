import Link from "next/link";
import { eq } from "drizzle-orm";
import { db, invitations, tenants } from "@tracey/db";
import { currentUser } from "~/lib/auth/current";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { acceptInvitationAction } from "./actions";

interface PageProps {
  searchParams: Promise<{ token?: string }>;
}

export default async function AcceptInvitePage({ searchParams }: PageProps) {
  const { token } = await searchParams;
  if (!token) return <ErrorView title="Missing invitation token" />;

  const [row] = await db
    .select({
      id: invitations.id,
      email: invitations.email,
      role: invitations.role,
      expiresAt: invitations.expiresAt,
      tenantName: tenants.name,
    })
    .from(invitations)
    .innerJoin(tenants, eq(tenants.id, invitations.tenantId))
    .where(eq(invitations.token, token))
    .limit(1);
  if (!row) return <ErrorView title="Invitation not found or already used" />;
  if (row.expiresAt.getTime() < Date.now()) {
    return <ErrorView title="This invitation has expired" />;
  }

  const me = await currentUser();

  // Not signed in: nudge to sign-up (pre-filled email) or sign-in with the invite preserved.
  if (!me) {
    const next = `/accept-invite?token=${encodeURIComponent(token)}`;
    return (
      <Shell>
        <CardHeader>
          <CardTitle>Join {row.tenantName}</CardTitle>
          <CardDescription>
            You&rsquo;ve been invited as a <strong>{row.role}</strong>. Sign in
            or create your account to accept.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <Button asChild>
            <Link
              href={`/sign-up?email=${encodeURIComponent(row.email)}&returnTo=${encodeURIComponent(next)}`}
            >
              Create account ({row.email})
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={`/sign-in?returnTo=${encodeURIComponent(next)}`}>
              I already have an account
            </Link>
          </Button>
        </CardContent>
      </Shell>
    );
  }

  // Signed in but with a different email — the invitee needs to sign out
  // and re-sign-in with the correct address.
  if (me.email.toLowerCase() !== row.email.toLowerCase()) {
    return (
      <Shell>
        <CardHeader>
          <CardTitle>Wrong account</CardTitle>
          <CardDescription>
            You&rsquo;re signed in as <strong>{me.email}</strong>, but this
            invitation was sent to <strong>{row.email}</strong>. Sign out and
            sign in with the matching email to accept.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline">
            <Link href="/api/auth/signout">Sign out</Link>
          </Button>
        </CardContent>
      </Shell>
    );
  }

  // Happy path — same email, click to accept.
  return (
    <Shell>
      <CardHeader>
        <CardTitle>Join {row.tenantName}</CardTitle>
        <CardDescription>
          You&rsquo;ve been invited as a <strong>{row.role}</strong>.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={acceptInvitationAction}>
          <input type="hidden" name="token" value={token} />
          <Button type="submit" className="w-full">
            Accept and continue
          </Button>
        </form>
      </CardContent>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <Card className="w-full max-w-md">{children}</Card>
    </div>
  );
}

function ErrorView({ title }: { title: string }) {
  return (
    <Shell>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>
          Ask the workspace owner to send a fresh invitation.
        </CardDescription>
      </CardHeader>
    </Shell>
  );
}
