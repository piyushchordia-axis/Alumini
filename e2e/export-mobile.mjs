// Exports the Expo app for the web into e2e/.expo-web, pointed at the local API, for e2e/mobile-web.mjs.
//   pnpm e2e:mobile:export      then, in a second terminal: pnpm e2e:mobile:serve
// A Node wrapper instead of `EXPO_PUBLIC_API_URL=… npx expo export`, which doesn't work in PowerShell or cmd.
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "e2e", ".expo-web");
const apiUrl = process.env.EXPO_PUBLIC_API_URL || "http://localhost:4000";

rmSync(out, { recursive: true, force: true });
const args = ["exec", "expo", "export", "--platform", "web", "--output-dir", out];
const env = { ...process.env, EXPO_PUBLIC_API_URL: apiUrl };
const cwd = path.join(root, "apps", "mobile");
// pnpm is a .cmd shim on Windows, so it needs a shell there; quote the output path in case it has spaces.
const result =
  process.platform === "win32"
    ? spawnSync(["pnpm", ...args.slice(0, -1), `"${out}"`].join(" "), { cwd, env, stdio: "inherit", shell: true })
    : spawnSync("pnpm", args, { cwd, env, stdio: "inherit" });
if (result.status !== 0) process.exit(result.status ?? 1);
console.log(`\nExported for ${apiUrl} into ${path.relative(root, out)}. Serve it with: pnpm e2e:mobile:serve`);
