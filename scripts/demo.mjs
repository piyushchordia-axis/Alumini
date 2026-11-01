#!/usr/bin/env node
// `pnpm demo`: makes sure Postgres and Redis are up, applies new migrations, prints how to sign in, then runs the API
// and the web app until Ctrl+C. Works on Windows, macOS, Linux and in a Codespace (where it runs on attach).
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { API_ENV, blue, composePorts, IS_WIN, red, ROOT, run, serviceUrls, waitForPort, yellow } from "./lib.mjs";

process.chdir(ROOT);

if (!existsSync(API_ENV)) {
  console.error(`${red("✗")} ${API_ENV} is missing. Run the one-time setup first:  node scripts/setup-local.mjs`);
  process.exit(1);
}

const inCodespace = !!process.env.CODESPACE_NAME;
const { db, redis } = serviceUrls();
const host = (u) => u.hostname.replace(/^\[|\]$/g, "") || "localhost";
const up = async () => (await waitForPort(host(db), Number(db.port || 5432), 1)) && (await waitForPort(host(redis), Number(redis.port || 6379), 1));

// After a restart the containers may be stopped: start them when Docker is around (not inside a dev container, whose
// services are managed by the container setup).
if (!(await up())) {
  const docker = !existsSync("/.dockerenv") && run("docker", ["info"], { quiet: true }).ok;
  if (docker) {
    console.log(`${blue("==>")} Starting Postgres and Redis in Docker`);
    const started = run("docker", ["compose", "up", "-d", "--wait", "postgres", "redis"], { quiet: true, env: composePorts() });
    if (!started.ok) {
      console.error(started.out);
      process.exit(1);
    }
  }
  if (!(await waitForPort(host(db), Number(db.port || 5432), docker ? 30 : 60))) {
    console.error(`${red("✗")} Postgres is not answering on ${host(db)}:${db.port || 5432}. Start Docker Desktop (or your database) and run pnpm demo again.`);
    process.exit(1);
  }
}

// Applies any new migrations after a pull; quick and safe when there are none.
const migrated = run("pnpm", ["--silent", "db:migrate"], { quiet: true });
if (!migrated.ok) {
  console.error(migrated.out);
  process.exit(1);
}

let web = "http://localhost:5173";
let apiNote = "";
if (inCodespace) {
  const domain = process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN || "app.github.dev";
  web = `https://${process.env.CODESPACE_NAME}-5173.${domain}`;
  // Best effort: the phone app and uploaded photos need the API port to be public.
  const visible = run("gh", ["codespace", "ports", "visibility", "4000:public", "-c", process.env.CODESPACE_NAME], { quiet: true }).ok;
  apiNote = visible
    ? "API port 4000 is public, so the phone app and photos work."
    : "For the phone app and photos: Ports tab → right-click port 4000 → Port Visibility → Public.";
}

console.log(`
  ✨ Illuminize demo
  ──────────────────────────────────────────────────────────────
  Web app:   ${web}
  OTP code:  123456 (any phone number; new numbers register as new members)

  Platform admin           +91 99999 99999   → ${web}/platform
  Admin, Demo University   +91 90000 00001   (auto-approve members and posts)
  Admin, Demo College      +91 90000 00002   (approval needed; has pending items)
  Admin, Demo School       +91 90000 00003
  Members                  +91 91000 00001 … 00025
  Live updates: open the app in two browsers as two members; reactions and comments
                update the other one's bell without reloading.
${apiNote ? `\n  ${apiNote}\n` : ""}
  Phone app: pnpm mobile (Expo Go, same Wi-Fi), pnpm mobile:tunnel, or pnpm mobile:web for a browser preview.
  Reset demo data: pnpm db:reset     Full guide: DEMO.md
  Stop: Ctrl+C
  ──────────────────────────────────────────────────────────────
`);
if (!process.stdout.isTTY) console.log(yellow("(output is not a terminal; logs follow)"));

const turboArgs = ["turbo", "run", "dev", "--filter=@illuminize/api", "--filter=@illuminize/web"];
const child = IS_WIN ? spawn(["pnpm", ...turboArgs].join(" "), { stdio: "inherit", shell: true }) : spawn("pnpm", turboArgs, { stdio: "inherit" });
// Ctrl+C reaches the whole process group (and console on Windows); let turbo shut the dev servers down, then exit.
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => {});
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 130 : 0)));
