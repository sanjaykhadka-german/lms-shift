import { vi } from "vitest";

/**
 * Tiny in-memory fake for the bits of @tracey/db that
 * lib/billing/handle-stripe-event.ts and the health route touch.
 *
 * - `processed_stripe_events` is a Set<eventId>; insert() returns the new id
 *   on first sight and an empty array on conflict, mirroring
 *   `.onConflictDoNothing().returning()`.
 * - `tenants` is a plain object map keyed by id. update().where() applies the
 *   patch to the matched row(s) and returns the updated rows.
 *
 * We do NOT model Drizzle's where() expression tree here — instead, the fake
 * stores the most recent `where` predicate on a module-level slot, and the
 * test calls `seedTenant()` / `getTenant()` directly. This gives us call
 * coverage without re-implementing the ORM.
 */

type TenantRow = {
  id: string;
  clerkOrgId?: string;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  plan?: string;
  status?: string;
  currentPeriodEnd?: Date | null;
  seatsPurchased?: number;
  trialEndsAt?: Date;
  updatedAt?: Date;
};

const state = {
  tenants: new Map<string, TenantRow>(),
  events: new Set<string>(),
  lastWherePredicate: undefined as undefined | ((row: TenantRow) => boolean),
};

export function resetFakeDb() {
  state.tenants.clear();
  state.events.clear();
  state.lastWherePredicate = undefined;
}

export function seedTenant(row: TenantRow) {
  state.tenants.set(row.id, row);
}

export function getTenant(id: string): TenantRow | undefined {
  return state.tenants.get(id);
}

export function allTenants(): TenantRow[] {
  return Array.from(state.tenants.values());
}

export function eventsSeen(): string[] {
  return Array.from(state.events);
}

// Predicate factory used by the eq() mock so update().where() can match.
type Predicate = (row: TenantRow) => boolean;
const PRED = Symbol("pred");
function isPredicate(x: any): x is { [PRED]: Predicate } {
  return x !== null && typeof x === "object" && typeof x[PRED] === "function";
}

export const eq = (col: { __field: keyof TenantRow }, val: unknown) => ({
  [PRED]: (row: TenantRow) => row[col.__field] === val,
});

export const isNotNull = (col: { __field: keyof TenantRow }) => ({
  [PRED]: (row: TenantRow) => row[col.__field] != null,
});

export const sql = vi.fn(() => ({ __sql: true }));

const tenantsCol = {
  id: { __field: "id" as const },
  clerkOrgId: { __field: "clerkOrgId" as const },
  stripeCustomerId: { __field: "stripeCustomerId" as const },
  stripeSubscriptionId: { __field: "stripeSubscriptionId" as const },
};
const processedStripeEventsCol = { eventId: { __field: "eventId" as const } };

export const tenants = tenantsCol as any;
export const processedStripeEvents = processedStripeEventsCol as any;

function makeInsertChain(table: any, values: any) {
  const isEvents = table === processedStripeEventsCol;
  let conflicting = false;
  const chain: any = {
    onConflictDoNothing: () => {
      conflicting = true;
      return chain;
    },
    returning: async () => {
      if (isEvents) {
        const id = values.eventId;
        if (state.events.has(id)) return conflicting ? [] : [{ eventId: id }];
        state.events.add(id);
        return [{ eventId: id }];
      }
      // Tenant insert path (used by currentTenant path; not exercised here)
      const id = values.id ?? `tenant-${state.tenants.size + 1}`;
      const row: TenantRow = { ...values, id };
      if (state.tenants.has(id)) return conflicting ? [] : [row];
      state.tenants.set(id, row);
      return [row];
    },
    then: (onFulfilled: any) => chain.returning().then(onFulfilled),
  };
  return chain;
}

function makeUpdateChain(table: any, patch: any) {
  let predicate: Predicate | undefined;
  const apply = () => {
    if (table !== tenantsCol) return [] as TenantRow[];
    const matched: TenantRow[] = [];
    for (const row of state.tenants.values()) {
      if (predicate ? predicate(row) : true) {
        Object.assign(row, patch);
        matched.push(row);
      }
    }
    return matched;
  };
  const chain: any = {
    where: (expr: any) => {
      if (isPredicate(expr)) {
        predicate = expr[PRED];
        state.lastWherePredicate = predicate;
      }
      return chain;
    },
    returning: async () => apply(),
    then: (onFulfilled: any) => Promise.resolve(apply()).then(() => onFulfilled(undefined)),
  };
  return chain;
}

export const db = {
  insert: (table: any) => ({
    values: (values: any) => makeInsertChain(table, values),
  }),
  update: (table: any) => ({
    set: (patch: any) => makeUpdateChain(table, patch),
  }),
  select: () => ({
    from: () => ({
      where: () => ({
        limit: async () => [],
      }),
    }),
  }),
  execute: vi.fn(async () => [{ ok: 1 }]),
};
