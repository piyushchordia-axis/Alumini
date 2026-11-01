# Illuminize — notes for Claude Code

A multi-tenant alumni network: each institution (tenant) gets its own branded space; alumni sign in by phone + OTP.
pnpm + turborepo monorepo. README.md is the full product and architecture guide; this file is the working summary.

## Layout

- `apps/api`: Express 5, Drizzle ORM (Postgres 16), Redis, BullMQ, Socket.IO. Code in `src/`, migrations in `drizzle/`,
  tests in `test/`.
- `apps/web`: React 19, Vite, Tailwind v4, TanStack Query. Holds the member app, tenant admin (`routes/t/admin`) and
  platform console (`routes/platform`).
- `apps/mobile`: Expo SDK 58 with expo-router, members only. Screens are in `src/app`.
- `packages/shared`: constants and enums, zod schemas, DTO types, the typed API client (`src/client`) and realtime
  client, used by all three apps.
- `e2e/`: plain Playwright scripts for the member, admin/platform and mobile-web journeys.
- `scripts/`: `setup-local.mjs` (one-command setup), `demo.mjs` (`pnpm demo`), and their shared `lib.mjs`.

## Commands

| What | Command |
| --- | --- |
| First-time setup (any OS; starts Postgres + Redis in Docker) | `node scripts/setup-local.mjs` (`--help` for options) |
| Run the API + web app | `pnpm demo` (or `pnpm api` and `pnpm web` separately; `pnpm mobile` for Expo) |
| Lint / typecheck everything | `pnpm lint`, `pnpm typecheck` (or `pnpm turbo run lint typecheck`) |
| API tests | `pnpm test` (Postgres + Redis must run; set `REQUIRE_DB=1` and `REQUIRE_REAL_REDIS=1` so nothing silently skips) |
| One test file | `cd apps/api; pnpm exec vitest run test/integration/polls.test.ts` |
| New migration after a schema change | `pnpm --filter @illuminize/api db:generate --name short_name`, then `pnpm db:migrate` |
| Reset demo data (also clears Redis, which resets OTP rate limits) | `pnpm db:reset` |
| Run a scheduled job now | `pnpm jobs:run digest demo-university --force` (or `celebrations`) |
| e2e | `pnpm db:reset`, `pnpm demo`, then `pnpm e2e:web` / `pnpm e2e:admin`; mobile: `pnpm e2e:mobile:export`, `pnpm e2e:mobile:serve`, `pnpm e2e:mobile-web` |

Demo logins (OTP `123456` in development):
- platform admin `+919999999999`;
- tenant admins `+919000000001` (demo-university), `+919000000002` (demo-college) and `+919000000003` (demo-school);
- members `+9191000000xx`.

The development is done on Windows too: scripts must stay cross-platform. No bash, no `VAR=x cmd`, no `rm -rf` in
package.json. Use Node scripts, and `fileURLToPath` rather than `URL.pathname` for file paths.

## Conventions

- **API layering.** Routes use `route({ body, query, params }, handler)` and `ok(res, data)` from
  `apps/api/src/middleware/validate.ts`. Services are free functions over `ctx: AppContext`. Repositories take the db
  client first and hold all SQL.
- **Errors.** Throw `AppError` (`apps/api/src/lib/errors.ts`), with codes in `packages/shared/src/errorCodes.ts`.
- **Transactions.** Use `runInTransaction`/`afterCommit` (`apps/api/src/lib/transaction.ts`): jobs and realtime events
  queued inside run only after commit. ESLint rejects raw `db.transaction`.
- **Shared types.** Enums live in `packages/shared/src/constants.ts`; zod schemas and DTO types in `packages/shared`.
  The web and mobile apps call the API only through the shared client.
- **Admin and abuse-prone actions.** Admin actions call `recordAudit`. Abuse-prone routes add `rateLimit` (tests enable
  it with `RATE_LIMIT_IN_TESTS=1`).
- **Background work.** Declare a job in `src/jobs/definitions.ts`, handle it in `handlers.ts`, and add recurring work
  to `schedules.ts`. Per-institution daily or weekly work goes through the engagement tick (`tenantSlots`), using the
  institution's time zone and claiming a row in `tenant_job_runs`.
- **Outbound messages.** Use `queueMessage(s)` with a template in `services/messages/templates.ts` (priority,
  optional `load` step, secret keys). Invitations and announcements may use only `tenantOutboundChannels` (plan ∩
  configured senders).
- **Notifications.** Use `notify()`: categories and member preferences, dedupe keys, chunked bulk inserts. Links in
  emails use `WEB_APP_URL`.
- **Feature parity.** Every member-facing feature ships on **web and mobile** in the same change. Admin and platform
  consoles are web only.
- **Tests.** Integration tests use `createTestContext()` + `ctx.truncateAll()`, factories in `test/helpers`, and run
  queued jobs with `ctx.jobs.drain()`.
- **Changes.** Keep them small and focused. Run lint, typecheck and the API tests before committing.

## Gotchas (learned the hard way)

- Drizzle's `jsonb` re-parses string values ("3" becomes 3): use the `jsonValue` column type
  (`src/db/schema/helpers.ts`).
- Postgres can't use a new enum value in the same migration batch that adds it. Add values in one migration and
  reference them only from app code.
- A trigger stamps `memberships.approved_at` when a membership becomes APPROVED (and on insert).
- expo-router: `href: null` on a tab makes the screen unreachable (it redirects). Hide the tab button instead
  (`tabBarButton: () => null`).
- react-native-web ignores `accessibilityState`: use `aria-checked`/`aria-selected` so state is exposed on the web
  build.
- In development, OTP requests are rate-limited per phone and IP; `pnpm db:reset` clears them.
- Charts are hand-built SVG in `apps/web/src/components/charts`. Series colours come from the validated palette in
  `chartUtils.ts` (fixed order, colour-blind checked), never from tenant brand colours.

## Git

- Work on branch `claude/illuminize-multi-tenant-platform-ho1w6e`. `main` only has the initial commit.
- Don't open pull requests unless asked.
- Commit messages: an imperative summary line, then what changed and why.

## What's next

- **Wave 2:** messaging and groups (chat over Socket.IO), mentorship and referrals, and a business directory.
- **Wave 3:** event upgrades (tickets, reminders) and giving campaigns, on the payments layer
  (`apps/api/src/services/payments`).
- **Known follow-ups:**
  - the admin Members page scrolls sideways (~98px) on phones;
  - the Linux CI (`.github/workflows/ci.yml`) runs only on `main` and pull requests, while the Windows workflow also
    runs on `claude/**` pushes.
