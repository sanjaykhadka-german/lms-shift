import "server-only";
import { Resend } from "resend";

// Invitation emails point at ShiftCraft's OWN /accept-invite route so the
// whole invite → accept flow stays on the ShiftCraft domain (no lms-web
// hop). The accept route reads/writes the shared app.invitations /
// app.members tables, so accepted invites still grant access to both apps.
//
// NEXT_PUBLIC_SHIFTCRAFT_URL is set in .env (and on Render) per
// [[reference_render_db]] → falls back to localhost:4100 in dev. It is
// build-time inlined, so changing it on Render needs a rebuild, not a restart.

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

function shiftcraftUrl(): string {
  return process.env.NEXT_PUBLIC_SHIFTCRAFT_URL ?? "http://localhost:4100";
}

export async function sendInvitationEmail(opts: {
  to: string;
  token: string;
  tenantName: string;
  inviterName?: string | null;
}): Promise<void> {
  const acceptUrl = `${shiftcraftUrl()}/accept-invite?token=${encodeURIComponent(
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
