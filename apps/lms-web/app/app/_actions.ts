"use server";

import { redirect } from "next/navigation";
import { createClient } from "~/lib/supabase/server";
import { setActiveTenant } from "~/lib/auth/current";

export async function signOutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}

export async function switchTenantAction(formData: FormData) {
  const tenantId = formData.get("tenantId");
  if (typeof tenantId !== "string" || !tenantId) {
    redirect("/app");
  }
  await setActiveTenant(tenantId as string);
  redirect("/app");
}
