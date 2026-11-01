// Helpers shared by setup-local.mjs and demo.mjs. Node built-ins only (they run before `pnpm install`).
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const IS_WIN = process.platform === "win32";
export const API_ENV = path.join("apps", "api", ".env");

/**
 * Runs a command and waits. On Windows pnpm, docker and corepack are .cmd/.exe shims that need a shell, so the
 * command line goes through it as one string (our arguments never contain spaces or quotes).
 */
export function run(cmd, args = [], { quiet = false, env } = {}) {
  const options = { stdio: quiet ? "pipe" : "inherit", encoding: "utf8", env: env ? { ...process.env, ...env } : process.env };
  const result = IS_WIN ? spawnSync([cmd, ...args].join(" "), { ...options, shell: true }) : spawnSync(cmd, args, options);
  return { ok: result.status === 0 && !result.error, status: result.status, out: `${result.stdout ?? ""}${result.stderr ?? ""}`.trim() };
}

export function readEnv(file) {
  return existsSync(file) ? readFileSync(file, "utf8") : "";
}

export function getEnv(text, key) {
  const m = new RegExp(`^${key}=(.*)$`, "m").exec(text);
  return m ? m[1].trim() : undefined;
}

/** Sets KEY=VALUE, replacing the existing line (commented-out examples are left alone) or appending one. */
export function setEnv(file, key, value) {
  let text = readEnv(file);
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, "m");
  if (re.test(text)) text = text.replace(re, line);
  else text = `${text}${text && !text.endsWith("\n") ? "\n" : ""}${line}\n`;
  writeFileSync(file, text);
}

/** Database and Redis URLs from apps/api/.env (defaults match docker-compose.yml). */
export function serviceUrls() {
  const env = readEnv(API_ENV);
  return {
    db: new URL(getEnv(env, "DATABASE_URL") || "postgres://postgres:postgres@localhost:5432/illuminize"),
    redis: new URL(getEnv(env, "REDIS_URL") || "redis://localhost:6379/0"),
  };
}

/**
 * Host ports for `docker compose`: an explicit POSTGRES_PORT / REDIS_PORT wins, otherwise the ports already in
 * apps/api/.env, so a custom port chosen once keeps working on later runs.
 */
export function composePorts() {
  const { db, redis } = serviceUrls();
  const local = (u) => ["localhost", "127.0.0.1", "::1", "[::1]"].includes(u.hostname);
  return {
    POSTGRES_PORT: process.env.POSTGRES_PORT || (local(db) && db.port) || "5432",
    REDIS_PORT: process.env.REDIS_PORT || (local(redis) && redis.port) || "6379",
  };
}

/** Resolves true once something accepts TCP connections on host:port, false after `seconds`. */
export function waitForPort(host, port, seconds) {
  const deadline = Date.now() + seconds * 1000;
  return new Promise((resolve) => {
    const attempt = () => {
      const socket = net.connect({ host, port });
      socket.setTimeout(1000);
      const retry = () => {
        socket.destroy();
        if (Date.now() >= deadline) resolve(false);
        else setTimeout(attempt, 500);
      };
      socket.once("connect", () => {
        socket.end();
        resolve(true);
      });
      socket.once("error", retry);
      socket.once("timeout", retry);
    };
    attempt();
  });
}

const paint = (code) => (s) => (process.stdout.isTTY && !process.env.NO_COLOR ? `\x1b[${code}m${s}\x1b[0m` : s);
export const blue = paint("1;34");
export const green = paint("32");
export const yellow = paint("33");
export const red = paint("31");
