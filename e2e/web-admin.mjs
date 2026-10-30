import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const BASE = "http://localhost:5173";
const SHOTS = process.env.SHOTS ?? new URL("./screenshots/", import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });
const unique = String(Date.now()).slice(-6);
const results = [];
const step = async (name, fn) => {
  try {
    await fn();
    results.push(`✓ ${name}`);
  } catch (err) {
    results.push(`✗ ${name}: ${String(err).split("\n")[0]}`);
    throw err;
  }
};

const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.setDefaultTimeout(15000);
page.on("dialog", (d) => d.accept());
const shot = (n) => page.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: true });

async function loginWithPhone(number) {
  await page.fill('input[type="tel"]', number);
  await page.click('button:has-text("Send code")');
  await page.waitForSelector("text=Development mode");
  const code = (await page.textContent("span.font-mono")).trim();
  await page.fill('input[inputmode="numeric"]', code);
  await page.click('button:has-text("Verify and continue")');
}

try {
  await step("tenant admin signs in and sees dashboard counts", async () => {
    await page.goto(`${BASE}/t/demo-college/login`);
    await loginWithPhone("9000000002");
    await page.waitForURL(/\/app\/feed$/);
    await page.goto(`${BASE}/t/demo-college/admin`);
    await page.waitForURL(/\/admin\/dashboard$/);
    await page.waitForSelector("text=Pending members");
    await shot("a01-dashboard");
  });

  await step("approve a pending member", async () => {
    await page.goto(`${BASE}/t/demo-college/admin/members?status=PENDING`);
    const row = page.locator("li", { hasText: "Divya Menon" }).first();
    await row.waitFor();
    await row.locator('button:has-text("Approve")').click();
    await page.waitForSelector("text=Member approved");
    await page.goto(`${BASE}/t/demo-college/admin/members?status=APPROVED`);
    await page.waitForSelector("li:has-text('Divya Menon')");
    await shot("a02-members");
  });

  await step("reject a pending member with a reason", async () => {
    await page.goto(`${BASE}/t/demo-college/admin/members?status=PENDING`);
    const row = page.locator("li", { hasText: "Amit Verma" }).first();
    await row.waitFor();
    await row.locator('button:has-text("Reject")').click();
    await page.fill("textarea", "Could not verify batch, please add your roll number");
    await page.click('button:has-text("Reject"):not(:has-text("Rejected"))  >> nth=-1');
    await page.waitForSelector("text=Request rejected");
  });

  await step("approve a pending job from the moderation queue", async () => {
    await page.goto(`${BASE}/t/demo-college/admin/moderation`);
    const row = page.locator("li", { hasText: "Robotics Intern" }).first();
    await row.waitFor();
    await row.locator('button:has-text("View full content")').click();
    await page.waitForSelector("text=ROS2");
    await row.locator('button:has-text("Approve")').click();
    await page.waitForSelector("text=Job approved");
    await shot("a03-moderation");
  });

  await step("resolve the spam report by removing content", async () => {
    await page.goto(`${BASE}/t/demo-college/admin/reports`);
    await page.waitForSelector("text=Earn $5000/week");
    await page.click('button:has-text("Remove content")');
    await page.fill("textarea", "Confirmed spam");
    await page.click('div[role="dialog"] button:has-text("Remove")');
    await page.waitForSelector("text=Report resolved");
    await page.waitForSelector("text=No open reports");
    await shot("a04-reports");
  });

  await step("settings page loads and saves", async () => {
    await page.goto(`${BASE}/t/demo-college/admin/settings`);
    await page.waitForSelector("text=New member approval");
    await page.click('button:has-text("Save settings")');
    await page.waitForSelector("text=Settings saved");
    await page.click("text=Branding");
    await page.waitForSelector("text=Preview");
    await shot("a05-settings");
  });

  await step("platform admin signs in and sees institutions", async () => {
    await page.goto(`${BASE}/t/demo-college/app/profile`);
    await page.click('button:has-text("Sign out")');
    await page.waitForURL(/\/t\/demo-college$/);
    await page.goto(`${BASE}/platform/login`);
    await loginWithPhone("9999999999");
    await page.waitForURL(/\/platform\/tenants$/);
    await page.waitForSelector("text=Demo University");
    await page.waitForSelector("text=Demo International School");
    await shot("p01-tenants");
  });

  await step("onboard a new institution with an initial admin", async () => {
    await page.click("text=+ Onboard institution");
    await page.locator('label:has-text("Name") input').first().fill(`Smoke Institute ${unique}`);
    await page.locator('label:has-text("URL slug") input').fill(`smoke-institute-${unique}`);
    await page.locator('label:has-text("Admin mobile") input').fill(`+9177${unique}0000`.slice(0, 13));
    await page.locator('label:has-text("Admin name") input').fill("Smoke Admin");
    await page.click('button:has-text("Onboard institution")');
    await page.waitForURL(/\/platform\/tenants\/[0-9a-f-]+$/);
    await page.waitForSelector(`text=Smoke Institute ${unique}`);
    await page.click("text=Admins");
    await page.waitForSelector("text=Smoke Admin");
    await shot("p02-tenant-detail");
  });

  await step("record a billing plan and see usage", async () => {
    await page.click("text=Billing");
    await page.waitForSelector("text=Record a new plan");
    await page.fill('input[type="number"][step="0.01"]', "50");
    await page.click('button:has-text("Record plan")');
    await page.waitForSelector("text=Billing plan recorded");
    await page.waitForSelector("text=Per active user · ₹50 per active member");
    await page.waitForSelector("text=Estimated amount");
    await shot("p03-billing");
  });

  await step("platform stats and users", async () => {
    await page.goto(`${BASE}/platform/stats`);
    await page.waitForSelector("text=Institutions");
    await page.waitForSelector(`text=Smoke Institute ${unique}`);
    await page.goto(`${BASE}/platform/users`);
    await page.fill('input[placeholder="Search by phone digits"]', "9000000002");
    await page.waitForSelector("text=Suresh Patil");
    await shot("p04-users");
  });

  console.log(results.join("\n"));
  console.log("ADMIN SMOKE OK");
} catch (err) {
  console.log(results.join("\n"));
  console.error("ADMIN SMOKE FAILED:", err);
  await page.screenshot({ path: `${SHOTS}/admin-failure.png`, fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
