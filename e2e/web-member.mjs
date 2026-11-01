import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { runJob } from "./lib.mjs";

const BASE = "http://localhost:5173";
// fileURLToPath, not URL.pathname: on Windows .pathname gives "/C:/…", which fs can't use.
const SHOTS = process.env.SHOTS ?? fileURLToPath(new URL("./screenshots/", import.meta.url));
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
const PHONE_C = `7${unique.slice(0, 9).padEnd(9, "3")}`;

const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.setDefaultTimeout(15000);
const shot = (n) => page.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: true });

async function loginWithPhone(number, p = page) {
  await p.fill('input[type="tel"]', number);
  await p.click('button:has-text("Send code")');
  await p.waitForSelector("text=Development mode");
  const code = (await p.textContent("span.font-mono")).trim();
  await p.fill('input[inputmode="numeric"]', code);
  await p.click('button:has-text("Verify and continue")');
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
    // The institution's own profile questions (seeded, optional) live under "More about you".
    await page.click("text=More about you (optional)");
    await page.getByLabel("Department").selectOption({ label: "Computer Science" });
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
    await card.locator('button[aria-label="Celebrate"]').click();
    await card.locator("span.ml-1").filter({ hasText: /^\s*1\s*$/ }).waitFor({ timeout: 10000 });
    await card.locator("a", { hasText: "comments" }).click();
    await page.waitForURL(/\/app\/feed\/[0-9a-f-]+$/);
    await page.waitForSelector('h2:has-text("Comments")');
    await page.fill('textarea[placeholder="Write a comment…"]', "First comment!");
    await page.click('button:has-text("Reply")');
    await page.waitForSelector("text=First comment!");
    await shot("05-post-detail");
  });

  await step("edit your own post", async () => {
    const card = page.locator("article").first();
    await card.locator('button:has-text("Edit")').click();
    await card.locator('textarea[aria-label="Edit post"]').fill(`Edited smoke post ${unique}`);
    await card.locator('button:has-text("Save")').click();
    await page.waitForSelector(`text=Edited smoke post ${unique}`);
  });

  await step("live notification: the bell updates without a reload", async () => {
    // A second member in their own browser posts; the first member reacts; the second member's bell updates live.
    const other = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const pageB = await other.newPage();
    pageB.setDefaultTimeout(15000);
    await pageB.goto(`${BASE}/t/demo-university/login`);
    await loginWithPhone(PHONE_C, pageB);
    await pageB.waitForURL(/\/register$/);
    await pageB.fill('input[name="fullName"]', "Live Listener");
    await pageB.selectOption('select[name="batchYear"]', "2015");
    await pageB.click('button:has-text("Join the network")');
    await pageB.waitForURL(/\/app\/feed$/);
    const body = `Live check ${unique}`;
    await pageB.fill("textarea", body);
    await pageB.click('button:has-text("Post")');
    await pageB.locator("article", { hasText: body }).first().waitFor();
    await pageB.waitForSelector('a[aria-label="Notifications"]');

    await page.goto(`${BASE}/t/demo-university/app/feed`);
    const card = page.locator("article", { hasText: body }).first();
    await card.locator('button[aria-label="Celebrate"]').click();

    // While connected, polling only runs every 5 minutes, so only the live update can pass within 8 seconds.
    await pageB.waitForSelector('a[aria-label="Notifications, 1 unread"]', { timeout: 8000 });
    await pageB.screenshot({ path: `${SHOTS}/06b-live-bell.png` });
    await other.close();
  });

  await step("announcement is pinned with its badge; vote in a poll", async () => {
    await page.goto(BASE + "/t/demo-university/app/feed");
    const ann = page.locator("article", { hasText: "Registrations for DemoU Alumni Day 2026" }).first();
    await ann.waitFor();
    await ann.locator("text=📣 Announcement").waitFor();
    const poll = page.locator("article", { hasText: "Where should we hold the next London meetup?" }).first();
    await poll.waitFor();
    await poll.locator('[aria-label="Poll"] button:has-text("Shoreditch")').click();
    await poll.locator("text=Shoreditch ✓").waitFor();
    await poll.locator("text=/\\d+%/").first().waitFor();
    await shot("04b-announcement-poll");
  });

  await step("celebrations card: send birthday wishes", async () => {
    const card = page.locator("section", { hasText: "Celebrating today" }).first();
    await card.waitFor();
    await card.locator('button:has-text("Send wishes")').first().click();
    await card.locator("text=Wished ✓").first().waitFor();
  });

  await step("weekly digest: run it now and read “This week”", async () => {
    await runJob("digest", "demo-university");
    for (let i = 0; i < 10; i++) {
      await page.goto(BASE + "/t/demo-university/app/digest");
      await page.waitForSelector("text=This week at DemoU");
      if (await page.locator("h2:has-text('Popular posts')").count()) break;
      await page.waitForTimeout(1000);
    }
    await page.waitForSelector("h2:has-text('Popular posts')");
    await shot("04c-digest");
    await page.goto(BASE + "/t/demo-university/app/feed");
    await page.waitForSelector("text=This week");
  });

  await step("create a job and view it", async () => {
    await page.click('nav >> text=Jobs');
    await page.waitForSelector("text=Backend Engineer (Node.js)");
    await page.click("text=+ Post a job");
    await page.fill('input[name="title"]', `Smoke Test Engineer ${unique}`);
    await page.fill('input[name="companyName"]', "Smoke Labs");
    await page.fill('textarea[name="description"]', "Keep the smoke tests green. Remote within India.");
    await page.click('button:has-text("Post job")');
    await page.waitForURL(/\/app\/jobs\/[0-9a-f-]+$/);
    await page.waitForSelector("h1:has-text('Smoke Test Engineer')");
    await shot("06-job-detail");
  });

  await step("delete your own job through the confirm dialog", async () => {
    await page.click('button:has-text("Delete")');
    const dialog = page.locator('[role="dialog"]', { hasText: "Delete this job?" });
    await dialog.waitFor();
    await dialog.locator('button:has-text("Cancel")').click();
    await dialog.waitFor({ state: "detached" });
    await page.waitForSelector("h1:has-text('Smoke Test Engineer')");
    await page.click('button:has-text("Delete")');
    await dialog.locator('button:has-text("Delete job")').click();
    await page.waitForURL(/\/app\/jobs$/);
    await page.waitForSelector("text=Backend Engineer (Node.js)");
    await page.locator(`text=Smoke Test Engineer ${unique}`).waitFor({ state: "detached" });
  });

  await step("RSVP to a seeded event", async () => {
    await page.click('nav >> text=Events');
    await page.click("text=Mumbai alumni coffee meetup");
    await page.waitForSelector("text=Who's coming");
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

  await step("phone layout: More sheet reaches My posts and past events", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.click('nav[aria-label="Main"] >> button:has-text("More")');
    await page.waitForSelector('[role="dialog"] >> text=Switch institution');
    await page.click('[role="dialog"] >> text=My posts');
    await page.waitForURL(/\/app\/my-content$/);
    if (await page.locator('[role="dialog"]').count()) throw new Error("More sheet stayed open after navigating");
    await page.click('[role="tab"]:has-text("Past events")');
    await shot("08b-phone-my-content");
    await page.setViewportSize({ width: 1280, height: 900 });
  });

  await step("notifications page, notification settings + sign out", async () => {
    await page.click('a[aria-label^="Notifications"]');
    await page.waitForSelector("h1:has-text('Notifications')");
    await page.click("text=⚙️ Settings");
    await page.waitForSelector("h1:has-text('Notification settings')");
    const celebrations = page.locator('[role="radiogroup"][aria-label="Birthdays and anniversaries"]');
    await celebrations.locator('[role="radio"]:has-text("Off")').click();
    await page.reload();
    await celebrations.locator('[role="radio"][aria-checked="true"]:has-text("Off")').waitFor();
    await shot("08c-notification-settings");
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
