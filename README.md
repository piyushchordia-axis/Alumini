# Illuminize

A multi-tenant alumni network for universities, colleges and schools. Each institution (a **tenant**) gets its own
branded starting page; alumni sign in with their mobile number (OTP over WhatsApp, SMS fallback), register a profile,
are approved automatically or by the institution's admins, and then use the community. Illuminize staff onboard
institutions and keep offline billing (chargeback) records from a platform console.

- **Members** (web and phone app): a profile with work and study history, skills and links (set up in three guided
  steps), a community feed with polls and announcements, a jobs board with structured job posts and referral requests,
  a funding board, a business directory, the batch directory, events with RSVPs, birthdays and anniversaries, a weekly
  digest, and private contact: direct messages (each starting as a request), group chats and mentorship.
- **Institution admins** (web and phone app): member approval, content moderation and reports, chat reports with an
  audited view, feature switches and branding, profile questions, invitations, announcements, analytics and CSV
  exports.
- **Illuminize staff** (web): onboarding, billing plans and usage, a comparison of institutions for chargeback, and the
  chat reports escalated to them.

| App | Stack | Path |
| --- | --- | --- |
| API | Node 22, TypeScript, Express 5, Drizzle ORM, Postgres 16, Redis | `apps/api` |
| Web (members + admins + platform console) | React 19, Vite, Tailwind v4, react-router 7, TanStack Query | `apps/web` |
| Mobile (members and institution admins) | Expo SDK 58, expo-router, React Native | `apps/mobile` |
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
| Tenant admin, Shri Gujarati Samaj (`shri-gujarati-samaj`) | `+919000000004` | type OTHER; admin approves members, content published immediately; full showcase seed (feed, jobs, events, businesses, chat, groups, mentors, referrals) |
| Samaj members (showcase) | `+919100000031`–`038` | Hetal (textiles), Ravi (product / referrals), Kiran (jewellery), Asha (job seeker / mentee), Bhavin (mentor), Nisha (diaspora); `037`–`038` pending approval |
| Members | `+9191000000xx` | see `apps/api/src/db/seed.ts` |
| Current pupil, Demo School | `+919100000026` | Naina Sen, batch two years from now: never sees messages, groups, mentors or referrals |
| Generated members | `+91931…`, `+91932…`, `+91933…`, `+91934…` | 130 extra alumni across the four institutions, approved over the last six months |

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

The seed also fills in profiles and job posts, on a fresh database (`pnpm db:reset`): on an existing one it leaves the
members, profile questions and jobs already there as they are.

- **Full profiles** for seven named members, matching their posts and listings: in Demo University Rahul
  (`+919100000001`, founder of Zylo Labs), Priya (`+919100000002`, product at Google), Vikram (`+919100000005`, an MBA
  student and the seeded job seeker) and Sneha (`+919100000006`, distributed systems, open to investing); in Demo
  College Kiran Joshi (`+919100000011`) and Neha Sharma (`+919100000012`); and in Demo School Nikhil Bose
  (`+919100000023`), whose college and MBA are studies elsewhere. Each has a headline, skills, past roles and at least
  one link, and all but Vikram say what they're open to.
- **Partial profiles** for about 60% of the generated members: some of a headline, industry, skills, the year they
  started working, past roles, a degree here, studies elsewhere, links and Open to. They come from a random stream of
  their own, so every other generated value is as it was.
- **Profile questions.** Demo University no longer asks "Department", which field of study replaces, and its waiting
  invitation for Harsh Vora prefills Hostel instead. Demo College's "Branch" and "Higher studies" became one filterable
  multiple-choice question, "Clubs and societies".
- **Rich jobs.** Rahul's "Backend Engineer (Node.js)" at Zylo Labs fills in nearly everything: Remote from Mumbai,
  Mid level, 3–6 years, four skills, two openings, "₹25–40 LPA" with the pay note "Plus ESOPs", bulleted
  Responsibilities, Requirements and Benefits, How to apply with a link, and About the company. Priya's "Associate
  Product Manager" at Google is Hybrid in London, Entry level, 1–3 years and "£55k–70k/yr". Kiran's "Robotics Intern"
  waits in Demo College's Moderation (the admin `+919000000002`), so the preview shows a "₹25,000–35,000/mo" stipend,
  "Open to freshers", three openings, an education requirement and skills including ROS2. The other jobs stay short.
- **Rich text.** The Zylo Labs business listing (bullets, a numbered list and a link) and the Mumbai coffee meetup
  (bullets, a link and an email) show how descriptions render.

The e2e journeys change some of this (the admin journey removes the reported message, for one), so run `pnpm db:reset`
before showing the demo.

## How it works

### Tenants and membership

- A **user** is a phone number (global). A **membership** is that user inside one tenant and carries the profile
  (name, batch year, photo, date of birth, profession, company, designation, city/country, headline, work and study
  history, skills, links, optional marital status and kids, bio, interests, and the institution's own profile
  questions: see **Profiles and onboarding**) and the approval state. One person can belong to several institutions.
- **Profile questions** are defined per institution (up to 30: text, long text, number, date, single or multiple
  choice, yes/no). Each can be required (asked at sign-up), visible to members or to admins only, editable by the
  member or set by admins, and choice questions can filter the directory (`?field=key:value`, repeatable). Values are
  validated by the same shared schema in the API, web and mobile apps. Degree and field of study are built into every
  profile outside schools, as **Admin → Profile fields** says, so they need no question.
- Per-tenant **member approval mode**: `AUTO_APPROVE` or `ADMIN_APPROVAL`. Pending members see a waiting screen and
  are notified when approved or rejected (with the reason). Rejected members can update their details and re-apply;
  admins can suspend and reinstate.
- Per-tenant **content moderation mode**: `AUTO_APPROVE` or `ADMIN_APPROVAL` for posts, jobs, funding listings,
  events, business listings and groups (like a moderated Facebook group). Comments are never held but can be removed,
  and neither are chat messages, which never reach moderation at all. Tenant admins' own content is always published.
  Members can report content; admins resolve reports by removing content or dismissing them.
- The **admin console** is in the web app and the phone app. On the web, the header links to it at every width, and the
  link, the sidebar and the More sheet show an amber count of what's waiting (pending members, content to review, open
  reports and chat reports). In the phone app, admins open it from More, whose row carries the same count, or from My
  profile: a stack of its own above the tabs, opening on the dashboard. Admin notices open it too: a request to join on
  the member's page, the others on the dashboard. Its pages are coming to the phone one at a time (see Known gaps);
  the members list is there, with the same status tabs and counts, search, Approve all and row actions as the web's,
  scrolling on through the pages, and so is a member's page: their facts and profile, their answers to the
  institution's questions (which admins can edit), their mentor profile (Remove as mentor), Make admin or Remove admin
  role (asked first on both apps), and their recent activity, naming who acted. So is the audit log, filtered by a
  family of actions (Members, Content, Reports and so on) or any prefix typed, kept in the address; its rows link to the
  member they're about and show their details as readable lines, never a private key such as a deleted account's phone
  hash, nor a phone number (a new institution's first admin is recorded by number). On both apps an admin's notice of
  a request to join carries Approve and Reject while the request waits (the phone asks before approving), and
  otherwise says where it stands; a refetch that shows it decided elsewhere closes an open Reject and says so. The
  notice and the list send the status they showed, so a screen left open can't overturn another admin's decision: the
  API refuses (409) and the apps say where the member stands now.
  The app opens only for an institution's members, so Illuminize staff who aren't one use its console on the web.
- Per-tenant **features** can be switched on and off (see below), and **branding** (name, colours, logo, cover,
  tagline, welcome message) drives the landing page and the apps' colours and accents (buttons, links, chosen states).
  It doesn't set the background of a member's pages: each member chooses their own (see **Appearance**).
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

Other members never see a current pupil's profile links or Open to (admins still see any that are stored, on the
member's page and in the members CSV), the forms don't ask them for either, and every save clears their Open to (see
**Profiles and onboarding**).

### Profiles and onboarding

A profile belongs to a membership, so someone in two institutions has two: the batch, the degree and admins' edits
are the institution's own, and each admin's CSV export covers only their members. **Use details from …** (below)
saves retyping. The shared rules are in `packages/shared/src/lib/profile.ts` and `schemas/membership.ts`, so both apps
and the API agree.

- **Fields.** Besides name (2 to 100 characters), batch, date of birth, what they do, company and role (120 each),
  city (80), country, bio (1000) and interests (20, of 40 characters each), a profile holds:
  - a photo (see **Photos and uploads**);
  - a **headline** of up to 120 characters on one line (runs of spaces and line breaks become one space), shown under
    the name;
  - an **industry**, from a fixed list of 24 (`INDUSTRIES`, which jobs share);
  - the **year they started working**, from which the apps show "8 years of experience" ("Started working in 2026" in
    that year), so it never goes stale;
  - up to 20 **skills** of 40 characters each;
  - their **degree** and **field of study** here (80 each);
  - up to 15 **past roles** (company and title, 120 each, with optional start and end years); the current role stays
    the company and role fields;
  - up to 10 **studies elsewhere** (institution 120, degree and field of study 80 each, and years);
  - **links**: LinkedIn, website, GitHub, Instagram and X (500 characters each);
  - **Open to**: Hiring, Collaborating and Investing. Open to work stays the job-seeker profile, and Mentor comes from
    the mentor profile: profiles and directory cards carry `isMentor` by the Mentors list's own rule, and the edit
    screen links to **Offer to mentor** for a member who can mentor and doesn't yet.
- **Years** run from 1940 to this year, judged when the input is parsed rather than when the server started; studies
  elsewhere may end up to 10 years ahead. An entry can't end before it starts.
- **Lists** travel whole in the same body as the rest of the profile and replace what's stored. The server stores past
  roles and studies newest first: by end year (or the start year when there's no end), then start year, with entries
  that have no years last.
- **Links are checked by their real hostname** (`hostUrlSchema`): LinkedIn on linkedin.com or a subdomain, GitHub on
  github.com, Instagram on instagram.com and X on x.com or twitter.com, so "https://evil.com/?linkedin.com/" no longer
  passes as LinkedIn. No link may carry a user name or password, and each is stored as the URL parser reads it
  (`URL.href`), so whatever opens it goes where the check looked: "https://linkedin.com\@evil.com" is stored as
  "https://linkedin.com/@evil.com". The forms turn a handle ("@asha" or "asha") into that site's profile address and
  put "https://" in front of "github.com/asha", as the member leaves the box and again on save; the API takes full URLs
  only. Migration 0028 cleared stored LinkedIn values a host check refuses, and profiles shown to other members leave
  out any other stored link today's rules refuse.
- **Skills** go through `normalizeSkills` (`lib/skills.ts`), on profiles and jobs alike: each is trimmed with inner
  spaces collapsed, blanks are dropped, and repeats are dropped ignoring case and full-width letters (`skillKey`),
  keeping the first spelling and the member's order. An over-long skill is an error at its place in the list, and too
  many is an error rather than a list cut short.
- **Who is asked what.** Students aren't asked the year they started working. Schools don't ask for a degree or field
  of study here: their forms hide both, every save at a school clears them, retyping an institution to a school clears
  every member's (counted in the audit log), and the members CSV leaves the two columns out. Current pupils aren't asked
  for links or Open to: the API clears their Open to on every save, whatever was sent or stored, other members never
  see their links or Open to (admins still see any that are stored, on the member's page and in the members CSV), and
  the directory's Open to filter never finds them. An input a form hides is neither checked nor sent
  (`hiddenProfileKeys`), so a value the member can't see can't block a save. A profile edit (PATCH) leaves any key it
  doesn't send as stored (null or `[]` clears it), so leaving a hidden input out loses nothing beyond the school rule
  above.
- **Profile pages.** A member's profile, My profile and the admin's member page share one layout on both apps: photo,
  name, the headline (or else the role line, such as "CEO at Zylo Labs"), batch and place, and badges (Open to work,
  Mentor, each Open to choice); then links (a website named by its host, `rel="noopener noreferrer nofollow"`), the bio
  as rich text, skills, "N years of experience · industry", a timeline with the current role first and then past roles,
  studies here (not at schools) and elsewhere, and interests. Empty parts are left out. The edit form (under the
  profile on My profile on web, **Edit profile** on mobile) has the registration steps' three sections, Basics, Work
  and About you (`#basics`, `#work`, `#about` on web; `?section=` on mobile), saved with one PATCH. Past roles and
  studies elsewhere are list editors (Add, Edit, Remove, Done), and a server error lands on its exact field, list rows
  included (`experiences.1.endYear`).

**Registration** walks through the same three sections on both apps, under a step bar: "Step 1 of 3 · Basics", then
Work and About you.

1. **Basics**: the photo, name and batch (still the first two inputs), what they do, date of birth, city and country,
   and the institution's required questions. Everything registration requires is on this step, so skipping the others
   is always safe.
2. **Work**: headline, company, role, industry, the year they started working, skills and past roles.
3. **About you**: bio, interests, degree and field of study, studies elsewhere, links and Open to, the institution's
   optional questions, a **Personal** disclosure (marital status and kids) and the sharing switches.

Each step leaves out what the member isn't asked (see "Who is asked what" above).

- **Continue** checks the step it leaves. **Skip for now** on Work puts back the values it last accepted. The last step
  has **Join the network** or **Submit for approval**, by the server's rule (an institution that approves members
  automatically, or an invitation it lets straight in), with "An admin at … will review your profile before you can
  join." under it when approval is needed. The step bar opens any step already visited.
- **Back** is on every step (left of the step's buttons on a wide web page, last on a phone). On Work and About you it
  goes to the step before, keeping the draft. On Basics it leaves for the page they came from, normally the
  institution's landing page, asking "Leave registration?" first if anything has been typed
  (`REGISTRATION_LEAVE_CONFIRM`).
- **Basics names the verified number**: "Signed in as +91 98765 43210" (`formatPhone`), with **Use a different number**
  beside it, which signs out and opens sign-in, asking first if anything has been typed (`REGISTRATION_NUMBER_CONFIRM`).
- **The landing page doesn't bounce.** Someone signed in who isn't a member of the institution (a 404 or
  `NOT_A_MEMBER`) sees its landing page with **Join …** (to registration) and the same "Signed in as" line, instead of
  being sent straight into a fresh form, which Back on Basics would only bring them back to. A member still goes into
  the app, and a member removed while in the app still lands on registration. The landing page also stops remembering
  the institution as the one to start at, as the app's guard does when a membership is refused, so Choose a different
  institution opens the list instead of coming back to it.
- **One POST at the end** (`POST /t/:slug/memberships`), so admins hear only of complete applications. A server error
  opens the earliest step holding a field it names (`profileStepOf`) and marks the field. On the web app the membership
  it returns, put in the cache, moves them on through the page's own redirect, and nothing else navigates: a second
  navigation to the app could land while the app's redirect to its first section was still being drawn, and leave an
  empty page.
- Each step starts at the top with its heading focused. Browser Back (web), Android's back button and iOS's swipe back
  go to the step before, as Back does, and on Basics they leave, asking first as Back does (web: `useBlocker`; mobile:
  expo-router's `usePreventRemove`, whose cancelled swipe arrives as a POP). While the profile is being sent they do
  nothing, so a refusal finds the draft still there; the page the profile then moves them on to, signing out and a
  forced sign-out aren't held. Android's back button with nothing under registration (opened first, or after a
  redirect replaced everything) never reaches `usePreventRemove`, as the navigator hands it straight to Android, so
  registration's own `BackHandler` answers it there, the same way. A double tap moves one step.
- **Re-applying** after a rejection prefills every step and shows the reason above each. On a first registration the
  name comes from the invitation, or else from the account.
- **The draft stays in memory only**, as it holds personal details, and survives a background refetch failing.

**Use details from another institution.** Step 1 offers "You have a profile at …" with a **Use details from …** button
(`GET /me/profile-copy?exclude=<slug>`), from the member's most recently updated approved membership at another
institution (never one waiting, rejected or suspended, nor at a suspended or archived institution).

- It brings only details that belong to the person: city and country, headline, company, role, industry, the year they
  started working, skills, past roles, bio, interests, studies elsewhere (the degree and field of study there become one
  entry named after that institution), links (checked against today's rules) and Open to. Never the batch, the
  institution's questions, the **Personal** details (marital status and kids), the phone setting or the photo.
- The date of birth comes only when that profile shows the birthday on its feed, because a new profile celebrates it
  until the member turns that off.
- It fills only inputs the member hasn't changed, skips inputs the form hides, and says what it did: "Filled in your
  city, headline, company and 6 more from Demo University. Kept what you'd entered for your country."
- **Undo** puts back only what still holds what the copy put there, and says which later changes it kept.
- It isn't offered when re-applying, or when it would add nothing.

**Profile strength** (`profileStrength`) weighs what's filled in:

| Item | Weight | Left out for |
| --- | --- | --- |
| Photo | 20 | |
| Headline | 15 | |
| Current role (company or role) | 10 | |
| City | 10 | |
| 3 or more skills | 10 | |
| Bio | 10 | |
| Industry | 5 | |
| The year they started working | 5 | students and current pupils |
| A link | 5 | current pupils |
| Degree or field of study here | 5 | schools |
| A past role or studies elsewhere | 5 | |

The score is the weight done out of the weight that applies to the member. The feed opens with a "Complete your
profile" card (a section, not a post) showing the score and the three heaviest missing items, each linking to its
section of the edit form; it hides at 90% or above. **Not now** (`POST /memberships/me/profile-nudge/dismiss`) stamps
`profile_nudge_dismissed_at`, so the card stays away for 14 days on every device, and leaves "Hidden for 14 days. My
profile always shows what's left to add." in its place. My profile always shows the meter and everything still to add.

**Directory.** `q` also matches the headline and any skill. New filters for industry, skill (one, matched whole and
regardless of case), field of study (matched whole, like city) and Open to sit behind **More filters** (web) and
**Filters** (mobile). `GET /directory/filters` returns the industries present and the 50 commonest skills and fields of
study, merged across case and spelled as most members spell them (cached for five minutes). Cards show the headline (or
the role line) and short Open to badges that screen readers hear in full.

### Photos and uploads

Every image goes through `POST /t/:slug/uploads` (a JPEG, PNG or WebP of at most 5 MB in the `file` field) and is
re-encoded with sharp before it's stored (`apps/api/src/lib/images.ts`). Its type is read from its bytes and the declared
type is ignored: phones label a converted photo with its source's type, so only a file declared as something other than
an image (or `application/octet-stream`) is turned away unread. A body over 5 MB gets 413 with the apps' own words,
"Choose an image under 5 MB." Each image is:

- turned upright from its EXIF orientation, with all metadata dropped, GPS position included;
- scaled down to at most 2048 pixels on the longest side (never enlarged), keeping its format, and re-encoded smaller
  if that's what it takes to stay under the size limit;
- refused with 413 above 40 megapixels or when its decoded bitmap would be too large, and with 415 (`UNSUPPORTED_MEDIA`)
  when it won't decode. Each API process works on at most two images at once.

`?purpose=avatar` (the default is `image`) makes a profile photo: a 512×512 JPEG cropped around the most interesting
part, with any transparency on white. `?purpose=backdrop` makes a member's background photo (see **Appearance**): a JPEG
on white of at most 1600 pixels on its longest side. A purpose the API doesn't know is refused before the rate limits
count it.

- **Who may upload:** members (approved, or pending or rejected while they fix their registration; not suspended),
  anyone registering where self-registration is open, anyone holding an open invitation (so an invitee at a closed
  institution can add a photo while registering), and Illuminize staff. 20 uploads an hour per user, and
  `UPLOADS_PER_TENANT_DAILY_CAP` per institution.
- **The ledger.** The `uploads` table records each stored file: institution, uploader, storage key, purpose, type and
  size. The row outlives its uploader (`user_id` becomes null).
- **A profile photo must be your own.** A changed `avatarUrl` (on registering, editing or an admin's edit) must be an
  avatar uploaded to this institution by the member, or by the admin making the edit; otherwise 400 on `avatarUrl`.
  That keeps out third-party addresses, which would log everyone who opens the directory, and other people's photos.
  An unchanged value always passes, so photos saved before this rule, or before a switch of storage provider, keep
  working. The apps send `avatarUrl` only when it changed.
- **Clean-up.** After the change commits, a replaced or removed photo's file and ledger row are deleted when no profile
  in the institution still shows it. The save and the delete both lock the photo's ledger row, so a concurrent save
  can't lose a photo in use. Deleting an account deletes the user's photos that nothing else shows. The
  `uploads.sweepAvatars` job runs every six hours and deletes avatar and background uploads more than two days old
  that no profile or background shows (photos picked in a form that was never saved). Storage errors are logged and
  never fail a request; the row stays, so the sweep tries again. Only profile and background photos are ever deleted;
  a background photo follows the profile photo's rules throughout (see **Appearance**).
- **CDN copies.** S3 objects are cached as immutable for a year, so a CDN in front of the bucket may keep serving a
  deleted photo until its copy expires.
- **The apps prepare every photo before sending it.** What a picker or a browser says about a photo (type, size,
  dimensions) describes the photo picked, not the file sent, so no picked file goes up as it is:
  - **On a phone,** `useImageUpload` picks at full quality, so the picker makes no lossy copy of its own, and
    `preparePickedPhoto` (`apps/mobile/src/lib/photos.ts`, on expo-image-manipulator) decodes the photo (HEIC and HEIF
    too) at most 2048 pixels on its longest side (1024 for a profile photo), so a 50-megapixel photo is never held in
    memory whole, turns it upright and saves it again. It becomes a JPEG at quality 0.85, or a PNG when the source may
    be see-through (anything but a JPEG, HEIC or HEIF: a PNG, WebP or GIF, or a type the picker didn't give). A phone
    paints nothing under a JPEG, so see-through parts saved as one turn black: a PNG over 5 MB is drawn smaller instead
    (each side × 0.7, until it fits). Its size is read from the file written (expo-file-system), and both the picker's
    full-size copy in the app's cache and the prepared one are deleted once the photo has gone. Cancel works while it is
    being prepared, and a photo that can't be read says "Couldn't open that photo. Try another one."
  - **In a browser** (the web app, and the phone app's web build), `prepareImageFile`
    (`packages/shared/src/client/imageUpload.ts`) does the same on a canvas, for posts, covers and logos
    (`ImageUploader`) as for profile photos (`AvatarPicker`, always a JPEG on white). A canvas can paint white under a
    JPEG, so a PNG over 5 MB becomes a JPEG on white. Every file is decoded, however small, since only that gives its
    sides (a 300 KB PNG can be 9000 pixels wide, over the server's 40 megapixels); an allowed one that already fits goes
    as it is. A file the browser can't decode (HEIC outside Safari) is refused with "Choose a JPEG, PNG or WebP image."
    The file inputs list only those three types, so iPhone Safari hands a HEIC photo over as a JPEG.
  - Each app then checks the prepared file (`imageFileProblem`) and uploads it with a 90-second timeout, given up on
    when the screen closes.
- **Both apps** use an `AvatarPicker`: a 96px round preview with initials, **Add photo**, **Change photo** and **Remove
  photo**, the photo prepared as above, progress, and cancel. Errors show inline and are announced. Saving waits while
  a photo uploads. On a phone the system editor crops the photo square; the web relies on the server's crop. An avatar
  shows initials until its photo loads, and falls back to them if it fails.

### Appearance

Each member chooses the background of the signed-in app under **My profile → Appearance** (a card on the web, a screen
in the phone app): **Plain**, **Institution colour**, **Institution cover** (offered only where the institution has a
cover) or **Your photo**. It's saved on their membership (`memberships.appearance`, changed with
`PATCH /t/:slug/memberships/me/appearance`), so it's chosen per institution and is the same on the web and the phone.
Only they see it: their own membership carries it, and no admin, directory or "Use details from …" view does.

- **Only the page changes.** Posts, cards, the header and the tab bar stay white, chats stay plain, and the apps stay
  light: there's no dark mode yet (see Known gaps). The page changes as soon as a tile is chosen and goes back if the
  save fails.
- **Institution colour** is a light tint of the brand (`pageTint`, 8% of it). **A cover or a photo** lies under a veil
  of the plain page colour at 85%, so only a soft wash of it shows. On either, grey text on the page itself steps one
  shade darker (slate-500 to slate-600: the web's `[data-backdrop]` rule, the phone's `theme.pageMuted` and `Muted`), so
  it reads at least as well as on the plain page, and brand-coloured text on the page (the web sidebar's current link,
  the phone's Filters toggles) takes `pageInk`, the brand darkened as far as it must be to read at 4.5:1 on the darkest
  the page gets. Without its photo (an institution that took its cover away) the page is plain, and the choice comes
  back with the photo.
- **Where it's drawn.** The rules are in `packages/shared/src/lib/appearance.ts`: `resolveAppearance` reads a missing or
  unknown key as Plain, `pageBackdrop` says what to draw, and the helpers beside it say which tiles to offer. The web
  draws it in `HomeLayout`, the member app's own layout. The phone app's `(app)` layout gives every page under it a
  theme with it (`theme.page`), and the page shells (`Screen`, `SectionScreen`, `StackScreen`) take their colour from
  it and draw `PageBackdrop`.
- **The admin console stays plain** on both apps, whatever the admin chose for themselves, so it shows the institution
  as members see it: on the web `AdminLayout` is outside `HomeLayout`, and in the phone app `AdminScreen` and
  `AdminListScreen` put the plain page back (`PlainPage`).
- **A background photo follows the profile photo's rules** (see Photos and uploads). The apps prepare it before it goes
  (at most 1600 pixels, a JPEG on white) and upload it with `?purpose=backdrop`; only the member's own background upload
  at that institution is accepted. A replaced or removed one is deleted after the change commits if nothing else shows
  it, and so are a deleted account's and those uploaded but never saved (the sweep). Choosing **Your photo** with no
  photo is refused ("Upload a photo first"). **Remove photo** goes back to Plain when the photo is the background, and
  leaves another choice as it is.

### Rich text

Long descriptions take bullet lists and clickable links, with no other formatting: the parser is
`parseRichText` in `packages/shared/src/lib/richText.ts`, pure and linear in the length of the text (checked on
50,000-character pathological inputs).

- A line starting with `-`, `*`, `•`, `●`, `▪`, `◦` or `–` and a space is a bullet ("-5°C" isn't). `1.` or `1)` and a
  space starts a numbered list, which keeps its starting number. A line indented by two spaces (or a tab) continues the
  item above; a blank line ends a list or paragraph, and a paragraph keeps its line breaks.
- `http(s)` addresses and bare email addresses become links, and the link text is exactly what was written.
  Punctuation that ends a sentence is left out of an address, curly quotes, the em dash and CJK punctuation end one
  wherever they are, and a closing bracket stays only when the address opened it.
- A link must pass `new URL()`: http, https or mailto only, a host, no user name or password
  ("https://google.com@evil.com" stays text), and at most 2048 characters. A host written beyond ASCII also stays text,
  so the text shown always matches where the link goes. Zero-width and bidirectional control characters are stripped
  first.
- The `RichText` component on web (`components/common/RichText.tsx`) and mobile (`components/RichText.tsx`) builds
  React elements only, never `dangerouslySetInnerHTML`. Links carry `rel="noopener noreferrer nofollow ugc"` (real
  anchors on the web export), screen readers hear list numbers but not bullets, and right-to-left lists lay out from
  their first letter (`dir="auto"` on web, `textDirection` on mobile).
- It renders a job's About the role and other sections and its About the company, event details, funding pitches,
  business descriptions and member bios. `RICH_TEXT_HINT` ("Start a line with - for a bullet point. Links become
  clickable.") sits under those fields in the forms, and cards show a plain excerpt with the markers gone
  (`plainExcerpt`).
- Posts, comments and chat stay plain text on purpose: links in the feed invite spam, and chat is text only.

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
the weekly digest, chat pushes, staff alerts for escalated chat reports and the sweep of unsaved profile and background
photos) runs on BullMQ queues in Redis: `jobs`, `messages` and `chat`. Code inside a request queues a job; it never calls
slow providers itself.

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

Invitations, announcements, the weekly digest, email confirmations and staff alerts go out through `queueMessage()`
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
view. Profile completeness counts photo, headline, city, company, industry, skills, past roles, education (a degree or
field of study here, or studies elsewhere), birthday, LinkedIn, any link and confirmed email. *Members CSV* exports
every member with all profile answers (admin-only ones included) and confirmed email, and after "Last active" the
profile's own details: headline, industry, the year they started working, skills, degree, field of study, past roles,
studies elsewhere, each link and Open to (a list in one cell; no degree columns at a school). *Activity CSV* gives
active days and content per member for the chosen period. Exports stream in batches of 1000,
start with a UTF-8 BOM so Excel reads them correctly, prefix cells starting with `= + - @` with `'` so spreadsheets
don't run them as formulas (this includes `+91…` phone numbers), and are audited and rate-limited.

### Jobs

Members post jobs under **Jobs**, following the institution's content moderation. A job carries what someone needs
before applying, laid out the same way on both apps; the rules are in `packages/shared/src/schemas/jobs.ts` and
`lib/jobs.ts`. The form has six sections (limits in characters unless noted):

| Section | Fields |
| --- | --- |
| Basics | Job title (3–150), Company (120), Type (Full time, Part time, Contract, Internship, Freelance), Work mode (On-site, Hybrid or Remote; On-site when not given), Location (120) |
| Requirements | Seniority (Entry level, Mid level, Senior, Lead, Manager, Executive), Minimum and Maximum experience (0–50 years), Skills (up to 15 of 40 characters, normalised as on profiles), Education (120) |
| Pay | Currency (INR, USD, EUR, GBP, AED, SGD, CAD or AUD; INR when not given), Pay period (Per year, Per month, Per hour), Minimum and Maximum pay, Pay note (80, such as "Plus ESOPs"), Openings (1–1000) |
| About the role | About the role (the `description` field, 10–5000, required), Responsibilities, Requirements and Benefits (3000 each), all rich text |
| Company | Logo (an upload), Website, Industry (the profiles' 24), Company size (1–10, 11–50, 51–200, 201–1,000, 1,001–5,000, 5,001+), About the company (1500) |
| How to apply | Apply link, Contact email, Contact phone (24), Applications close, How to apply (3000), and "I can refer people for this job" |

- **Rules.** A maximum must be at least its minimum, for experience and for pay. An edit's ranges are checked again
  against what's stored, under the row lock, so a PATCH of only a maximum below the stored minimum gets 400 on that
  field; CHECK constraints back this up. A field an edit leaves out stays as it is (null clears it, `[]` the skills),
  so a form that doesn't show a field can't wipe it. The apply link, company website and logo are http or https with no
  user name or password, at most 2048 characters, and stored as the URL parser reads them, like profile links
  (`linkUrlSchemaUpTo`). `jobs.company_industry` uses the same `industry` enum as `memberships.industry`.
- **Experience** shows as "3–6 years", "3+ years", "Up to 2 years" or "Open to freshers" (`experienceLabel`).
- **Pay** is stored in whole minor units (paise, cents) with its currency and period. The form takes amounts in full
  ("2500000, not 25 L") and converts them with `toMinor`, which rounds half away from zero on the decimal text.
  `formatSalary` (`lib/salary.ts`) writes pay without Intl number formatting, which Hermes may lack: "₹25–40 LPA" for
  rupees a year (crores from 100 lakh: "₹1.2 Cr"), "₹40,000–60,000/mo" with Indian digit grouping for rupees a month
  or an hour, "$120k–150k/yr" for other currencies a year or a month, "$40–62.50/hr" by the hour, and "From …" or "Up
  to …" with only one end. The form previews pay and experience as "Shows as: …". An internship's pay is its
  "Stipend". The Pay note shows as a fact of its own, and on cards when there's no amount; migration 0029 copied the
  old free-text salary into it.
- **Where.** `workMode` replaced the remote flag (0029 turned `is_remote` into Remote, and 0030 dropped it).
  `jobPlaceLabel` writes the place the same way on cards, the job's page, the digest email and both digest pages:
  "Mumbai · Remote", "Remote", or the location alone for an on-site job.
- **Cards and the page.** Lists return `JobCardDto`, built field by field: title, company and logo, place and work
  mode, type, seniority, experience, skills, pay and pay note, and a `summary` the API makes from About the role (one
  plain line of up to 200 characters). They carry no apply link, email, phone, sections or company details, so a page of
  results isn't a contact scrape. `GET /jobs/:id` returns the full `JobDto`, which the admin preview and the edit form
  use too. A card puts the title first for screen readers, draws the logo on the left without announcing it, and shows
  place, type, experience, pay, two lines of summary and up to three skills, on one line, with "+N more". The page has
  a header with the logo (or initials), title, company and place; the key facts with SVG icons (`jobFacts`: type, work
  mode, location, pay or stipend, pay note, experience, seniority, openings, education, and "Applications close 12 Dec"
  while open); skill chips; Apply, email and phone; the sections as rich text; and an "About the company" card.
- **Closed or expired.** A job is open (`jobIsOpen`) while it's approved, not closed by its poster and not past its
  closing date. Once it isn't, the API leaves out its apply link, email, phone and How to apply for everyone but its
  poster and admins, and both apps show "Applications closed" (with the date, for one that expired) where the buttons
  were. Closed and expired jobs leave the board unless `includeClosed` is set; the poster's own list keeps them.
  Referral requests follow the same rule: a job takes them only while it's open and its poster offered.
- **Filters.** Search ("title, company or skill"), Type and Can refer stay in view; Work mode, Seniority and "Your
  experience (years)" sit behind **More filters** (web) or **Filters** (mobile), with **Clear filters**. `experience`
  finds jobs whose range fits that many years: an open end never rules a job out, and a blank value is no filter.
- **Reusing company details.** Once a company is typed, the form looks for the poster's latest job at the same company
  (`mine=true&q=`, names compared as skills are, skipping removed jobs and the job being edited) and offers **Use
  details from your last job at …**. It names the details it would fill, fills only the logo, website, industry, size
  and about that are still empty, then says "Filled in from your last job at …. Check them before you post."
- **Matching skills.** On a job's page, each of its skills that the viewer lists on their own profile here is a filled
  chip with a check mark (screen readers hear "(you have this)"), in the job's own order, and a line under the chips
  says "You have N of M skills", even at 0. A viewer whose profile lists no skills sees "Add your skills to see which
  you match" there instead, which opens Work: `#work` on My profile on the web, **Edit profile** at Work on the phone
  app. A card puts the matched skills first, with the same check, so the three it shows start with them, and "+N more"
  counts the rest; the skills stay on one line, a long one cut short, and the card's accessible name lists them with
  "(you have this)" after each match. Nothing is compared for the job's poster, on its page or its card (on the board
  and in My posts), in the admin preview, or for a job with no skills. Skills match whole by `skillKey` (`skillMatch`
  and `skillsMatchedFirst` in `lib/skills.ts`), so case, spacing and full-width letters don't matter, and "SQL" isn't
  "PostgreSQL". The viewer's skills come from the membership each app already holds, so there's no extra request.
- **The admin preview.** **Admin → Moderation** shows a job in full, as its page does, with headings that fit under the
  Moderation page's own, its apply link, email, phone and website as text rather than links, How to apply even once
  closed, and none of its skills marked. A member's edit still goes back for review where admins approve content.

### Business directory

Members list businesses they run under **Businesses**: a name, one of 14 categories, a description, a logo, a city, a
website, and a contact email and phone. Each member may have up to five listings that an admin hasn't removed.

- Listings follow the institution's content moderation, can be reported (they go to **Admin → Reports**), and show in
  the author's My posts.
- The description is rich text (bullets and links) on the listing's page, and a plain excerpt on cards. The apps upload
  the logo, which is processed like every image (see **Photos and uploads**); the API itself still takes any http(s)
  address for it (see Known gaps).
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
  now. Staff see escalated reports in the platform console's **Chat reports** (no text), whose nav item counts the
  open ones, with why each is theirs ("About an admin" or "No other admin"), and open them through the institution's
  own admin pages, where each view is audited with why they were allowed in. Staff reach only escalated reports.
- **Another member of staff.** A member of staff who changed an institution's admins after a report there was filed
  (assigning or removing an admin, changing a role, approving, suspending or reinstating an admin, or the staff flag of
  one of its admins), which may be what made it staff's, can't view, resolve or dismiss it: they get
  `NEEDS_OTHER_STAFF`, "You changed this institution's admins after this report was filed, so another member of
  Illuminize staff needs to handle it." Changes that can't make a report staff's don't count: any to its reporter, and
  taking the admin role from the member it's about (suspending, removing or demoting them), so staff can suspend a
  reported admin and still close the report. Removing a message leaves open the other reports on it that they must
  leave to someone else. The console shows them the note on the report in place of its link, and on an open one says
  when no other member of staff may take it either (make someone a platform admin). It's read from the audit rows those
  changes write in their own transaction, and a change up to a minute before the report counts too, because both are
  stamped when their transaction began; a later one counts however late, closed reports included, since escalation is
  worked out when read. Alerts go only to staff who may take it, and a report no member of staff may take waits,
  unclaimed, for one who may.
- **Staff alerts.** When a report becomes theirs, each member of staff who may take it gets a `STAFF_CHAT_REPORT` email
  (or WhatsApp or SMS, where a template is configured for it and they have no confirmed email): at once if it's filed
  about an admin or with no other admin to handle it, and within five minutes if a later change of admins escalates it
  (the `chatReports.alertStaff` job). `chat_reports.staff_alerted_at` records it, so a report alerts once while it
  stays theirs. The alert gives the institution, the reason, what was reported and why it's for staff, and a link to the
  console; it names nobody and quotes nothing. It's checked again when sent: a report closed by then sends nothing, and
  one its admins can handle again sends nothing and is claimed afresh if it becomes staff's later. A report that names
  every member of staff waits until one joins whom it doesn't. It's queued without an institution, so no institution is
  billed for it. Staff who hold the admin role in an institution get its `CHAT_REPORT_FILED` notice only for a report
  that's theirs from the start, the one kind they can open.
- **Changes to who is an admin** are audited in the same transaction as the change: staff assigning or removing an
  institution's admins or changing someone's staff flag, and admins approving, rejecting, suspending or reinstating a
  member or changing a role. Assigning never lifts a suspension ("This member is suspended. Reinstate them first.").
- **No retaliation.** While an open chat report names a tenant admin as the reported member, that admin can't suspend
  anyone, change roles, reinstate a suspended admin, edit member profiles or remove a mentor. Every target gets the same
  answer, "This needs another admin or Illuminize staff", so it doesn't point at the reporter. Refusals are audited, and
  those actions together are limited to 60 an hour per admin, so they can't be repeated to watch for the report closing.
  Staff aren't restricted. Filing and the check share a lock on the reported member, so a report filed while an admin's
  change is under way either stops it or is filed once the change has committed.

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
- All sessions are revoked once it commits, and their devices' push tokens are forgotten. Their profile and background
  photos that no other profile shows are deleted then too.
- **Safety holds.** A suspension, and each block other members placed on them, is kept under a keyed hash of their
  phone number (HMAC-SHA256 of the E.164 number with `PHONE_HASH_KEY`, or a key derived from `JWT_SECRET`) in
  `deleted_account_suspensions` and `deleted_account_blocks`. Nothing else about them goes in those tables, blocks they
  placed go, and an account with neither leaves no row there (the audit row below keeps the hash all the same). Before
  reading what to keep, the deletion takes the locks the cascade would (the user's row, then their memberships), so a
  suspension or a block still being committed, or a membership a rejoin is inserting, is waited for and kept rather than
  deleted unseen. Holds don't expire: one ends when it's taken back, or when the blocker's membership or the institution
  is deleted. If the number joins that institution again (registering, or staff making them an admin), the new
  membership takes them back in its transaction, so a registration that fails leaves them held: a suspension makes it a
  suspended member ("Suspended before this account was deleted"), whatever an invitation or the approval mode would
  give, with no request for admins and a `membership.suspension_restored` audit row; held blocks are placed again with
  their first date, silently ("Blocks are invisible", above). From then on they're an ordinary suspension (the
  Suspended tab, Reinstate) and ordinary blocks (Blocked members, Unblock); there is no screen for holds. Staff
  assigning such a number as an admin get "This member is suspended. Reinstate them first.", as for any suspended
  member, once the suspension is back. Both apps' confirmation says so before anything is deleted. A number stored
  before today's length rules is hashed as stored, so such an account can still be deleted.
- It's audited as `auth.account_deleted` in the same transaction (no actor, the user as target, the request's IP), with
  the phone hash, the number of memberships and of suspensions kept, never the number itself or anything about blocks.
  Every deletion writes this row, whether or not anything is held, and audit rows are never purged: the keyed hash of
  every deleted account's number stays in the platform audit log, which staff can read. Migration 0032 took the raw
  number out of the rows earlier deletions wrote.

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
  - `notification:new` (with the new unread count), `notification:unread` (another device read some, or another admin
    approved or rejected a request to join, which marks every current admin's unread notice of it read and tells only
    those admins; both apps refetch the list, so an unread notice shows where the request stands, while one already read
    learns it from the API's 409 when acted on) and `notification:bulk` (an announcement reached many members at once).
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
  lib/            errors, transactions, pagination, phone numbers; images.ts (sharp: every upload re-encoded)
  middleware/     auth, tenant resolution + membership, feature and pupil guards, validation, rate limiting, errors
  services/       approval & moderation state machines, OTP, tokens, membership, content, billing, stats
  services/chat/  direct messages, groups, delivery (fanout.ts), pushes, blocks, reports and the admins' audited view
  services/mentorship/, services/referrals/   mentorship and referral requests
  repositories/   all SQL (Drizzle) grouped by table
  routes/         public, auth, me, tenant (member + admin), platform
  services/otp/   console / WhatsApp Cloud / MSG91 senders behind one interface
apps/api/drizzle  SQL migrations (generated; some hand-written parts: pg_trgm, the moderation_items view, the
                  content_type rebuilds in 0019 and 0023, the LinkedIn clean-up in 0028 and the jobs backfill in 0029)
apps/api/test     vitest unit + integration tests (real Postgres, in-memory Redis; helpers/images.ts makes real images)
apps/web/src      routes/ (member app, t/admin, platform), components/ (ui, icons, feed, layout, profile, jobs,
                  common/RichText…), hooks/, stores/; design tokens in index.css (Manrope + Source Sans 3,
                  elevation ladder)
apps/mobile/src   app/ (expo-router screens: tabs under (app)/(tabs), chat and other stacked screens above them),
                  components/ (ui, icons via react-native-svg, profile, jobs, RichText…), hooks/, stores/, theme/
packages/shared   constants (enums, labels, countries), zod schemas, DTO types, client/ (typed fetch client, upload
                  helpers), realtime/ (events and client), chat/ (chat cache and live sync, no React),
                  lib/ (features.ts: switches and current pupils; sections.ts: the member app's sections;
                  profile.ts: profile sections, registration steps, strength and "Use details from"; skills.ts;
                  salary.ts: formatSalary; jobs.ts: open, place, experience and facts; richText.ts: the parser;
                  phone.ts: national-number lengths)
e2e/              Playwright smoke scripts for web, admin console and the exported mobile web build
```

## API overview

All responses use `{ data }`, cursor lists `{ data, nextCursor }`, pages `{ data, page, pageSize, total }`, errors
`{ error: { code, message, details } }` (codes in `packages/shared/src/errorCodes.ts`).

| Area | Endpoints |
| --- | --- |
| Public | `GET /tenants`, `GET /tenants/:slug`, `GET /invites/:token`, `GET/POST /unsubscribe`, `GET /health`, `POST /webhooks/razorpay` |
| Auth | `POST /auth/otp/request`, `POST /auth/otp/verify`, `POST /auth/refresh`, `POST /auth/logout`, `POST /auth/logout-all`, `POST /auth/email/verify` |
| Me | `GET /me`, `GET /me/profile-copy` (`?exclude=<slug>`), `GET/POST/DELETE /me/email`, `POST/DELETE /me/push-tokens`, `POST /me/delete` |
| Tenant `/t/:slug` | `memberships` (register, me, update, invitation, `me/profile-nudge/dismiss`, `me/appearance`), `profile-fields`, `uploads` (`?purpose=image\|avatar\|backdrop`), `directory` (+ `filters`, and one member's profile), `jobs` (+ `seekers`, and referral requests: `jobs/:id/referrals`, `jobs/referrals/mine`, `jobs/referrals/summary`, `jobs/referrals/:id/accept/decline/withdraw/report`), `funding`, `businesses`, `posts` (+ comments, reactions, `poll/vote`), `events` (+ rsvp, attendees, cancel), `reports`, `notifications`, `notification-prefs`, `celebrations` (today, wishes), `digest/latest`, `payments` (get, confirm) |
| Tenant chat `/t/:slug/chat` | `direct` (send a first message; `direct/:membershipId` finds a thread), `conversations` (`?inbox=MAIN\|REQUESTS`; one; `messages` with `?cursor` or `?afterSeq`; send; `read`, `mute`, `accept`, `decline`), `badge`, `blocks` (list, block, unblock), `messages/:id/report`, `groups` (list, create, `invites` for the member's own invitations; per group: get, edit or archive, `members`, `invite-candidates`, `join`, `leave`, `invites` to invite, `invites/accept`, `invites/decline`, `members/:membershipId` to remove) |
| Tenant mentorship `/t/:slug/mentorship` | `me` (get, save, stop mentoring), `summary`, `mentors` (+ one), `requests` (send, list, `accept/decline/withdraw/end/report`) |
| Tenant admin `/t/:slug/admin` | `dashboard`, `analytics`, `exports/members.csv`, `exports/activity.csv`, `members` (approve/reject/suspend/reinstate/role/profile, approve-all-pending), `mentors/:membershipId/remove`, `moderation` (approve/reject/remove/restore/pin), `reports` (resolve/dismiss), `chat-reports` (list; `view`, `resolve`, `dismiss` are POSTs), `settings`, `branding`, `profile-fields`, `invitations` (import/send/revoke), `announcements/audience`, `audit` |
| Platform `/platform` | `tenants` (create/update/settings/admins), `tenants/:id/billing` (plans/usage/snapshots), `stats`, `analytics/comparison`, `exports/comparison.csv`, `jobs/run`, `users` (platform-admin toggle), `audit`, `messages` (test send, status), `chat-reports` (escalated, no text) |

The directory and the jobs board filter by query parameter, besides `cursor` and `limit`:

- `GET /t/:slug/directory`: `q` (name, company, role, headline or skill), `batchYear`, `city`, `country`,
  `professionType`, `company`, `industry`, `skill`, `fieldOfStudy`, `openTo`, and `field=key:value` (repeatable).
  `GET /directory/filters` lists the choices.
- `GET /t/:slug/jobs`: `q` (title, company or skill), `jobType`, `workMode` (which replaced `remote`), `seniority`,
  `experience` (years), `location`, `canRefer`, `mine` and `includeClosed`. It returns `JobCardDto`s; `GET /jobs/:id`
  returns the full job.

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

Uploads are decoded and re-encoded with **sharp** (`apps/api/src/lib/images.ts`), so tests upload real images made at
test time (`test/helpers/images.ts`); a few fake bytes after a PNG header now get 415. sharp ships its native library
as per-platform packages (`@img/sharp-*`) with no install script, so it needs no entry in pnpm's build-script allowlist
(`onlyBuiltDependencies` in `pnpm-workspace.yaml`, which lists only esbuild), installs on Windows, Linux and Alpine
without a compiler, and survives the Dockerfile's `pnpm install --ignore-scripts`. pnpm installs the package for the
machine it runs on, which is one more reason not to share `node_modules` between Windows and a dev container. Both CI
workflows check that sharp loads right after installing.

**Migrations that replace columns** go in two steps, as 0029 and 0030 do for jobs: add the new columns and backfill
them while the old ones are still there, then drop the old ones in a second migration. Generated in one step,
drizzle-kit stops to ask whether a column was renamed. And when merging a branch that adds migrations, regenerate them
after the other branch's rather than renumbering them: Drizzle applies only migrations newer than the last one a
database has.

`e2e/README.md` explains how to run the Playwright smoke scripts that walk the member, admin and platform journeys,
and how to export the Expo app for the web to exercise the mobile screens in a browser.

### Mobile

```bash
cd apps/mobile
cp .env.example .env                 # EXPO_PUBLIC_API_URL=http://10.0.2.2:4000 for the Android emulator
npx expo start                        # then press a / i, or scan with Expo Go
```

`expo-notifications`, `expo-image-picker`, `expo-image-manipulator`, `expo-file-system`, `expo-document-picker`,
`expo-sharing`, `expo-clipboard`, `expo-secure-store` and `react-native-svg` are native modules: use a development build
(`npx expo run:android`, or `npx expo run:ios` on a Mac) rather than Expo Go for push notifications. A development build
made before one of them was added lacks it and must be rebuilt, and Metro restarted (`pnpm mobile`): `react-native-svg`
draws every icon, `expo-image-manipulator` and `expo-file-system` prepare photos, and the document picker, sharing and
clipboard modules are there for the admin console's CSV import, exports and invitation links. Expo Go already includes
them all. EAS Build works too, but the repo has no `eas.json` yet: run `npx expo install expo-dev-client`
and `eas build:configure` first, then `eas build --profile development`. Images and tokens degrade gracefully on the web
export.

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
- `PHONE_HASH_KEY` (optional, at least 32 characters) keys the hash kept of a deleted account's phone number. Set it
  once and keep it: changing it, or `JWT_SECRET` while it's unset, forgets every suspension and block held for
  deleted accounts.
- `UPLOADS_PER_TENANT_DAILY_CAP` (default 2000) limits image uploads per institution per day; `BILLING_TIMEZONE` sets the
  billing calendar.
- Every upload is re-encoded with sharp inside the API process, at most two images at a time per process, and each can
  hold a decoded bitmap of up to 160 MB (40 megapixels of 8-bit RGBA): allow for that in the API's memory. The image
  gets sharp's Alpine (musl) build from the lockfile and needs no build tools.
- `WEB_APP_URL` is the web app's public origin, used for links in invitations, announcements, digests and confirmation
  emails. It defaults to `http://localhost:5173` outside production; in production it is required once any outbound
  channel is configured (otherwise the API logs a warning at start). Also: `WHATSAPP_TEMPLATES`, `INVITES_DAILY_LIMIT`,
  `EMAIL_VERIFY_GLOBAL_DAILY_CAP` (see `apps/api/.env.example`).
- Deploy the worker together with, or before, the API: new job types (announcement fan-out, celebrations, digest, and
  the chat pushes on the `chat` queue) are queued by the API and must have a worker that knows them. The worker also
  runs the six-hourly sweep that deletes unsaved profile and background photos, so give it the API's storage settings:
  the same `UPLOAD_DIR` volume with local storage, or the same bucket with S3.
- Uploads: `STORAGE_PROVIDER=local` (default) keeps images under `UPLOAD_DIR`, served from `/uploads`, which suits one
  server with a persistent disk. For anything else set `STORAGE_PROVIDER=s3` with an S3-compatible bucket (AWS S3,
  Cloudflare R2 with `S3_REGION=auto`, DigitalOcean Spaces, MinIO): `S3_BUCKET`, `S3_PUBLIC_BASE_URL` (the bucket's
  public URL or a CDN), optional `S3_ENDPOINT`/`S3_FORCE_PATH_STYLE`, and keys or the default AWS credentials. The
  bucket must be publicly readable; objects are immutable and cached for a year. `/uploads` keeps serving older local
  files after a switch. Try it locally with `docker compose --profile s3 up -d` (MinIO, see `apps/api/.env.example`).
  The API and the worker delete replaced and unsaved profile and background photos, so S3 credentials need
  `DeleteObject` as well as `PutObject`; a refused delete is logged, and the sweep tries again. A CDN may keep serving a
  deleted photo until its cached copy expires, and files stored on local disk before a switch to S3 are never deleted
  from it. The API knows its own files by `S3_PUBLIC_BASE_URL` (or `PUBLIC_BASE_URL`) as written and as a URL parser
  writes it (a lower-case host, no default port), since a background photo's address is saved in that form.
- The web app is static: `pnpm --filter @illuminize/web build` and serve `apps/web/dist` with `VITE_API_URL` pointing
  at the API (or proxy `/api` and `/uploads`).
- CI (`.github/workflows/ci.yml`) checks that sharp loads, then runs lint, typecheck, the API test-suite against
  Postgres + Redis services, and builds; its `docker` job builds the API image and processes an image inside it.
  `.github/workflows/windows.yml` runs the one-command setup, a sharp check, lint, typecheck, API tests and builds on
  Windows.

## Known gaps / next steps

**Next: Wave 3.** Event upgrades (tickets, reminders) and giving campaigns, on the payments layer
(`apps/api/src/services/payments`) and the background jobs described above.

**To close before launch.**

- **Legal.** There is no privacy policy. Children's data (India's DPDP Act, going by the +91 numbers) and a retention
  period for messages and for removed message text need a lawyer's review. The policy must also cover keeping a keyed
  hash of a deleted account's phone number with no expiry (see "Account deletion and suspension"): in the holds, for as
  long as a suspension or a member's block on them stands, and in the `auth.account_deleted` audit row every deletion
  writes, held or not, for good, next to the old user id and the request's IP. Whoever has the key can find the number
  from the hash by trying every number. It must cover too the raw numbers a deletion still leaves: in invitations, in
  outbound message records, and in the `platform.tenant.create` audit row of an institution whose first admin they
  were (its `initialAdmin`).
- **The pupil rule trusts what members enter.** A pupil who gives a false batch year or date of birth gets through.
- **A blocked member's abuse is invisible to admins,** because withheld messages can't be reported.
- **Reporting a sole admin's message** stops them suspending anyone or changing roles until staff close the report.
- **A reported admin keeps some reach over the reporter:** they can still moderate the reporter's posts and see the
  reporter's other reports.
- **The retaliation rule leaks a little.** Its refusal tells an admin, roughly, when a report about them opened
  (refusals are audited, and the actions limited to 60 an hour).
- **Nothing has been checked on a real phone** beyond what the web export shows: see "Checks that need a real phone" in
  `e2e/README.md`. Profiles and jobs added more of them: the native square crop and the photo-library permission,
  cancelling an upload and its timeout, the keyboard on the long edit form, the list editors and each registration
  step, Android's back button and iOS's swipe back going to the registration step before (and asking on Basics),
  VoiceOver and TalkBack focus after removing or finishing a list row, on the copy banner and its Undo, and on the "Not
  now" note,
  links opening the browser, the chip rows keeping the chosen chip in view, VoiceOver and TalkBack on a job's matched
  skills and its card, a job's add-skills link bringing back a profile editor already open, and the edit screen's
  scroll to a section (`measureLayout`) on the new architecture. Photo preparation added HEIC from an iPhone and HEIF
  from Android, 48 and 50 megapixel photos, transparent PNG and GIF logos and a large cut-out PNG, cancelling while a
  photo is prepared and iPhone Safari's own HEIC conversion. Appearance added picking a background photo and
  scrolling over one on a low-end Android.
  The keyboard fix for Android's edge-to-edge windows needs the long forms checked.
- **The Docker image and CI's `docker` job haven't run on GitHub yet.** CI runs only on `main` and pull requests.

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
  - Rotating `PHONE_HASH_KEY` (or `JWT_SECRET` while it stands in for one) forgets every hold, and the hash of a phone
    number can be found by trying every number if the key leaks. Two people deleting their accounts at the same moment,
    one of whom had blocked the other, can make one deletion fail (on the blocker's membership going, or a deadlock);
    it succeeds when tried again.
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
  - Funding listings keep the flaws the business directory avoided: contact details in lists (jobs no longer send
    them either), and edits with no rate limit.
  - Deleting a post, job, funding listing or event leaves its open reports in the queue with no content (business
    listings resolve theirs). A report filed while a listing is being deleted can still slip in the same way.
  - `CONTENT_REMOVED` pushes include the admin's note, which chat removals keep in the app.
  - **Admin → Reports** shows only an error when another admin has just handled a report; Chat reports closes the
    dialog and refreshes the list.
  - Illuminize staff reach only escalated chat reports, even in an institution where they are genuine admins.
- Uploads:
  - A CDN in front of S3 may keep serving a deleted profile or background photo until its cached copy expires.
  - Only a profile or background photo has to be the member's own upload. Job company logos, business logos, post
    images and event covers take any http(s) address, so one can point at someone else's upload, or at a server that
    logs whoever views it.
  - Only profile and background photos are ever deleted: other uploads stay in storage after whatever used them changes
    or goes.
- Links:
  - In rich text, an address whose host is written beyond ASCII (an internationalised domain) stays plain text rather
    than becoming a link.
  - The mobile app's right-to-left layout of rich text is an approximation: it takes the direction from the first
    letter, using letter ranges for the main scripts (`textDirection`), where the web has the browser's `dir="auto"`.
  - Job links (apply link, company website, logo) saved before the stricter rules are stored and shown as they were
    typed. Profile links saved before them are stored as typed too, though other members see them only as today's rules
    read them, and not at all if those rules refuse them.
  - Events, business listings and funding still check their links with the older `httpUrlSchema`, which lets a user
    name or password through ("https://google.com@evil.example") and stores the address as typed.
- Registration:
  - Browser Back (web) goes to the previous step, or asks before leaving Basics with something typed, only when the
    history entry before registration belongs to the same page load, such as the landing page that led to sign-in.
    When registration holds the load's first entry (its address, or the sign-in page, opened directly or in a new tab,
    or the page reloaded), the browser's Back leaves registration without asking, and the draft with it. The labelled
    Back always works.
  - On the phone app, iOS's swipe back and Android's back button (between steps, while sending, and with registration
    the only screen) are checked by hand only (`e2e/README.md`), and the browser's own Back on its web build isn't
    tested; e2e sees the hold only through the `beforeunload` it adds on the web build.
  - A member removed while in the app (the membership answering 404) is still sent straight to registration, so Back on
    Basics there returns to the app page before it, which sends them to registration again.
  - Nothing tests the "Join the network" label at an institution that approves members automatically but has invite
    auto-approve off: no seeded institution is set up that way.
  - Once a request to join is approved or rejected, only current admins' notices of it are marked read: a demoted or
    suspended admin's copy stays unread, still saying the request waits, until they read it.
- The admin console in the phone app:
  - Admin pages not yet in the phone app, which its console's home lists as on the web console for now: moderation,
    reports, chat reports, invitations, branding (Settings says so where it would link to it) and analytics. Until each
    lands, its tile on the console's home (moderation and both kinds of report have one) opens nothing, and its admin
    notices open the console's home.
  - Illuminize staff who aren't members of an institution can't use its console in the phone app; they use the web.
- Screens and navigation:
  - A mobile detail screen opened cold from a link or push seeds the list under it with the detail's params (for
    example `/businesses?id=…`), because expo-router passes them to the anchor route.
  - Some screens still read a query's error directly (`DigestPage`, for one), and the web post, event, funding and
    business pages replace the screen when a background refetch fails (`MemberProfilePage` doesn't).
  - UI follow-ups: deeper tenant theming / branding preview in admin, and skeleton loaders and purposeful motion.
  - No dark mode: both apps are light only, and the phone app keeps dark status-bar content when the phone is in dark
    mode. Members choose only their pages' background (see Appearance).
  - Emoji no longer stand in for icons, but typographic glyphs (✕ ✓ ‹ ← → ↑ ↓ › ⋯ ⓘ ➤) still draw some controls on both
    apps and in the consoles (close, back, send, checkmarks, the analytics arrows) rather than the shared SVG set.
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
