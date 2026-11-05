This is an Expo/React Native mobile application. Prioritize mobile-first patterns, performance, and cross-platform compatibility.

## Expo has changed — do not trust your training data

Expo ships breaking changes every SDK release. APIs you remember are likely renamed, moved, or removed. Before writing any code that touches an Expo, EAS, or React Native API:

1. Read the major version of the `expo` package in `package.json`.
2. Fetch the matching versioned docs: `https://docs.expo.dev/versions/v<major>.0.0/`
3. For anything else, fetch https://docs.expo.dev/llms.txt — an index of all Expo docs with corrections to common LLM misconceptions. Follow its links to the specific page you need; never answer from memory.

## Commands

Use `bunx` instead of `npx` if the project uses bun (`bun.lock` present).

```bash
npx expo install <package>  # ALWAYS use instead of npm/yarn/pnpm/bun add — resolves SDK-compatible versions
npx expo start              # start the dev server
npx expo lint               # lint
npx tsc --noEmit            # typecheck
npx expo-doctor             # diagnose dependency and config issues
npx expo install --fix      # fix incompatible package versions
```

Run lint and typecheck before declaring any task done.

## Navigation & Routing

- Use **Expo Router** for all navigation. Routes live in `src/app/` — every file there is a screen, `_layout.tsx` files define navigators. Keep non-route code (components, hooks, utils) outside `src/app/`.
- Import `Link`, `router`, and `useLocalSearchParams` from `expo-router`.
- Docs: https://docs.expo.dev/router/introduction.md

### Headers and safe area (required)

Native stack headers float over content on device. **Do not** set `headerShown: true` for member chrome (no `detailHeader`).

| Kind of screen | Shell | Stack options |
| --- | --- | --- |
| Tab list root (feed, jobs, directory, …) | `SectionScreen` → draws `MemberAppBar` | index: `headerShown: false` |
| Pushed detail / modal (job, post, profile, …) | `Screen title="…"` or `StackScreen` / `StackHeader` | stack: `screenOptions={{ headerShown: false }}`; keep `presentation: "modal"` where needed |
| Chat overlay under `(app)/` | `ChatScreen` + `ChatHeader` | parent already `headerShown: false` |
| Auth without a bar | `Screen topInset` | n/a |

`MemberAppBar`, `StackHeader`, and `ChatHeader` each own `paddingTop: insets.top`. Do not pad the app bar via `SectionScreen`/`StackScreen` `style` — put padding on an inner content view.

## Building with EAS

Use EAS to build, sign, and submit the app in the cloud (`eas build`, `eas submit`) and to ship over-the-air updates (`eas update`) — no local Xcode or Android Studio required. Run EAS CLI as `bunx eas-cli <command>` in Bun projects, or `npx eas-cli@latest <command>` otherwise; substitute that for bare `eas` in docs examples.
Docs: https://docs.expo.dev/eas/index.md

## UI (keep in sync with web)

Member UI follows the same craft rules as web (see root `CLAUDE.md` → **UI / UX**):

- SVG icons from `src/components/icons.tsx` (`react-native-svg`). Section tabs use icon *names* in `src/lib/sections.ts`, not emoji. Do not use emoji for nav, empty states, or chrome badges.
- Theme tokens and elevation live in `src/theme`. Cards should read above the page background; landing is brand-first (full-bleed cover + institution hero).
- Feature parity: every member-facing visual change ships on web and mobile in the same change.
- After `expo install` of a native module, restart Metro; a server started before the install will fail to resolve it.
- OTP phone fields: hold one `{ country, number }` entry, read every change to the box with `readPhoneEntry(country, raw, entry)` and every country picked with `readPhoneEntry(country, entry.held ?? entry.number)` from `@illuminize/shared` (`clampNationalNumber`, India max 10, is its last step), and send `phoneEntryToE164`. Show a stored number with `formatPhone`.

## Rules

- If `ios/` and `android/` directories do not exist, they are generated (Continuous Native Generation). Never create or edit them by hand — configure native behavior in `app.json` and config plugins.
- Expo Go only includes its bundled native modules. After adding a library with native code, the app needs a development build: `npx expo run:ios|android` locally, or `eas build --profile development`.
- Prefer recommended Expo modules over third-party libraries, and check your available skills before adding dependencies. Docs: https://docs.expo.dev/versions/latest/index.md
