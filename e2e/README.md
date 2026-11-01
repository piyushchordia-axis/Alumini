# End-to-end smoke tests

Plain Playwright scripts that drive the real apps against a running API with the demo seed loaded.
They are deliberately simple (no test runner) so they double as a walkthrough of the product.

## Prerequisites

```bash
pnpm install
npx playwright install chromium          # once (or set PLAYWRIGHT_CHROMIUM_PATH to an existing Chromium binary)
pnpm db:reset                            # fresh schema + demo data (pending members, open report, …)
pnpm api                                 # http://localhost:4000, OTP_PROVIDER=console
```

## Web (member journey)

```bash
pnpm web                                 # http://localhost:5173 (proxies /api to the API)
mkdir -p e2e/screenshots && node e2e/web-member.mjs
```

Covers: tenant picker → landing → phone + OTP → registration (with a profile question) → auto-approved feed → post,
react, comment → live bell → pinned announcement and a poll vote → celebrations card and wishes → weekly digest (run
through the platform job endpoint, see `lib.mjs`) → post a job → RSVP → directory → notification settings → sign out
→ ADMIN_APPROVAL tenant lands on the pending screen.

## Web (tenant admin + platform console)

```bash
node e2e/web-admin.mjs
```

Covers: tenant admin dashboard, approve/reject members, approve a job from the moderation queue, resolve a spam report by
removing content, settings, adding a profile question, importing an invitation CSV and joining through its link in a
second browser, an announcement that also goes by email, analytics charts and the members CSV; platform login,
onboarding an institution with its first admin, recording a billing plan, usage, stats, user search and the
institution comparison with its CSV. Re-run `pnpm db:reset` between runs so the pending fixtures exist (it also clears
Redis, which resets the OTP rate limits the scripts use up).

## Mobile (Expo app exported for the web)

The Expo app can be exported with Metro and driven in a browser, which is a cheap way to exercise the screens without a
device. The API must allow the origin (`CORS_ORIGINS` includes `http://localhost:8081` in `.env.example`).

```bash
cd apps/mobile && EXPO_PUBLIC_API_URL=http://localhost:4000 npx expo export --platform web --output-dir ../../e2e/.expo-web
node e2e/spa-server.cjs e2e/.expo-web 8081 &
node e2e/mobile-web.mjs
```

Note: on the web export React Navigation keeps inactive tab stacks mounted, so the script dispatches clicks directly in
one place; on iOS and Android the native tab behaviour does not have this quirk.
