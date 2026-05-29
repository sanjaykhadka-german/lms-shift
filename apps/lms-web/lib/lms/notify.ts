import "server-only";
import { Resend } from "resend";
import { siteConfig } from "~/lib/site-config";
import { getTenantOwnerEmails } from "./admins";

// Resolves the tenant's owner(s) and emails them a one-line summary of the
// learner's quiz attempt. Admins are intentionally not emailed — they get
// the in-app notification at learner.ts:564-576 instead, to keep mail
// volume tight. The legacy LMS_ADMIN_EMAIL / ADMIN_EMAIL env vars are no
// longer consulted (every tenant routed mail to a single global address
// before this change).

const apiKey = process.env.RESEND_API_KEY;
const from = `${process.env.MAIL_FROM_NAME ?? "Tracey"} <${
  process.env.MAIL_FROM ?? "no-reply@example.com"
}>`;

let resend: Resend | null = null;
function client(): Resend {
  resend ??= new Resend(apiKey!);
  return resend;
}

// RFC 2606 / RFC 6761 reserved domains — never deliver real mail to these.
function isReservedTestRecipient(to: string): boolean {
  return /@(example\.(test|com|org|net)|invalid|localhost|test)$/i.test(to.trim());
}

export async function notifyAttempt(opts: {
  tenantId: string;
  learnerEmail: string;
  learnerName: string;
  moduleTitle: string;
  score: number;
  passed: boolean;
}): Promise<void> {
  if (!apiKey) return;
  const recipients = (await getTenantOwnerEmails(opts.tenantId)).filter(
    (e) => !isReservedTestRecipient(e),
  );
  if (recipients.length === 0) return;
  const verdict = opts.passed ? "PASSED" : "did NOT pass";
  const subject = `[${siteConfig.name}] ${opts.learnerName} ${verdict} ${opts.moduleTitle} (${opts.score}%)`;
  const text =
    `${opts.learnerName} <${opts.learnerEmail}> ${verdict} the quiz for ` +
    `"${opts.moduleTitle}" with a score of ${opts.score}%.`;
  try {
    await client().emails.send({ from, to: recipients, subject, text });
  } catch (err) {
    // Don't let a Resend hiccup roll back a successful attempt insert.
    console.error("notifyAttempt failed", err);
  }
}
