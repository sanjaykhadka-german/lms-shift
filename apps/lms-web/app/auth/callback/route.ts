import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "~/lib/supabase/server";

// Supabase Auth redirects here after the user clicks the email-confirmation
// (or magic) link. We exchange the `code` for a session (which sets the auth
// cookies via the server client), then forward to the app.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const returnToParam = searchParams.get("returnTo");
  const returnTo =
    returnToParam && returnToParam.startsWith("/") ? returnToParam : "/app";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${returnTo}`);
    }
  }

  return NextResponse.redirect(`${origin}/sign-in?reason=auth`);
}
