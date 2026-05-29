import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "~/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  const { user, response } = await updateSession(request);

  const path = request.nextUrl.pathname;
  const isProtected = path.startsWith("/app");

  if (isProtected && !user) {
    const url = new URL("/sign-in", request.nextUrl);
    url.searchParams.set("returnTo", path);
    const redirect = NextResponse.redirect(url);
    for (const c of response.cookies.getAll()) redirect.cookies.set(c);
    return redirect;
  }

  if (user && (path.startsWith("/sign-in") || path.startsWith("/sign-up"))) {
    const redirect = NextResponse.redirect(new URL("/app", request.nextUrl));
    for (const c of response.cookies.getAll()) redirect.cookies.set(c);
    return redirect;
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
