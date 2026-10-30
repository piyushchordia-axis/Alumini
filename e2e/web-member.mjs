import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const BASE = "http://localhost:5173";
const SHOTS = process.env.SHOTS ?? new URL("./screenshots/", import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });
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
const unique = String(Date.now()).slice(-8); // 8 digits → +919N phone
const PHONE_A = `9${unique.slice(0, 9).padEnd(9, "1")}`; // 10 digits starting with 9
const PHONE_B = `8${unique.slice(0, 9).padEnd(9, "2")}`;

const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.setDefaultTimeout(15000);
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
  await step("tenant picker lists seeded institutions", async () => {
    await page.goto(BASE + "/");
    await page.waitForSelector("text=Demo University");
    await page.waitForSelector("text=Demo College of Engineering");
    await shot("01-picker");
  });

  await step("landing → login with OTP (new user) → register → auto-approved feed", async () => {
    await page.click("text=Demo University");
    await page.waitForSelector("text=Sign in / Join");
    await shot("02-landing");
    await page.click("text=Sign in / Join");
    await loginWithPhone(PHONE_A);
    await page.waitForURL(/\/register$/);
    await shot("03-register");
    await page.fill('input[name="fullName"]', "Smoke Tester");
    await page.selectOption('select[name="batchYear"]', "2012");
    await page.selectOption('select[name="professionType"]', "FOUNDER");
    await page.fill('input[name="companyName"]', "Smoke Labs");
    await page.fill('input[name="city"]', "Mumbai");
    await page.click('button:has-text("Join the network")');
    await page.waitForURL(/\/app\/feed$/);
    await page.waitForSelector("text=Welcome to the official Demo University alumni network");
    await shot("04-feed");
  });

  await step("post to the feed and react", async () => {
    const body = `Hello from smoke run ${unique} 👋`;
    await page.fill("textarea", body);
    await page.click('button:has-text("Post")');
    const card = page.locator("article", { hasText: body }).first();
    await card.waitFor();
    await card.locator('button[aria-label="celebrate"]').click();
    await card.locator("span.ml-1").filter({ hasText: /^\s*1\s*$/ }).waitFor({ timeout: 10000 });
    await card.locator("a", { hasText: "comments" }).click();
    await page.waitForURL(/\/app\/feed\/[0-9a-f-]+$/);
    await page.waitForSelector('h2:has-text("Comments")');
    await page.fill('textarea[placeholder="Write a comment…"]', "First comment!");
    await page.click('button:has-text("Reply")');
    await page.waitForSelector("text=First comment!");
    await shot("05-post-detail");
  });

  await step("create a job and view it", async () => {
    await page.click('nav >> text=Jobs');
    await page.waitForSelector("text=Backend Engineer (Node.js)");
    await page.click("text=+ Post a job");
    await page.fill('input[name="title"]', "Smoke Test Engineer");
    await page.fill('input[name="companyName"]', "Smoke Labs");
    await page.fill('textarea[name="description"]', "Keep the smoke tests green. Remote within India.");
    await page.click('button:has-text("Post job")');
    await page.waitForURL(/\/app\/jobs\/[0-9a-f-]+$/);
    await page.waitForSelector("h1:has-text('Smoke Test Engineer')");
    await shot("06-job-detail");
  });

  await step("RSVP to a seeded event", async () => {
    await page.click('nav >> text=Events');
    await page.click("text=Mumbai alumni coffee meetup");
    await page.waitForSelector("text=Who's going");
    const before = await page.locator("strong").first().textContent();
    await page.click("button:has-text(\"I'm going\")");
    await page.locator("strong").first().filter({ hasText: new RegExp(`^${Number(before) + 1}$`) }).waitFor({ timeout: 10000 });
    await page.waitForSelector("text=Smoke Tester");
    await shot("07-event");
  });

  await step("directory search and profile", async () => {
    await page.click('nav >> text=Directory');
    await page.fill('input[placeholder="Name, company, role"]', "Priya");
    await page.waitForSelector("text=Priya Nair");
    await page.click("text=Priya Nair");
    await page.waitForSelector("h1:has-text('Priya Nair')");
    await shot("08-member");
  });

  await step("notifications page + sign out", async () => {
    await page.click('a[aria-label="Notifications"]');
    await page.waitForSelector("h1:has-text('Notifications')");
    await page.click("text=Sign out");
    await page.waitForURL(/\/t\/demo-university$/);
  });

  await step("ADMIN_APPROVAL tenant: registration lands on pending screen", async () => {
    await page.goto(BASE + "/t/demo-college/login");
    await loginWithPhone(PHONE_B);
    await page.waitForURL(/\/register$/);
    await page.fill('input[name="fullName"]', "Pending Smoke");
    await page.selectOption('select[name="batchYear"]', "2010");
    await page.click('button:has-text("Submit for approval")');
    await page.waitForURL(/\/pending$/);
    await page.waitForSelector("text=Awaiting approval");
    await shot("09-pending");
  });

  console.log(results.join("\n"));
  console.log("SMOKE OK");
} catch (err) {
  console.log(results.join("\n"));
  console.error("SMOKE FAILED:", err);
  await page.screenshot({ path: `${SHOTS}/failure.png`, fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
