import "server-only";
import { Resend } from "resend";
import { APPS } from "./site-config";

// Email notifications for ShiftCraft events. Mirrors the LMS pattern at
// apps/lms-web/lib/lms/notify.ts:
//
//   - RESEND_API_KEY missing → every send is a silent no-op (so local dev
//     and CI work without external state).
//   - Every send is try/catch'd; a Resend hiccup never rolls back the DB
//     write that scheduled the email.
//   - Senders pass full recipient details (email + display name), since
//     resolving those from user_id is cheap at the call-site and keeps
//     this module DB-free.

const apiKey = process.env.RESEND_API_KEY;
const from = `${process.env.MAIL_FROM_NAME ?? "ShiftCraft"} <${
  process.env.MAIL_FROM ?? "no-reply@example.com"
}>`;

let resend: Resend | null = null;
function client(): Resend {
  resend ??= new Resend(apiKey!);
  return resend;
}

const APP_URL = APPS.shiftcraft.url;
const MY_SHIFTS_URL = `${APP_URL}/app/my-shifts`;
const ANNOUNCEMENTS_URL = `${APP_URL}/app/announcements`;

function fmtShift(s: { startsAt: Date; endsAt: Date; role: string; locationName: string | null }): string {
  const start = s.startsAt.toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  const end = s.endsAt.toLocaleString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
  const where = s.locationName ? ` @ ${s.locationName}` : "";
  return `${start} – ${end} · ${s.role}${where}`;
}

function displayName(name: string | null, email: string): string {
  return name && name.trim().length > 0 ? name : email;
}

async function safeSend(opts: {
  to: string;
  subject: string;
  text: string;
  html: string;
  context: string;
}): Promise<void> {
  if (!apiKey) return;
  try {
    await client().emails.send({
      from,
      to: opts.to,
      subject: opts.subject,
      text: opts.text,
      html: opts.html,
    });
  } catch (err) {
    console.error(`[shiftcraft email] ${opts.context} failed`, err);
  }
}

export async function notifyShiftOffered(opts: {
  to: { email: string; name: string | null };
  shift: { startsAt: Date; endsAt: Date; role: string; locationName: string | null };
}): Promise<void> {
  const greeting = `Hi ${displayName(opts.to.name, opts.to.email).split(" ")[0]},`;
  const shiftLine = fmtShift(opts.shift);
  await safeSend({
    to: opts.to.email,
    subject: `New shift offer · ${shiftLine}`,
    text: `${greeting}\n\nYou've been offered a shift:\n\n  ${shiftLine}\n\nOpen ShiftCraft to accept or decline: ${MY_SHIFTS_URL}`,
    html: `
      <p>${greeting}</p>
      <p>You've been offered a shift:</p>
      <p><strong>${shiftLine}</strong></p>
      <p><a href="${MY_SHIFTS_URL}">Open ShiftCraft</a> to accept or decline.</p>
    `,
    context: "notifyShiftOffered",
  });
}

export async function notifySwapRequested(opts: {
  to: { email: string; name: string | null };
  from: { name: string | null; email: string };
  // The shift the initiator is giving up.
  giveaway: { startsAt: Date; endsAt: Date; role: string; locationName: string | null };
  // If a two-way swap, the shift the target would receive in return.
  receive: { startsAt: Date; endsAt: Date; role: string; locationName: string | null } | null;
  note: string | null;
}): Promise<void> {
  const greeting = `Hi ${displayName(opts.to.name, opts.to.email).split(" ")[0]},`;
  const senderName = displayName(opts.from.name, opts.from.email);
  const giveawayLine = fmtShift(opts.giveaway);
  const isSwap = !!opts.receive;
  const subject = isSwap
    ? `Swap proposal from ${senderName} · ${giveawayLine}`
    : `Cover request from ${senderName} · ${giveawayLine}`;

  const noteBlock = opts.note ? `\nThey added: "${opts.note}"\n` : "";
  const noteHtml = opts.note
    ? `<p><em>They added:</em> "${opts.note}"</p>`
    : "";

  if (isSwap && opts.receive) {
    const receiveLine = fmtShift(opts.receive);
    await safeSend({
      to: opts.to.email,
      subject,
      text:
        `${greeting}\n\n${senderName} would like to swap shifts with you.\n\n` +
        `They'd give up: ${giveawayLine}\nYou'd give up: ${receiveLine}\n` +
        `${noteBlock}\nReview the swap: ${MY_SHIFTS_URL}`,
      html: `
        <p>${greeting}</p>
        <p><strong>${senderName}</strong> would like to swap shifts with you.</p>
        <p><em>They'd give up:</em> ${giveawayLine}</p>
        <p><em>You'd give up:</em> ${receiveLine}</p>
        ${noteHtml}
        <p><a href="${MY_SHIFTS_URL}">Review the swap</a></p>
      `,
      context: "notifySwapRequested(swap)",
    });
    return;
  }

  await safeSend({
    to: opts.to.email,
    subject,
    text:
      `${greeting}\n\n${senderName} can't make this shift and is asking you to cover:\n\n` +
      `  ${giveawayLine}\n${noteBlock}\nReview the request: ${MY_SHIFTS_URL}`,
    html: `
      <p>${greeting}</p>
      <p><strong>${senderName}</strong> can't make this shift and is asking you to cover:</p>
      <p><strong>${giveawayLine}</strong></p>
      ${noteHtml}
      <p><a href="${MY_SHIFTS_URL}">Review the request</a></p>
    `,
    context: "notifySwapRequested(cover)",
  });
}

export async function notifySwapAccepted(opts: {
  to: { email: string; name: string | null };
  acceptor: { name: string | null; email: string };
  // What the initiator gave up (now belongs to the acceptor).
  gaveAway: { startsAt: Date; endsAt: Date; role: string; locationName: string | null };
  // For a two-way swap, what the initiator picked up in exchange.
  pickedUp: { startsAt: Date; endsAt: Date; role: string; locationName: string | null } | null;
}): Promise<void> {
  const greeting = `Hi ${displayName(opts.to.name, opts.to.email).split(" ")[0]},`;
  const acceptorName = displayName(opts.acceptor.name, opts.acceptor.email);
  const gaveAwayLine = fmtShift(opts.gaveAway);
  const subject = opts.pickedUp
    ? `${acceptorName} accepted your swap`
    : `${acceptorName} is covering your shift`;

  if (opts.pickedUp) {
    const pickedUpLine = fmtShift(opts.pickedUp);
    await safeSend({
      to: opts.to.email,
      subject,
      text:
        `${greeting}\n\n${acceptorName} accepted your swap.\n\n` +
        `They took: ${gaveAwayLine}\nYou took: ${pickedUpLine}\n\n` +
        `View your shifts: ${MY_SHIFTS_URL}`,
      html: `
        <p>${greeting}</p>
        <p><strong>${acceptorName}</strong> accepted your swap.</p>
        <p><em>They took:</em> ${gaveAwayLine}</p>
        <p><em>You took:</em> ${pickedUpLine}</p>
        <p><a href="${MY_SHIFTS_URL}">View your shifts</a></p>
      `,
      context: "notifySwapAccepted(swap)",
    });
    return;
  }

  await safeSend({
    to: opts.to.email,
    subject,
    text:
      `${greeting}\n\n${acceptorName} is covering your shift:\n\n  ${gaveAwayLine}\n\n` +
      `View your shifts: ${MY_SHIFTS_URL}`,
    html: `
      <p>${greeting}</p>
      <p><strong>${acceptorName}</strong> is covering your shift:</p>
      <p><strong>${gaveAwayLine}</strong></p>
      <p><a href="${MY_SHIFTS_URL}">View your shifts</a></p>
    `,
    context: "notifySwapAccepted(cover)",
  });
}

/**
 * Fan out an announcement to a list of recipients. Each recipient gets a
 * personalised greeting; the body is the announcement text as-typed
 * (newlines preserved in the text part, wrapped in <p> for HTML).
 *
 * Returns the count of recipients we actually attempted to send to —
 * Resend hiccups during a per-recipient call are swallowed by safeSend
 * but each attempt still counts toward the total recorded in
 * sc_announcements.emailed_recipient_count.
 */
export async function notifyAnnouncementPosted(opts: {
  recipients: Array<{ email: string; name: string | null }>;
  postedBy: { name: string | null; email: string };
  tenantName: string;
  title: string;
  body: string;
}): Promise<number> {
  if (opts.recipients.length === 0) return 0;
  const senderName = displayName(opts.postedBy.name, opts.postedBy.email);
  const subject = `${opts.tenantName} · ${opts.title}`;
  const bodyHtml = opts.body
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replace(/\n/g, "<br/>")}</p>`)
    .join("");

  let sent = 0;
  for (const r of opts.recipients) {
    const greeting = `Hi ${displayName(r.name, r.email).split(" ")[0]},`;
    await safeSend({
      to: r.email,
      subject,
      text:
        `${greeting}\n\n${senderName} posted an announcement in ${opts.tenantName}:\n\n` +
        `${opts.title}\n\n${opts.body}\n\n` +
        `Read on ShiftCraft: ${ANNOUNCEMENTS_URL}`,
      html: `
        <p>${greeting}</p>
        <p><strong>${senderName}</strong> posted an announcement in <strong>${opts.tenantName}</strong>:</p>
        <h3 style="margin:1em 0 0.5em">${opts.title}</h3>
        ${bodyHtml}
        <p><a href="${ANNOUNCEMENTS_URL}">Read on ShiftCraft</a></p>
      `,
      context: `notifyAnnouncementPosted to ${r.email}`,
    });
    sent += 1;
  }
  return sent;
}

export async function sendDocumentExpiryDigest(opts: {
  to: Array<{ email: string; name: string | null }>;
  tenantName: string;
  total: number;
  /** Plaintext summary from summariseExpiry — already formatted. */
  summary: string;
}): Promise<void> {
  if (opts.to.length === 0) return;
  const DOCS_URL = `${APP_URL}/app/admin/documents-expiring`;
  const subject = `${opts.total} document${opts.total === 1 ? "" : "s"} expiring · ${opts.tenantName}`;
  const summaryHtml = opts.summary
    .split("\n")
    .map((l) => l.replace(/^  /, "&nbsp;&nbsp;"))
    .join("<br />");
  for (const r of opts.to) {
    const greeting = `Hi ${displayName(r.name, r.email).split(" ")[0]},`;
    await safeSend({
      to: r.email,
      subject,
      text:
        `${greeting}\n\n${opts.total} document${opts.total === 1 ? "" : "s"} ` +
        `with an upcoming or passed expiry in ${opts.tenantName}.\n\n${opts.summary}\n\n` +
        `Review: ${DOCS_URL}`,
      html: `
        <p>${greeting}</p>
        <p>${opts.total} document${opts.total === 1 ? "" : "s"} with an upcoming or passed expiry in <strong>${opts.tenantName}</strong>.</p>
        <p style="font-family: ui-monospace, SFMono-Regular, monospace; font-size: 13px; white-space: pre-wrap">${summaryHtml}</p>
        <p><a href="${DOCS_URL}">Review on ShiftCraft</a></p>
      `,
      context: `sendDocumentExpiryDigest to ${r.email}`,
    });
  }
}

export async function notifySwapDeclined(opts: {
  to: { email: string; name: string | null };
  decliner: { name: string | null; email: string };
  giveaway: { startsAt: Date; endsAt: Date; role: string; locationName: string | null };
}): Promise<void> {
  const greeting = `Hi ${displayName(opts.to.name, opts.to.email).split(" ")[0]},`;
  const declinerName = displayName(opts.decliner.name, opts.decliner.email);
  const giveawayLine = fmtShift(opts.giveaway);
  await safeSend({
    to: opts.to.email,
    subject: `${declinerName} declined your request`,
    text:
      `${greeting}\n\n${declinerName} declined your request for the shift:\n\n  ${giveawayLine}\n\n` +
      `You can ask someone else from ShiftCraft: ${MY_SHIFTS_URL}`,
    html: `
      <p>${greeting}</p>
      <p><strong>${declinerName}</strong> declined your request for the shift:</p>
      <p><strong>${giveawayLine}</strong></p>
      <p>You can ask someone else from <a href="${MY_SHIFTS_URL}">ShiftCraft</a>.</p>
    `,
    context: "notifySwapDeclined",
  });
}
