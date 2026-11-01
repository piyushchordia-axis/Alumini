#!/usr/bin/env node
// One-command setup for Illuminize on Windows, macOS, Linux, a dev container or a Codespace.
//
//   node scripts/setup-local.mjs            start Postgres + Redis in Docker, write env files, install, migrate, seed
//   node scripts/setup-local.mjs --help     all options
//
// Uses Node's built-in modules only, so it runs before `pnpm install`. Safe to run again: existing env values are kept
// (except the addresses --lan / --emulator are asked to change), and migrations and the demo seed skip what exists.
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { API_ENV, blue, composePorts, green, IS_WIN, red, ROOT, run, serviceUrls, setEnv, waitForPort, yellow } from "./lib.mjs";

process.chdir(ROOT);

const PNPM_VERSION = JSON.parse(readFileSync("package.json", "utf8")).packageManager?.split("@")[1] ?? "10";
const API_ENV_EXAMPLE = path.join("apps", "api", ".env.example");
const MOBILE_ENV = path.join("apps", "mobile", ".env");
const MOBILE_ENV_EXAMPLE = path.join("apps", "mobile", ".env.example");

const HELP = `Usage: node scripts/setup-local.mjs [options]

  --skip-docker    Use a Postgres 16 and Redis 7 you already run (native install, dev container, CI) instead of Docker.
  --skip-install   Don't run pnpm install.
  --lan            Phone on the same Wi-Fi: point the phone app and photo links at this computer's network address.
  --emulator       Android emulator: point the phone app at 10.0.2.2.
  --e2e            Also download the Chromium build the end-to-end scripts use.
  -h, --help       Show this help.

Environment: POSTGRES_PORT / REDIS_PORT pick other host ports for the Docker containers (default 5432 / 6379).`;

const KNOWN = new Set(["--skip-docker", "--skip-install", "--lan", "--emulator", "--e2e", "--help", "-h"]);
const args = process.argv.slice(2);
const unknown = args.filter((a) => !KNOWN.has(a));
if (unknown.length) {
  console.error(`Unknown option: ${unknown.join(" ")}\n\n${HELP}`);
  process.exit(2);
}
const flag = (name) => args.includes(name);
if (flag("--help") || flag("-h")) {
  console.log(HELP);
  process.exit(0);
}

const step = (s) => console.log(`\n${blue("==>")} ${s}`);
const ok = (s) => console.log(`    ${green("✓")} ${s}`);
const warn = (s) => console.log(`    ${yellow("!")} ${s}`);
function fail(message, hint) {
  console.error(`\n${red("✗")} ${message}`);
  if (hint) console.error(`  ${hint.split("\n").join("\n  ")}`);
  process.exit(1);
}

function createFrom(example, file) {
  if (existsSync(file)) return false;
  writeFileSync(file, readFileSync(example, "utf8"));
  return true;
}

/** This computer's address on the local network (Wi-Fi/Ethernet), skipping virtual adapters (WSL, Hyper-V, Docker). */
function lanAddress() {
  const virtual = /vEthernet|WSL|Hyper-V|VirtualBox|VMware|docker|br-|veth|virbr|utun|tailscale|zerotier|Loopback/i;
  const candidates = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    if (virtual.test(name)) continue;
    for (const a of addrs ?? []) {
      if (a.family !== "IPv4" || a.internal) continue;
      const rank = a.address.startsWith("192.168.") ? 0 : a.address.startsWith("10.") ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(a.address) ? 2 : 3;
      if (rank < 3) candidates.push({ address: a.address, rank });
    }
  }
  candidates.sort((x, y) => x.rank - y.rank);
  return candidates[0]?.address ?? null;
}

const inCodespace = !!process.env.CODESPACE_NAME;
const inContainer = inCodespace || !!process.env.REMOTE_CONTAINERS || existsSync("/.dockerenv");
const skipDocker = flag("--skip-docker");

console.log(`${blue("Illuminize setup")}  ${os.type()} ${os.arch()}, Node ${process.versions.node}, ${ROOT}`);

// 1. Node
step("Checking Node.js");
const nodeMajor = Number(process.versions.node.split(".")[0]);
if (nodeMajor < 22) {
  fail(`Node ${process.versions.node} is too old; Illuminize needs Node 22 or newer.`, "Install the LTS from https://nodejs.org (Windows: the .msi installer), open a new terminal and run this again.");
}
ok(`Node ${process.versions.node}`);
if (IS_WIN && ROOT.length > 60) {
  warn(`This folder's path is ${ROOT.length} characters long and node_modules nests deeply; some tools fail past 260.`);
  warn("If anything reports a missing file, clone to a short path such as C:\\dev\\Alumini and run once:");
  warn("  git config --global core.longpaths true");
}

// 2. pnpm
step(`Checking pnpm (this repo uses ${PNPM_VERSION})`);
let pnpm = run("pnpm", ["--version"], { quiet: true });
if (!pnpm.ok) {
  warn("pnpm not found; enabling it with corepack");
  const enabled = run("corepack", ["enable"], { quiet: true });
  if (!enabled.ok && !IS_WIN && run("sudo", ["-n", "true"], { quiet: true }).ok) run("sudo", ["corepack", "enable"], { quiet: true });
  pnpm = run("pnpm", ["--version"], { quiet: true });
  if (!pnpm.ok) {
    fail(
      "pnpm is not available.",
      IS_WIN
        ? `Either open PowerShell as Administrator and run:  corepack enable\nor install it for your user:                       npm install -g pnpm@${PNPM_VERSION}\nThen open a new terminal and run this again.`
        : `Run:  sudo corepack enable   (or: npm install -g pnpm@${PNPM_VERSION}), then run this again.`,
    );
  }
}
const pnpmVersion = pnpm.out.split(/\s+/).pop() ?? "";
if (pnpmVersion.split(".")[0] !== PNPM_VERSION.split(".")[0]) warn(`pnpm ${pnpmVersion} found but this repo pins ${PNPM_VERSION}. If installs misbehave: npm install -g pnpm@${PNPM_VERSION}`);
else ok(`pnpm ${pnpmVersion}`);

// 3. Env files (before Docker, so custom ports land in the URLs)
step("Writing environment files");
if (createFrom(API_ENV_EXAMPLE, API_ENV)) {
  setEnv(API_ENV, "JWT_SECRET", randomBytes(32).toString("hex"));
  setEnv(API_ENV, "OTP_PEPPER", randomBytes(32).toString("hex"));
  ok(`created ${API_ENV} with fresh secrets`);
} else ok(`${API_ENV} exists; keeping your values`);
if (process.env.POSTGRES_PORT) {
  setEnv(API_ENV, "DATABASE_URL", `postgres://postgres:postgres@localhost:${process.env.POSTGRES_PORT}/illuminize`);
  ok(`DATABASE_URL uses port ${process.env.POSTGRES_PORT}`);
}
if (process.env.REDIS_PORT) {
  setEnv(API_ENV, "REDIS_URL", `redis://localhost:${process.env.REDIS_PORT}/0`);
  ok(`REDIS_URL uses port ${process.env.REDIS_PORT}`);
}

const mobileCreated = createFrom(MOBILE_ENV_EXAMPLE, MOBILE_ENV);
let mobileApi = null;
if (inCodespace) {
  // Forwarded URLs, so the browser, the phone app and uploaded photos reach the right ports.
  const domain = process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN || "app.github.dev";
  const url = (port) => `https://${process.env.CODESPACE_NAME}-${port}.${domain}`;
  setEnv(API_ENV, "PUBLIC_BASE_URL", url(4000));
  setEnv(API_ENV, "WEB_APP_URL", url(5173));
  setEnv(API_ENV, "CORS_ORIGINS", `http://localhost:5173,http://localhost:8081,${url(5173)},${url(8081)}`);
  mobileApi = url(4000);
  ok(`Codespace addresses: ${url(5173)}`);
} else if (flag("--emulator")) {
  mobileApi = "http://10.0.2.2:4000";
} else if (flag("--lan") || (mobileCreated && !inContainer)) {
  const ip = lanAddress();
  if (ip) {
    mobileApi = `http://${ip}:4000`;
    if (flag("--lan")) {
      setEnv(API_ENV, "PUBLIC_BASE_URL", mobileApi);
      ok(`photo links use ${mobileApi} (run with --lan again after changing networks)`);
    }
  } else {
    warn("No Wi-Fi/Ethernet address found; the phone app will use localhost (fine for the browser preview).");
    mobileApi = "http://localhost:4000";
  }
} else if (mobileCreated) {
  mobileApi = "http://localhost:4000";
}
if (mobileApi) {
  setEnv(MOBILE_ENV, "EXPO_PUBLIC_API_URL", mobileApi);
  ok(`phone app talks to ${mobileApi} (${MOBILE_ENV})`);
} else ok(`${MOBILE_ENV} exists; keeping your values`);

const { db } = serviceUrls();

// 4. Docker
if (skipDocker) {
  step("Using your own Postgres and Redis (--skip-docker)");
} else {
  step("Starting Postgres and Redis in Docker");
  if (!run("docker", ["--version"], { quiet: true }).ok) {
    fail("Docker is not installed or not on PATH.", "Install Docker Desktop (https://www.docker.com/products/docker-desktop/) and start it,\nor run this with --skip-docker if you run Postgres 16 and Redis 7 yourself.");
  }
  if (!run("docker", ["info"], { quiet: true }).ok) fail("Docker is installed but not running.", 'Start Docker Desktop, wait until it shows "Engine running", then run this again.');
  const ports = composePorts();
  const up = run("docker", ["compose", "up", "-d", "--wait", "postgres", "redis"], { quiet: true, env: ports });
  if (!up.ok) {
    console.error(up.out);
    const portClash = /port is already allocated|address already in use|Only one usage of each socket address|ports are not available/i.test(up.out);
    fail(
      "Could not start the Postgres and Redis containers.",
      portClash
        ? [
            "A port is already in use, usually by PostgreSQL or Redis installed directly on this computer.",
            "Stop that service (Windows: Services app → postgresql-x64-… → Stop), or use other ports. In PowerShell:",
            '  $env:POSTGRES_PORT="5433"; $env:REDIS_PORT="6380"; node scripts/setup-local.mjs',
            "Later runs remember them (they are saved in apps/api/.env).",
          ].join("\n")
        : "Check that Docker Desktop is running and can download postgres:16-alpine and redis:7-alpine.",
    );
  }
  ok(`Postgres on localhost:${ports.POSTGRES_PORT}, Redis on localhost:${ports.REDIS_PORT}`);
}

// 5. Dependencies
if (flag("--skip-install")) {
  step("Skipping pnpm install (--skip-install)");
} else {
  step("Installing dependencies (the first run takes a few minutes)");
  if (!run("pnpm", ["install", "--frozen-lockfile"]).ok) fail("pnpm install failed (see above).", "Check your internet connection and run this again.");
}

// 6. Databases
step("Preparing the database");
const dbHost = db.hostname.replace(/^\[|\]$/g, "") || "localhost";
const dbPort = Number(db.port || 5432);
if (!(await waitForPort(dbHost, dbPort, 60))) {
  fail(`Postgres is not answering on ${dbHost}:${dbPort}.`, skipDocker ? "Start your Postgres server, or run without --skip-docker to use Docker." : "Check the postgres container in Docker Desktop.");
}
const created = run("pnpm", ["--silent", "db:create"], { quiet: true });
if (!created.ok) {
  console.error(created.out);
  fail("Could not create the databases.", `Check DATABASE_URL in ${API_ENV}.`);
}
for (const line of created.out.split(/\r?\n/).filter((l) => /database/i.test(l))) (/Could not/.test(line) ? warn : ok)(line.trim());
const migrated = run("pnpm", ["--silent", "db:migrate"], { quiet: true });
if (!migrated.ok) {
  console.error(migrated.out);
  fail("Could not apply the database migrations.");
}
ok("migrations applied");
const seeded = run("pnpm", ["--silent", "db:seed"], { quiet: true });
if (!seeded.ok) {
  console.error(seeded.out);
  fail("Could not load the demo data.");
}
ok(/"generatedMembers":\s*[1-9]/.test(seeded.out) ? "demo data loaded" : "demo data already loaded");

// 7. Optional e2e browser
if (flag("--e2e")) {
  step("Downloading Chromium for the end-to-end scripts");
  if (!run("pnpm", ["exec", "playwright", "install", "chromium"]).ok) warn("Download failed; run `pnpm exec playwright install chromium` later.");
}

// 8. Next steps
const domain = process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN || "app.github.dev";
const web = inCodespace ? `https://${process.env.CODESPACE_NAME}-5173.${domain}` : "http://localhost:5173";
console.log(`
${green("Setup complete.")}

  Start the API and web app:  pnpm demo        then open ${web}
  Sign in with any mobile number; the code is 123456. Demo logins:
    Platform admin            +91 99999 99999  (${web}/platform)
    Admin, Demo University    +91 90000 00001
    Admin, Demo College       +91 90000 00002  (approvals waiting)
    Member                    +91 91000 00001
  Tests:                      pnpm test        (needs Postgres and Redis running)
  Reset the demo data:        pnpm db:reset
  Phone app:                  pnpm mobile      and scan the QR code with Expo Go on the same Wi-Fi${
    IS_WIN ? "\n                              (when Windows asks, allow Node.js on private networks)" : ""
  }
  More: README.md ("Run it on your computer") and DEMO.md
`);
