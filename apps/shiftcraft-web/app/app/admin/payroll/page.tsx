import { redirect } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import {
  forTenant,
  scEmployees,
  scXeroEarningsMapping,
  scXeroEmployeeLinks,
} from "@tracey/db";
import { currentMembership } from "~/lib/auth/current";
import { isAdmin as isOwnerLevel } from "~/lib/roles";
import { Button } from "~/components/ui/button";
import {
  isXeroConfigured,
  listAvailableOrgs,
  listEarningsRates,
  listPayRuns,
  listXeroEmployees,
  loadConnection,
} from "~/lib/payroll/xero";
import {
  PAYROLL_CATEGORIES,
  PAYROLL_CATEGORY_LABEL,
} from "~/lib/payroll/categories";
import {
  autoLinkEmployeesAction,
  autoMapEarningsAction,
  disconnectAction,
  linkEmployeeAction,
  saveMappingAction,
  startConnectAction,
  switchXeroOrgAction,
} from "./actions";
import { ExportToXeroForm, ReadbackForm } from "./_export-form";
import { PayRunPicker } from "./_payrun-picker";
import { InfoPopover } from "~/components/InfoPopover";

export const metadata = { title: "Payroll · ShiftCraft" };
export const dynamic = "force-dynamic";

export default async function PayrollAdminPage({
  searchParams,
}: {
  searchParams: Promise<{
    connected?: string;
    xero_error?: string;
    automapped?: string;
    ambiguous?: string;
    autolinked?: string;
    nomatch?: string;
  }>;
}) {
  const membership = await currentMembership();
  if (!membership) redirect("/app");
  if (!isOwnerLevel(membership.role)) redirect("/app");
  const tenantId = membership.tenant.id;
  const {
    connected,
    xero_error: xeroError,
    automapped,
    ambiguous,
    autolinked,
    nomatch,
  } = await searchParams;

  if (!isXeroConfigured()) {
    return (
      <div className="mx-auto max-w-3xl space-y-6 px-6 py-10">
        <h1 className="flex items-center gap-1.5 font-display text-[28px] font-semibold tracking-[-0.02em] text-ink">
          Payroll
          <InfoPopover label="About payroll integration">
            <p>
              Once configured, this screen lets you connect a Xero org,
              map ShiftCraft pay categories to Xero earnings rates, link
              each ShiftCraft employee to a Xero employee, and push
              approved timesheets to Xero for finalisation.
            </p>
          </InfoPopover>
        </h1>
        <section className="rounded-[var(--r-lg)] border border-[color-mix(in_srgb,var(--warn)_45%,transparent)] bg-[color-mix(in_srgb,var(--warn)_10%,transparent)] p-6">
          <h2 className="text-sm font-semibold">Xero is not configured</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            The server is missing one or more of{" "}
            <code className="rounded bg-muted px-1 font-mono">
              XERO_CLIENT_ID
            </code>
            ,{" "}
            <code className="rounded bg-muted px-1 font-mono">
              XERO_CLIENT_SECRET
            </code>
            , and{" "}
            <code className="rounded bg-muted px-1 font-mono">
              XERO_REDIRECT_URI
            </code>
            . Register an app at{" "}
            <a
              href="https://developer.xero.com/app/manage"
              className="underline"
            >
              developer.xero.com
            </a>{" "}
            and set the three env vars in Render before connecting.
          </p>
        </section>
      </div>
    );
  }

  const connection = await loadConnection(tenantId);

  // The Xero side of the mapping table — pulled fresh on every page
  // render so newly added earnings rates show up without a manual
  // refresh. If the token expired or refresh fails, fall back to an
  // empty list and surface the error to the operator.
  let earningsRates: Awaited<ReturnType<typeof listEarningsRates>> = [];
  let xeroEmployees: Awaited<ReturnType<typeof listXeroEmployees>> = [];
  let availableOrgs: Awaited<ReturnType<typeof listAvailableOrgs>> = [];
  let payRuns: Awaited<ReturnType<typeof listPayRuns>> = [];
  let listError: string | null = null;
  if (connection) {
    try {
      [earningsRates, xeroEmployees, availableOrgs, payRuns] = await Promise.all([
        listEarningsRates(tenantId),
        listXeroEmployees(tenantId),
        listAvailableOrgs(tenantId),
        listPayRuns(tenantId),
      ]);
    } catch (err) {
      // Surface the real Xero error — the xero-node SDK throws non-Error
      // objects (HTTP error shapes), so the old `instanceof Error` check fell
      // through to a useless generic message. Log the raw error to the server
      // and extract status + body for the operator-facing banner.
      console.error("[payroll] Xero read failed:", err);
      const e = err as {
        statusCode?: number;
        response?: { statusCode?: number; body?: unknown };
        body?: unknown;
        message?: string;
      };
      const status = e.statusCode ?? e.response?.statusCode;
      const bodyRaw = e.response?.body ?? e.body;
      let bodyStr = "";
      try {
        bodyStr =
          typeof bodyRaw === "string"
            ? bodyRaw
            : bodyRaw
              ? JSON.stringify(bodyRaw)
              : "";
      } catch {
        bodyStr = "";
      }
      const detail =
        [
          status ? `HTTP ${status}` : null,
          bodyStr || e.message || (err instanceof Error ? err.message : ""),
        ]
          .filter(Boolean)
          .join(" — ")
          .slice(0, 400) || "unknown error";
      listError = `Failed to read from Xero: ${detail}`;
    }
  }

  const [mappings, employees, links] = await Promise.all([
    forTenant(tenantId).run((tx) =>
      tx
        .select()
        .from(scXeroEarningsMapping)
        .where(eq(scXeroEarningsMapping.traceyTenantId, tenantId)),
    ),
    forTenant(tenantId).run((tx) =>
      tx
        .select({
          id: scEmployees.id,
          fullName: scEmployees.fullName,
          email: scEmployees.email,
        })
        .from(scEmployees)
        .where(eq(scEmployees.traceyTenantId, tenantId))
        .orderBy(asc(scEmployees.fullName)),
    ),
    forTenant(tenantId).run((tx) =>
      tx
        .select()
        .from(scXeroEmployeeLinks)
        .where(eq(scXeroEmployeeLinks.traceyTenantId, tenantId)),
    ),
  ]);

  const mappingByCategory = new Map(mappings.map((m) => [m.category, m]));
  const linkByEmployeeId = new Map(links.map((l) => [l.scEmployeeId, l]));

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-6 py-10">
      <div>
        <h1 className="flex items-center gap-1.5 font-display text-[28px] font-semibold tracking-[-0.02em] text-ink">
          Payroll
          <InfoPopover label="About payroll integration">
            <p>
              Connect a Xero org once; map ShiftCraft pay categories
              (ordinary / overtime / penalty_sat / penalty_sun /
              penalty_ph / allowance) to your Xero earnings rates; link
              each employee to a Xero employee.
            </p>
            <p className="mt-1">
              Pushing a week sends <strong>APPROVED</strong> timesheets
              via the Xero Payroll AU API. Xero finalises the pay run;
              read back the totals via the read-back form to surface
              actual gross/net on Reports.
            </p>
          </InfoPopover>
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Push approved timesheets to your Xero Payroll AU org. Xero
          finalises the pay run, calculates tax/super, and produces
          payslips. ShiftCraft never calculates pay totals itself —
          we hand off hours per category and read back the result.
        </p>
      </div>

      {connected === "1" && (
        <div className="rounded-[var(--r-sm)] border border-[color-mix(in_srgb,var(--live)_45%,transparent)] bg-[color-mix(in_srgb,var(--live)_10%,transparent)] px-4 py-2 text-sm font-medium text-ink">
          Connected to Xero — map your earnings rates below before exporting.
        </div>
      )}
      {xeroError && (
        <div className="rounded-[var(--r-sm)] border border-[color-mix(in_srgb,var(--danger)_45%,transparent)] bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] px-4 py-2 text-sm font-medium text-ink">
          Xero connect failed: <span className="font-mono">{xeroError}</span>
        </div>
      )}
      {listError && connection && (
        <div className="rounded-[var(--r-sm)] border border-[color-mix(in_srgb,var(--danger)_45%,transparent)] bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] px-4 py-2 text-sm font-medium text-ink">
          Xero read failed: <span className="font-mono">{listError}</span>
        </div>
      )}

      <section className="rounded-lg border border-border bg-card p-6 shadow-sm">
        <h2 className="text-sm font-semibold">Connection</h2>
        {connection ? (
          <div className="mt-3 space-y-3">
            <div className="text-sm">
              Connected to{" "}
              <span className="font-medium">
                {connection.xeroTenantName ?? "(unnamed org)"}
              </span>{" "}
              <span className="font-mono text-xs text-muted-foreground">
                {connection.xeroTenantId.slice(0, 8)}…
              </span>
            </div>
            <div className="text-xs text-muted-foreground">
              Connected{" "}
              {connection.connectedAt.toLocaleDateString(undefined, {
                day: "numeric",
                month: "short",
                year: "numeric",
              })}
              {connection.lastUsedAt && (
                <>
                  {" "}· Last call{" "}
                  {connection.lastUsedAt.toLocaleString(undefined, {
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </>
              )}
            </div>
            {availableOrgs.length > 1 && (
              <form
                action={switchXeroOrgAction}
                className="flex flex-wrap items-center gap-2 rounded-[var(--r-sm)] border border-line bg-[var(--paper-2)] px-3 py-2"
              >
                <label
                  htmlFor="xero-org"
                  className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3"
                >
                  Active org
                </label>
                <select
                  id="xero-org"
                  name="xeroTenantId"
                  defaultValue={connection.xeroTenantId}
                  className="flex h-8 min-w-[220px] rounded-md border border-[color:var(--input)] bg-transparent px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--ring)]"
                >
                  {availableOrgs.map((o) => (
                    <option key={o.xeroTenantId} value={o.xeroTenantId}>
                      {o.xeroTenantName ?? o.xeroTenantId}
                    </option>
                  ))}
                </select>
                <Button type="submit" size="sm" variant="outline">
                  Switch org
                </Button>
                <span className="text-xs text-muted-foreground">
                  This consent covers {availableOrgs.length} orgs — exports
                  target the selected one.
                </span>
              </form>
            )}
            <form action={disconnectAction}>
              <Button
                type="submit"
                size="sm"
                variant="outline"
                className="border-destructive/40 text-destructive hover:bg-destructive/10"
              >
                Disconnect
              </Button>
            </form>
          </div>
        ) : (
          <div className="mt-3 space-y-3">
            <p className="text-sm text-muted-foreground">
              Connect your Xero org once. We&rsquo;ll request Payroll
              scopes (payruns + timesheets + employees + settings). The
              connection is per workspace; admins can disconnect at any
              time.
            </p>
            <form action={startConnectAction}>
              <Button type="submit" size="sm">
                Connect to Xero
              </Button>
            </form>
          </div>
        )}
      </section>

      {connection && (
        <section className="rounded-lg border border-border bg-card shadow-sm">
          <div className="border-b border-border px-5 py-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <h2 className="text-sm font-semibold">Earnings code mapping</h2>
              {earningsRates.length > 0 && (
                <form action={autoMapEarningsAction}>
                  <Button type="submit" variant="outline" size="sm">
                    Auto-map by name
                  </Button>
                </form>
              )}
            </div>
            {automapped !== undefined && (
              <p className="mt-2 rounded-md border border-[color-mix(in_srgb,var(--live)_45%,transparent)] bg-[color-mix(in_srgb,var(--live)_10%,transparent)] px-3 py-1.5 text-xs font-medium text-ink">
                Auto-mapped {automapped} categor
                {automapped === "1" ? "y" : "ies"} by name.
                {ambiguous && ambiguous !== "0"
                  ? ` ${ambiguous} had more than one possible rate — set those manually below.`
                  : ""}
              </p>
            )}
            <p className="mt-1 text-xs text-muted-foreground">
              Pick the Xero earnings rate each ShiftCraft category should
              feed into. The rate&rsquo;s multiplier (1.0, 1.5, 2.0, etc.)
              is configured in Xero — we send raw hours per category and
              Xero applies the multiplier.
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              <strong>Auto-map by name</strong> fills in the obvious matches
              (e.g. a Xero rate named &ldquo;Ordinary Hours&rdquo;) and skips
              anything ambiguous — review the rest below.
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              The <strong>overtime</strong> rows (Saturday / Sunday /
              public-holiday overtime) are optional. Map one only if your
              award pays OT on that day at a distinct rate — otherwise leave
              it unmapped and that overtime stays in the base penalty bucket.
            </p>
          </div>
          <ul className="divide-y divide-border">
            {PAYROLL_CATEGORIES.map((cat) => {
              const current = mappingByCategory.get(cat);
              return (
                <li
                  key={cat}
                  className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
                >
                  <div className="text-sm font-medium">
                    {PAYROLL_CATEGORY_LABEL[cat]}
                    <span className="ml-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      {cat}
                    </span>
                  </div>
                  <form
                    action={saveMappingAction}
                    className="flex items-center gap-2"
                  >
                    <input type="hidden" name="category" value={cat} />
                    <select
                      name="xeroEarningsRateId"
                      defaultValue={current?.xeroEarningsRateId ?? ""}
                      className="flex h-8 rounded-md border border-[color:var(--input)] bg-transparent px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--ring)]"
                    >
                      <option value="">— Not mapped —</option>
                      {earningsRates.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                    </select>
                    <input
                      type="hidden"
                      name="xeroEarningsRateName"
                      value=""
                    />
                    <Button type="submit" size="sm" variant="outline">
                      Save
                    </Button>
                  </form>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {connection && (
        <section className="rounded-lg border border-border bg-card p-6 shadow-sm">
          <h2 className="text-sm font-semibold">Export week to Xero</h2>
          <p className="mt-1 mb-4 text-xs text-muted-foreground">
            Builds one Xero Timesheet per linked employee for the week,
            pushed at status APPROVED. Idempotent on (tenant, week) —
            re-running replaces the previous push. The Xero admin then
            finalises the pay run in Xero.
          </p>
          <ExportToXeroForm />
        </section>
      )}

      {connection && (
        <section className="rounded-lg border border-border bg-card p-6 shadow-sm">
          <h2 className="text-sm font-semibold">Read-back finalised pay run</h2>
          <p className="mt-1 mb-4 text-xs text-muted-foreground">
            After Xero finalises a pay run, pull its totals (gross / net / tax /
            super) back into ShiftCraft. Surfaces on the Reports page.
          </p>
          <PayRunPicker payRuns={payRuns} />
          <details className="mt-4">
            <summary className="cursor-pointer text-xs text-muted-foreground hover:text-ink">
              Or read back by PayRunID manually
            </summary>
            <div className="mt-3">
              <ReadbackForm />
            </div>
          </details>
        </section>
      )}

      {connection && employees.length > 0 && (
        <section className="rounded-lg border border-border bg-card shadow-sm">
          <div className="border-b border-border px-5 py-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <h2 className="text-sm font-semibold">Employee linking</h2>
              {xeroEmployees.length > 0 && (
                <form action={autoLinkEmployeesAction}>
                  <Button type="submit" variant="outline" size="sm">
                    Auto-link by email
                  </Button>
                </form>
              )}
            </div>
            {autolinked !== undefined && (
              <p className="mt-2 rounded-md border border-[color-mix(in_srgb,var(--live)_45%,transparent)] bg-[color-mix(in_srgb,var(--live)_10%,transparent)] px-3 py-1.5 text-xs font-medium text-ink">
                Auto-linked {autolinked} employee
                {autolinked === "1" ? "" : "s"} by matching email.
                {nomatch && nomatch !== "0"
                  ? ` ${nomatch} had no Xero email match — link those manually below.`
                  : ""}
              </p>
            )}
            <p className="mt-1 text-xs text-muted-foreground">
              Match each ShiftCraft employee to the corresponding Xero
              employee. <strong>Auto-link by email</strong> matches anyone
              whose email is identical in both systems; link the rest by hand.
              Unlinked rows are skipped on export with a warning so a
              misconfigured row never blocks the rest.
            </p>
          </div>
          <ul className="divide-y divide-border">
            {employees.map((e) => {
              const link = linkByEmployeeId.get(e.id);
              return (
                <li
                  key={e.id}
                  className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
                >
                  <div>
                    <div className="text-sm font-medium">{e.fullName}</div>
                    {e.email && (
                      <div className="text-xs text-muted-foreground">
                        {e.email}
                      </div>
                    )}
                  </div>
                  <form
                    action={linkEmployeeAction}
                    className="flex items-center gap-2"
                  >
                    <input
                      type="hidden"
                      name="scEmployeeId"
                      value={e.id}
                    />
                    <select
                      name="xeroEmployeeId"
                      defaultValue={link?.xeroEmployeeId ?? ""}
                      className="flex h-8 min-w-[220px] rounded-md border border-[color:var(--input)] bg-transparent px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--ring)]"
                    >
                      <option value="">— Not linked —</option>
                      {xeroEmployees.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.firstName} {x.lastName}
                          {x.email ? ` · ${x.email}` : ""}
                        </option>
                      ))}
                    </select>
                    <input
                      type="hidden"
                      name="xeroEmployeeName"
                      value=""
                    />
                    <Button type="submit" size="sm" variant="outline">
                      Save
                    </Button>
                  </form>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
