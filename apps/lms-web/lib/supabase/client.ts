import { createBrowserClient } from "@supabase/ssr";

/**
 * Supabase client for Client Components (browser). Reads the session from the
 * cookies set by the SSR/server client.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
