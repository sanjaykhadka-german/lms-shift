# lms-shift

A pnpm + Turbo monorepo with two Next.js 16 apps on **Supabase**, sharing a
multi-tenant database with **row-per-tenant** isolation:

- **`apps/lms-web`** (port 4000) — the Learning module: training modules, mixed
  content (PDF / audio / video / image / text / link), auto-scored quizzes, a
  completion register, WHS compliance records, AI Studio, billing, and a
  platform super-admin surface.
- **`apps/shiftcraft-web`** (port 4100) — ShiftCraft: employee shift scheduling
  (locations, shifts, assignments, time-off).

Forked from `sanjaykhadka-german/LMS`, trimmed to these two products (the
planning tool and app-hub were dropped).

## Architecture

- **Stack:** Next.js 16 (App Router, React 19) · TypeScript · Drizzle ORM over
  `postgres-js` · Tailwind · shadcn/ui.
- **Database:** Supabase Postgres. Runtime uses the **transaction pooler**
  (`:6543`, `prepare:false`); migrations use the **session/direct** connection
  (`:5432`).
- **Auth:** **Supabase Auth** (`@supabase/ssr`). `app.users` mirrors
  `auth.users` (same uuid), provisioned on first authenticated request.
- **Multi-tenancy (row-per-tenant):** every domain table carries
  `tracey_tenant_id uuid NOT NULL REFERENCES app.tenants(id)`. All tenant-scoped
  queries run through `forTenant(tenantId).run(tx => …)` (in `@tracey/db`), which
  sets the `app.tenant_id` Postgres GUC per transaction. **RLS** (`FORCE`,
  `migrations/manual/0001_enable_rls.sql`) enforces
  `tracey_tenant_id = current_setting('app.tenant_id')::uuid` as a fail-closed
  backstop — a query issued outside `forTenant().run()` returns zero rows.

```
apps/
  lms-web/          Next.js — learning module (:4000)
  shiftcraft-web/   Next.js — shift scheduling (:4100)
packages/
  db/               Drizzle schema, migrations, client, forTenant(), seed
  auth/             shared Role type + role utilities
  ui/               shared UI (shadcn/ui)
  types/            shared TypeScript types
  config/           shared tsconfig / eslint / prettier / tailwind
```

## Quick start (local)

Requires Node ≥ 20.11 and pnpm 9 (`corepack enable`).

```bash
pnpm install
cp .env.example .env        # fill in Supabase values (see below)
pnpm db:migrate             # baseline schema + RLS policies
pnpm db:seed                # seed two demo tenants + verify tenant isolation
pnpm dev                    # lms-web :4000, shiftcraft-web :4100
```

In the Supabase dashboard (Auth → URL configuration) add the redirect URLs
`http://localhost:4000/auth/callback` and `http://localhost:4100/auth/callback`.

### Required environment

See `.env.example`. Key values:

| Var | Purpose |
| --- | --- |
| `DATABASE_URL` | Supabase **transaction pooler** (`:6543`) — app runtime |
| `DIRECT_URL` | Supabase **session/direct** (`:5432`) — migrations |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase Auth (browser + server) |
| `SUPABASE_SERVICE_ROLE_KEY` | server-only admin auth ops (never exposed to the client) |
| `RESEND_API_KEY`, `STRIPE_*`, `GEMINI_*`/`CLAUDE_*` | email, billing, AI (optional in dev) |
| `PLATFORM_ADMIN_EMAILS` | comma-separated emails granted the `/platform` surface |

## Common commands

```bash
pnpm dev            # run all apps (Turbo)
pnpm build          # production build
pnpm typecheck      # tsc across all packages + apps
pnpm lint           # eslint
pnpm db:generate    # drizzle-kit generate (new migration from schema changes)
pnpm db:migrate     # apply baseline + manual RLS migration
pnpm db:seed        # seed demo tenants + assert row-per-tenant isolation
pnpm db:studio      # Drizzle Studio
pnpm db:reset       # drop app/public/drizzle (dev only; guarded for non-local)
```

## Deployment

`render.yaml` defines two web services (`lms-web` auto-deploy; `shiftcraft-web`
manual) plus two cron jobs (Stripe reconcile, WHS reminders). The database is an
external Supabase project — set `DATABASE_URL`/`DIRECT_URL` and the Supabase
keys in each service's environment. `lms-web`'s build runs `pnpm db:migrate`.
