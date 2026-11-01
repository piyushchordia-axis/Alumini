#!/usr/bin/env bash
# One-time setup for a dev container / Codespace (safe to re-run).
# Installs dependencies, writes env files with the Codespace's public URLs,
# then migrates and seeds the demo database.
set -euo pipefail
cd "$(dirname "$0")/.."

say() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }

# Sets KEY=VALUE in an env file, replacing an existing line or appending one.
set_env() {
  local file="$1" key="$2" value="$3"
  if grep -q "^${key}=" "$file"; then
    local tmp
    tmp="$(mktemp)"
    awk -v k="$key" -v v="$value" 'BEGIN { FS = OFS = "=" } $1 == k { print k "=" v; next } { print }' "$file" >"$tmp"
    cat "$tmp" >"$file"
    rm -f "$tmp"
  else
    printf '%s=%s\n' "$key" "$value" >>"$file"
  fi
}

if [ "${SKIP_INSTALL:-0}" != "1" ]; then
  say "Enabling pnpm"
  if command -v sudo >/dev/null 2>&1 && [ "$(id -u)" != "0" ]; then sudo corepack enable; else corepack enable; fi
  say "Installing dependencies (first run takes a few minutes)"
  pnpm install --frozen-lockfile
fi

API_ENV=apps/api/.env
MOBILE_ENV=apps/mobile/.env
[ -f "$API_ENV" ] || cp apps/api/.env.example "$API_ENV"
[ -f "$MOBILE_ENV" ] || cp apps/mobile/.env.example "$MOBILE_ENV"

if [ -n "${CODESPACE_NAME:-}" ]; then
  say "Configuring URLs for Codespace ${CODESPACE_NAME}"
  domain="${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-app.github.dev}"
  api_url="https://${CODESPACE_NAME}-4000.${domain}"
  web_url="https://${CODESPACE_NAME}-5173.${domain}"
  mobile_url="https://${CODESPACE_NAME}-8081.${domain}"
  # Uploaded photos are linked through the API's public URL so they load on the web and on phones.
  set_env "$API_ENV" PUBLIC_BASE_URL "$api_url"
  set_env "$API_ENV" WEB_APP_URL "$web_url"
  set_env "$API_ENV" CORS_ORIGINS "http://localhost:5173,http://localhost:8081,${web_url},${mobile_url}"
  set_env "$MOBILE_ENV" EXPO_PUBLIC_API_URL "$api_url"
else
  # Local dev container: the phone app reaches the API through localhost on the same machine.
  set_env "$MOBILE_ENV" EXPO_PUBLIC_API_URL "http://localhost:4000"
fi

say "Waiting for Postgres"
for _ in $(seq 1 60); do
  if (exec 3<>/dev/tcp/127.0.0.1/5432) 2>/dev/null; then break; fi
  sleep 1
done

say "Migrating and seeding the demo database"
pnpm db:migrate
pnpm db:seed >/dev/null
say "Setup complete"
