# Illuminize — notes for Claude Code

A multi-tenant alumni network: each institution (tenant) gets its own branded space; alumni sign in by phone + OTP.
pnpm + turborepo monorepo. README.md is the full product and architecture guide; this file is the working summary.

## Layout

- `apps/api`: Express 5, Drizzle ORM (Postgres 16), Redis, BullMQ, Socket.IO. Code in `src/`, migrations in `drizzle/`,
  tests in `test/`.
- `apps/web`: React 19, Vite, Tailwind v4, TanStack Query. Holds the member app, tenant admin (`routes/t/admin`) and
  platform console (`routes/platform`). Design tokens live in `src/index.css`; SVG icons in `src/components/icons.tsx`;
  shared primitives in `src/components/ui`.
- `apps/mobile`: Expo SDK 58 with expo-router, members only. Screens are in `src/app`. Theme tokens in `src/theme`;
  SVG icons in `src/components/icons.tsx` (`react-native-svg`); primitives in `src/components/ui.tsx`. Chrome:
  `MemberAppBar` (tab roots), `StackHeader` / `Screen title=` / `StackScreen` (pushed screens), `ChatHeader` (chat
  overlays). Do not use native stack headers for member chrome (see Gotchas).
- `packages/shared`: constants and enums, zod schemas, DTO types, the typed API client (`src/client`) and realtime
  client, used by all three apps. `src/chat` (`@illuminize/shared/chat`) holds the chat cache, outbox and live sync with
  no React; `src/lib/features.ts` the feature switches and current pupils; `src/lib/sections.ts` the member sections;
  `src/data/countries.ts` (generated) includes `maxNationalDigits` and `src/lib/phone.ts` clamps national numbers.
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
- members `+9191000000xx`; `+919100000026` is a current pupil at demo-school. README "Demo data" lists the Wave 2 seed.

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
- **Admin and abuse-prone actions.** Admin actions call `recordAudit`, which swallows errors, so never inside a
  transaction: there use `recordAuditStrict(tx, …)`, which fails the change with it. Abuse-prone routes add `rateLimit`;
  a service that counts something else (invitees, a group's sends) calls `consumeRateLimit`. Tests enable both with
  `RATE_LIMIT_IN_TESTS=1`.
- **Feature switches.** Stored maps may lack keys: read them only through `resolveFeatures(type, stored)` (ESLint catches
  `settings.features.x`, not an alias), write with `applyFeatureChange`, and send clients the resolved map. Prerequisites
  live in `FEATURE_PREREQUISITES`, school defaults in `SCHOOL_OFF_FEATURES`. Anything that sends reads settings fresh,
  not from the five-minute tenant cache. Private contact also checks `isCurrentPupil` (`requireChatEligible`).
- **Chat.** `appendMessage(ctx, tx, …)` takes `tx`: only the outermost caller opens a transaction, and nothing inside
  uses `ctx.db` (nested ones can freeze the pool). Lock in this order: the member (per-member limits), the pair
  (`lockPair`, which blocks take too), mentorship or referral rows, the conversation, a participant. Every emit and push
  goes to `chatRecipients()` (or `chatRecipientOf` for a badge). Chat writes go over REST only; the socket stays server
  to client. Message bodies and request notes never go into pushes, notifications, audit metadata, job payloads or logs.
- **Invisible blocks.** A request or invitation that meets a block gets the normal answer and is stored suppressed
  (`withheld`, `suppressed`, `invite_suppressed`); nobody is told. Tests deep-equal the blocked and unblocked views.
- **Ways out.** A gated connection (mentorship, referrals) keeps its ways out (own lists, withdraw, end, report, stop)
  outside the feature gate and the pupil check, and the apps keep the section reachable while something is left there.
- **Background work.** Declare a job in `src/jobs/definitions.ts`, handle it in `handlers.ts`, and add recurring work
  to `schedules.ts`. Per-institution daily or weekly work goes through the engagement tick (`tenantSlots`), using the
  institution's time zone and claiming a row in `tenant_job_runs`.
- **Outbound messages.** Use `queueMessage(s)` with a template in `services/messages/templates.ts` (priority,
  optional `load` step, secret keys). Invitations and announcements may use only `tenantOutboundChannels` (plan ∩
  configured senders).
- **Notifications.** Use `notify()`: categories and member preferences, dedupe keys, chunked bulk inserts. Links in
  emails use `WEB_APP_URL`.
- **Feature parity.** Every member-facing feature ships on **web and mobile** in the same change — including visual
  design. Admin and platform consoles are web only.
- **UI / UX (quality craft, not Liquid Glass).** Institution brand leads; avoid purple/glow/cream-serif templates and
  full glassmorphism. Prefer opaque high-contrast content; soft blur only on sticky chrome (header / tab bar).
  - **Icons.** Chrome uses the shared SVG stroke set (`components/icons.tsx` on web and mobile). Do not use emoji as
    nav, empty-state, badge or feature icons. Reactions may keep emoji *inside* labeled SVG-framed hit targets only.
    Section maps store icon *names* (`apps/web/src/lib/sections.ts`, `apps/mobile/src/lib/sections.ts`), not emoji.
  - **Elevation.** Page background (`--surface-page` / `colors.bg`) is quieter than content. Level 1: posts and list
    modules (`Card` default / `elevation={1}`). Level 2: the feed composer and primary write surfaces
    (`elevation={2}`). Do not flatten feed cards into the page.
  - **Typography.** Web: Manrope (display) + Source Sans 3 (body) via `index.html` / CSS vars. Keep page titles from
    dwarfing body copy (`PageHeader` uses a locked scale).
  - **Landing / auth.** Brand-first full-bleed cover in `AuthShell` (web) and the tenant landing screen (mobile);
    institution name is the hero; one CTA; features below the fold with SVG + text.
  - **Nav.** Sidebar / tabs need ≥40–44px targets, clear active weight (primary wash + stronger text), and SVG icons.
    Admin chrome stays denser and more tool-like than the member app.
  - **Mobile headers.** Native stack headers float over content on device — do not use them for member chrome. Tab
    roots: `SectionScreen` (draws `MemberAppBar`, owns status-bar inset) and `headerShown: false` on the tab stack
    index. Pushed details/modals: `Screen title="…"` or `StackScreen` / `StackHeader`, stacks with
    `screenOptions={{ headerShown: false }}` (keep `presentation: "modal"` where needed). Chat overlays: `ChatHeader`.
    Auth screens without a bar: `Screen topInset`.
  - **Phone national length.** OTP fields clamp with `clampNationalNumber(country, raw)` (India max 10). API
    `normalizePhone` rejects over-length nationals. Regenerate countries via
    `node packages/shared/scripts/generate-countries.mjs` after changing length rules.
  - **Composer.** Avatar top-aligned to the textarea; Add image / Poll / Post live in one footer tray inside the card.
  - **Directory.** Default search + batch; advanced filters behind a toggle / sheet, not a six-column slab.
- **Tests.** Integration tests use `createTestContext()` + `ctx.truncateAll()`, factories in `test/helpers`, and run
  queued jobs with `ctx.jobs.drain()`. `truncateAll` deletes rows with foreign-key checks off, which needs a superuser
  (Docker and CI are); anyone else falls back to TRUNCATE, which makes the suite several times slower.
- **Changes.** Keep them small and focused. Run lint, typecheck and the API tests before committing.

## Gotchas (learned the hard way)

- Drizzle's `jsonb` re-parses string values ("3" becomes 3): use the `jsonValue` column type
  (`src/db/schema/helpers.ts`).
- Postgres can't use a new enum value in the same migration batch that adds it, and every pending migration runs in
  one transaction. Values only app code uses keep the generated `ADD VALUE`. A new content type must rebuild
  `content_type` in its own migration, because the `moderation_items` view needs the literal: copy the latest rebuild
  (0023 today, not 0019, which lacks `GROUP`), keeping every value and view arm (README → Known gaps has the steps).
- BullMQ keeps a finished job's id for a day, and `MemoryJobQueue` only dedupes pending jobs, so a constant `jobId`
  passes the tests and silently stops repeats in production. Chat pushes use one id per time bucket.
- Drizzle and Postgres copy a failed query's values into the error; the logger's `err` serializer strips them. Log
  errors under `err`.
- A trigger stamps `memberships.approved_at` when a membership becomes APPROVED (and on insert).
- expo-router: `href: null` on a tab makes the screen unreachable (it redirects). Hide the tab button instead
  (`tabBarButton: () => null`). A route folder with no `Tabs.Screen` silently redirects to the first visible tab, so
  e2e opens every section. A cold deep link seeds the stack's anchor with the detail's params.
- Mobile native stack headers (`headerShown: true` / old `detailHeader`) float over the scene on device — search bars
  and titles draw under the status bar and the header. Always use the in-tree bars (`MemberAppBar`, `StackHeader`,
  `ChatHeader`) and keep tab/detail stacks at `headerShown: false`. On web, inactive tab scenes stay mounted: the tabs
  layout hides unfocused ones (`detachInactiveScreens` + focused-only `display`) so search chrome cannot stack.
- react-native-web ignores `accessibilityState`: use `aria-checked` on checkboxes and radios and `aria-selected` on
  tabs so state is exposed on the web build. A toggle button needs `toggleState` (`components/ui.tsx`), which adds
  `aria-pressed`, because `aria-selected` isn't valid on `role="button"` in a browser.
- `Alert.alert` does nothing on the web export and e2e dismisses `window.confirm`: new flows use `ConfirmSheet` (mobile)
  and `ConfirmDialog` (web).
- In development, OTP requests are rate-limited per phone and IP; `pnpm db:reset` clears them. A full e2e run makes 20
  code requests, the whole per-IP hour (refused ones count), so `e2e/lib.mjs` signs each phone in once per run: reuse
  `apiSession`, don't add logins.
- Charts are hand-built SVG in `apps/web/src/components/charts`. Series colours come from the validated palette in
  `chartUtils.ts` (fixed order, colour-blind checked), never from tenant brand colours.
- After adding a native Expo module (e.g. `react-native-svg`), restart Metro (`pnpm mobile`); a server started before
  the install will fail to resolve the package. Prefer `npx expo install <pkg>` inside `apps/mobile`.
- Do not declare React components inside another component's render body (e.g. a local `NavLabel`): ESLint
  `react-hooks/static-components` rejects it. Hoist helpers to module scope.

## Git

- Work on branch `claude/illuminize-multi-tenant-platform-ho1w6e`. `main` only has the initial commit.
- Don't open pull requests unless asked.
- Commit messages: an imperative summary line, then what changed and why.

## What's next

- **Wave 2 is done:** messages, groups, mentorship, referrals and the business directory, on web and mobile. README
  "How it works" describes each.
- **Wave 3 is next:** event upgrades (tickets, reminders) and giving campaigns, on the payments layer
  (`apps/api/src/services/payments`).
- **Known follow-ups:**
  - the gaps to close before launch and the smaller follow-ups in README → "Known gaps / next steps";
  - the device-only checks in `e2e/README.md` → "Checks that need a real phone", none run yet;
  - UI polish still open: admin branding preview / deeper tenant theming, skeleton loaders and purposeful motion tokens,
    sweep any remaining emoji on secondary empty states; admin Members status tabs can still overflow on narrow phones
    (list rows were reflowed);
  - the Linux CI (`.github/workflows/ci.yml`) runs only on `main` and pull requests, while the Windows workflow also
    runs on `claude/**` pushes.
