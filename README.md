# Illuminize

A multi-tenant alumni network for universities, colleges and schools. Each institution (a **tenant**) gets its own
branded starting page; alumni sign in with their mobile number (OTP over WhatsApp, SMS fallback), register a profile,
are approved automatically or by the institution's admins, and then use the community. Illuminize staff onboard
institutions and keep offline billing (chargeback) records from a platform console.

- **Members** (web and phone app): a community feed with polls and announcements, a jobs board with referral requests,
  a funding board, a business directory, the batch directory, events with RSVPs, birthdays and anniversaries, a weekly
  digest, and private contact: direct messages (each starting as a request), group chats and mentorship.
- **Institution admins** (web): member approval, content moderation and reports, chat reports with an audited view,
  feature switches and branding, profile questions, invitations, announcements, analytics and CSV exports.
- **Illuminize staff** (web): onboarding, billing plans and usage, a comparison of institutions for chargeback, and the
  chat reports escalated to them.

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
| Tenant admin, Demo University (`demo-university`) | `+919000000001` | members auto-approved, content published immediately; an open chat report and a reported business listing |
| Tenant admin, Demo College (`demo-college`) | `+919000000002` | admin approves members **and** content; has pending members, pending posts/job/event/business listing and an open spam report |
| Tenant admin, Demo School (`demo-school`) | `+919000000003` | admin approves members, content published immediately; messaging, groups and mentorship start off, as at any school |
| Members | `+9191000000xx` | see `apps/api/src/db/seed.ts` |
| Current pupil, Demo School | `+919100000026` | Naina Sen, batch two years from now: never sees messages, groups, mentors or referrals |
| Generated members | `+91931…`, `+91932…`, `+91933…` | 110 extra alumni across the three institutions, approved over the last six months |

Any other phone number registers as a brand-new member.

The seed also builds history relative to today (`apps/api/src/db/seedDemoHistory.ts`), so the analytics and engagement
features have something to show: 26 weeks of activity and posts, profile questions with answers, invitations in every
state, a poll, a pinned announcement, a birthday (Meera) and a membership anniversary (Rahul) today, and confirmed
emails for Rahul, Priya and Sneha. Demo University's plan includes WhatsApp, SMS and email at per-message rates
(logged to the API console in development). Each part is skipped when it already exists, so re-running is safe.

Last, `seedConnections` adds the Wave 2 data, mostly in Demo University. Each part has its own check, so an older
database, once migrated, gets it from the next `pnpm db:seed`.

| What | Seeded | Sign in as |
| --- | --- | --- |
| Businesses | Six listings in Demo University, one of them ("Instant Visa Desk") reported as spam; three in Demo College, one ("Joshi Automation Services") waiting for approval | any member; the admins `+919000000001` (Reports) and `+919000000002` (Moderation) |
| Direct messages | Rahul and Priya (one unread for Priya), Sneha and the admin Ananya, Arjun and Meera, and a message request from Vikram waiting in Rahul's Requests | Rahul `+919100000001`, Priya `+919100000002` |
| Open chat report | Meera reported a threatening message from Arjun. Its text is unique, so tests can show it never leaks into moderation, reports or logs | the admin `+919000000001` |
| Groups | "London & UK alumni" (open, owned by Priya, with Rahul and two generated members) and "Batch of 2012 reunion committee" (invite-only, owned by Rahul, with Priya and a generated member, and an invitation waiting for another) | Rahul, Priya; anyone else finds the open one in Discover |
| Mentors | Rahul, Priya and two generated members offer to mentor; a request from Riya Fernandes waits for Priya; Rahul mentors Farhan Lobo, with the chat accepting opened | Priya (a request to answer), Rahul (a mentorship under way) |
| Referral jobs | Rahul's "Backend Engineer (Node.js)" and Priya's "Associate Product Manager" take referral requests; one waits for Priya; Rahul accepted one from Gaurav Chatterjee, with its chat | Priya (a request to answer), Rahul (an accepted one) |
| A current pupil | Naina Sen in Demo School (see above) | `+919100000026` |

The e2e journeys change some of this (the admin journey removes the reported message, for one), so run `pnpm db:reset`
before showing the demo.

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
- Per-tenant **content moderation mode**: `AUTO_APPROVE` or `ADMIN_APPROVAL` for posts, jobs, funding listings,
  events, business listings and groups (like a moderated Facebook group). Comments are never held but can be removed,
  and neither are chat messages, which never reach moderation at all. Tenant admins' own content is always published.
  Members can report content; admins resolve reports by removing content or dismissing them.
- Per-tenant **features** can be switched on and off (see below), and **branding** (name, colours, logo, cover,
  tagline, welcome message) drives the landing page and the app theme.
- A trigger (migration 0005) stamps `memberships.approved_at` when a membership becomes approved.

### Feature switches

Admins switch each member section on or off under **Admin → Settings**: Community feed, Jobs, Funding, Events &
meetups, Member directory, Business directory, Messaging, Groups and Mentorship. Switching one off hides it and deletes
nothing. The rules live in `packages/shared/src/lib/features.ts`.

- **Defaults by type.** Messaging, Groups and Mentorship (`SCHOOL_OFF_FEATURES`) start off for schools, because members
  can contact each other privately there, and on for universities and colleges. Everything else starts on. A school's
  admin can turn them on; the settings page says why they start off and that current pupils still can't use them.
  Retyping an institution to a school turns the three off and records which were on in the audit log.
- **Resolved maps.** `tenant_settings.features` holds only what was stored, and may lack keys. Everything reads it
  through `resolveFeatures(type, stored)`, which fills a missing key from the type's default and then applies
  prerequisites. The API sends clients the resolved map, so the apps read `features.x` with no defaults of their own.
  ESLint rejects reading a stored map directly in the API.
- **Prerequisites.** Mentorship needs Messaging (`FEATURE_PREREQUISITES`), because accepting a request opens a private
  chat. Turning Messaging off turns Mentorship off in the same save, and never fails. Asking for Mentorship while
  Messaging stays off is refused ("Mentorship needs Messaging. Turn on Messaging first."), and turning Messaging back
  on leaves Mentorship off until an admin turns it on. Open groups need only Groups, but invite-only groups need
  Messaging too, because an invite-only group of two is a private chat.
- **Referrals have no switch.** `referralsEnabled(features)` is Jobs and Messaging together, so a school starts with
  them off.
- **Changed keys only.** The settings form sends only the switches the admin changed, and the API applies them on top
  of what's stored, under a row lock (`applyFeatureChange`), so a stale tab or two admins saving at once can't undo
  each other's change.
- **Off is immediate where it matters.** Sending a message, opening a chat and chat pushes read the settings fresh,
  not from the five-minute institution cache.

### Current pupils

A school can have pupils who haven't left yet. At a school only, with the year read in the institution's time zone, a
member counts as a current pupil (`isCurrentPupil`) when their batch year is in the future, when they've entered a date
of birth and are under 18, or when they've entered none and their batch year is this year. Adding a date of birth that
shows 18 or over lifts the last rule. An admin that staff add with no batch year gets last year, so at a school they
never count.

Current pupils can't use messages, groups, mentorship or referral requests, whatever the school switches on:

- as the one acting: those routes answer `FEATURE_DISABLED` (`requireChatEligible`);
- as the one being contacted: a message, mentorship request or referral request to them answers `CONTACT_UNAVAILABLE`,
  and they can't be listed as mentors or found by group invitation search;
- as a recipient: `chatRecipients()` leaves them out, so editing a profile into pupil status stops delivery from the
  next message.

The membership DTO carries `chatEligible` and member profiles carry `canMessage` (never false because of a block,
which would give it away). Both apps hide every entry point when these are false.

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

Work that can wait (push notifications and Expo receipts, outbound messages, invitations, announcements, celebrations,
the weekly digest and chat pushes) runs on BullMQ queues in Redis: `jobs`, `messages` and `chat`. Code inside a request
queues a job; it never calls slow providers itself.

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

Invitations, announcements, the weekly digest and email confirmations go out through `queueMessage()`
(`apps/api/src/services/messages`), and Wave 3's reminders and receipts will too. Each
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
- **Announcements.** Admins can post as an announcement: pinned by default, an announcement badge (SVG icon in the
  apps), an in-app notification and push to every member, and optionally email, WhatsApp or SMS when the plan includes
  them (members can opt out of those in their notification settings, and emails carry one-click unsubscribe). The send
  runs as a background job in batches of 1000 and stops if the post is removed first. The feed's pinned strip shows
  five; further pinned posts stay in the feed with their badge.
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

Members choose per category (comments and reactions, messages, mentorship and referrals, events, announcements,
birthdays and anniversaries, and for admins admin work) between off, in-app, and in-app plus push; account notices
(approvals, moderation decisions, a removed chat message) always arrive and announcements always show in the app.

- **Messages** (`CHAT`) covers new messages, message requests and group invitations. The bell never shows chat, so its
  lowest level, in-app, means the Messages badge alone; push adds a title-only push.
- **Mentorship and referrals** (`CONNECTIONS`) covers requests to mentor someone or refer them for a job, and the answers
  to a member's own requests.
- Both show only where the member can use what's behind them (`visibleNotificationCategories`): not to a current pupil,
  and not with the features off.
- Members who aren't approved (pending, rejected or suspended) get only account notices.

They can also turn off the digest email and announcement messages. Emails carry signed unsubscribe
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

### Business directory

Members list businesses they run under **Businesses**: a name, one of 14 categories, a description, a logo, a city, a
website, and a contact email and phone. Each member may have up to five listings that an admin hasn't removed.

- Listings follow the institution's content moderation, can be reported (they go to **Admin → Reports**), and show in
  the author's My posts.
- Search covers the name and description, with category and city filters.
- Lists never carry the email or phone: only a listing's own page does, so a page of results can't be scraped for
  contacts. Contact details are typed by the author, never filled in from their account. Website and logo links must
  be `http` or `https`.
- Deleting a listing resolves its open reports in the same transaction.

### Direct messages

Members message each other one to one under **Messages**, or with **Message this member** on a profile. Chat is text
only: uploads can be read by anyone with their link, so an attachment wouldn't be private, and the message box says
so. The tables are `chat_*` (`apps/api/src/db/schema/chat.ts`) and the client is `api.chat`, because "messages"
already means outbound WhatsApp, SMS and email.

- **Message requests.** A first message to someone is a request. It waits in their **Requests** tab, where they can
  read it and accept, decline or block. The sender sees "Request sent" and can't write more until it's accepted.
  Replying accepts a request. A decline is silent: the sender may ask again 30 days after their last request, three
  times in all, and can start 20 new requests a day.
- **Blocks are invisible.** "Block member" is in each thread's **Conversation options** and on profiles, and
  **Messages → Blocked members** lifts them. The blocked member is never told. A first message to someone who blocked
  them looks sent and stays theirs alone. In an accepted thread, what they send looks normal to them and reaches only
  their own devices (stored `withheld`), and stays hidden from the blocker for good, even after an unblock. The
  requester's view of their thread and of their own messages is the same whether the request is waiting, declined or
  blocked, and tests compare the two with deep equality. The blocker can't send until they unblock. Blocking also
  withdraws or silently suppresses mentorship and referral requests between the two, and their group invitations to
  each other.
- **Ordering and retries.** Each conversation has a gapless `seq`, handed out under the conversation's row lock, and
  pages are read by `seq`, never by time. Every send carries a `clientKey`: a retry with the same key gets the original
  message back and uses no `seq`. The apps keep unsent messages in an outbox, send one at a time per thread, and offer
  Try again after 20 seconds without an answer.
- **REST writes, live reads.** Every chat write is a REST call, which brings the institution's status, membership
  checks, feature switches, rate limits and token refresh with it. The socket only carries events from server to
  client (`ClientToServerEvents` is empty). Each event goes straight from `afterCommit` to the user rooms of whoever
  `chatRecipients()` allows at that moment: delivery is at most once, and Postgres is the source of truth. When a live
  message's `seq` jumps, or after a reconnect (and again three seconds later, as the server joins rooms after
  connecting), the apps fetch what they missed (`?afterSeq=`). The shared logic (`@illuminize/shared/chat`: query keys, cache reducers, `createChatSync`) has no React
  dependency, so web and mobile run the same code.
- **Unread and the badge.** Chat writes nothing to the bell. `GET /chat/badge` returns `{ unread, requests, invites }`:
  conversations with something unread (muted ones left out), requests waiting, and group invitations, which badge
  Groups rather than Messages. A thread is marked read only while it's actually on screen.
- **Pushes.** A burst of messages is gathered for 5 seconds (30 in a group), then each recipient gets one push for the
  conversation and no more for two minutes (ten in a group), or until they read it. Pushes carry a title and nothing
  else: "New message from Priya Nair", "New message in London & UK alumni" (the group's approved name), "Priya Nair
  accepted your message request". A request says only "New message request" and a group invitation "You've been invited
  to a group", so a stranger's name never shows before they've been accepted. Pushes expire after an hour, aren't shown
  for the thread already open, and a tap opens the thread. They run on the `chat` queue with a job id per time bucket,
  because BullMQ keeps a finished job's id for a day.
- **Bodies stay in the thread.** Message text and request notes never go into pushes, bell notifications, audit
  metadata, job payloads or logs. Drizzle and Postgres copy a failed query's values into the error, so the logger's
  error serializer strips them, or a failed send could write a message into the log.

### Groups

A group is a shared chat room. Any member who can use chat creates one under **Groups**, which has **Discover**,
**My groups** and **Invitations**. Group threads open in the Messages inbox like any other.

- **Open or invite-only, for good.** Anyone can find an open group in Discover and join it, with the whole history. An
  invite-only group is visible only to its members and invitees (anyone else gets a 404, from every route including
  `POST /reports`), and new members see messages from when they join.
- **Roles.** The owner edits, invites, removes members and archives, which leaves the group read-only. Members send and
  leave, and can invite in an open group. Someone who left an open group can join again; someone removed needs a new
  invitation. Limits: 500 members, 100 waiting invitations, 20 groups owned, and 25 invitations per request.
  Invitations lapse after 30 days.
- **Invitations can't get round a decline.** Declining someone's message request or invitation hides their invitations
  for 30 days, and an invitation from someone the invitee blocked is held back. The inviter sees the same either way.
  Invitation search finds approved members who aren't current pupils; with the member directory switched off, only
  people the inviter already shares a group or an accepted chat with, so it can't stand in for the directory.
- **Moderation.** New groups follow the institution's content moderation. Members and pushes only ever see an approved
  name and description; under admin approval, an owner's edit waits for review while the room keeps running, with
  invitations paused. Rejecting withdraws the approval, so under admin approval an edit can't reopen the room without
  a review (under automatic approval it can: see Known gaps). Rejected and removed groups are frozen and hidden, and
  restoring one brings it back intact. The moderation queue shows a group's name and description only: chat messages
  never appear in `moderation_items`.
- **Delivery.** Group sends share the direct-message path, with a limit of 120 a minute per group
  (`CHAT_GROUP_BUSY`). Unread counts text messages, not lines like "joined the group". A member who blocked someone sees
  their messages as "Blocked member", with no text.
- **A new owner.** When the owner leaves, is suspended or deletes their account, the member who has been in it longest
  and can still run it takes over. A group nobody can take over is archived.

### Mentorship

- **Offering.** Under **Mentors → Be a mentor**, a member picks up to five areas from a fixed list of 12, how often they
  can meet (weekly, every two weeks, monthly or a one-off conversation), an availability note and a note to mentees.
  Mentors appear in **Find mentors**, with search and area and availability filters, and get a Mentor badge on
  directory cards.
- **Asking.** A mentee sends a request with a note (10 to 500 characters). The mentor accepts or declines under
  **Requests**. Accepting opens a private chat whose first message is the note, with one notification rather than two.
- **Ending.** Either side can end a mentorship. Its chat closes (read-only) if the mentorship opened it and no other
  accepted mentorship or referral connects the two, and they wait 30 days before either asks again.
- **Limits.** One open request per pair, three per pair in any 30 days whatever became of them, and five open per mentee.
- **Blocks stay invisible.** A request involving a block gets the same answer, is stored `suppressed`, and notifies
  nobody.
- **Stopping.** Stopping mentoring, or an admin's **Remove as mentor** on the member's admin page (audited), declines the
  requests waiting and leaves mentorships under way running.
- **Reporting.** **Report request** declines a request (its sender sees an ordinary decline) and files a chat report with
  a copy of the note.
- **Ways out.** A member who can't use mentorship any more (switched off, or a current pupil) can still read their
  requests, withdraw, end, report and stop mentoring, and Mentors stays behind More for them while they have something
  there (`GET /mentorship/summary`).
- **Notifications** (`CONNECTIONS`): `MENTORSHIP_REQUESTED` (which names nobody), `_ACCEPTED`, `_DECLINED` and `_ENDED`,
  with ids only in their data.

### Referrals

Referral requests live inside Jobs. A poster ticks **I can refer people for this job**, and members ask with **Ask for a
referral** and a note (10 to 500 characters). The poster answers on the job's page or under **Jobs → Referrals**
(Received and Sent), and accepting opens a private chat whose first message is the note. A decline is final for that job.

- **Who may ask:** an approved member who isn't a current pupil or the poster, about an approved, open, unexpired job
  that takes referrals, from a poster who is approved and not a pupil.
- **Limits:** three requests per job and requester in any state, ten waiting per requester, and 25 waiting per job.
  Requesters see no one else's requests or counts.
- **Closing a job** (or deleting, rejecting or removing it, or unticking the box) closes its waiting requests and tells
  their senders. A chat already opened stays open.
- Blocks and **Report request** work as for mentorship.
- **With Messaging off** (a school with Jobs on, say), there's nothing to tick, `canRefer` reads false, and asking or
  accepting is refused. The ways out still work: lists, withdraw, decline and report.
- **Notifications** (`CONNECTIONS`): `REFERRAL_REQUESTED` (which names nobody), `REFERRAL_ACCEPTED` and
  `REFERRAL_DECLINED`, which also tells a sender their job closed.

### Chat reports and admin access

Chat messages stay out of `CONTENT_TYPES` and `moderation_items` (a group is there only as its name and description),
because admins can read everything in that view. Instead:

- **Reporting a message.** A member picks **Report message** on someone else's message. The dialog says "Admins will
  see this message and up to 10 around it." Filing freezes that list of ids, worked out for the reporter: up to five
  either side, leaving out anything from before they joined, withheld from them, redacted for them or already removed.
  Members can't report their own messages, system lines or withheld messages. A mentorship or referral request's note
  is reported with **Report request**, which keeps a copy of the note.
- **The queue.** **Admin → Chat reports** shows who reported whom, why and when, and no text. The dashboard's **Open chat
  reports** tile and the nav item always show, even with Messaging off, because an admin may switch it off during an
  incident. Admins get a `CHAT_REPORT_FILED` notification with no text.
- **The audited view.** **View messages** is a `POST` that reads only the frozen ids and writes a `chat_report.view`
  audit row, with ids and counts only, in the same transaction (`recordAuditStrict`): if the audit row can't be
  written, no text comes back. The answer isn't cached and the page keeps it in memory only, so a refetch can't write
  a false audit row and leaving the page discards the text. 120 views an hour per admin.
- **Acting.** **Remove message** turns it into "This message was removed" for everyone in the thread and tells its
  sender "A message you sent was removed", with the admin's note in the app only. **Resolve, keep message** and
  **Dismiss** close the report. Each is audited. Suspending the sender stays on the member's page, which the report
  links to.
- **Who may see a report.** An eligible admin is an approved tenant admin who is neither the reporter nor the reported
  member. A report naming an admin is invisible to them: not in their list, tile, counts or audit log, and its id
  answers 404 like one that doesn't exist. Filing records no actor in the audit log.
- **Escalation.** A report goes to Illuminize staff when the reported member is a tenant admin, or when no other eligible
  admin exists (staff holding the admin role don't count). It's worked out when read, so it follows who is an admin
  now. Staff see escalated reports in the platform console's **Chat reports** (no text) and open them through the
  institution's own admin pages, where each view is audited with why they were allowed in. Staff reach only escalated
  reports.
- **No retaliation.** While an open chat report names a tenant admin as the reported member, that admin can't suspend
  anyone, change roles, reinstate a suspended admin, edit member profiles or remove a mentor. Every target gets the same
  answer, "This needs another admin or Illuminize staff", so it doesn't point at the reporter. Refusals are audited, and
  those actions together are limited to 60 an hour per admin, so they can't be repeated to watch for the report closing.
  Staff aren't restricted.

### Account deletion and suspension

**Deleting an account** (Profile → Delete account) runs in one transaction:

- Messages the member sent stay in other people's chats and groups, shown as from a "Deleted member". Their 1:1 threads
  go read-only. Requests waiting to or from them are declined, and their withheld messages, which nobody received or can
  review, are deleted.
- They leave every group. Groups they owned pass to the longest-standing member who can run them, or are archived.
  Invitations they sent disappear.
- Mentorship and referral requests they sent are withdrawn, those waiting for them close, and mentorships under way end,
  without notifying anyone. Accepted referrals stay accepted.
- Their business listings go, and the open reports on them are resolved. Chat reports survive with the deleted party
  left empty.
- All sessions are revoked once it commits, and their devices' push tokens are forgotten.

**Suspending a member** blocks their REST calls in that institution and stops chat delivery to them (`chatRecipients()`
leaves them out). Their live connection stays open, because they may be active in other institutions. Their chat
messages stay visible, since hiding them would punch holes in other people's threads, and the other member of a 1:1
thread can't send to them. Their posts, jobs, business listings and other content are hidden from other members. Live
groups they own pass to the longest-standing eligible member, or are archived. They drop out of Find mentors, and with
their jobs hidden nobody can ask them for a referral. Requests waiting from them drop out of the mentor's or poster's
list until they're reinstated; nothing is declined. They get only account notices.

**Suspending an institution** blocks its REST calls, and chat pushes still queued for it drop themselves.

### Live updates (Socket.IO)

The API serves Socket.IO at `/socket.io` on its own port (WebSocket transport only). Apps connect with their access
token; the server checks the session, puts each socket in its user's and session's rooms, and closes it when the token
expires (the shared client in `packages/shared/src/realtime` refreshes and reconnects) or the session is signed out.

- Events only go from server to client; every write is a REST call. Each one about an institution carries its
  `tenantSlug`.
  - `notification:new` (with the new unread count), `notification:unread` (another device read some) and
    `notification:bulk` (an announcement reached many members at once).
  - `chat:message` (a new message, to everyone who may see it and to the sender's other devices), `chat:read` (the
    member read a thread on another device; only ever to their own devices, as there are no read receipts),
    `chat:removed` (an admin removed a message), `chat:changed` (a thread changed: refetch it; it carries no content,
    which is all a request's recipient gets) and `chat:unread` (the Messages and Groups badge counts).
  - `mentorship:changed` and `referral:changed`: something in the member's mentorship or referral lists changed, so
    refetch them. No content.
  - No typing indicators or presence: they would give blocks away.
- Polling stays as a fallback, slowing to every 5 minutes while connected.
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
  middleware/     auth, tenant resolution + membership, feature and pupil guards, validation, rate limiting, errors
  services/       approval & moderation state machines, OTP, tokens, membership, content, billing, stats
  services/chat/  direct messages, groups, delivery (fanout.ts), pushes, blocks, reports and the admins' audited view
  services/mentorship/, services/referrals/   mentorship and referral requests
  repositories/   all SQL (Drizzle) grouped by table
  routes/         public, auth, me, tenant (member + admin), platform
  services/otp/   console / WhatsApp Cloud / MSG91 senders behind one interface
apps/api/drizzle  SQL migrations (generated; some hand-written parts: pg_trgm, the moderation_items view, and the
                  content_type rebuilds in 0019 and 0023)
apps/api/test     vitest unit + integration tests (real Postgres, in-memory Redis)
apps/web/src      routes/ (member app, t/admin, platform), components/ (ui, icons, feed, layout…), hooks/, stores/;
                  design tokens in index.css (Manrope + Source Sans 3, elevation ladder)
apps/mobile/src   app/ (expo-router screens: tabs under (app)/(tabs), chat and other stacked screens above them),
                  components/ (ui, icons via react-native-svg…), hooks/, stores/, theme/
packages/shared   constants (enums, labels, countries), zod schemas, DTO types, client/ (typed fetch client),
                  realtime/ (events and client), chat/ (chat cache and live sync, no React),
                  lib/ (features.ts: switches and current pupils; sections.ts: the member app's sections)
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
| Tenant `/t/:slug` | `memberships` (register, me, update, invitation), `profile-fields`, `uploads`, `directory`, `jobs` (+ `seekers`, and referral requests: `jobs/:id/referrals`, `jobs/referrals/mine`, `jobs/referrals/summary`, `jobs/referrals/:id/accept/decline/withdraw/report`), `funding`, `businesses`, `posts` (+ comments, reactions, `poll/vote`), `events` (+ rsvp, attendees, cancel), `reports`, `notifications`, `notification-prefs`, `celebrations` (today, wishes), `digest/latest`, `payments` (get, confirm) |
| Tenant chat `/t/:slug/chat` | `direct` (send a first message; `direct/:membershipId` finds a thread), `conversations` (`?inbox=MAIN\|REQUESTS`; one; `messages` with `?cursor` or `?afterSeq`; send; `read`, `mute`, `accept`, `decline`), `badge`, `blocks` (list, block, unblock), `messages/:id/report`, `groups` (list, create, `invites` for the member's own invitations; per group: get, edit or archive, `members`, `invite-candidates`, `join`, `leave`, `invites` to invite, `invites/accept`, `invites/decline`, `members/:membershipId` to remove) |
| Tenant mentorship `/t/:slug/mentorship` | `me` (get, save, stop mentoring), `summary`, `mentors` (+ one), `requests` (send, list, `accept/decline/withdraw/end/report`) |
| Tenant admin `/t/:slug/admin` | `dashboard`, `analytics`, `exports/members.csv`, `exports/activity.csv`, `members` (approve/reject/suspend/reinstate/role/profile, approve-all-pending), `mentors/:membershipId/remove`, `moderation` (approve/reject/remove/restore/pin), `reports` (resolve/dismiss), `chat-reports` (list; `view`, `resolve`, `dismiss` are POSTs), `settings`, `branding`, `profile-fields`, `invitations` (import/send/revoke), `announcements/audience`, `audit` |
| Platform `/platform` | `tenants` (create/update/settings/admins), `tenants/:id/billing` (plans/usage/snapshots), `stats`, `analytics/comparison`, `exports/comparison.csv`, `jobs/run`, `users` (platform-admin toggle), `audit`, `messages` (test send, status), `chat-reports` (escalated, no text) |

### Rate limits

Abuse-prone routes count requests in fixed windows in Redis, per member unless noted: the `rateLimit` middleware, or
`consumeRateLimit()` inside a service when the count depends on the request (one group invitation per invitee). Going
over answers 429 `RATE_LIMITED` with a retry time. Tests skip them unless `RATE_LIMIT_IN_TESTS=1`.

| Bucket | Limit | Covers |
| --- | --- | --- |
| `chat-send`, `chat-send-hour` | 60 a minute and 600 an hour | sending a message, in any thread |
| `chat-send-group` | 120 a minute per group | everyone's sends in one group (`CHAT_GROUP_BUSY`) |
| `chat-request` | 20 a day | new message requests, counted whether or not the recipient has blocked the sender |
| `chat-read` | 120 a minute | marking read, mute, accept, decline, thread lookup, invitation search |
| `chat-block` | 60 an hour | block and unblock |
| `chat-report` | 30 an hour | reporting a message or a mentorship or referral request |
| `chat-group-create` | 5 a day (and 20 groups owned) | creating a group |
| `chat-group-edit` | 30 an hour | editing or archiving a group |
| `chat-group-member` | 60 an hour | join, leave, accept or decline an invitation, remove a member |
| `chat-group-invite` | 200 invitees a day (25 per request) | group invitations |
| `business-create`, `business-edit` | 10 and 30 an hour | business listings |
| `mentor-profile` | 30 an hour | offering to mentor, editing, stopping |
| `mentorship-request`, `referral-request` | 10 an hour each | asking for mentoring or a referral |
| `connection-action` | 60 an hour | accept, decline, withdraw and end, for mentorship and referrals |
| `chat-report-view` | 120 an hour per user | an admin viewing a chat report |
| `member-admin-action` | 60 an hour per user | suspend, reinstate, role and profile changes, removing a mentor |

Older buckets include OTP requests and checks, token refresh, content creation (`content-create`, 30 an hour),
comments, poll votes, content reports, uploads, wishes, invitation imports, exports and email confirmation.

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
(`npx expo run:android`, or `npx expo run:ios` on a Mac) rather than Expo Go for push notifications. EAS Build works
too, but the repo has no `eas.json` yet: run `npx expo install expo-dev-client` and `eas build:configure` first, then
`eas build --profile development`. Images and tokens degrade gracefully on the web export.

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
- Deploy the worker together with, or before, the API: new job types (announcement fan-out, celebrations, digest, and
  the chat pushes on the `chat` queue) are queued by the API and must have a worker that knows them.
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

**Next: Wave 3.** Event upgrades (tickets, reminders) and giving campaigns, on the payments layer
(`apps/api/src/services/payments`) and the background jobs described above.

**To close before launch.**

- **Legal.** There is no privacy policy. Children's data (India's DPDP Act, going by the +91 numbers) and a retention
  period for messages and for removed message text need a lawyer's review.
- **The pupil rule trusts what members enter.** A pupil who gives a false batch year or date of birth gets through.
- **Deleting and rejoining clears blocks and a suspension.** Someone blocked or suspended can delete their account and
  sign in again with the same phone. Fixing it means keeping a hashed phone after deletion, which waits for the
  privacy policy.
- **Staff get no alert** for escalated chat reports: they appear in the platform console only.
- **Staff can change who is an admin and then read a report that change escalated.** Each staff action records why it
  was allowed, so it can be checked afterwards.
- **A blocked member's abuse is invisible to admins,** because withheld messages can't be reported.
- **Reporting a sole admin's message** stops them suspending anyone or changing roles until staff close the report, and
  staff aren't alerted.
- **A reported admin keeps some reach over the reporter:** they can still moderate the reporter's posts and see the
  reporter's other reports.
- **The retaliation rule leaks a little and has a gap.** Its refusal tells an admin, roughly, when a report about them
  opened (refusals are audited, and the actions limited to 60 an hour), and the check takes no lock, so a report filed
  during an admin's suspend or role change doesn't stop it.
- **Nothing has been checked on a real phone** beyond what the web export shows: see "Checks that need a real phone" in
  `e2e/README.md`.

**Smaller follow-ups.**

- Chat:
  - A push token stays registered when a session ends any way other than signing out on that device or everywhere;
    tokens aren't tied to sessions, so fixing it needs a schema change.
  - A send that gets no answer for 20 seconds offers Try again, but the server may still take the first attempt
    later, after messages sent since.
  - Every row of a mobile thread re-renders when the thread changes: `MessageRow` is memoised, but its actions and
    `onSelect` are new on each render.
  - After a block is lifted, the two sides can disagree until the next message: a member who replied while blocked sees
    the thread accepted, while the other still sees their own request waiting and can't write.
  - Withheld messages leave a jump in `seq` for the blocker after an unblock, which costs their app one gap fill that
    finds nothing.
  - `auth.account_deleted` is audited before the deletion's transaction, so a deletion that fails still leaves the row.
  - Deleting an account sends no `chat:changed` to the other member of each 1:1 thread, so an open thread shows the
    deleted member until it next refetches.
- Mentorship: while mentorship or messaging is off, or the mentor is a current pupil, the decline route is gated but
  report and stop aren't, so a mentee told "declined" in that state knows it came from a report or from stopping.
  Referrals let a decline through with messaging off; moving mentorship's decline outside the gate would close this.
- Groups:
  - A group approved or restored while its owner is suspended stays theirs: it's left out of Discover, with nobody to
    run it until they're reinstated.
  - Under automatic approval, an owner's edit republishes a rejected group with no admin, as an edit does for posts.
- Content and moderation:
  - Funding listings keep the flaws the business directory avoided: contact details in lists, and edits with no rate
    limit.
  - Deleting a post, job, funding listing or event leaves its open reports in the queue with no content (business
    listings resolve theirs). A report filed while a listing is being deleted can still slip in the same way.
  - `CONTENT_REMOVED` pushes include the admin's note, which chat removals keep in the app.
  - **Admin → Reports** shows only an error when another admin has just handled a report; Chat reports closes the
    dialog and refreshes the list.
  - Illuminize staff reach only escalated chat reports, even in an institution where they are genuine admins.
- Screens and navigation:
  - The admin Members status tabs can still overflow sideways on narrow phones (member rows reflow; tabs don't wrap).
  - The web app's shared Modal close and ConfirmDialog buttons are under 44px tall.
  - A mobile detail screen opened cold from a link or push seeds the list under it with the detail's params (for
    example `/businesses?id=…`), because expo-router passes them to the anchor route.
  - Some screens still read a query's error directly (`DigestPage`, for one), and the web post, event, funding and
    business pages replace the screen when a background refetch fails (`MemberProfilePage` doesn't).
  - UI follow-ups: deeper tenant theming / branding preview in admin, skeleton loaders and purposeful motion, and a
    sweep of any remaining emoji on secondary empty states (chrome and feed already use the shared SVG icon set).
- Sign-in: refresh tokens rotate with no grace period, so a refresh whose response is lost signs the member out.
- Tests: reporting a declined, withdrawn or closed mentorship or referral request's note, and the admin's view of a
  note report, are covered by the API tests only.

**Also.**

- WhatsApp delivery needs a verified Meta business account and an approved authentication template before it can be
  tested; the console sender covers development.
- Phone-number changes/merges are a manual platform-admin task.
- **Enums in migrations.** All pending migrations run in one transaction, and Postgres 16 can't use an enum value added
  by `ALTER TYPE ... ADD VALUE` in the same batch. That's fine for values only app code uses, like new
  `notification_type` values, which keep the generated `ADD VALUE` lines. A new content type is different, because the
  `moderation_items` view needs its literal: rebuild `content_type` in the migration that adds it, as 0019 (`BUSINESS`)
  and 0023 (`GROUP`) do. Copy the latest rebuild (0023 today), as an older one lacks values and arms added since. Run
  `db:generate`, delete the generated `ADD VALUE` line, then drop the view, rename the type to `content_type_old`,
  create `content_type` with every value, convert `content_reports.content_type` with
  `USING content_type::text::content_type`, drop the old type, and create the view again with every arm. Check with a
  fresh `pnpm db:reset` as well as `pnpm db:migrate` on an existing database.
