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

## Run it on your computer (Windows, macOS, Linux)

You need **Git**, **Node.js 22 LTS** (nodejs.org; on Windows the .msi installer) and **Docker Desktop**, running. Then,
in PowerShell, Terminal or any shell:

```bash
git clone -b claude/illuminize-multi-tenant-platform-ho1w6e https://github.com/piyushchordia-axis/Alumini.git
cd Alumini
node scripts/setup-local.mjs      # once: Postgres + Redis in Docker, env files, install, migrate, demo data
pnpm demo                         # every time: API on :4000 and web app on http://localhost:5173 (Ctrl+C stops)
```

The setup script needs nothing but Node:
- It checks your tools, enables pnpm through corepack, and starts `postgres:16` and `redis:7` with Docker Compose.
- It writes `apps/api/.env` (with fresh secrets) and `apps/mobile/.env`, installs dependencies, creates the
  development and test databases, migrates them and loads the demo data.
- It's safe to run again, and keeps values you've changed.
- `pnpm demo` starts the containers itself if they're stopped (after a restart, for example).
- Sign in with any number; the code is always `123456`. The logins are below and in DEMO.md.

Options (`node scripts/setup-local.mjs --help`):

| Option | When |
| --- | --- |
| `--lan` | Testing on a phone with Expo Go on the same Wi-Fi: points the app and photo links at this computer's network address (run again after switching networks) |
| `--emulator` | Android emulator (Android Studio): the app reaches the API at `10.0.2.2` |
| `--skip-docker` | You run Postgres 16 and Redis 7 yourself (a native install, a dev container or CI) |
| `--e2e` | Also download Chromium for the end-to-end scripts |
| `POSTGRES_PORT` / `REDIS_PORT` | Ports 5432/6379 are taken; e.g. PowerShell `$env:POSTGRES_PORT="5433"` before running. Saved for next time. |

Then `pnpm mobile` starts Expo for the phone app (scan the QR code with Expo Go). `pnpm test` runs the API tests
against the same containers.

**On Windows, if something goes wrong:**
- *"pnpm is not available"*: corepack needs an administrator shell once. Run `corepack enable` in PowerShell opened
  as Administrator, or install pnpm for your user with `npm install -g pnpm@10.28.0`.
- *"A port is already in use"*: a PostgreSQL (or Redis) installed directly on Windows has 5432 (6379). Stop it in
  the Services app, or use other ports as above.
- *"Docker is installed but not running"*: start Docker Desktop and wait for "Engine running". Turn on *Start Docker
  Desktop when you sign in* so the database is there after a restart.
- *Missing files or paths too long*: clone to a short folder such as `C:\dev\Alumini` and run
  `git config --global core.longpaths true` once.
- *The phone can't reach the API*: run setup with `--lan`, and allow Node.js on private networks when Windows Firewall
  asks (or add an inbound rule for ports 4000 and 8081).
- Work from a normal Windows folder, not `\\wsl$\...`. If you also use the dev container, don't share one
  `node_modules` between the two (native modules differ); clone twice.

Line endings are fixed to LF by `.gitattributes`, whatever your Git `core.autocrlf` setting.

### Manual setup

The script runs these steps; do them by hand if you prefer:

```bash
corepack enable                # pnpm 10 is pinned in package.json
pnpm install
docker compose up -d           # Postgres (illuminize + illuminize_test) and Redis
cp apps/api/.env.example apps/api/.env      # PowerShell: Copy-Item apps/api/.env.example apps/api/.env
pnpm db:migrate
pnpm db:seed
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
| Generated members | `+91931…`, `+91932…`, `+91933…` | 110 extra alumni across the three institutions, approved over the last six months |

Any other phone number registers as a brand-new member.

The seed also builds history relative to today (`apps/api/src/db/seedDemoHistory.ts`), so the analytics and engagement
features have something to show: 26 weeks of activity and posts, profile questions with answers, invitations in every
state, a poll, a pinned announcement, a birthday (Meera) and a membership anniversary (Rahul) today, and confirmed
emails for Rahul, Priya and Sneha. Demo University's plan includes WhatsApp, SMS and email at per-message rates
(logged to the API console in development). Each part is skipped when it already exists, so re-running is safe.

## How it works

### Tenants and membership

- A **user** is a phone number (global). A **membership** is that user inside one tenant and carries the profile
  (name, batch year, date of birth, profession, company, designation, city/country, optional marital status, kids,
  bio, LinkedIn, interests, and the institution's own profile questions) and the approval state. One person can belong
  to several institutions.
- **Profile questions** are defined per institution (up to 30: text, long text, number, date, single or multiple
  choice, yes/no). Each can be required (asked at sign-up), visible to members or to admins only, editable by the
  member or set by admins, and choice questions can filter the directory (`?field=key:value`, repeatable). Values are
  validated by the same shared schema in the API, web and mobile apps.
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
- A plan also lists the **messaging channels** it includes (WhatsApp, SMS, email) and an optional per-message rate for
  each. Institutions can send invitations and announcements only on channels their plan includes *and* the server has
  configured; in-app and push are always available. Messages delivered in the period (not failed or cancelled) are
  counted per channel and added to the estimate and snapshots. System email (address confirmation, the weekly digest)
  is not limited by the plan.
- **Compare** (`/platform/compare`) shows every institution side by side for a period (members, active rate, content,
  messages per channel and the estimated charge) and downloads it as CSV for chargeback.

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

### Background jobs

Work that can wait (delivering push notifications, checking Expo receipts, and later invites, digests and reminders)
runs on a BullMQ queue in Redis. Code inside a request queues a job; it never calls slow providers itself.

- **Where workers run.** `WORKER_MODE=inline` (the default outside production, so `pnpm demo` needs nothing extra)
  runs them inside the API process. In production the default is `separate`: run `pnpm worker` locally, or
  `node dist/worker.js` from the API image, as its own process (health check on `WORKER_HEALTH_PORT`, default 4001).
- **After commit.** Jobs queued inside a transaction must use `runInTransaction()` (`apps/api/src/lib/transaction.ts`);
  they are queued only once it commits and dropped if it rolls back. ESLint rejects raw `db.transaction(...)`.
- **Adding a job.** Declare its payload in `src/jobs/definitions.ts` (with attempts and backoff), add a handler to
  `src/jobs/handlers.ts`, and for recurring work an entry in `src/jobs/schedules.ts` (synced when workers start).
- **Tests** use an in-memory queue that runs only when a test calls `ctx.jobs.drain()`. The BullMQ tests need a real
  Redis and are skipped without one (CI sets `REQUIRE_REAL_REDIS=1`).
- **Redis** must keep jobs: use `maxmemory-policy noeviction` and AOF persistence in production.

### Outbound messages (WhatsApp, SMS, email)

Invites, digests, reminders and receipts go out through `queueMessage()` (`apps/api/src/services/messages`). Each
message is stored in `outbound_messages` and sent by a background job, which tries the message type's channels in
order (for example WhatsApp, then SMS, then email), retries temporary provider errors with backoff, and records every
attempt. A sweeper re-queues messages a crash left behind.

| Channel | Provider | Settings |
| --- | --- | --- |
| WhatsApp | Meta WhatsApp Cloud API | `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`; each message type uses an approved template |
| SMS | MSG91 Flow API | `MSG91_AUTH_KEY` and `MSG91_FLOW_TEMPLATE_IDS="TYPE=flowId,…"` (DLT-registered text in India) |
| Email | Any SMTP server (SES, Zoho, Google Workspace, Resend, SendGrid) | `SMTP_URL`, `EMAIL_FROM`, optional `EMAIL_REPLY_TO`; set SPF and DKIM for the sending domain |

Outside production, channels without settings log the message instead of sending it. To check a deployment, staff can
call `POST /api/v1/platform/messages/test` with a phone and/or email and follow `GET /api/v1/platform/messages/:id`.
Message types and their per-channel templates live in `templates.ts`.

### Member email

Members can add an email address (per person, shared across institutions) under their profile. It is used only after
they open the confirmation link (`/verify-email?token=…`, confirmed with a button so link scanners can't do it); a new
address replaces the old one only once confirmed. Addresses are never shown to other members. Requests are rate-limited
per member, address, IP and globally (`EMAIL_VERIFY_GLOBAL_DAILY_CAP`). Links in emails use `WEB_APP_URL`.

### Invitations

Admins import a CSV (phone, and optionally name, batch, email and any profile-question key) from **Admin →
Invitations**; the browser parses it and sends it in chunks of 500, and each row comes back as new, updated, already a
member or invalid with a reason. Phones without a country code use the institution's country.

- Sending uses the plan's channels (WhatsApp, SMS, email), at most `INVITES_DAILY_LIMIT` per institution per day and
  one resend per invitation per day. Without paid channels the admin copies the link or shares it from their own
  WhatsApp.
- The link is `WEB_APP_URL/i/<token>`. The token only identifies the invitation: joining still needs an OTP-verified
  phone that matches. Invited members join even when self-registration is closed, are approved straight away when
  *invite auto-approve* is on (Settings), have their answers prefilled, and are never reinstated if suspended.
- WhatsApp needs an approved template per message type in `WHATSAPP_TEMPLATES` (`INVITE=name:language,…`). The invite
  template's body is `Hi {{1}}, you're invited to join the {{2}} alumni network on Illuminize.` with a URL button whose
  base is `WEB_APP_URL/i/` and variable part `{{1}}`. For SMS in India, register the link's domain with your DLT
  template (MSG91 flow ids in `MSG91_FLOW_TEMPLATE_IDS`).

### Engagement: polls, announcements, celebrations, weekly digest

- **Polls.** A post can carry a poll (2 to 6 options, single or multiple choice, optional closing time). Votes are
  anonymous; members see counts. Options are locked once anyone votes.
- **Announcements.** Admins can post as an announcement: pinned by default, a 📣 badge, an in-app notification and push
  to every member, and optionally email, WhatsApp or SMS when the plan includes them (members can opt out of those in
  their notification settings, and emails carry one-click unsubscribe). The send runs as a background job in batches
  of 1000 and stops if the post is removed first. The feed's pinned strip shows five; further pinned posts stay in the
  feed with their badge.
- **Celebrations.** A feed card lists today's birthdays (day and month only, never the year) and membership
  anniversaries (from the approval date), with *Send wishes*. The member gets one greeting, and wishes collect into one
  notification ("Asha and 23 others…"). Members can opt out of either in their profile.
- **Weekly digest.** Every Monday the top posts, new jobs and upcoming events of the past week are saved for each
  institution, shown in the app ("This week") and emailed to members with a confirmed email who haven't turned it off.
  Only ids are stored, so content removed since never appears.
- **Scheduling.** An `engagement.tick` job runs every 15 minutes and, for each institution, queues celebrations from
  09:00 and the digest from Monday 08:00 in the **institution's time zone** (Settings, default `Asia/Kolkata`). Each
  run is claimed in `tenant_job_runs`, so retries and overlapping ticks never send twice. To run one now: platform
  `POST /api/v1/platform/jobs/run {job: "celebrations" | "digest", tenantId, force}` or
  `pnpm jobs:run digest demo-university --force`.

### Notification preferences and unsubscribe

Members choose per category (comments and reactions, events, announcements, birthdays and anniversaries) between off,
in-app, and in-app plus push; account notices (approvals, moderation decisions) always arrive and announcements always
show in the app. They can also turn off the digest email and announcement messages. Emails carry signed unsubscribe
links and `List-Unsubscribe` headers (one-click, RFC 8058) handled by `POST /api/v1/unsubscribe?token=…`, no sign-in
needed. Bulk notifications are written in chunks of 1000 with dedupe keys and broadcast once per chunk.

### Analytics and exports

**Admin → Analytics** charts the last 12 weeks, 6 months or 12 months (weeks start on Monday in the institution's time
zone): new and active members per week (active means the same as for billing), posts, comments, jobs and events per
week, and who the members are (batches, cities, countries, professions, profile completeness, answers to choice
questions, invitation funnel), with each headline number compared with the period before. Every chart has a table
view. *Members CSV* exports every member with all profile answers (admin-only ones included) and confirmed email;
*Activity CSV* gives active days and content per member for the chosen period. Exports stream in batches of 1000,
start with a UTF-8 BOM so Excel reads them correctly, prefix cells starting with `= + - @` with `'` so spreadsheets
don't run them as formulas (this includes `+91…` phone numbers), and are audited and rate-limited.

### Live updates (Socket.IO)

The API serves Socket.IO at `/socket.io` on its own port (WebSocket transport only). Apps connect with their access
token; the server checks the session, puts each socket in its user's and session's rooms, and closes it when the token
expires (the shared client in `packages/shared/src/realtime` refreshes and reconnects) or the session is signed out.

- Events: `notification:new` (with the new unread count), `notification:unread` (another device read some) and
  `notification:bulk` (an announcement reached many members at once). Chat events join in Wave 2. Polling stays as a fallback, slowing to every 5 minutes while connected.
- Several API nodes share events through the Redis adapter; a separate worker publishes through Redis with the
  emitter. WebSocket-only transport means no sticky sessions are needed, but the load balancer must allow WebSocket
  upgrades and an idle timeout above 25 seconds.
- The web app reaches it through the Vite proxy in development; in production serve `/socket.io` from the API origin
  (or proxy it with WebSocket upgrade). Browser origins must be in `CORS_ORIGINS`; native apps send no origin.

### Online payments (Razorpay)

Event tickets and donations (Wave 3) take payments through a provider-neutral layer (`apps/api/src/services/payments`):

1. The feature creates a payment order. Its *purpose handler* prices it inside a transaction, then the provider order
   is created and the app gets the checkout parameters.
2. The app opens Razorpay Checkout and sends the returned payment id and signature to
   `POST /t/:slug/payments/:id/confirm`. The server verifies the signature, fetches the payment from Razorpay and checks
   it matches the order. Only a *captured* payment marks the order paid; the purpose's `onPaid` runs exactly once.
3. Razorpay webhooks (`POST /api/v1/webhooks/razorpay`, signature checked over the raw body, each event id processed
   once in the background) cover payments the app never confirmed, failures and refunds.

`PAYMENTS_PROVIDER=mock` (the default outside production) fakes the checkout so features can be built and tested without
keys: `POST /t/:slug/payments/:id/mock-checkout` returns what to confirm with. Production defaults to `disabled` and
refuses `mock`. For real payments set `PAYMENTS_PROVIDER=razorpay` with `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` and
`RAZORPAY_WEBHOOK_SECRET`, enable auto-capture, and add the webhook in the dashboard with the payment, order and refund
events (see `apps/api/.env.example`).

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
| Public | `GET /tenants`, `GET /tenants/:slug`, `GET /invites/:token`, `GET/POST /unsubscribe`, `GET /health`, `POST /webhooks/razorpay` |
| Auth | `POST /auth/otp/request`, `POST /auth/otp/verify`, `POST /auth/refresh`, `POST /auth/logout`, `POST /auth/logout-all`, `POST /auth/email/verify` |
| Me | `GET /me`, `GET/POST/DELETE /me/email`, `POST/DELETE /me/push-tokens`, `POST /me/delete` |
| Tenant `/t/:slug` | `memberships` (register, me, update, invitation), `profile-fields`, `uploads`, `directory`, `jobs` (+ `seekers`), `funding`, `posts` (+ comments, reactions, `poll/vote`), `events` (+ rsvp, attendees, cancel), `reports`, `notifications`, `notification-prefs`, `celebrations` (today, wishes), `digest/latest`, `payments` (get, confirm) |
| Tenant admin `/t/:slug/admin` | `dashboard`, `analytics`, `exports/members.csv`, `exports/activity.csv`, `members` (approve/reject/suspend/reinstate/role/profile, approve-all-pending), `moderation` (approve/reject/remove/restore/pin), `reports` (resolve/dismiss), `settings`, `branding`, `profile-fields`, `invitations` (import/send/revoke), `announcements/audience`, `audit` |
| Platform `/platform` | `tenants` (create/update/settings/admins), `tenants/:id/billing` (plans/usage/snapshots), `stats`, `analytics/comparison`, `exports/comparison.csv`, `jobs/run`, `users` (platform-admin toggle), `audit`, `messages` (test send, status) |

## Development

```bash
pnpm lint          # eslint in every package (expo lint for mobile)
pnpm typecheck     # tsc in every package
pnpm test          # API unit + integration tests (needs Postgres + Redis on localhost, see apps/api/.env.test)
pnpm build         # tsup bundle for the API, Vite build for the web app
pnpm --filter @illuminize/api db:generate   # new Drizzle migration after editing the schema
```

Integration tests skip when the test database is unreachable; set `REQUIRE_DB=1` (and `REQUIRE_REAL_REDIS=1` for the
BullMQ and Socket.IO adapter tests) to make them fail instead, as CI does. In PowerShell: `$env:REQUIRE_DB="1"`.
`CLAUDE.md` summarises the conventions for anyone (or any Claude Code session) working on the code.

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
- `WEB_APP_URL` is the web app's public origin, used for links in invitations, announcements, digests and confirmation
  emails. It defaults to `http://localhost:5173` outside production; in production it is required once any outbound
  channel is configured (otherwise the API logs a warning at start). Also: `WHATSAPP_TEMPLATES`, `INVITES_DAILY_LIMIT`,
  `EMAIL_VERIFY_GLOBAL_DAILY_CAP` (see `apps/api/.env.example`).
- Deploy the worker together with, or before, the API: new job types (announcement fan-out, celebrations, digest) are
  queued by the API and must have a worker that knows them.
- Uploads: `STORAGE_PROVIDER=local` (default) keeps images under `UPLOAD_DIR`, served from `/uploads`, which suits one
  server with a persistent disk. For anything else set `STORAGE_PROVIDER=s3` with an S3-compatible bucket (AWS S3,
  Cloudflare R2 with `S3_REGION=auto`, DigitalOcean Spaces, MinIO): `S3_BUCKET`, `S3_PUBLIC_BASE_URL` (the bucket's
  public URL or a CDN), optional `S3_ENDPOINT`/`S3_FORCE_PATH_STYLE`, and keys or the default AWS credentials. The
  bucket must be publicly readable; objects are immutable and cached for a year. `/uploads` keeps serving older local
  files after a switch. Try it locally with `docker compose --profile s3 up -d` (MinIO, see `apps/api/.env.example`).
- The web app is static: `pnpm --filter @illuminize/web build` and serve `apps/web/dist` with `VITE_API_URL` pointing
  at the API (or proxy `/api` and `/uploads`).
- CI (`.github/workflows/ci.yml`) runs lint, typecheck, the API test-suite against Postgres + Redis services, and builds.
  `.github/workflows/windows.yml` runs the one-command setup, lint, typecheck, API tests and builds on Windows.

## Known gaps / next steps

- Event reminders and chat are not included yet; they build on the background jobs described above.
- On the mobile web export, controls that still use `accessibilityState` (reactions, tabs, chips) don't expose their
  selected state, because react-native-web only emits the `aria-*` props; the Wave 1 screens use `aria-checked`.
- WhatsApp delivery needs a verified Meta business account and an approved authentication template before it can be
  tested; the console sender covers development.
- Postgres enum additions need hand-written `ALTER TYPE` migrations. Migration 0005 adds a trigger that stamps
  `memberships.approved_at`.
- Phone-number changes/merges are a manual platform-admin task.
