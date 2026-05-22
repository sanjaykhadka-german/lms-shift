import "server-only";
import { Resend } from "resend";

// Invitation emails point at lms-web's /accept-invite — the workspace
// invite flow + the accept route live there (Tracey is the umbrella
// brand; lms-web hosts the shared auth/onboarding surfaces). Accepted
// invites create an app.members row that grants access to both apps.
//
// NEXT_PUBLIC_LMS_URL is set in .env (and on Render) per [[reference_render_db]]
// → falls back to localhost in dev.

const apiKey = process.env.RESEND_API_KEY;
const from = `${process.env.MAIL_FROM_NAME ?? "Tracey"} <${
  process.env.MAIL_FROM ?? "no-reply@example.com"
}>`;

let resend: Resend | null = null;
function client(): Resend {
  if (!apiKey) {
    throw new Error(
      "RESEND_API_KEY is not set — invitation email cannot be sent.",
    );
  }
  resend ??= new Resend(apiKey);
  return resend;
}

function lmsUrl(): string {
  return process.env.NEXT_PUBLIC_LMS_URL ?? "http://localhost:4000";
}

export async function sendInvitationEmail(opts: {
  to: string;
  token: string;
  tenantName: string;
  inviterName?: string | null;
}): Promise<void> {
  const acceptUrl = `${lmsUrl()}/accept-invite?token=${encodeURIComponent(
    opts.token,
  )}`;
  const inviter = opts.inviterName ?? "A teammate";

  await client().emails.send({
    from,
    to: opts.to,
    subject: `You've been invited to ${opts.tenantName} on Tracey`,
    text:
      `${inviter} has invited you to join ${opts.tenantName} on Tracey.\n\n` +
      `Accept the invitation: ${acceptUrl}\n\n` +
      `This invitation expires in 7 days.`,
    html: `
      <p>${inviter} has invited you to join <strong>${opts.tenantName}</strong> on Tracey.</p>
      <p><a href="${acceptUrl}">Accept the invitation</a></p>
      <p>This invitation expires in 7 days.</p>
    `,
  });
}
