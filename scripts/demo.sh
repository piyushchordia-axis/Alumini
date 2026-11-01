#!/usr/bin/env bash
# Starts the API and the web app for a demo and prints how to sign in.
# Runs automatically when you open the Codespace; run `pnpm demo` to start it again.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -n "${CODESPACE_NAME:-}" ]; then
  domain="${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-app.github.dev}"
  web_url="https://${CODESPACE_NAME}-5173.${domain}"
  # Best effort: the phone app and uploaded photos need the API port to be public.
  if command -v gh >/dev/null 2>&1 && gh codespace ports visibility 4000:public -c "$CODESPACE_NAME" >/dev/null 2>&1; then
    api_note="API port 4000 is public, so the phone app and photos work."
  else
    api_note="For the phone app and photos: Ports tab → right-click port 4000 → Port Visibility → Public."
  fi
else
  web_url="http://localhost:5173"
  api_note=""
fi

# Applies any new migrations after a pull; quick and safe when there are none.
pnpm --silent db:migrate >/dev/null

cat <<BANNER

  ✨ Illuminize demo
  ──────────────────────────────────────────────────────────────
  Web app:   ${web_url}
  OTP code:  123456 (any phone number; new numbers register as new members)

  Platform admin           +91 99999 99999   → ${web_url}/platform
  Admin, Demo University   +91 90000 00001   (auto-approve members and posts)
  Admin, Demo College      +91 90000 00002   (approval needed; has pending items)
  Admin, Demo School       +91 90000 00003
  Members                  +91 91000 00001 … 00025
  Live updates: open the app in two browsers as two members; reactions and comments
                update the other one's bell without reloading.

  ${api_note}
  Phone app: run  pnpm mobile:tunnel  in a new terminal and scan the QR code with Expo Go,
             or   pnpm mobile:web     for a phone-sized preview in the browser.
  Reset demo data: pnpm db:reset     Full guide: DEMO.md
  ──────────────────────────────────────────────────────────────

BANNER

exec pnpm turbo run dev --filter=@illuminize/api --filter=@illuminize/web
