import "server-only";
import { Resend } from "resend";
import { siteConfig } from "~/lib/site-config";

const apiKey = process.env.RESEND_API_KEY;
const from = `${process.env.MAIL_FROM_NAME ?? "Tracey"} <${
  process.env.MAIL_FROM ?? "no-reply@example.com"
}>`;

let resend: Resend | null = null;
function client(): Resend {
  if (!apiKey) {
    throw new Error(
      "RESEND_API_KEY is not set — verification email cannot be sent.",
    );
  }
  resend ??= new Resend(apiKey);
  return resend;
}

export async function sendVerificationEmail(opts: {
  to: string;
  token: string;
  name?: string | null;
  returnTo?: string;
}): Promise<void> {
  const params = new URLSearchParams({ token: opts.token, email: opts.to });
  if (opts.returnTo) params.set("returnTo", opts.returnTo);
  const verifyUrl = `${siteConfig.url}/verify-email?${params.toString()}`;
  const greeting = opts.name ? `Hi ${opts.name},` : "Hi,";

  await client().emails.send({
    from,
    to: opts.to,
    subject: `Verify your email for ${siteConfig.name}`,
    text:
      `${greeting}\n\n` +
      `Click the link below to verify your email and finish setting up your ${siteConfig.name} account:\n\n` +
      `${verifyUrl}\n\n` +
      `This link expires in 24 hours. If you didn't sign up, you can safely ignore this email.`,
    html: `
      <p>${greeting}</p>
      <p>Click the link below to verify your email and finish setting up your ${siteConfig.name} account:</p>
      <p><a href="${verifyUrl}">${verifyUrl}</a></p>
      <p>This link expires in 24 hours. If you didn't sign up, you can safely ignore this email.</p>
    `,
  });
}

export async function sendInvitationEmail(opts: {
  to: string;
  token: string;
  tenantName: string;
  inviterName?: string | null;
}): Promise<void> {
  const acceptUrl = `${siteConfig.url}/accept-invite?token=${encodeURIComponent(
    opts.token,
  )}`;
  const inviter = opts.inviterName ?? "A teammate";

  await client().emails.send({
    from,
    to: opts.to,
    subject: `You've been invited to ${opts.tenantName} on ${siteConfig.name}`,
    text:
      `${inviter} has invited you to join ${opts.tenantName} on ${siteConfig.name}.\n\n` +
      `Accept the invitation: ${acceptUrl}\n\n` +
      `This invitation expires in 7 days.`,
    html: `
      <p>${inviter} has invited you to join <strong>${opts.tenantName}</strong> on ${siteConfig.name}.</p>
      <p><a href="${acceptUrl}">Accept the invitation</a></p>
      <p>This invitation expires in 7 days.</p>
    `,
  });
}
