import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client for privileged, server-only admin operations
 * (e.g. setting another user's password, creating/inviting users). NEVER
 * import this into client code — the service-role key bypasses RLS and all
 * auth checks.
 */
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}
