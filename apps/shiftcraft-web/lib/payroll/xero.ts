import "server-only";
import { and, eq } from "drizzle-orm";
import { XeroClient } from "xero-node";
import {
  forTenant,
  scXeroConnections,
  type ScXeroConnection,
} from "@tracey/db";
import { decryptPii, encryptPii } from "@tracey/db/pii";

// ─── Xero adapter (AUDIT.md #5) ─────────────────────────────────────
//
// Wraps the official xero-node SDK with per-tenant token storage,
// auto-refresh, and the few Payroll AU endpoints we actually use:
// list earnings rates, list employees, create timesheets, read pay
// run. Token refresh happens transparently on every getClient() call
// when the access token is within ~60s of expiry.
//
// Hard rule from AUDIT.md: ShiftCraft never calculates tax/super/
// payslips. We push hours; Xero owns finals.
//
// Env vars (set in Render before first connect):
//   XERO_CLIENT_ID       — from developer.xero.com app registration
//   XERO_CLIENT_SECRET   — same
//   XERO_REDIRECT_URI    — full URL to /api/payroll/xero/callback
//
// Optional:
//   XERO_SCOPES          — defaults to "openid email payroll.payruns
//                          payroll.timesheets payroll.employees
//                          payroll.settings offline_access"

const CLIENT_ID = process.env.XERO_CLIENT_ID;
const CLIENT_SECRET = process.env.XERO_CLIENT_SECRET;
const REDIRECT_URI = process.env.XERO_REDIRECT_URI;
const DEFAULT_SCOPES = [
  "openid",
  "email",
  "profile",
  "payroll.payruns",
  "payroll.timesheets",
  "payroll.employees",
  "payroll.settings",
  "offline_access",
];
const SCOPES = (process.env.XERO_SCOPES?.split(/\s+/).filter(Boolean) ??
  DEFAULT_SCOPES) as string[];

export function isXeroConfigured(): boolean {
  return !!(CLIENT_ID && CLIENT_SECRET && REDIRECT_URI);
}

export function getXeroScopes(): readonly string[] {
  return SCOPES;
}

function requireConfigured(): { clientId: string; clientSecret: string; redirectUri: string } {
  if (!CLIENT_ID || !CLIENT_SECRET || !REDIRECT_URI) {
    throw new Error(
      "Xero is not configured. Set XERO_CLIENT_ID, XERO_CLIENT_SECRET, XERO_REDIRECT_URI.",
    );
  }
  return {
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    redirectUri: REDIRECT_URI,
  };
}

// ─── OAuth: consent URL + callback exchange ─────────────────────────

export async function buildConsentUrl(state: string): Promise<string> {
  const cfg = requireConfigured();
  const client = new XeroClient({
    clientId: cfg.clientId,
    clientSecret: cfg.clientSecret,
    redirectUris: [cfg.redirectUri],
    scopes: SCOPES,
    state,
  });
  await client.initialize();
  return client.buildConsentUrl();
}

export interface XeroExchangeResult {
  xeroTenantId: string;
  xeroTenantName: string | null;
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: Date;
  scope: string;
}

export async function exchangeAuthCode(
  callbackUrl: string,
  state?: string,
): Promise<XeroExchangeResult> {
  const cfg = requireConfigured();
  // `state` MUST be passed: xero-node's apiCallback validates the returned
  // state against `this.config.state`, and openid-client throws
  // "checks.state argument is missing" if we leave it undefined while Xero
  // echoes one back. The caller (the callback route) has already matched this
  // value against the state cookie.
  const client = new XeroClient({
    clientId: cfg.clientId,
    clientSecret: cfg.clientSecret,
    redirectUris: [cfg.redirectUri],
    scopes: SCOPES,
    state,
  });
  await client.initialize();
  const tokenSet = await client.apiCallback(callbackUrl);
  const tenants = await client.updateTenants(false);
  if (!tokenSet.access_token || !tokenSet.refresh_token) {
    throw new Error("Xero returned an incomplete token set.");
  }
  if (tenants.length === 0) {
    throw new Error(
      "Xero authorisation succeeded but no organisations are connected.",
    );
  }
  // First tenant the user picked. For multi-org users we currently
  // grab their first; a future slice can expose a chooser.
  const t = tenants[0];
  const expiresAt = tokenSet.expires_at
    ? new Date(tokenSet.expires_at * 1000)
    : new Date(Date.now() + 1800 * 1000); // fallback: 30min
  return {
    xeroTenantId: String(t.tenantId),
    xeroTenantName: t.tenantName ? String(t.tenantName) : null,
    accessToken: tokenSet.access_token,
    refreshToken: tokenSet.refresh_token,
    accessTokenExpiresAt: expiresAt,
    scope: tokenSet.scope ?? SCOPES.join(" "),
  };
}

// ─── Persistence helpers ────────────────────────────────────────────

export async function saveConnection(
  tenantId: string,
  userId: string,
  result: XeroExchangeResult,
): Promise<void> {
  const accessTokenEnc = encryptPii(result.accessToken);
  const refreshTokenEnc = encryptPii(result.refreshToken);
  if (!accessTokenEnc || !refreshTokenEnc) {
    throw new Error("Token encryption failed.");
  }
  // null → undefined for Drizzle's nullable-column insert types.
  const xeroTenantName = result.xeroTenantName ?? undefined;
  await forTenant(tenantId).run((tx) =>
    tx
      .insert(scXeroConnections)
      .values({
        traceyTenantId: tenantId,
        xeroTenantId: result.xeroTenantId,
        xeroTenantName,
        accessTokenEnc,
        refreshTokenEnc,
        accessTokenExpiresAt: result.accessTokenExpiresAt,
        scopes: result.scope,
        connectedByUserId: userId,
        lastUsedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [scXeroConnections.traceyTenantId],
        set: {
          xeroTenantId: result.xeroTenantId,
          xeroTenantName,
          accessTokenEnc,
          refreshTokenEnc,
          accessTokenExpiresAt: result.accessTokenExpiresAt,
          scopes: result.scope,
          connectedByUserId: userId,
          lastUsedAt: new Date(),
          updatedAt: new Date(),
        },
      }),
  );
}

export async function loadConnection(
  tenantId: string,
): Promise<ScXeroConnection | null> {
  const [row] = await forTenant(tenantId).run((tx) =>
    tx
      .select()
      .from(scXeroConnections)
      .where(eq(scXeroConnections.traceyTenantId, tenantId))
      .limit(1),
  );
  return row ?? null;
}

export async function deleteConnection(tenantId: string): Promise<void> {
  await forTenant(tenantId).run((tx) =>
    tx
      .delete(scXeroConnections)
      .where(eq(scXeroConnections.traceyTenantId, tenantId)),
  );
}

// ─── Multi-org support ──────────────────────────────────────────────
//
// A single Xero consent can cover several organisations. We persist
// one "active" org per workspace (scXeroConnections.xeroTenantId), but
// the stored token can address any org the user authorised. These two
// helpers back the org chooser on /app/admin/payroll: list everything
// the token can reach, and switch which one this workspace targets.

export interface XeroOrgSummary {
  xeroTenantId: string;
  xeroTenantName: string | null;
}

export async function listAvailableOrgs(
  tenantId: string,
): Promise<XeroOrgSummary[]> {
  const ctx = await getClientForTenant(tenantId);
  if (!ctx) return [];
  // updateTenants(false) re-reads Xero's /connections for the current
  // token set without pulling full org details — cheap, and reflects
  // orgs added/removed since first consent.
  const tenants = await ctx.client.updateTenants(false);
  return tenants
    .filter((t) => t.tenantId)
    .map((t) => ({
      xeroTenantId: String(t.tenantId),
      xeroTenantName: t.tenantName ? String(t.tenantName) : null,
    }));
}

export async function setActiveOrg(
  tenantId: string,
  xeroTenantId: string,
  xeroTenantName: string | null,
): Promise<void> {
  await forTenant(tenantId).run((tx) =>
    tx
      .update(scXeroConnections)
      .set({
        xeroTenantId,
        xeroTenantName: xeroTenantName ?? undefined,
        updatedAt: new Date(),
      })
      .where(eq(scXeroConnections.traceyTenantId, tenantId)),
  );
}

// ─── Client cache + auto-refresh ────────────────────────────────────
//
// getClient builds an XeroClient with the stored token set already
// loaded. If the access token expires within 60s, refresh first and
// persist the new tokens before returning.

const REFRESH_WINDOW_MS = 60 * 1000;

export async function getClientForTenant(
  tenantId: string,
): Promise<{ client: XeroClient; xeroTenantId: string } | null> {
  const cfg = requireConfigured();
  const conn = await loadConnection(tenantId);
  if (!conn) return null;

  const accessTokenInit = decryptPii(conn.accessTokenEnc);
  const refreshTokenInit = decryptPii(conn.refreshTokenEnc);
  if (!accessTokenInit || !refreshTokenInit) {
    // Stored ciphertext didn't decrypt — likely a TRACEY_PII_ENC_KEY
    // rotation without re-encrypting the row. Treat as not-connected
    // so the admin reconnects fresh.
    return null;
  }
  let accessToken: string = accessTokenInit;
  let refreshToken: string = refreshTokenInit;
  let expiresAt = conn.accessTokenExpiresAt;

  if (expiresAt.getTime() - Date.now() <= REFRESH_WINDOW_MS) {
    const refresher = new XeroClient({
      clientId: cfg.clientId,
      clientSecret: cfg.clientSecret,
      redirectUris: [cfg.redirectUri],
      scopes: SCOPES,
    });
    await refresher.initialize();
    const newTokenSet = await refresher.refreshWithRefreshToken(
      cfg.clientId,
      cfg.clientSecret,
      refreshToken,
    );
    if (!newTokenSet.access_token || !newTokenSet.refresh_token) {
      throw new Error("Token refresh returned an incomplete set.");
    }
    accessToken = newTokenSet.access_token;
    refreshToken = newTokenSet.refresh_token;
    expiresAt = newTokenSet.expires_at
      ? new Date(newTokenSet.expires_at * 1000)
      : new Date(Date.now() + 1800 * 1000);
    const newAccessEnc = encryptPii(accessToken);
    const newRefreshEnc = encryptPii(refreshToken);
    if (newAccessEnc && newRefreshEnc) {
      await forTenant(tenantId).run((tx) =>
        tx
          .update(scXeroConnections)
          .set({
            accessTokenEnc: newAccessEnc,
            refreshTokenEnc: newRefreshEnc,
            accessTokenExpiresAt: expiresAt,
            updatedAt: new Date(),
          })
          .where(eq(scXeroConnections.traceyTenantId, tenantId)),
      );
    }
  }

  const client = new XeroClient({
    clientId: cfg.clientId,
    clientSecret: cfg.clientSecret,
    redirectUris: [cfg.redirectUri],
    scopes: SCOPES,
  });
  await client.initialize();
  client.setTokenSet({
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_at: Math.floor(expiresAt.getTime() / 1000),
    token_type: "Bearer",
    scope: conn.scopes ?? SCOPES.join(" "),
  });

  // Touch last_used_at without blocking the caller.
  forTenant(tenantId)
    .run((tx) =>
      tx
        .update(scXeroConnections)
        .set({ lastUsedAt: new Date() })
        .where(eq(scXeroConnections.traceyTenantId, tenantId)),
    )
    .catch((err) => console.warn("[xero] lastUsedAt update failed:", err));

  return { client, xeroTenantId: conn.xeroTenantId };
}

// ─── Read-only catalogue helpers ────────────────────────────────────

export interface XeroEarningsRateSummary {
  id: string;
  name: string;
  type: string | null;
}

export async function listEarningsRates(
  tenantId: string,
): Promise<XeroEarningsRateSummary[]> {
  const ctx = await getClientForTenant(tenantId);
  if (!ctx) return [];
  const response = await ctx.client.payrollAUApi.getPayItems(ctx.xeroTenantId);
  const rates = response.body.payItems?.earningsRates ?? [];
  return rates
    .filter((r) => r.earningsRateID && r.name)
    .map((r) => ({
      id: String(r.earningsRateID),
      name: String(r.name),
      type: r.earningsType ? String(r.earningsType) : null,
    }));
}

export interface XeroEmployeeSummary {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
}

export async function listXeroEmployees(
  tenantId: string,
): Promise<XeroEmployeeSummary[]> {
  const ctx = await getClientForTenant(tenantId);
  if (!ctx) return [];
  const response = await ctx.client.payrollAUApi.getEmployees(
    ctx.xeroTenantId,
  );
  const employees = response.body.employees ?? [];
  return employees
    .filter((e) => e.employeeID)
    .map((e) => ({
      id: String(e.employeeID),
      firstName: e.firstName ?? "",
      lastName: e.lastName ?? "",
      email: e.email ? String(e.email) : null,
    }));
}

// ─── Timesheet push ─────────────────────────────────────────────────
//
// Pushes one Xero Timesheet per (employee, week) at status APPROVED.
// timesheetLines carry the per-category hours split into a 7-element
// numberOfUnits array (Monday through Sunday) so the Xero admin sees
// the day-of-week distribution.
//
// Returns the array of created Xero timesheet IDs so the caller can
// persist them in sc_xero_pay_runs.summary for later read-back.

export interface XeroTimesheetLineInput {
  earningsRateId: string;
  /** 7 numbers Mon..Sun; zeros allowed. */
  unitsByDay: number[];
}

export interface XeroTimesheetInput {
  xeroEmployeeId: string;
  startDate: string; // YYYY-MM-DD (Monday)
  endDate: string; // YYYY-MM-DD (Sunday)
  lines: XeroTimesheetLineInput[];
}

export async function pushTimesheets(
  tenantId: string,
  timesheets: XeroTimesheetInput[],
  idempotencyKey?: string,
): Promise<Array<{ employeeId: string; timesheetId: string | null; error?: string }>> {
  const ctx = await getClientForTenant(tenantId);
  if (!ctx) throw new Error("Xero is not connected for this tenant.");
  if (timesheets.length === 0) return [];

  const payload = timesheets.map((t) => ({
    employeeID: t.xeroEmployeeId,
    startDate: t.startDate,
    endDate: t.endDate,
    status: "APPROVED" as const,
    timesheetLines: t.lines.map((l) => ({
      earningsRateID: l.earningsRateId,
      numberOfUnits: l.unitsByDay,
    })),
  })) as unknown as Parameters<
    typeof ctx.client.payrollAUApi.createTimesheet
  >[1];

  const response = await ctx.client.payrollAUApi.createTimesheet(
    ctx.xeroTenantId,
    payload,
    idempotencyKey,
  );

  const created = response.body.timesheets ?? [];
  return timesheets.map((t, i) => {
    const made = created[i];
    return {
      employeeId: t.xeroEmployeeId,
      timesheetId: made?.timesheetID ? String(made.timesheetID) : null,
      error:
        made?.validationErrors && made.validationErrors.length > 0
          ? made.validationErrors.map((e) => e.message).join("; ")
          : undefined,
    };
  });
}

// ─── Pay-run read-back ──────────────────────────────────────────────
//
// Fetches a single pay run by Xero ID. Used by the read-back action
// once the Xero admin has finalised the run; we extract gross + net
// totals into sc_xero_pay_runs.summary for the reports page.

export interface XeroPayRunSummary {
  payRunId: string;
  status: string;
  wages: number | null;
  deductions: number | null;
  tax: number | null;
  super: number | null;
  netPay: number | null;
  periodStartDate: string | null;
  periodEndDate: string | null;
}

export async function fetchPayRunSummary(
  tenantId: string,
  payRunId: string,
): Promise<XeroPayRunSummary | null> {
  const ctx = await getClientForTenant(tenantId);
  if (!ctx) return null;
  const response = await ctx.client.payrollAUApi.getPayRun(
    ctx.xeroTenantId,
    payRunId,
  );
  const runs = response.body.payRuns ?? [];
  const run = runs[0];
  if (!run) return null;
  return {
    payRunId,
    status: String(run.payRunStatus ?? "UNKNOWN"),
    wages: run.wages ?? null,
    deductions: run.deductions ?? null,
    tax: run.tax ?? null,
    super: run._super ?? null,
    netPay: run.netPay ?? null,
    periodStartDate: run.payRunPeriodStartDate ?? null,
    periodEndDate: run.payRunPeriodEndDate ?? null,
  };
}
