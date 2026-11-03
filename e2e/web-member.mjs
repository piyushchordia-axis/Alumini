import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { dropFrames, reconnect, runJob, scriptBusiness, scriptConversation, scriptFeatures, scriptMembership, scriptNotification, scriptTenant, signedInContext } from "./lib.mjs";

const BASE = process.env.WEB_URL ?? "http://localhost:5173";
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
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
// The second member registered below, kept signed in for the groups journey so it costs no extra login. Unique per run, so
// an invitation search can't pick a member an earlier run registered.
const LISTENER = `Live Listener ${unique.slice(-4)}`;
let listener = null;

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
    await pageB.fill('input[name="fullName"]', LISTENER);
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
    listener = { context: other, page: pageB };
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

  await step("businesses: search and filter, with contact details only on a listing's own page", async () => {
    await page.click('nav >> text=Businesses');
    await page.waitForURL(/\/app\/businesses$/);
    const zylo = page.locator("h3", { hasText: "Zylo Labs" });
    const singh = page.locator("h3", { hasText: "Singh Textiles" });
    await zylo.waitFor();
    await singh.waitFor();
    if (await page.locator("text=hello@zylolabs.example").count()) throw new Error("the list shows a contact email");
    if (await page.locator("text=5550 0101").count()) throw new Error("the list shows a contact phone");
    await shot("08-businesses");

    const search = page.getByLabel("Search businesses");
    await search.fill("lending software");
    await singh.waitFor({ state: "detached" });
    await zylo.waitFor();
    await search.fill("");
    await singh.waitFor();

    const category = page.getByLabel("Category", { exact: true });
    await category.selectOption("MANUFACTURING");
    await zylo.waitFor({ state: "detached" });
    await singh.waitFor();
    await category.selectOption("");
    await zylo.waitFor();

    const city = page.getByLabel("City", { exact: true });
    await city.fill("surat");
    await zylo.waitFor({ state: "detached" });
    await singh.waitFor();
    await city.fill("nowhere at all");
    await page.waitForSelector("text=No businesses match");
    await city.fill("");
    await zylo.waitFor();

    await zylo.click();
    await page.waitForURL(/\/app\/businesses\/[0-9a-f-]+$/);
    await page.waitForSelector("h1:has-text('Zylo Labs')");
    await page.waitForSelector('a[href="mailto:hello@zylolabs.example"]');
    await page.waitForSelector('a[href^="tel:"]:has-text("5550 0101")');
    await page.waitForSelector('button:has-text("Report")');
    await shot("08-business-detail");
  });

  await step("businesses: add a listing, edit it, find it in My posts and delete it through the confirm dialog", async () => {
    const name = `Smoke Bakery ${unique}`;
    const contact = `bakery${unique}@example.com`;
    await page.goto(BASE + "/t/demo-university/app/businesses");
    await page.click('a:has-text("Add a business")');
    await page.waitForURL(/\/app\/businesses\/new$/);
    // The name mobile-web.mjs finds the same control by, as with the logo's remove button below.
    await page.getByLabel("Business name *", { exact: true }).fill(name);
    await page.selectOption('select[name="category"]', "FOOD_BEVERAGE");
    await page.fill('input[name="city"]', "Mumbai");
    await page.fill('textarea[name="description"]', "Sourdough baked for the smoke tests every morning.");
    await page.setInputFiles('input[type="file"]', { name: "logo.png", mimeType: "image/png", buffer: PNG });
    await page.locator('img[src*="/uploads/"]').waitFor();
    await page.getByRole("button", { name: "Remove logo", exact: true }).waitFor();
    await page.fill('input[name="contactEmail"]', contact);
    await page.fill('input[name="contactPhone"]', "+91 22 5550 0199");

    // A javascript: link must not reach an href.
    await page.fill('input[name="websiteUrl"]', "javascript:alert(1)");
    await page.click('button:has-text("Publish listing")');
    await page.locator('label:has-text("Website") [role="alert"]').waitFor();
    if (!page.url().endsWith("/businesses/new")) throw new Error("a javascript: website was accepted");
    await page.fill('input[name="websiteUrl"]', "https://example.com/smoke-bakery");

    await page.click('button:has-text("Publish listing")');
    await page.waitForURL(/\/app\/businesses\/[0-9a-f-]+$/);
    await page.waitForSelector(`h1:has-text("${name}")`);
    await page.waitForSelector(`a[href="mailto:${contact}"]`);
    await page.waitForSelector('a[href="https://example.com/smoke-bakery"]');
    if (await page.locator('button:text-is("Report")').count()) throw new Error("your own listing offers to report it");

    await page.click('a[href$="/edit"]');
    await page.waitForURL(/\/edit$/);
    if ((await page.inputValue('input[name="contactEmail"]')) !== contact) throw new Error("the edit form lost the contact email");
    await page.fill('input[name="name"]', `${name} and Sons`);
    // A background refetch failing must not replace the form and lose what was typed.
    const editing = await scriptBusiness(page, "demo-university", /\/businesses\/([0-9a-f-]+)\/edit$/.exec(page.url())[1]);
    editing.answer(503, "INTERNAL");
    await editing.refetch();
    if ((await page.inputValue('input[name="name"]')) !== `${name} and Sons`) throw new Error("a failed refetch lost what was typed on the edit form");
    await editing.stop();
    await page.click('button:has-text("Save changes")');
    await page.waitForSelector(`h1:has-text("${name} and Sons")`);

    await page.goto(BASE + "/t/demo-university/app/my-content");
    await page.click('[role="tab"]:has-text("Businesses")');
    await page.locator("h3", { hasText: `${name} and Sons` }).click();
    await page.waitForURL(/\/app\/businesses\/[0-9a-f-]+$/);

    await page.click('button:has-text("Delete")');
    const dialog = page.locator('[role="dialog"]', { hasText: "Delete this listing?" });
    await dialog.waitFor();
    await dialog.locator('button:has-text("Cancel")').click();
    await dialog.waitFor({ state: "detached" });
    await page.waitForSelector(`h1:has-text("${name} and Sons")`);
    await page.click('button:has-text("Delete")');
    await dialog.locator('button:has-text("Delete listing")').click();
    await page.waitForURL(/\/app\/businesses$/);
    await page.locator("h3", { hasText: "Zylo Labs" }).waitFor();
    await page.locator(`text=${name} and Sons`).waitFor({ state: "detached" });
  });

  const moreButton = page.locator('nav[aria-label="Main"] button:has-text("More")');
  const expectMoreActive = async (active, where) => {
    const current = (await moreButton.getAttribute("aria-current")) === "true";
    const tinted = (await moreButton.getAttribute("class")).split(" ").includes("text-primary");
    if (current !== active || tinted !== active) throw new Error(`More on ${where}: aria-current ${current}, tinted ${tinted}, expected ${active}`);
  };

  await step("phone layout: every section opens, with Events and Funding behind More", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    const bar = page.locator('nav[aria-label="Main"]:visible');
    if ((await bar.locator("a").count()) !== 4) throw new Error("the bottom bar should show four sections, then More");
    const sections = [
      ["Feed", /\/app\/feed$/, "text=Welcome to the official Demo University alumni network"],
      ["Messages", /\/app\/messages$/, "main >> text=Messages"],
      ["Jobs", /\/app\/jobs$/, "text=Backend Engineer (Node.js)"],
      ["Directory", /\/app\/directory$/, 'input[placeholder="Name, company, role"]'],
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
    if (await page.locator('[role="dialog"] a[aria-current="page"]').count()) throw new Error("a sheet link shows as current on Directory, which is on the bar");
    await page.click('[role="dialog"] a:has-text("Events")');
    await page.waitForURL(/\/app\/events$/);
    await page.waitForSelector("text=Mumbai alumni coffee meetup");
    await expectMoreActive(true, "Events");

    await moreButton.click();
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

    await moreButton.click();
    await page.click('[role="dialog"] a:has-text("Businesses")');
    await page.waitForURL(/\/app\/businesses$/);
    await page.locator("h3", { hasText: "Zylo Labs" }).waitFor();
    await expectMoreActive(true, "Businesses");

    await moreButton.click();
    await page.click('[role="dialog"] a:has-text("Groups")');
    await page.waitForURL(/\/app\/groups$/);
    await page.getByRole("tab", { name: "Discover", selected: true }).waitFor();
    await page.locator("h3", { hasText: "London & UK alumni" }).waitFor();
    await expectMoreActive(true, "Groups");
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
    for (const section of ["Funding", "Businesses"]) {
      if (await page.locator(`[role="dialog"] a:has-text("${section}")`).count()) throw new Error(`the sheet lists ${section}, which is switched off`);
    }
    await page.keyboard.press("Escape");
    await page.locator('[role="dialog"]').waitFor({ state: "detached" });
    await page.click('a:has-text("Go to the app")');
    await page.waitForURL(/\/app\/feed$/);
    await page.goto(app + "/businesses");
    await page.waitForSelector("text=Businesses is turned off");
    await page.goto(app + "/my-content");
    await page.locator('[role="tab"]:has-text("Posts")').waitFor();
    if (await page.locator('[role="tab"]:has-text("Businesses")').count()) throw new Error("My posts has a tab for a section that is switched off");

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

  await step("two members message each other live: request, accept, replies, a report and a block", async () => {
    // Seeded members with no thread between them. mobile-web.mjs uses a different pair, so the two scripts can run in either order.
    const desktop = { viewport: { width: 1280, height: 900 } };
    const contextA = await signedInContext(browser, BASE, "+919100000004", desktop); // Meera Iyer
    const contextB = await signedInContext(browser, BASE, "+919100000006", desktop); // Sneha Kulkarni
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();
    for (const p of [pageA, pageB]) p.setDefaultTimeout(15000);
    const app = `${BASE}/t/demo-university/app`;
    const log = (p) => p.locator('[role="log"]');
    const live = { timeout: 8000 };

    // B waits on Requests, so the request has to arrive there live.
    await pageB.goto(`${app}/messages`);
    await pageB.getByRole("tab", { name: "Requests" }).click();
    await pageB.waitForSelector("text=No message requests");
    const badgeB = pageB.locator('nav[aria-label="Main"]:visible a[href$="/app/messages"]');
    if (await badgeB.getAttribute("aria-label")) throw new Error(`B starts with something waiting: ${await badgeB.getAttribute("aria-label")}`);

    // A asks from B's profile. The first message goes as a request, and nothing more can follow it until B answers.
    await pageA.goto(`${app}/directory`);
    await pageA.fill('input[placeholder="Name, company, role"]', "Sneha");
    await pageA.click("text=Sneha Kulkarni");
    await pageA.getByRole("link", { name: "Message this member" }).click();
    await pageA.waitForURL(/\/messages\/new\?to=[0-9a-f-]+$/);
    await pageA.waitForSelector("text=Your first message is a request");
    const asked = `Hello Sneha, could I ask about Seattle? ${unique}`;
    await pageA.getByLabel("Write a message").fill(asked);
    await pageA.getByRole("button", { name: "Send message" }).click();
    await pageA.waitForURL(/\/messages\/[0-9a-f-]{36}$/);
    await pageA.waitForSelector("text=Request sent");
    await log(pageA).getByText(asked).waitFor();
    if (await pageA.getByLabel("Write a message").count()) throw new Error("the requester can write more before an answer");
    await shot("10a-chat-request-sent");

    // B: the badge and the Requests tab change with no reload.
    await pageB.locator('nav[aria-label="Main"]:visible a[aria-label="Messages, 1 unread"]').waitFor(live);
    const request = pageB.locator('[role="tabpanel"] a', { hasText: "Meera Iyer" });
    await request.waitFor(live);
    await request.click();
    await log(pageB).getByText(asked).waitFor();
    await pageB.getByRole("button", { name: "Accept request" }).click();
    const boxB = pageB.getByLabel("Write a message");
    await boxB.waitFor();

    // A can write once B accepts, with no reload, and messages go both ways live.
    const boxA = pageA.getByLabel("Write a message");
    await boxA.waitFor(live);
    const fromA = `How is the weather over there? ${unique}`;
    await boxA.fill(fromA);
    // An IME (Indian-language keyboards among them) uses Enter to pick a word, so Enter mid-composition must not send.
    await boxA.evaluate((el) => el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true, cancelable: true })));
    await pageA.waitForTimeout(300);
    if ((await boxA.inputValue()) !== fromA) throw new Error("Enter during IME composition sent the message");
    await boxA.press("Enter");
    await log(pageB).getByText(fromA).waitFor(live);
    const fromB = `Rainy, as ever.\nAsk away! ${unique}`;
    await boxB.fill(fromB);
    await pageB.getByRole("button", { name: "Send message" }).click();
    await log(pageA).getByText(`Ask away! ${unique}`).waitFor(live);
    // Late socket echoes and responses have had time to land, and each message is still one bubble on each side.
    await pageA.waitForTimeout(1500);
    for (const [p, who] of [
      [pageA, "A"],
      [pageB, "B"],
    ]) {
      for (const text of [asked, fromA, `Ask away! ${unique}`]) {
        const bubbles = await log(p).getByText(text).count();
        if (bubbles !== 1) throw new Error(`${who} shows ${bubbles} bubbles for "${text}"`);
      }
    }
    await shot("10b-chat-thread");
    await pageB.screenshot({ path: `${SHOTS}/10c-chat-thread-b.png` });

    // A thread open in a background tab marks nothing read: A's badge counts B's next message until A's tab is in front again.
    const setVisible = (p, visible) =>
      p.evaluate((v) => {
        Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (v ? "visible" : "hidden") });
        document.dispatchEvent(new Event("visibilitychange"));
      }, visible);
    const badgeA = pageA.locator('nav[aria-label="Main"]:visible a[href$="/app/messages"]');
    await setVisible(pageA, false);
    const unseen = `Still there? ${unique}`;
    await boxB.fill(unseen);
    await boxB.press("Enter");
    await log(pageA).getByText(unseen).waitFor(live);
    await pageA.locator('nav[aria-label="Main"]:visible a[aria-label="Messages, 1 unread"]').waitFor(live);
    await pageA.waitForTimeout(2000);
    if ((await badgeA.getAttribute("aria-label")) !== "Messages, 1 unread") throw new Error("a thread in a background tab was marked read");
    await setVisible(pageA, true);
    await pageA.waitForFunction(() => !document.querySelector('nav[aria-label="Main"] a[href$="/app/messages"][aria-label]'), undefined, live);

    // A send that fails stays in the thread with Try again, which sends it under the same key. One refused for going too
    // fast goes back in the box to send later.
    const sendUrl = /\/api\/v1\/t\/demo-university\/chat\/conversations\/[0-9a-f-]+\/messages$/;
    const sentKeys = [];
    let reply = 503;
    await pageA.route(sendUrl, (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      sentKeys.push(route.request().postDataJSON().clientKey);
      if (reply === null) return route.fallback();
      const code = reply === 429 ? "RATE_LIMITED" : "INTERNAL";
      return route.fulfill({ status: reply, contentType: "application/json", body: JSON.stringify({ error: { code, message: `e2e ${code}` } }) });
    });
    const retried = `Sent at the second try ${unique}`;
    await boxA.fill(retried);
    await boxA.press("Enter");
    const tryAgain = pageA.getByRole("button", { name: "Try again" });
    await tryAgain.waitFor();
    if (await boxA.inputValue()) throw new Error("a failed send left its words in the box as well as in the thread");
    reply = null;
    await tryAgain.click();
    await log(pageB).getByText(retried).waitFor(live);
    await tryAgain.waitFor({ state: "detached" });
    if (sentKeys.length !== 2 || sentKeys[0] !== sentKeys[1]) throw new Error(`Try again didn't reuse the client key: ${sentKeys.join(", ")}`);
    if ((await log(pageA).getByText(retried).count()) !== 1) throw new Error("a retried message isn't exactly one bubble");
    reply = 429;
    const tooFast = `One more thing ${unique}`;
    await boxA.fill(tooFast);
    await boxA.press("Enter");
    await pageA.waitForSelector("text=You're sending messages quickly");
    if ((await boxA.inputValue()) !== tooFast) throw new Error("a send refused for going too fast lost its words");
    if (await log(pageA).getByText(tooFast).count()) throw new Error("a send refused for going too fast stayed in the thread");
    await pageA.unroute(sendUrl);

    // The thread failing to refetch in the background keeps the screen and the draft, and so does leaving and coming back.
    const draft = `Half-written thought ${unique}`;
    await boxA.fill(draft);
    const thread = await scriptConversation(pageA, "demo-university", pageA.url().split("/").pop());
    thread.answer(503, "INTERNAL");
    await thread.refetch();
    if ((await boxA.inputValue()) !== draft) throw new Error("a failed refetch of the thread lost the draft");
    if (!(await log(pageA).getByText(fromA).isVisible())) throw new Error("a failed refetch of the thread replaced it");
    thread.answer(null);
    await thread.stop();
    await pageA.click('nav[aria-label="Main"]:visible >> text=Feed');
    await pageA.waitForURL(/\/app\/feed$/);
    await pageA.goBack();
    await boxA.waitFor();
    if ((await boxA.inputValue()) !== draft) throw new Error("leaving the thread and coming back lost the draft");
    await boxA.fill("");

    // A reports B's message. The dialog says what admins will see, and a second report counts as done, not as an error.
    const reportB = async () => {
      const bubble = log(pageA).locator("div.group", { hasText: `Ask away! ${unique}` });
      await bubble.hover();
      await bubble.getByRole("button", { name: "Report message" }).click();
      const dialog = pageA.locator('[role="dialog"]', { hasText: "Report message" });
      await dialog.getByText("Admins will see this message and up to 10 around it.").waitFor();
      await dialog.getByRole("button", { name: "Send report" }).click();
      await dialog.waitFor({ state: "detached" });
    };
    await reportB();
    await reportB();
    await pageA.waitForSelector("text=You have already reported this message");
    if (await log(pageA).locator("div.group", { hasText: fromA }).getByRole("button", { name: "Report message" }).count()) throw new Error("a member can report their own message");

    // A blocks B. B's next message looks sent to B and never reaches A, even after A unblocks.
    await pageA.getByRole("button", { name: "Conversation options" }).click();
    await pageA.locator('[role="dialog"]', { hasText: "Conversation options" }).getByRole("button", { name: "Block member" }).click();
    await pageA.locator('[role="dialog"]', { hasText: "Block Sneha Kulkarni?" }).getByRole("button", { name: "Block member" }).click();
    await pageA.waitForSelector("text=You blocked Sneha Kulkarni");
    if (await boxA.count()) throw new Error("the blocker can still write");
    const whileBlocked = `Are you still there? ${unique}`;
    await boxB.fill(whileBlocked);
    await boxB.press("Enter");
    await log(pageB).getByText(whileBlocked).waitFor();
    await pageB.waitForTimeout(3000);
    if (await pageB.getByRole("button", { name: "Try again" }).count()) throw new Error("a message to a member who blocked you looked failed");
    if (await log(pageB).getByText("Sending…").count()) throw new Error("a message to a member who blocked you is stuck sending");
    if ((await log(pageB).getByText(whileBlocked).count()) !== 1) throw new Error("the blocked member's message isn't exactly one bubble on their side");
    if (await log(pageA).getByText(whileBlocked).count()) throw new Error("a blocked member's message reached the blocker");
    await pageA.getByRole("button", { name: "Unblock member" }).click();
    await boxA.waitFor();
    // A reload mounts the layout and the thread together, and the thread must still count as open: a message the live
    // connection loses is fetched as soon as the next one shows the gap, not only once A leaves and comes back.
    const lost = `Lost on the way ${unique}`;
    const socket = await dropFrames(pageA, lost);
    await pageA.reload();
    await log(pageA).getByText(fromA).waitFor();
    if (await log(pageA).getByText(whileBlocked).count()) throw new Error("unblocking brought back a message sent while blocked");
    await socket.opened();
    await boxB.fill(lost);
    await boxB.press("Enter");
    await log(pageB).getByText(lost).waitFor();
    await log(pageB).getByText("Sending…").waitFor({ state: "detached" });
    const afterLost = `And the one after it ${unique}`;
    await boxB.fill(afterLost);
    await boxB.press("Enter");
    await log(pageA).getByText(afterLost).waitFor(live);
    await log(pageA).getByText(lost).waitFor(live);
    if (!socket.dropped()) throw new Error("the live connection never carried the message meant to be lost, so the gap went untested");

    // On a phone the thread takes the screen: no header or bottom bar, and the composer in view.
    await pageA.setViewportSize({ width: 390, height: 844 });
    if (await pageA.locator('nav[aria-label="Main"]:visible').count()) throw new Error("the bottom bar shows over a thread on a phone");
    // The thread sizes itself from the visual viewport, which reports the new size a moment after it changes.
    const inView = await pageA
      .waitForFunction(() => document.querySelector('[aria-label="Write a message"]')?.getBoundingClientRect().bottom <= window.innerHeight, undefined, { timeout: 3000 })
      .then(() => true)
      .catch(() => false);
    if (!inView) throw new Error(`the composer is off screen on a phone: ${JSON.stringify(await boxA.boundingBox())}`);
    await pageA.getByRole("link", { name: "Back to messages" }).click();
    await pageA.waitForURL(/\/app\/messages$/);
    await pageA.locator('[role="tabpanel"] a', { hasText: "Sneha Kulkarni" }).waitFor();
    await pageA.screenshot({ path: `${SHOTS}/10d-chat-inbox-phone.png` });
    await contextA.close();
    await contextB.close();
  });

  await step("a current pupil sees no Messages or Groups, even with both switched on", async () => {
    const context = await signedInContext(browser, BASE, "+919100000026", { viewport: { width: 390, height: 844 } }); // Ira Banerjee, demo-school
    const pupil = await context.newPage();
    pupil.setDefaultTimeout(15000);
    const chatCalls = [];
    pupil.on("request", (r) => {
      if (/\/api\/v1\/t\/[^/]+\/chat\//.test(r.url())) chatCalls.push(new URL(r.url()).pathname);
    });
    // Schools start with messaging and groups off. On here, so only the pupil rule can be what hides them.
    const features = await scriptFeatures(pupil, "demo-school");
    features.only("feed", "messaging", "groups", "jobs", "directory", "events", "businesses", "funding");
    await pupil.goto(`${BASE}/t/demo-school/app/feed`);
    const bar = pupil.locator('nav[aria-label="Main"]:visible');
    await bar.locator("a").first().waitFor();
    const shown = (await bar.locator("a").allInnerTexts()).map((text) => text.split("\n").pop().trim());
    for (const section of ["Messages", "Groups"]) if (shown.includes(section)) throw new Error(`a pupil's bottom bar offers ${section}: ${shown.join(", ")}`);
    await pupil.click('nav[aria-label="Main"] >> button:has-text("More")');
    await pupil.waitForSelector('[role="dialog"] >> text=Switch institution');
    for (const section of ["Messages", "Groups"]) if (await pupil.locator(`[role="dialog"] a:has-text("${section}")`).count()) throw new Error(`a pupil's More sheet offers ${section}`);
    await pupil.keyboard.press("Escape");
    await pupil.goto(`${BASE}/t/demo-school/app/messages`);
    await pupil.waitForSelector("text=Messages aren't available");
    await pupil.goto(`${BASE}/t/demo-school/app/groups`);
    await pupil.waitForSelector("text=Groups aren't available");
    await pupil.goto(`${BASE}/t/demo-school/app/my-content`);
    await pupil.locator('[role="tab"]:has-text("Posts")').waitFor();
    if (await pupil.locator('[role="tab"]:has-text("Groups")').count()) throw new Error("a pupil's My posts has a Groups tab");
    if (chatCalls.length) throw new Error(`a pupil's app called the chat API: ${chatCalls.join(", ")}`);
    await features.stop();
    await context.close();
  });

  await step("groups: an open group found in Discover and joined, live messages both ways, an invitation accepted from Invitations, leaving, archiving", async () => {
    // Two members this run registered (the owner on the main page, the listener kept from the live-bell step), so nothing
    // here lands in the seeded members' badges or threads that the direct-message journeys check.
    const owner = page;
    const joiner = listener.page;
    const app = `${BASE}/t/demo-university/app`;
    const log = (p) => p.locator('[role="log"]');
    const live = { timeout: 8000 };
    const openName = `Smoke runners ${unique}`;
    const closedName = `Smoke committee ${unique}`;
    const threadId = (p) => /\/messages\/([0-9a-f-]{36})$/.exec(p.url())[1];
    const createGroup = async (name, choice) => {
      await owner.goto(`${app}/groups`);
      await owner.getByRole("link", { name: "Create group" }).first().click();
      await owner.waitForURL(/\/app\/groups\/new$/);
      // Before anything is sent: what each choice means, and that it's for good.
      await owner.getByText("You can't change this after the group is created.").waitFor();
      await owner.getByText("Any member can find and join this group, and new members see the whole conversation.").waitFor();
      await owner.getByText("Only people you invite can see this group. New members see messages from when they join.").waitFor();
      await owner.getByLabel("Group name").fill(name);
      await owner.getByLabel("Description").fill(`Made by the smoke run ${unique}.`);
      await owner.getByLabel(choice, { exact: true }).check();
      await owner.getByRole("button", { name: "Create group" }).click();
      await owner.waitForURL(/\/app\/messages\/[0-9a-f-]{36}$/);
      await owner.getByLabel("Write a message").waitFor();
      return threadId(owner);
    };
    const send = async (p, text) => {
      await p.getByLabel("Write a message").fill(text);
      await p.getByRole("button", { name: "Send message" }).click();
      await log(p).getByText(text).waitFor();
    };

    // An open group, with a message from before the second member arrives: they get the whole history.
    const openId = await createGroup(openName, "Open group");
    const before = `Who's in for Saturday? ${unique}`;
    await send(owner, before);
    await owner.screenshot({ path: `${SHOTS}/11a-group-created.png` });

    // The second member finds it in Discover, opens its preview and joins.
    await joiner.goto(`${app}/groups`);
    await joiner.getByLabel("Search groups").fill(openName);
    await joiner.getByRole("link", { name: openName }).click();
    await joiner.waitForURL(new RegExp(`/app/groups/${openId}$`));
    await joiner.getByText("Smoke Tester").first().waitFor();
    await joiner.screenshot({ path: `${SHOTS}/11b-group-preview.png` });
    await joiner.getByRole("button", { name: "Join group" }).click();
    await joiner.waitForURL(new RegExp(`/app/messages/${openId}$`));
    await log(joiner).getByText(before).waitFor();
    await log(owner).getByText(`${LISTENER} joined the group`).waitFor(live);

    // Live both ways, each message under its sender's name, and exactly one bubble each side.
    const fromJoiner = `Count me in ${unique}`;
    await send(joiner, fromJoiner);
    await log(owner).getByText(fromJoiner).waitFor(live);
    const fromOwner = `Great, 7am at the gate ${unique}`;
    await send(owner, fromOwner);
    await log(joiner).getByText(fromOwner).waitFor(live);
    await owner.waitForTimeout(1500);
    for (const [p, who] of [
      [owner, "the owner"],
      [joiner, "the joiner"],
    ]) {
      for (const text of [before, fromJoiner, fromOwner]) {
        const bubbles = await log(p).getByText(text).count();
        if (bubbles !== 1) throw new Error(`${who} shows ${bubbles} bubbles for "${text}"`);
      }
    }
    await log(owner).getByText(LISTENER, { exact: true }).first().waitFor();
    await log(joiner).getByText("Smoke Tester", { exact: true }).first().waitFor();
    await owner.screenshot({ path: `${SHOTS}/11c-group-thread.png` });

    // An invite-only group. What was said before the invitee joins stays out of their view.
    const closedId = await createGroup(closedName, "Invite-only group");
    const early = `Before anyone else is here ${unique}`;
    await send(owner, early);
    const groupsLink = joiner.locator('nav[aria-label="Main"]:visible a[href$="/app/groups"]');
    if (await groupsLink.getAttribute("aria-label")) throw new Error(`the joiner starts with something on Groups: ${await groupsLink.getAttribute("aria-label")}`);
    await owner.getByRole("link", { name: "Group details" }).click();
    await owner.waitForURL(new RegExp(`/app/groups/${closedId}$`));
    await owner.getByRole("button", { name: "Invite members" }).click();
    const inviting = owner.locator('[role="dialog"]', { hasText: "Invite members" });
    await inviting.getByLabel("Search members").fill(LISTENER);
    await inviting.getByRole("checkbox", { name: LISTENER }).check();
    await inviting.getByRole("button", { name: "Send invitation" }).click();
    await inviting.waitFor({ state: "detached" });

    // The invitee's Groups badge arrives live, named for what it counts, and the invitation waits under Invitations.
    const badge = joiner.locator('nav[aria-label="Main"]:visible a[aria-label="Groups, 1 invitation"]');
    await badge.waitFor(live);
    await badge.click();
    await joiner.waitForURL(/\/app\/groups$/);
    await joiner.getByRole("tab", { name: "Invitations" }).click();
    await joiner.waitForURL(/\/app\/groups\?tab=invitations$/);
    const invitation = joiner.locator("article", { hasText: closedName });
    await invitation.getByText("Invited by Smoke Tester").waitFor();
    await joiner.screenshot({ path: `${SHOTS}/11d-group-invitation.png` });
    await invitation.getByRole("button", { name: "Accept invitation" }).click();
    await joiner.waitForURL(new RegExp(`/app/messages/${closedId}$`));
    await log(joiner).getByText("You joined the group").waitFor();
    if (await log(joiner).getByText(early).count()) throw new Error("an invite-only group showed a new member what was said before they joined");
    await joiner.waitForFunction(() => !document.querySelector('nav[aria-label="Main"] a[href$="/app/groups"][aria-label]'), undefined, live);

    // Leaving, through the confirm dialog. The owner sees it live, and the group is gone for the one who left.
    await owner.goto(`${app}/messages/${closedId}`);
    await log(owner).getByText(`${LISTENER} joined the group`).waitFor();
    await joiner.getByRole("link", { name: "Group details" }).click();
    await joiner.waitForURL(new RegExp(`/app/groups/${closedId}$`));
    await joiner.getByRole("button", { name: "Leave group" }).click();
    const leaving = joiner.locator('[role="dialog"]', { hasText: "Leave this group?" });
    await leaving.getByRole("button", { name: "Cancel" }).click();
    await leaving.waitFor({ state: "detached" });
    await joiner.getByRole("button", { name: "Leave group" }).click();
    await leaving.getByRole("button", { name: "Leave group" }).click();
    await joiner.waitForURL(/\/app\/groups\?tab=mine$/);
    await log(owner).getByText(`${LISTENER} left the group`).waitFor(live);
    await joiner.locator("h3", { hasText: openName }).waitFor();
    if (await joiner.locator("h3", { hasText: closedName }).count()) throw new Error("an invite-only group stayed in My groups after leaving it");
    await joiner.goto(`${app}/messages/${closedId}`);
    await joiner.waitForSelector("text=This conversation isn't available");

    // Archiving the open group leaves it readable and closed: the member's open thread says so live.
    await joiner.goto(`${app}/messages/${openId}`);
    await log(joiner).getByText(fromOwner).waitFor();
    await owner.goto(`${app}/groups/${openId}`);
    await owner.getByRole("button", { name: "Archive group" }).click();
    await owner.locator('[role="dialog"]', { hasText: "Archive this group?" }).getByRole("button", { name: "Archive group" }).click();
    await owner.getByText("Archived", { exact: true }).first().waitFor();
    await joiner.getByText("This group has been archived").waitFor(live);
    if (await joiner.getByLabel("Write a message").count()) throw new Error("an archived group still offers its members a message box");
    await joiner.screenshot({ path: `${SHOTS}/11e-group-archived.png` });

    // The owner's groups are in My posts.
    await owner.goto(`${app}/my-content`);
    await owner.getByRole("tab", { name: "Groups" }).click();
    await owner.locator("article", { hasText: openName }).getByText("Archived").waitFor();
    await owner.locator("article", { hasText: closedName }).waitFor();
    await listener.context.close();
    listener = null;
  });

  await step("a chat notice in the bell opens its thread, and one this member can't open says so with a way back", async () => {
    const removed = await scriptNotification(page, "demo-university", { type: "CHAT_MESSAGE_REMOVED", data: { conversationId: "00000000-0000-4000-8000-0000000000aa", messageId: "00000000-0000-4000-8000-0000000000ab" }, title: "An admin removed a message you sent" });
    await page.goto(BASE + "/t/demo-university/app/feed");
    await page.click('a[aria-label^="Notifications"]');
    await page.click("text=An admin removed a message you sent");
    await page.waitForURL("**/t/demo-university/app/messages/00000000-0000-4000-8000-0000000000aa");
    await page.waitForSelector("text=This conversation isn't available");
    await page.getByRole("link", { name: "Back to messages" }).locator("visible=true").first().click();
    await page.waitForURL(/\/t\/demo-university\/app\/messages$/);
    await removed.stop();
  });

  await step("notifications page, notification settings + sign out", async () => {
    await page.click('a[aria-label^="Notifications"]');
    await page.waitForSelector("h1:has-text('Notifications')");
    await page.click("text=⚙️ Settings");
    await page.waitForSelector("h1:has-text('Notification settings')");
    const celebrations = page.locator('[role="radiogroup"][aria-label="Birthdays and anniversaries"]');
    // The switch moves before the save lands, so wait for it: reloading at once can cut the request off.
    const [saved] = await Promise.all([
      page.waitForResponse((r) => r.request().method() === "PATCH" && r.url().endsWith("/notification-prefs")),
      celebrations.locator('[role="radio"]:has-text("Off")').click(),
    ]);
    if (!saved.ok()) throw new Error(`saving notification settings answered ${saved.status()}`);
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
