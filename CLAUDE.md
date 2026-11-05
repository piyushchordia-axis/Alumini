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
  `src/data/countries.ts` (generated) includes `maxNationalDigits`; `src/lib/phone.ts` reads a phone field
  (`readPhoneEntry`, `nationalDigits`, `phoneEntryToE164`; `clampNationalNumber` is its last step) and formats stored
  numbers (`formatPhone`).
  `src/lib/profile.ts` holds the profile's sections and registration steps, strength, hidden inputs and "Use details
  from"; `lib/jobs.ts` a job's facts, place and open or closed state; `lib/skills.ts` `normalizeSkills` and `skillKey`;
  `lib/salary.ts` `formatSalary`; `lib/richText.ts` the rich-text parser; `lib/color.ts` WCAG contrast and the tones
  of an institution colour (`brandTones`).
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
| New migration after a schema change | `pnpm --filter @illuminize/api db:generate --name short_name`, then `pnpm db:migrate` (replacing a column: see Gotchas) |
| Reset demo data (also clears Redis, which resets OTP rate limits) | `pnpm db:reset` |
| Run a scheduled job now | `pnpm jobs:run digest demo-university --force` (or `celebrations`) |
| e2e | `pnpm db:reset`, `pnpm demo`, then `pnpm e2e:web` / `pnpm e2e:admin`; mobile: `pnpm e2e:mobile:export`, `pnpm e2e:mobile:serve`, `pnpm e2e:mobile-web` |

Demo logins (OTP `123456` in development):
- platform admin `+919999999999`;
- tenant admins `+919000000001` (demo-university), `+919000000002` (demo-college), `+919000000003` (demo-school) and `+919000000004` (shri-gujarati-samaj);
- members `+9191000000xx`; `+919100000026` is a current pupil at demo-school; Samaj showcase members `+919100000031`–`038`. README "Demo data" lists the Wave 2 seed.

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
  uses `ctx.db` (nested ones can freeze the pool). Lock in this order: the report subject (`lockReportSubject`, shared
  to file a chat report, exclusive in `assertNoOpenReportAboutActor`; `adminTransition` takes the actor's before the
  target membership row), the member (per-member limits), the pair (`lockPair`, which blocks take too), mentorship or
  referral rows, the conversation, a participant. Every emit and push goes to `chatRecipients()` (or `chatRecipientOf`
  for a badge). Chat writes go over REST only; the socket stays server to client. Message bodies and request notes never
  go into pushes, notifications, audit metadata, job payloads or logs.
- **Invisible blocks.** A request or invitation that meets a block gets the normal answer and is stored suppressed
  (`withheld`, `suppressed`, `invite_suppressed`); nobody is told. Tests deep-equal the blocked and unblocked views.
- **Ways out.** A gated connection (mentorship, referrals) keeps its ways out (own lists, withdraw, end, report, stop)
  outside the feature gate and the pupil check, and the apps keep the section reachable while something is left there.
- **Background work.** Declare a job in `src/jobs/definitions.ts`, handle it in `handlers.ts`, and add recurring work
  to `schedules.ts`. Per-institution daily or weekly work goes through the engagement tick (`tenantSlots`), using the
  institution's time zone and claiming a row in `tenant_job_runs`.
- **Outbound messages.** Use `queueMessage(s)` with a template in `services/messages/templates.ts` (priority,
  optional `load` step, secret keys). Invitations and announcements may use only `tenantOutboundChannels` (plan ∩
  configured senders). Messages to Illuminize staff (`STAFF_CHAT_REPORT`) are queued with `tenantId: null`, so no
  institution is billed for them.
- **Notifications.** Use `notify()`: categories and member preferences, dedupe keys, chunked bulk inserts. Links in
  emails use `WEB_APP_URL`.
- **Links and skills.** A link a member types uses `hostUrlSchema` (one site's hosts) or `linkUrlSchema` /
  `linkUrlSchemaUpTo(max)`, which refuse a user name or password and store `URL.href`; never `httpUrlSchema` for a new
  field. Skills go through `skillListSchema` (`normalizeSkills`) and are compared with `skillKey`.
- **Profiles.** A form neither checks nor sends the inputs it hides (`hiddenProfileKeys`, `withoutHiddenProfileKeys`),
  and an edit (profile or job) leaves a key it doesn't send as stored: a new optional text field takes `.optional()`
  after `optionalTrimmed` (or works like jobs' `optionalText`), because bare `optionalTrimmed` turns a missing key into
  null. The profile copy (`toPortableProfileDto`, "Use details from …") never carries the name, batch, what they do,
  the institution's questions, marital status and kids, the phone setting or the photo, and carries the date of birth
  only when the source profile shows the birthday on its feed.
- **Rich text.** Long member-written text renders through `RichText` (web `components/common/RichText.tsx`, mobile
  `components/RichText.tsx`), never `dangerouslySetInnerHTML`; cards use `plainExcerpt`, forms show `RICH_TEXT_HINT`.
  Posts, comments and chat stay plain text.
- **Uploads.** Every image goes through `storeUpload` (`processImage` in `src/lib/images.ts`, then the `uploads`
  ledger). A profile photo changes only through `applyAvatarChange`, inside the saving transaction: it must be an avatar
  the member (or the editing admin) uploaded here, and the photo it replaces is deleted after commit if unused. The
  server decides by the bytes, never the declared type. A picked file is never uploaded as it is: pickers prepare every
  pick (`useImageUpload` with `preparePickedPhoto` on mobile, `ImageUploader` and `AvatarPicker` with
  `prepareImageFile` on web) and check the prepared file with `imageFileProblem`, and the phone deletes both the
  picker's copy and the prepared one afterwards.
- **Lists and contacts.** Card DTOs (`JobCardDto`, business cards) are built field by field and never carry contact
  details; only the detail does, and once a job isn't open (`jobIsOpen`: approved, not closed, not past its closing
  date) only to its poster and admins. Funding lists still send them (a known gap): don't copy `toFundingDto`.
- **Feature parity.** Every member-facing feature ships on **web and mobile** in the same change — including visual
  design. Admin and platform consoles are web only.
- **UI / UX (quality craft, not Liquid Glass).** Institution brand leads; avoid purple/glow/cream-serif templates and
  full glassmorphism. Prefer opaque high-contrast content; soft blur only on sticky chrome (header / tab bar).
  - **Icons.** Chrome uses the shared SVG stroke set (`components/icons.tsx` on web and mobile). Do not use emoji as
    nav, empty-state, badge or feature icons: `EmptyState` and `ChatNotice` take an SVG element only, and ESLint
    (`packages/config/eslint/no-emoji-icons.cjs`) rejects emoji in web, mobile and shared source (CI doesn't lint
    mobile, so the API unit test `noEmojiIcons.test.ts` runs the guard over all three). Reactions may keep emoji
    *inside* labeled SVG-framed hit targets only, on a commented `eslint-disable-next-line`. Notification and push
    titles (the API's 📣, 🎂, 🎉) are message text, not icons, and keep theirs. Section maps store icon *names*
    (`apps/web/src/lib/sections.ts`, `apps/mobile/src/lib/sections.ts`), not emoji.
  - **Brand colour.** Institutions choose any colour, which may be too light to read or near-black. Brand-coloured
    text and icons use the ink (web `text-primary-ink`, mobile `theme.primaryInk`) and text on the brand colour uses
    `text-on-primary` / `theme.onPrimary`, all from `brandTones` (Button, Badge, the Open to and multiple-choice
    chips and the reaction chips do; older spots with `text-primary`, or white on `bg-primary`, move over when
    touched). A chosen state is a wash, a thin ring and the ink, as the reaction chips are (web `bg-primary-wash` and
    `ring-primary-ring`, mobile `theme.primaryWash` and `primaryRing`; not `bg-primary/14`, which a pale brand loses
    in the tray), never a stroke colour alone, and hover styles go only on the unchosen state, where they can't outrank
    it.
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
  - **Phone entry.** OTP fields hold one `{ country, number }` entry. They read every change to the box with
    `readPhoneEntry(country, raw, entry)` and every country picked with `readPhoneEntry(country, entry.held ??
    entry.number)` (libphonenumber-js/min: a pasted "+44…" moves the country, a trunk "0" isn't counted;
    `clampNationalNumber`, India max 10, is its last step), and send `phoneEntryToE164`; Send code needs 6
    `nationalDigits`. Show a stored number with `formatPhone`. API `normalizePhone` rejects over-length nationals but
    takes 9-digit Indian ones (the seed has them).
    Regenerate countries via `node packages/shared/scripts/generate-countries.mjs` after changing length rules.
  - **Composer.** Avatar top-aligned to the textarea; Add image / Poll / Post live in one footer tray inside the card.
  - **Directory and Jobs.** Search plus a filter or two in view (web directory: batch; Jobs on both apps: type and Can
    refer; the mobile directory shows search alone); the rest behind More filters (web) / Filters (mobile), not a
    six-column slab.
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
- `memberships.industry` and `jobs.company_industry` share the `industry` enum (`INDUSTRIES`): a new industry is one
  `ALTER TYPE "industry" ADD VALUE` for both, plus its label.
- Replacing a column makes drizzle-kit stop and ask whether it was renamed, which an unattended run can't answer.
  Generate twice: add the new columns with a hand-written backfill while the old ones still exist, then drop the old
  ones in a second migration (0029 and 0030 do this for jobs).
- Drizzle applies a migration only if its journal `when` is newer than the last one applied. When two branches both
  added migrations, regenerate the later branch's after the other's (keeping their hand-written parts), never just
  renumber them: databases that already ran the other branch's would skip them silently.
- BullMQ keeps a finished job's id for a day, and `MemoryJobQueue` only dedupes pending jobs, so a constant `jobId`
  passes the tests and silently stops repeats in production. Chat pushes use one id per time bucket.
- Drizzle and Postgres copy a failed query's values into the error; the logger's `err` serializer strips them. Log
  errors under `err`.
- A trigger stamps `memberships.approved_at` when a membership becomes APPROVED (and on insert).
- expo-router: `href: null` on a tab makes the screen unreachable (it redirects). Hide the tab button instead
  (`tabBarButton: () => null`). A route folder with no `Tabs.Screen` silently redirects to the first visible tab, so
  e2e opens every section. A cold deep link seeds the stack's anchor with the detail's params. Pushing onto another
  tab's stack (the feed's profile card opening Edit profile) needs `{ withAnchor: true }`, or that stack holds only the
  pushed screen and Back and Save leave it behind.
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
- sharp decodes and re-encodes every upload, so upload tests use real images made at test time
  (`test/helpers/images.ts`); a few fake bytes after a PNG header get 415. Its native build is per platform: don't
  share `node_modules` between Windows and a dev container.
- expo-image-picker's `mimeType` and `fileSize` describe the source photo on Android, not the file it hands back (a
  HEIF saved as a JPEG is still labelled image/heif, with the original's size), and iOS returns a HEIC photo as it is
  whenever there is no editing, at any `quality` (quality 1 copies the original file). Trust neither:
  `preparePickedPhoto` saves every pick again and reads the size from the file it wrote. A phone writes a JPEG's
  see-through parts black (expo-image-manipulator paints nothing under them), so anything that may be transparent stays
  a PNG.
- Hermes may lack parts of `Intl` (compact numbers, some date formatting): shared code the phone app runs writes such
  text by hand, as `formatSalary` and `applicationsLine` do.
- A page holding a form waits only for its queries' first answer (`isLoading && !isFetched`, see `RegisterPage`): a
  query with no data goes back to loading on every refetch, which swaps the form, and what's typed in it, for a spinner.
- Redis caches are versioned in `src/redis/keys.ts` (`cacheTenant`, `cacheDirectoryFilters`): bump the version when a
  cached shape changes, or old entries are served until they expire.

## Git

- Work on branch `claude/illuminize-multi-tenant-platform-ho1w6e`. `main` only has the initial commit.
- Don't open pull requests unless asked.
- Commit messages: an imperative summary line, then what changed and why.

## What's next

- **Wave 2 is done:** messages, groups, mentorship, referrals and the business directory, on web and mobile. README
  "How it works" describes each.
- **Richer profiles and job posts are done:** guided registration, profile details and strength, photos and uploads,
  rich text, and structured jobs with matching skills. README "Profiles and onboarding", "Photos and uploads", "Rich
  text" and "Jobs" describe them.
- **Wave 3 is next:** event upgrades (tickets, reminders) and giving campaigns, on the payments layer
  (`apps/api/src/services/payments`).
- **Known follow-ups:**
  - the gaps to close before launch and the smaller follow-ups in README → "Known gaps / next steps";
  - the device-only checks in `e2e/README.md` → "Checks that need a real phone" (profiles, registration, jobs and
    photo preparation added more), none run yet;
  - links: events, businesses and funding still use `httpUrlSchema`, which lets a user name or password through and
    stores the address as typed; rich text leaves a non-ASCII (IDN) host as plain text;
  - uploads: only a profile photo must be the member's own upload (job and business logos, post images and event covers
    take any http(s) address), only profile photos are ever deleted, and a CDN may serve a deleted one until it expires;
  - UI polish still open: admin branding preview / deeper tenant theming, skeleton loaders and purposeful motion tokens;
    admin Members status tabs can still overflow on narrow phones (list rows were reflowed);
  - the Linux CI (`.github/workflows/ci.yml`) runs only on `main` and pull requests, while the Windows workflow also
    runs on `claude/**` pushes, so the Linux CI's new `docker` job (the API image, with sharp on Alpine) hasn't run on
    GitHub yet.
