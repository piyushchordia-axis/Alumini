# Web app notes for agents

React 19 + Vite + Tailwind v4 member app, tenant admin, and platform console.

## UI (keep in sync with mobile)

Follow root `CLAUDE.md` → **UI / UX**:

- Tokens and type in `src/index.css` (Manrope display, Source Sans 3 body; elevation `--shadow-1` / `--shadow-2`).
- SVG icons in `src/components/icons.tsx`. Section links use icon *names* in `src/lib/sections.ts`, not emoji. No emoji in nav, empty states, or chrome badges; reactions may keep emoji inside framed controls only.
- `Card` supports `elevation={1|2}` — feed posts level 1, composer level 2. Do not flatten content into the page background.
- Landing / auth: `AuthShell` is brand-first (full-bleed cover, institution as hero).
- Member visual changes ship on web and mobile in the same change. Admin stays denser and more tool-like.

## Layout map

- Member chrome: `src/components/layout/HomeLayout.tsx`
- Auth / landing: `src/components/layout/AuthShell.tsx`, `src/routes/t/LandingPage.tsx`
- Feed: `src/components/feed/` (`PostComposer`, `PostCard`, `CelebrationsCard`)
- Primitives: `src/components/ui/index.tsx`
