/**
 * Runs an institution's scheduled work now, for demos and support: `pnpm jobs:run celebrations demo-university`.
 * Runs in this process (the queue only carries the follow-up deliveries, which the API's inline worker or
 * `pnpm worker` sends). Add --force to run a day that already ran.
 */
import { createRuntime } from "../bootstrap";
import { loadConfig, loadDotenvFiles } from "../config/env";
import { createLogger } from "../lib/logger";
import { resetTenantRun } from "../repositories/engagement.repo";
import { findTenantBySlug } from "../repositories/tenants.repo";
import { localClock, runCelebrations } from "../services/celebrations.service";

async function main(): Promise<void> {
  const [job, slug] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const force = process.argv.includes("--force");
  if (job !== "celebrations" || !slug) {
    console.error("Usage: pnpm jobs:run celebrations <institution-slug> [--force]");
    process.exit(2);
  }
  loadDotenvFiles();
  const config = loadConfig();
  const runtime = await createRuntime({ role: "worker", config, logger: createLogger(config.LOG_LEVEL, config.isDevelopment) });
  try {
    const tenant = await findTenantBySlug(runtime.ctx.db, slug);
    if (!tenant) throw new Error(`No institution with slug "${slug}"`);
    const day = localClock(new Date(), tenant.timezone).day;
    if (force) await resetTenantRun(runtime.ctx.db, job, tenant.id, day);
    await runCelebrations(runtime.ctx, { tenantId: tenant.id, day }, { attempt: 1, maxAttempts: 1 });
    console.log(`Ran ${job} for ${tenant.name} (${day}).`);
  } finally {
    await runtime.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
