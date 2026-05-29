import Link from "next/link";

interface SearchParams {
  email?: string;
  sent?: string;
  returnTo?: string;
}

// Supabase Auth owns email confirmation: the link in the email points at
// /auth/callback, which exchanges the code for a session. This page is just
// the "check your inbox" waiting screen shown right after sign-up.
export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { email } = await searchParams;

  return (
    <Centered>
      <h1 className="text-2xl font-semibold tracking-tight">Check your inbox</h1>
      <p className="mt-2 text-sm text-[color:var(--muted-foreground)]">
        {email ? (
          <>
            We sent a verification link to <strong>{email}</strong>. Click it to finish
            setting up your account.
          </>
        ) : (
          <>Open the verification link we sent to your email to finish signing up.</>
        )}
      </p>
      <p className="mt-4 text-xs text-[color:var(--muted-foreground)]">
        Didn&apos;t get it? Check spam, or{" "}
        <Link
          href={email ? `/sign-up?email=${encodeURIComponent(email)}` : "/sign-up"}
          className="underline"
        >
          try again
        </Link>
        .
      </p>
    </Centered>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-md text-center">{children}</div>
    </div>
  );
}
