# Illuminize

A multi-tenant alumni network for universities, colleges and schools. Each institution (a **tenant**) gets its own
branded starting page; alumni sign in with their mobile number (OTP over WhatsApp, SMS fallback), register a profile,
are approved automatically or by the institution's admins, and then use the community feed, jobs board, funding
board, batch directory and events with RSVPs. Illuminize staff onboard institutions and keep offline billing
(chargeback) records from a platform console.

| App | Stack | Path |
| --- | --- | --- |
| API | Node 22, TypeScript, Express 5, Drizzle ORM, Postgres 16, Redis | `apps/api` |
| Web (members + admins + platform console) | React 19, Vite, Tailwind v4, react-router 7, TanStack Query | `apps/web` |
| Mobile (members) | Expo SDK 58, expo-router, React Native | `apps/mobile` |
| Shared | zod schemas, DTO types, typed API client used by both apps | `packages/shared` |

## Try it

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/piyushchordia-axis/Alumini/tree/claude/illuminize-multi-tenant-platform-ho1w6e)

The fastest way to click through Illuminize is a GitHub Codespace: it starts Postgres, Redis, the API and the web app with
demo data and opens the app in your browser. **[DEMO.md](DEMO.md)** has the logins, a guided tour and how to open the
phone app with Expo Go. Developers using VS Code can open the same setup locally with **Dev Containers: Reopen in
Container** (`.devcontainer/`).

## Quick start

```bash
corepack enable                # pnpm 10 is pinned in package.json
pnpm install
docker compose up -d           # Postgres (illuminize + illuminize_test) and Redis
cp apps/api/.env.example apps/api/.env
pnpm db:migrate && pnpm db:seed
pnpm api                       # http://localhost:4000
pnpm web                       # http://localhost:5173
pnpm mobile                    # Expo dev server (set EXPO_PUBLIC_API_URL in apps/mobile/.env)
```

With the default `OTP_PROVIDER=console` the one-time code is printed in the API log and, in development, also returned
in the response so the apps show it on screen. `OTP_DEV_FIXED_CODE=123456` makes every code `123456`.

### Demo data (`pnpm db:seed`, re-runnable; `pnpm db:reset` wipes and reseeds)

| Role | Phone | Notes |
| --- | --- | --- |
| Platform admin | `+919999999999` | `/platform` console |
| Tenant admin, Demo University (`demo-university`) | `+919000000001` | members auto-approved, content published immediately |
| Tenant admin, Demo College (`demo-college`) | `+919000000002` | admin approves members **and** content; has pending members, pending posts/job/event and an open spam report |
| Tenant admin, Demo School (`demo-school`) | `+919000000003` | admin approves members, content published immediately |
| Members | `+9191000000xx` | see `apps/api/src/db/seed.ts` |

Any other phone number registers as a brand-new member.

## How it works

### Tenants and membership

- A **user** is a phone number (global). A **membership** is that user inside one tenant and carries the profile
  (name, batch year, date of birth, profession, company, designation, city/country, optional marital status, kids,
  bio, LinkedIn, interests, free-form `extra` fields) and the approval state. One person can belong to several
  institutions.
- Per-tenant **member approval mode**: `AUTO_APPROVE` or `ADMIN_APPROVAL`. Pending members see a waiting screen and
  are notified when approved or rejected (with the reason). Rejected members can update their details and re-apply;
  admins can suspend and reinstate.
- Per-tenant **content moderation mode**: `AUTO_APPROVE` or `ADMIN_APPROVAL` for posts, jobs, funding listings and
  events (like a moderated Facebook group). Comments are never held but can be removed. Tenant admins' own content is
  always published. Members can report content; admins resolve reports by removing content or dismissing them.
- Per-tenant **features** (feed, jobs, funding, events, directory) can be switched on and off, and **branding**
  (name, colours, logo, cover, tagline, welcome message) drives the landing page and the app theme.

### Billing / chargeback (offline)

Billing is settled outside the product. The platform console records a **plan** per institution (per active member,
flat fee, or free, billed monthly, quarterly or yearly; a new plan closes the previous one, and plans can be edited or
ended), computes **usage** for any period and freezes **snapshots** (with a note) for invoicing.

- Periods are calendar days in `BILLING_TIMEZONE` (default `Asia/Kolkata`).
- **Active** members used the app on at least one day of the period (`member_activity_days`, one row per member per
  day). **Approved** counts members approved by the period end and not suspended by then; **new** counts members first
  approved during the period. Re-running a past period gives the same numbers.
- The estimate is the plan's per-cycle price prorated to the period: a calendar month on a quarterly plan is a third of
  the fee, half of July is 15/31 of a monthly fee.

### Authentication

Phone + 6-digit OTP. Codes are stored hashed in Redis with a 5-minute TTL, a 60-second resend cooldown and per-phone,
per-IP and global rate limits. Each code allows 5 guesses (counted atomically before comparing) and is then discarded;
a number whose codes are discarded 3 times in an hour is locked for 15 minutes, and an IP is throttled after 30 wrong
guesses an hour. Someone guessing at your number costs you one code, not a lock-out. Successful verification issues a 15-minute
JWT access token and a 30-day rotating refresh token; sessions live in Redis so logout and revocation are immediate.

OTP delivery is pluggable (`OTP_PROVIDER`):

| Provider | What it needs |
| --- | --- |
| `console` (default) | nothing; logs the code |
| `whatsapp` | Meta WhatsApp Business Cloud API: `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, an approved *authentication* template (`WHATSAPP_TEMPLATE_NAME`, `WHATSAPP_TEMPLATE_LANG`). Falls back to SMS when configured (required in production). |
| `sms` | MSG91 OTP API: `MSG91_AUTH_KEY`, `MSG91_TEMPLATE_ID` (swap the request shape in `SmsOtpSender.ts` for another vendor) |

### Multi-tenancy

One Postgres database; every tenant-scoped table carries `tenant_id` and every repository function takes the tenant
id first. Tenant context comes from the URL (`/api/v1/t/:slug/...`, mirrored by `/t/:slug/...` in the apps); the
server validates the caller's membership on every tenant route. Platform routes live under `/api/v1/platform`.

## Repository layout

```
apps/api/src
  config/         zod-validated environment
  db/schema/      Drizzle tables, enums and the moderation_items view; db/seed.ts demo data
  middleware/     auth, tenant resolution + membership guards, validation, rate limiting, errors
  services/       approval & moderation state machines, OTP, tokens, membership, content, billing, stats
  repositories/   all SQL (Drizzle) grouped by table
  routes/         public, auth, me, tenant (member + admin), platform
  services/otp/   console / WhatsApp Cloud / MSG91 senders behind one interface
apps/api/drizzle  SQL migrations (generated + one hand-written for pg_trgm and the view)
apps/api/test     vitest unit + integration tests (real Postgres, in-memory Redis)
apps/web/src      routes/ (member app, t/admin, platform), components/, hooks/, stores/
apps/mobile/src   app/ (expo-router screens), components/, hooks/, stores/, theme/
packages/shared   constants (enums, labels, countries), zod schemas, DTO types, client/ (typed fetch client)
e2e/              Playwright smoke scripts for web, admin console and the exported mobile web build
```

## API overview

All responses use `{ data }`, cursor lists `{ data, nextCursor }`, pages `{ data, page, pageSize, total }`, errors
`{ error: { code, message, details } }` (codes in `packages/shared/src/errorCodes.ts`).

| Area | Endpoints |
| --- | --- |
| Public | `GET /tenants`, `GET /tenants/:slug`, `GET /health` |
| Auth | `POST /auth/otp/request`, `POST /auth/otp/verify`, `POST /auth/refresh`, `POST /auth/logout`, `POST /auth/logout-all` |
| Me | `GET /me`, `POST/DELETE /me/push-tokens`, `POST /me/delete` |
| Tenant `/t/:slug` | `memberships` (register, me, update), `uploads`, `directory`, `jobs` (+ `seekers`), `funding`, `posts` (+ comments, reactions), `events` (+ rsvp, attendees, cancel), `reports`, `notifications` |
| Tenant admin `/t/:slug/admin` | `dashboard`, `members` (approve/reject/suspend/reinstate/role/profile, approve-all-pending), `moderation` (approve/reject/remove/restore/pin), `reports` (resolve/dismiss), `settings`, `branding`, `audit` |
| Platform `/platform` | `tenants` (create/update/settings/admins), `tenants/:id/billing` (plans/usage/snapshots), `stats`, `users` (platform-admin toggle), `audit` |

## Development

```bash
pnpm lint          # eslint in every package (expo lint for mobile)
pnpm typecheck     # tsc in every package
pnpm test          # API unit + integration tests (needs Postgres on localhost, see apps/api/.env.test)
pnpm build         # tsup bundle for the API, Vite build for the web app
pnpm --filter @illuminize/api db:generate   # new Drizzle migration after editing the schema
```

`e2e/README.md` explains how to run the Playwright smoke scripts that walk the member, admin and platform journeys,
and how to export the Expo app for the web to exercise the mobile screens in a browser.

### Mobile

```bash
cd apps/mobile
cp .env.example .env                 # EXPO_PUBLIC_API_URL=http://10.0.2.2:4000 for the Android emulator
npx expo start                        # then press a / i, or scan with Expo Go
```

`expo-notifications`, `expo-image-picker` and `expo-secure-store` are native modules: use a development build
(`npx expo run:android` / `eas build --profile development`) rather than Expo Go for push notifications. Images and
tokens degrade gracefully on the web export.

#### Push notifications

1. Create an Expo project (`npx eas init` in `apps/mobile`, or expo.dev) and put its id in `apps/mobile/.env` as
   `EAS_PROJECT_ID`; `app.config.ts` passes it to the app. Without it the app skips push registration.
2. Optionally set `EXPO_ACCESS_TOKEN` on the API if you enabled enhanced push security in Expo.
3. Install a development build on a real device and sign in; the device token is registered with the API and removed
   again on sign-out.

Every push carries the institution slug, the notification type and its ids, so tapping one opens the right screen in
the right institution (also when the tap launches the app). The API reads Expo's send tickets and, about 15 minutes
later, the delivery receipts, and deletes tokens Expo reports as `DeviceNotRegistered`.

## Deployment notes

- `apps/api/Dockerfile` builds a production image from the repo root (`docker build -f apps/api/Dockerfile .`); it runs
  pending migrations on start. Set `NODE_ENV=production`, strong `JWT_SECRET` and `OTP_PEPPER`, `PUBLIC_BASE_URL`,
  `CORS_ORIGINS`, `PLATFORM_ADMIN_PHONES` and the OTP provider variables. Production refuses `OTP_PROVIDER=console`
  (codes would only be logged) unless `OTP_ALLOW_CONSOLE_IN_PRODUCTION=true` for a throwaway demo. Put Redis in
  persistent (AOF) mode.
- `UPLOADS_PER_TENANT_DAILY_CAP` (default 2000) limits image uploads per institution per day; `BILLING_TIMEZONE` sets the
  billing calendar.
- Uploads are stored on local disk under `UPLOAD_DIR` and served from `/uploads`; `services/storage/StorageProvider.ts`
  is the seam for S3-compatible storage.
- The web app is static: `pnpm --filter @illuminize/web build` and serve `apps/web/dist` with `VITE_API_URL` pointing
  at the API (or proxy `/api` and `/uploads`).
- CI (`.github/workflows/ci.yml`) runs lint, typecheck, the API test-suite against Postgres + Redis services, and builds.

## Known gaps / next steps

- Email/digest notifications, event reminders and chat are not included yet; they are planned with the background
  worker. Push receipt checks currently run on a timer inside the API process.
- WhatsApp delivery needs a verified Meta business account and an approved authentication template before it can be
  tested; the console sender covers development.
- Postgres enum additions need hand-written `ALTER TYPE` migrations. Migration 0005 adds a trigger that stamps
  `memberships.approved_at`.
- Phone-number changes/merges are a manual platform-admin task.
