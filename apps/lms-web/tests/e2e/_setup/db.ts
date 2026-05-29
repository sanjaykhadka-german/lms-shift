// Optional Drizzle handle for test cleanup. Imported only by specs that
// need afterAll() cleanup; not used by smoke / read-only specs.

import { db, lmsUsers } from "@tracey/db";
import { eq } from "drizzle-orm";

export { db };

export async function deleteLmsUserByEmail(email: string): Promise<void> {
  await db.delete(lmsUsers).where(eq(lmsUsers.email, email));
}
