import "server-only";
import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

type CookieToSet = { name: string; value: string; options?: CookieOptions };

/**
 * Supabase client for Server Components, Server Actions, and Route Handlers.
 * Bound to the Next.js request cookies so it reads/refreshes the user session.
 *
 * Note: cookie writes from a Server Component throw (read-only context); we
 * swallow that — session refresh on navigation is handled by middleware.ts.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component — ignore. Middleware refreshes.
          }
        },
      },
    },
  );
}
