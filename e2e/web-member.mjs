import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { reconnect, runJob, scriptFeatures, scriptMembership, scriptTenant } from "./lib.mjs";

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
const PHONE_D = `6${unique.slice(0, 9).padEnd(9, "4")}`;

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

  const moreButton = page.locator('nav[aria-label="Main"] button:has-text("More")');
  const expectMoreActive = async (active, where) => {
    const current = (await moreButton.getAttribute("aria-current")) === "true";
    const tinted = (await moreButton.getAttribute("class")).split(" ").includes("text-primary");
    if (current !== active || tinted !== active) throw new Error(`More on ${where}: aria-current ${current}, tinted ${tinted}, expected ${active}`);
  };

  await step("phone layout: every section opens, with Funding behind More", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    const bar = page.locator('nav[aria-label="Main"]:visible');
    if ((await bar.locator("a").count()) !== 4) throw new Error("the bottom bar should show four sections, then More");
    const sections = [
      ["Feed", /\/app\/feed$/, "text=Welcome to the official Demo University alumni network"],
      ["Jobs", /\/app\/jobs$/, "text=Backend Engineer (Node.js)"],
      ["Directory", /\/app\/directory$/, 'input[placeholder="Name, company, role"]'],
      ["Events", /\/app\/events$/, "text=Mumbai alumni coffee meetup"],
    ];
    for (const [label, url, content] of sections) {
      await bar.locator(`a:has-text("${label}")`).click();
      await page.waitForURL(url);
      await page.waitForSelector(content);
      await expectMoreActive(false, label);
    }

    await moreButton.click();
    await page.waitForSelector('[role="dialog"] >> text=Switch institution');
    if (!(await moreButton.getAttribute("class")).split(" ").includes("text-primary")) throw new Error("More isn't highlighted while its sheet is open");
    if (await page.locator('[role="dialog"] a[aria-current="page"]').count()) throw new Error("a sheet link shows as current on Events, which is on the bar");
    await page.click('[role="dialog"] a:has-text("Funding")');
    await page.waitForURL(/\/app\/funding$/);
    await page.waitForSelector("text=Alumni raising capital and alumni investing in them");
    await expectMoreActive(true, "Funding");

    await moreButton.click();
    const current = page.locator('[role="dialog"] a[aria-current="page"]');
    await current.filter({ hasText: "Funding" }).waitFor();
    if ((await current.count()) !== 1) throw new Error("only the Funding link should show as current in the sheet");
    if (!(await current.getAttribute("class")).split(" ").includes("text-primary")) throw new Error("the current sheet link isn't styled as active");
    await shot("08a-phone-more-sheet");
    await page.keyboard.press("Escape");
    await page.locator('[role="dialog"]').waitFor({ state: "detached" });
    await expectMoreActive(true, "Funding after closing the sheet");
    await page.setViewportSize({ width: 1280, height: 900 });
  });

  await step("phone layout: More sheet reaches My posts and past events", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.click('nav[aria-label="Main"] >> button:has-text("More")');
    await page.waitForSelector('[role="dialog"] >> text=Switch institution');
    await page.click('[role="dialog"] >> text=My posts');
    await page.waitForURL(/\/app\/my-content$/);
    if (await page.locator('[role="dialog"]').count()) throw new Error("More sheet stayed open after navigating");
    await expectMoreActive(true, "My posts");
    await page.click('[role="tab"]:has-text("Past events")');
    await shot("08b-phone-my-content");
    await page.setViewportSize({ width: 1280, height: 900 });
  });

  await step("sections the institution has switched off", async () => {
    const features = await scriptFeatures(page, "demo-university");
    await page.setViewportSize({ width: 390, height: 844 });
    const bar = page.locator('nav[aria-label="Main"]:visible');
    const app = BASE + "/t/demo-university/app";
    const expectBar = async (...labels) => {
      const shown = (await bar.locator("a").allInnerTexts()).map((text) => text.split("\n").pop().trim());
      if (shown.join() !== labels.join()) throw new Error(`the bottom bar shows ${shown.join(", ")}, expected ${labels.join(", ")}`);
    };

    // The feed off: land on the next section, and with four left nothing overflows.
    features.only("jobs", "directory", "events", "funding");
    await page.goto(app);
    await page.waitForURL(/\/app\/jobs$/);
    await page.waitForSelector("text=Backend Engineer (Node.js)");
    await expectBar("Jobs", "Directory", "Events", "Funding");
    await expectMoreActive(false, "Jobs with the feed off");

    // Funding off: four sections, and nothing but the member's own links in the sheet. A link to it says so and offers a way home.
    features.only("feed", "jobs", "directory", "events");
    await page.goto(app + "/funding");
    await page.waitForSelector("text=Funding is turned off");
    await expectBar("Feed", "Jobs", "Directory", "Events");
    await moreButton.click();
    await page.waitForSelector('[role="dialog"] >> text=Switch institution');
    if (await page.locator('[role="dialog"] a:has-text("Funding")').count()) throw new Error("the sheet lists a section that is switched off");
    await page.keyboard.press("Escape");
    await page.locator('[role="dialog"]').waitFor({ state: "detached" });
    await page.click('a:has-text("Go to the app")');
    await page.waitForURL(/\/app\/feed$/);

    // Everything off: the profile is home, and More stands in for it on the bar.
    features.only();
    await page.goto(app);
    await page.waitForURL(/\/app\/profile$/);
    await page.waitForSelector('h1:has-text("My profile")');
    await expectBar();
    await expectMoreActive(true, "the profile, as home");
    await page.goto(app + "/events");
    await page.waitForSelector("text=Events is turned off");
    await features.stop();
    await page.setViewportSize({ width: 1280, height: 900 });
  });

  await step("a failed refetch keeps the open screen, and an answer from the API doesn't", async () => {
    const membership = await scriptMembership(page, "demo-university");
    const remembered = () => page.evaluate(() => JSON.parse(localStorage.getItem("illuminize.ui")).state.lastTenantSlug);
    const events = page.locator("text=Mumbai alumni coffee meetup");
    const tryAgain = page.locator('button:has-text("Try again")');
    const openEvents = async () => {
      membership.answer(null);
      await page.goto(BASE + "/t/demo-university/app/events");
      await events.waitFor();
    };

    await openEvents();
    membership.answer(503, "INTERNAL");
    await membership.refetch();
    if (!(await events.isVisible()) || (await tryAgain.count())) throw new Error("a 503 on a background refetch replaced the open screen");
    if ((await remembered()) !== "demo-university") throw new Error("a 503 forgot the institution");

    // Removed from the institution: the register form, and it stays even when a later refetch can't get through.
    membership.answer(404, "NOT_A_MEMBER");
    await membership.refetch();
    await page.waitForURL(/\/register$/);
    await page.waitForSelector("text=Create your profile");
    if ((await remembered()) !== null) throw new Error("an institution they were removed from stayed remembered");
    await page.fill('input[name="fullName"]', "Still typing");
    membership.answer(503, "INTERNAL");
    await reconnect(page);
    await page.waitForTimeout(1000);
    if (!page.url().endsWith("/register")) throw new Error("a failed refetch sent a removed member back into the app");
    if ((await page.inputValue('input[name="fullName"]')) !== "Still typing") throw new Error("a failed refetch lost what was typed on the register form");

    // A suspended institution: the answer stands until a success, so a later failure must not bring the old screen back.
    await openEvents();
    membership.answer(403, "TENANT_INACTIVE");
    await membership.refetch();
    await tryAgain.waitFor();
    await page.waitForSelector("text=e2e TENANT_INACTIVE");
    if ((await remembered()) !== null) throw new Error("a suspended institution stayed remembered");
    membership.answer(503, "INTERNAL");
    await membership.refetch();
    await tryAgain.waitFor();
    if (await events.count()) throw new Error("a 503 after a 403 reopened the app from the cached membership");
    if ((await remembered()) !== null) throw new Error("a 503 after a 403 remembered the institution again");

    // Nothing cached: a 503 has no screen to keep, isn't a reason to forget the institution, and trying again recovers.
    await openEvents();
    membership.answer(503, "INTERNAL");
    await page.goto(BASE + "/t/demo-university/app/events");
    await tryAgain.waitFor();
    if ((await remembered()) !== "demo-university") throw new Error("a 503 with nothing cached forgot the institution");
    membership.answer(null);
    await tryAgain.click();
    await events.waitFor();
    await membership.stop();
  });

  await step("a failed institution refetch keeps the open screen, and a 404 doesn't", async () => {
    const tenant = await scriptTenant(page, "demo-university");
    const events = page.locator("text=Mumbai alumni coffee meetup");
    const tryAgain = page.locator('button:has-text("Try again")');
    await page.goto(BASE + "/t/demo-university/app/events");
    await events.waitFor();

    tenant.answer(503, "INTERNAL");
    await tenant.refetch();
    if (!(await events.isVisible()) || (await tryAgain.count())) throw new Error("a 503 on the institution replaced the open screen");

    tenant.answer(404, "TENANT_NOT_FOUND");
    await tenant.refetch();
    await tryAgain.waitFor();
    await page.waitForSelector("text=e2e TENANT_NOT_FOUND");

    tenant.answer(503, "INTERNAL");
    await tenant.refetch();
    await tryAgain.waitFor();
    if (await events.count()) throw new Error("a 503 after a 404 reopened the app from the cached institution");

    tenant.answer(null);
    await tryAgain.click();
    await events.waitFor();
    await tenant.stop();
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

  await step("a forced sign-out leaves nothing cached for whoever signs in next", async () => {
    // Signed in as the pending member from the last step, with that membership cached.
    const membership = await scriptMembership(page, "demo-college");
    membership.answer(401, "SESSION_REVOKED");
    await membership.refetch();
    await page.waitForURL(/\/t\/demo-college\/login/);
    // The next person's membership can't load, so the old one would be all there is to show.
    membership.answer(503, "INTERNAL");
    await loginWithPhone(PHONE_D);
    await page.waitForSelector("text=e2e INTERNAL");
    if (await page.locator("text=Awaiting approval").count()) throw new Error("the next person to sign in saw the last member's cached membership");
    await membership.stop();
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
