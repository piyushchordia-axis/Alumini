import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { reconnect, scriptBusiness, scriptFeatures, scriptMembership, scriptNotification, scriptTenant } from "./lib.mjs";

const BASE = process.env.MOBILE_WEB_URL ?? "http://localhost:8081";
// fileURLToPath, not URL.pathname: on Windows .pathname gives "/C:/…", which fs can't use.
const SHOTS = process.env.SHOTS ?? fileURLToPath(new URL("./screenshots/", import.meta.url));
mkdirSync(SHOTS, { recursive: true });
const unique = String(Date.now()).slice(-8);
const PHONE = `7${unique.slice(0, 9).padEnd(9, "3")}`;
const PHONE_2 = `6${unique.slice(0, 9).padEnd(9, "4")}`;
const PHONE_3 = `6${unique.slice(0, 9).padEnd(9, "5")}`;
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
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
page.setDefaultTimeout(20000);
page.on("dialog", (d) => d.accept());
const shot = (n) => page.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: false });
const tap = (text) => page.getByText(text, { exact: true }).last().click();
// Items on the tab bar are links with role=tab. The screens' own Tabs have that role too, but no href.
const barTab = (label) => page.locator('a[role="tab"]').getByText(label, { exact: true });
const selectedBarTab = (label) => page.locator('a[role="tab"][aria-selected="true"]').getByText(label, { exact: true });
const hubRow = (label) => page.getByRole("link", { name: label, exact: true }).locator("visible=true").first();
const barLabels = () => page.locator('a[role="tab"]').locator("visible=true").evaluateAll((tabs) => tabs.map((tab) => tab.innerText.split("\n").pop()));
const expectBar = async (...labels) => {
  await barTab("More").waitFor();
  const shown = await barLabels();
  if (shown.join() !== labels.join()) throw new Error(`the tab bar shows ${shown.join(", ")}, expected ${labels.join(", ")}`);
};
const signIn = async (number) => {
  await page.getByPlaceholder("98765 43210").fill(number);
  await tap("Send code");
  const dev = await page.getByText(/Development mode/).textContent();
  await page.getByPlaceholder("••••••").fill(/(\d{6})/.exec(dev)[1]);
  await tap("Verify and continue");
};
const remembered = () => page.evaluate(() => JSON.parse(localStorage.getItem("illuminize.tenant")).state.lastTenantSlug);
// A section is on the tab bar or behind More, depending on which others the institution has enabled.
const openSection = async (label) => {
  await barTab("More").waitFor();
  if (await barTab(label).locator("visible=true").count()) return barTab(label).click();
  await barTab("More").click();
  await hubRow(label).click();
};
// Live updates: record the app's Socket.IO WebSocket once it opens.
const liveSockets = [];
page.on("websocket", (ws) => {
  if (ws.url().includes("/socket.io/")) liveSockets.push(ws);
});

try {
  await step("tenant picker renders from the API", async () => {
    await page.goto(BASE + "/");
    await page.getByText("Demo University", { exact: true }).waitFor();
    await shot("m01-picker");
    await tap("Demo University");
  });

  await step("landing → login → OTP → register → feed", async () => {
    await page.getByText("Sign in / Join with mobile number").waitFor();
    await shot("m02-landing");
    await tap("Sign in / Join with mobile number");
    // The country code picker searches the full list; pick the UK, then switch back to India.
    await page.getByRole("button", { name: /^Country code, India \+91/ }).click();
    await page.getByPlaceholder(/Search by name or code/).fill("kingdom");
    await page.getByText("United Kingdom", { exact: true }).click();
    await page.getByRole("button", { name: /^Country code, United Kingdom \+44/ }).waitFor();
    await page.getByRole("button", { name: /^Country code, United Kingdom/ }).click();
    await page.getByPlaceholder(/Search by name or code/).fill("+91");
    await page.getByText("India", { exact: true }).click();
    await page.getByRole("button", { name: /^Country code, India \+91/ }).waitFor();
    await signIn(PHONE);
    await page.getByText("Create your profile").waitFor();
    await shot("m03-register");
    const inputs = page.locator("input:visible");
    await inputs.nth(0).fill("Mobile Smoke");
    await inputs.nth(1).fill("2014");
    await tap("Join the network");
    await page.getByText("Welcome to the official Demo University alumni network", { exact: false }).waitFor();
    for (let i = 0; i < 50 && liveSockets.length === 0; i++) await page.waitForTimeout(100);
    if (liveSockets.length === 0) throw new Error("the app did not open a live-updates connection after signing in");
    await shot("m04-feed");
  });

  await step("create a post with a photo from the feed", async () => {
    await page.getByRole("button", { name: "New post" }).click();
    await page.locator("textarea").first().fill(`Hello from the mobile smoke ${unique}`);
    // A real 1×1 PNG through the browser's file chooser: the upload must send a File, not { uri, name, type }.
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
    const chooser = page.waitForEvent("filechooser");
    await tap("📷 Add image");
    await (await chooser).setFiles({ name: "smoke.png", mimeType: "image/png", buffer: png });
    await page.locator('img[src*="/uploads/"]').first().waitFor();
    await tap("Post");
    await page.getByText(`Hello from the mobile smoke ${unique}`).waitFor();
  });

  await step("edit your own post", async () => {
    await page.getByRole("button", { name: "Edit post" }).first().click();
    const box = page.getByLabel("Post text").last();
    await box.waitFor();
    await box.fill(`Edited on mobile ${unique}`);
    await tap("Save changes");
    await page.getByText(`Edited on mobile ${unique}`).first().waitFor();
    await shot("m04b-post-edited");
  });

  await step("celebrations card and a poll vote on the feed", async () => {
    const card = page.getByText("🎉 Celebrating today").locator("visible=true").first();
    await card.waitFor();
    await page.getByRole("button", { name: "Send wishes" }).locator("visible=true").first().click();
    await page.getByText("Wished ✓").locator("visible=true").first().waitFor();
    await shot("m04c-celebrations");
    // The poll is a few posts down; scroll until the list has rendered it.
    const question = page.getByText("Where should we hold the next London meetup?").locator("visible=true").first();
    for (let i = 0; i < 30 && !(await question.count()); i++) await page.mouse.wheel(0, 600);
    await question.scrollIntoViewIfNeeded();
    await page.getByRole("button", { name: "Canary Wharf" }).locator("visible=true").first().click();
    await page.locator('[aria-label^="Canary Wharf"][aria-label*="your vote"]').first().waitFor();
    await shot("m04d-poll");
  });

  await step("every section opens its own screen, with Funding behind More", async () => {
    if ((await page.locator('a[role="tab"]').locator("visible=true").count()) !== 5) throw new Error("the tab bar should show four sections, then More");
    const moreColor = () => barTab("More").evaluate((el) => getComputedStyle(el).color);
    const moreColorOnFeed = await moreColor();
    // A route folder with no Tabs.Screen redirects to the first tab rather than failing, so check the URL and the content.
    const sections = [
      ["Feed", "feed", page.getByRole("button", { name: "New post" })],
      ["Jobs", "jobs", page.getByText("Backend Engineer (Node.js)")],
      ["Directory", "directory", page.getByPlaceholder("Name, company, role")],
      ["Events", "events", page.getByText("Mumbai alumni coffee meetup")],
      ["Funding", "funding", page.getByText("Seeking funding", { exact: true })],
    ];
    for (const [label, path, content] of sections) {
      await openSection(label);
      await page.waitForURL(`**/t/demo-university/${path}`);
      await content.locator("visible=true").first().waitFor();
      if (label === "Funding") continue;
      await selectedBarTab(label).waitFor();
      if (await selectedBarTab("More").count()) throw new Error(`More shows as selected on ${label}`);
    }
    // A focused tab with no button highlights nothing, so More has to show it, both to screen readers and in colour.
    await selectedBarTab("More").waitFor();
    if ((await moreColor()) === moreColorOnFeed) throw new Error("More isn't tinted on an overflow section");
    await shot("m04e-funding");
  });

  await step("My posts opens from the More hub and its tabs scroll rather than truncate", async () => {
    await barTab("More").click();
    await page.waitForURL("**/t/demo-university/more");
    for (const row of ["Funding", "My profile", "Switch institution", "Sign out"]) await hubRow(row).waitFor();
    await hubRow("My posts").click();
    await page.waitForURL("**/t/demo-university/profile/my-content");
    await selectedBarTab("More").waitFor();
    const pastEvents = (selected) => page.locator(`[role="tab"][aria-selected="${selected}"]`).getByText("Past events", { exact: true }).locator("visible=true").first();
    await pastEvents(false).waitFor();
    await shot("m09-my-content");
    // The tabs fit at the usual width, so go narrower. A squeezed label stays one line tall, so its height proves nothing: look for clipped text.
    await page.setViewportSize({ width: 320, height: 700 });
    if (await pastEvents(false).evaluate((label) => label.scrollWidth - label.clientWidth > 1)) throw new Error('"Past events" is truncated on a narrow phone');
    const tabs = page.locator('[role="tablist"]').filter({ hasText: "Past events" }).locator("visible=true").first();
    if (!(await tabs.evaluate((list) => list.firstElementChild.scrollWidth > list.firstElementChild.clientWidth))) throw new Error("the tabs should scroll sideways on a narrow phone");
    await pastEvents(false).click();
    await pastEvents(true).waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
  });

  await step("jobs tab lists seeded openings", async () => {
    await openSection("Jobs");
    await page.getByText("Backend Engineer (Node.js)").locator("visible=true").first().waitFor();
    // Selected state must reach the DOM: react-native-web ignores accessibilityState and only emits aria-* props.
    const tab = (name, selected) => page.locator(`[role="tab"][aria-selected="${selected}"]`).getByText(name, { exact: true }).locator("visible=true").first();
    await tab("Openings", true).waitFor();
    await tab("Looking for work", false).click();
    await tab("Looking for work", true).waitFor();
    await tab("Openings", false).click();
    await shot("m05-jobs");
  });

  await step("RSVP to an event", async () => {
    await openSection("Events");
    await page.getByText("Mumbai alumni coffee meetup").locator("visible=true").first().click();
    await page.getByText("Who's going").waitFor();
    const before = Number((await page.locator("text=/^\\d+$/").first().textContent()).trim());
    await tap("I'm going");
    await page.getByText("Mobile Smoke").first().waitFor();
    await shot("m06-event");
    void before;
  });

  await step("directory search and member profile", async () => {
    await openSection("Directory");
    await page.getByRole("button", { name: /^Filters/ }).locator("visible=true").first().click();
    await page.getByText("Company", { exact: true }).locator("visible=true").first().waitFor();
    await page.getByText("Country", { exact: true }).locator("visible=true").first().waitFor();
    await page.getByPlaceholder("Name, company, role").fill("Priya");
    const hit = page.getByText("Priya Nair").locator("visible=true").first();
    await hit.waitFor();
    // inactive tab stacks stay mounted on web and overlap; dispatch the click straight to the card
    await hit.dispatchEvent("click");
    await page.getByText("Member since").waitFor();
    await shot("m07-member");
  });

  // Screens underneath stay mounted on the web export, so a label can match twice: the screen on top is the last one.
  const visible = (locator) => locator.locator("visible=true").last();

  await step("businesses behind More: search and filter, with contact details only on a listing's own page", async () => {
    await openSection("Businesses");
    await page.waitForURL("**/t/demo-university/businesses");
    await selectedBarTab("More").waitFor();
    // By description: Zylo Labs is also a funding listing, on a screen that is still mounted.
    const zylo = visible(page.getByText("Lending software for small marketplaces", { exact: false }));
    const singh = visible(page.getByText("Cotton and blended fabrics", { exact: false }));
    await zylo.waitFor();
    await singh.waitFor();
    if (await page.getByText("hello@zylolabs.example", { exact: false }).locator("visible=true").count()) throw new Error("the list shows a contact email");
    if (await page.getByText("5550 0101", { exact: false }).locator("visible=true").count()) throw new Error("the list shows a contact phone");
    await shot("m07a-businesses");

    const search = visible(page.getByLabel("Search businesses"));
    await search.fill("lending software");
    await singh.waitFor({ state: "hidden" });
    await zylo.waitFor();
    await search.fill("");
    await singh.waitFor();

    const chip = (label) => visible(page.getByRole("button", { name: label, exact: true }));
    await chip("Manufacturing").click();
    await zylo.waitFor({ state: "hidden" });
    await singh.waitFor();
    await chip("Any").click();
    await zylo.waitFor();

    const city = visible(page.getByLabel("City", { exact: true }));
    await city.fill("surat");
    await zylo.waitFor({ state: "hidden" });
    await singh.waitFor();
    await city.fill("nowhere at all");
    await visible(page.getByText("No businesses match", { exact: true })).waitFor();
    await city.fill("");
    await zylo.waitFor();

    await zylo.dispatchEvent("click");
    await page.waitForURL(/\/t\/demo-university\/businesses\/[0-9a-f-]+$/);
    await visible(page.getByText("hello@zylolabs.example", { exact: false })).waitFor();
    await visible(page.getByText("5550 0101", { exact: false })).waitFor();
    await visible(page.getByRole("button", { name: "Report this content" })).waitFor();
    await shot("m07a-business-detail");
  });

  await step("businesses: add a listing, edit it, find it in My posts and delete it through the confirm sheet", async () => {
    const name = `Mobile Bakery ${unique}`;
    const field = (label) => visible(page.getByLabel(label, { exact: true }));
    await page.goto(BASE + "/t/demo-university/businesses");
    await visible(page.getByRole("button", { name: "Add a business" })).click();
    await page.waitForURL("**/t/demo-university/businesses/new");
    // The names web-member.mjs finds the same controls by.
    await field("Business name *").fill(name);
    await visible(page.getByRole("button", { name: "Food & beverage", exact: true })).click();
    await field("City").fill("Mumbai");
    await field("Description *").fill("Sourdough baked for the smoke tests every morning.");
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
    const chooser = page.waitForEvent("filechooser");
    await visible(page.getByRole("button", { name: "📷 Add logo" })).click();
    await (await chooser).setFiles({ name: "logo.png", mimeType: "image/png", buffer: png });
    await visible(page.getByRole("button", { name: "Change logo" })).waitFor();
    await visible(page.getByRole("button", { name: "Remove logo", exact: true })).waitFor();
    await field("Contact email").fill(`mobile${unique}@example.com`);
    await field("Contact phone").fill("+91 22 5550 0198");

    // A javascript: link must not reach Linking.openURL.
    await field("Website").fill("javascript:alert(1)");
    await visible(page.getByRole("button", { name: "Publish listing" })).click();
    await visible(page.getByText("URL must start with", { exact: false })).waitFor();
    if (!page.url().endsWith("/businesses/new")) throw new Error("a javascript: website was accepted");
    await field("Website").fill("https://example.com/mobile-bakery");
    await visible(page.getByRole("button", { name: "Publish listing" })).click();
    await page.waitForURL(/\/t\/demo-university\/businesses\/[0-9a-f-]+$/);
    const detail = page.url();
    await visible(page.getByText(name, { exact: true })).waitFor();
    await visible(page.getByText(`mobile${unique}@example.com`, { exact: false })).waitFor();
    if (await page.getByRole("button", { name: "Report this content" }).locator("visible=true").count()) throw new Error("your own listing offers to report it");

    await visible(page.getByRole("button", { name: "Edit", exact: true })).click();
    await page.waitForURL("**/businesses/edit/*");
    await field("Business name *").waitFor();
    if ((await field("Contact email").inputValue()) !== `mobile${unique}@example.com`) throw new Error("the edit form lost the contact email");
    await field("Business name *").fill(`${name} and Sons`);
    // A background refetch failing must not replace the form and lose what was typed.
    const editing = await scriptBusiness(page, "demo-university", detail.split("/").pop());
    editing.answer(503, "INTERNAL");
    await editing.refetch();
    if ((await field("Business name *").inputValue()) !== `${name} and Sons`) throw new Error("a failed refetch lost what was typed on the edit form");
    await editing.stop();
    await visible(page.getByRole("button", { name: "Save changes" })).click();
    await page.waitForURL(detail);
    await visible(page.getByText(`${name} and Sons`, { exact: true })).waitFor();

    await barTab("More").click();
    await hubRow("My posts").click();
    await page.waitForURL("**/t/demo-university/profile/my-content");
    await visible(page.locator('[role="tab"]').getByText("Businesses", { exact: true })).click();
    const mine = visible(page.getByText(`${name} and Sons`, { exact: true }));
    await mine.waitFor();
    await mine.dispatchEvent("click");
    await page.waitForURL(detail);

    const sheet = page.getByRole("alertdialog", { name: "Delete this listing?" });
    await visible(page.getByRole("button", { name: "Delete", exact: true })).click();
    await sheet.waitFor();
    await sheet.getByRole("button", { name: "Cancel" }).click();
    await sheet.waitFor({ state: "hidden" });
    await visible(page.getByText(`${name} and Sons`, { exact: true })).waitFor();

    // Opened from a link, with nothing behind them to go back to: saving and deleting still have to leave the screen.
    await page.goto(`${BASE}/t/demo-university/businesses/edit/${detail.split("/").pop()}`);
    await field("City").fill("Pune");
    await visible(page.getByRole("button", { name: "Save changes" })).click();
    await page.waitForURL(detail);
    await visible(page.getByText("Pune", { exact: true })).waitFor();

    await page.goto(detail);
    await visible(page.getByRole("button", { name: "Delete", exact: true })).click();
    await shot("m07a-business-delete");
    await sheet.getByRole("button", { name: "Delete listing" }).click();
    await sheet.waitFor({ state: "hidden" });
    await page.waitForURL("**/t/demo-university/businesses");
    await visible(page.getByText("Lending software for small marketplaces", { exact: false })).waitFor();
    if (await page.getByText(`${name} and Sons`, { exact: true }).count()) throw new Error("a deleted listing is still in the list");
    // The next step takes the first bell on the page, which has to be the feed's rather than this screen's underneath it.
    await page.goto(BASE + "/t/demo-university/feed");
  });

  await step("notification settings persist", async () => {
    const group = () => page.locator('[role="radiogroup"][aria-label="Birthdays and anniversaries"]').locator("visible=true").first();
    const openSettings = async () => {
      await page.getByRole("button", { name: /^Notifications/ }).locator("visible=true").first().click();
      await page.getByRole("button", { name: "⚙️ Settings" }).locator("visible=true").first().click();
      await group().waitFor();
    };
    await openSection("Feed");
    await openSettings();
    await group().getByText("Off", { exact: true }).click();
    await group().locator('[role="radio"][aria-checked="true"]').getByText("Off", { exact: true }).waitFor();
    await page.goto(BASE + "/t/demo-university");
    await openSettings();
    await group().locator('[role="radio"][aria-checked="true"]').getByText("Off", { exact: true }).waitFor();
    await shot("m07b-notification-settings");
  });

  await step("nested screens open cold, and a notification tap lands on its target, all under the tabs", async () => {
    const opened = async (pattern) => {
      await page.waitForURL(pattern);
      return page.url();
    };
    await openSection("Jobs");
    await page.getByText("Backend Engineer (Node.js)").locator("visible=true").first().dispatchEvent("click");
    const job = await opened(/\/t\/demo-university\/jobs\/[0-9a-f-]+$/);
    await openSection("Funding");
    await page.getByText("Embedded credit for SME marketplaces", { exact: false }).locator("visible=true").first().dispatchEvent("click");
    const funding = await opened(/\/t\/demo-university\/funding\/[0-9a-f-]+$/);

    // A reload is a cold start, as a push tap or a shared link is.
    const nested = [
      [job, page.getByText("Backend Engineer (Node.js)"), "Jobs"],
      [funding, page.getByText("Embedded credit for SME marketplaces", { exact: false }), "More"],
      [BASE + "/t/demo-university/profile/my-content", page.getByText("Past events", { exact: true }), "More"],
    ];
    for (const [url, content, tab] of nested) {
      await page.goto(url);
      await content.locator("visible=true").first().waitFor();
      if (page.url() !== url) throw new Error(`${url} redirected to ${page.url()}`);
      await selectedBarTab(tab).waitFor();
      await expectBar("Feed", "Jobs", "Directory", "Events", "More");
    }

    // With nothing mounted under My posts, it must still have a way back on the screen. Android has its back button, iOS only has this.
    await page.goto(BASE + "/t/demo-university/more");
    await hubRow("My posts").click();
    await page.waitForURL("**/t/demo-university/profile/my-content");
    await page.getByLabel(/back$/i).locator("visible=true").first().click();
    await page.waitForURL("**/t/demo-university/profile");
    await page.getByRole("button", { name: "Edit profile" }).locator("visible=true").first().waitFor();

    const notification = await scriptNotification(page, "demo-university", { type: "CONTENT_APPROVED", data: { contentType: "FUNDING", contentId: funding.split("/").pop() }, title: "Your listing was approved" });
    await page.goto(BASE + "/t/demo-university/profile/notifications");
    await page.getByText("Your listing was approved", { exact: true }).click();
    await page.waitForURL(funding);
    await page.getByText("Embedded credit for SME marketplaces", { exact: false }).locator("visible=true").first().waitFor();
    await selectedBarTab("More").waitFor();
    await notification.stop();
  });

  await step("sections the institution has switched off", async () => {
    const features = await scriptFeatures(page, "demo-university");
    const open = async (url = "") => page.goto(`${BASE}/t/demo-university${url}`);

    // The feed off: land on the next section, and with four left nothing overflows.
    features.only("jobs", "directory", "events", "funding");
    await open();
    await page.waitForURL("**/t/demo-university/jobs");
    await page.getByText("Backend Engineer (Node.js)").locator("visible=true").first().waitFor();
    await expectBar("Jobs", "Directory", "Events", "Funding", "More");

    // Funding off: four sections, and nothing but the member's own rows in the hub. A link to it goes home instead.
    features.only("feed", "jobs", "directory", "events");
    await open();
    await page.waitForURL("**/t/demo-university/feed");
    await expectBar("Feed", "Jobs", "Directory", "Events", "More");
    await barTab("More").click();
    await hubRow("My posts").waitFor();
    for (const section of ["Funding", "Businesses"]) {
      if (await page.getByRole("link", { name: section, exact: true }).locator("visible=true").count()) throw new Error(`the hub lists ${section}, which is switched off`);
    }
    await open("/funding");
    await page.waitForURL("**/t/demo-university/feed");
    await open("/businesses");
    await page.waitForURL("**/t/demo-university/feed");
    await open("/profile/my-content");
    await page.locator('[role="tab"]').getByText("Posts", { exact: true }).locator("visible=true").first().waitFor();
    if (await page.locator('[role="tab"]').getByText("Businesses", { exact: true }).locator("visible=true").count()) throw new Error("My posts has a tab for a section that is switched off");

    // Everything off: the profile is home, and More stands in for it on the bar.
    features.only();
    await open();
    await page.waitForURL("**/t/demo-university/profile");
    await page.getByRole("button", { name: "Edit profile" }).locator("visible=true").first().waitFor();
    await expectBar("More");
    await selectedBarTab("More").waitFor();
    await open("/events");
    await page.waitForURL("**/t/demo-university/profile");
    await features.stop();
  });

  await step("a failed refetch keeps the open screen, and an answer from the API doesn't", async () => {
    const membership = await scriptMembership(page, "demo-university");
    const failed = page.getByText("Couldn't load this");
    const upcoming = page.locator('[role="tab"]').getByText("Upcoming", { exact: true }).locator("visible=true").first();
    const openEvents = async () => {
      membership.answer(null);
      await page.goto(BASE + "/t/demo-university/events");
      await upcoming.waitFor();
    };

    await openEvents();
    membership.answer(503, "INTERNAL");
    await membership.refetch();
    if (!(await upcoming.isVisible()) || (await failed.count())) throw new Error("a 503 on a background refetch replaced the open screen");
    if ((await remembered()) !== "demo-university") throw new Error("a 503 forgot the institution");

    // Removed from the institution: the register form, and it stays even when a later refetch can't get through.
    membership.answer(404, "NOT_A_MEMBER");
    await membership.refetch();
    await page.waitForURL("**/t/demo-university/register");
    await page.getByText("Create your profile").waitFor();
    if ((await remembered()) !== null) throw new Error("an institution they were removed from stayed remembered");
    const fullName = page.locator("input:visible").first();
    await fullName.fill("Still typing");
    membership.answer(503, "INTERNAL");
    await reconnect(page);
    await page.waitForTimeout(1000);
    if (!page.url().endsWith("/register")) throw new Error("a failed refetch sent a removed member back into the app");
    if ((await fullName.inputValue()) !== "Still typing") throw new Error("a failed refetch lost what was typed on the register form");

    // A suspended institution: the answer stands until a success, so a later failure must not bring the old screen back.
    await openEvents();
    membership.answer(403, "TENANT_INACTIVE");
    await membership.refetch();
    await failed.waitFor();
    await page.getByText("e2e TENANT_INACTIVE").waitFor();
    if ((await remembered()) !== null) throw new Error("a suspended institution stayed remembered");
    membership.answer(503, "INTERNAL");
    await membership.refetch();
    await failed.waitFor();
    if (await upcoming.count()) throw new Error("a 503 after a 403 reopened the app from the cached membership");
    membership.answer(null);
    await tap("Try again");
    await barTab("More").waitFor();

    // The way out reaches the picker, which redirects to a remembered institution.
    membership.answer(403, "TENANT_INACTIVE");
    await membership.refetch();
    await failed.waitFor();
    await tap("Choose another institution");
    await page.getByPlaceholder(/Search by name or city/).waitFor();

    // Nothing cached: a 503 has no screen to keep, and trying again recovers.
    membership.answer(503, "INTERNAL");
    await page.goto(BASE + "/t/demo-university/events");
    await failed.waitFor();
    membership.answer(null);
    await tap("Try again");
    await upcoming.waitFor();
    await membership.stop();
  });

  await step("a failed institution refetch keeps the open screen, and a 404 doesn't", async () => {
    const tenant = await scriptTenant(page, "demo-university");
    const failed = page.getByText("Couldn't load this");
    const upcoming = page.locator('[role="tab"]').getByText("Upcoming", { exact: true }).locator("visible=true").first();
    await page.goto(BASE + "/t/demo-university/events");
    await upcoming.waitFor();

    tenant.answer(503, "INTERNAL");
    await tenant.refetch();
    if (!(await upcoming.isVisible()) || (await failed.count())) throw new Error("a 503 on the institution replaced the open screen");

    tenant.answer(404, "TENANT_NOT_FOUND");
    await tenant.refetch();
    await failed.waitFor();
    await page.getByText("e2e TENANT_NOT_FOUND").waitFor();

    tenant.answer(503, "INTERNAL");
    await tenant.refetch();
    await failed.waitFor();
    if (await upcoming.count()) throw new Error("a 503 after a 404 reopened the app from the cached institution");

    tenant.answer(null);
    await tap("Try again");
    await barTab("More").waitFor();
    await tenant.stop();
  });

  await step("ADMIN_APPROVAL tenant lands on the pending screen", async () => {
    // deep link straight into the college (served with SPA fallback); signed in but not a member → register
    await page.goto(BASE + "/t/demo-college");
    await page.getByText("Create your profile").waitFor();
    const inputs = page.locator("input:visible");
    await inputs.nth(0).fill("Pending Mobile");
    await inputs.nth(1).fill("2011");
    await tap("Submit for approval");
    await page.getByText("Awaiting approval").waitFor();
    await shot("m08-pending");
  });

  await step("the More hub switches institution and signs out", async () => {
    await page.goto(BASE + "/t/demo-university");
    await barTab("More").click();
    await hubRow("Switch institution").click();
    await page.getByPlaceholder(/Search by name or city/).waitFor();
    await tap("Demo University");
    await page.waitForURL("**/t/demo-university/feed");
    await barTab("More").click();
    await hubRow("Sign out").click();
    await page.getByText("Sign in / Join with mobile number").waitFor();
    await page.waitForURL("**/t/demo-university");
  });

  await step("a forced sign-out leaves nothing cached for whoever signs in next", async () => {
    // Signed out by the last step. A new member joins, so there is a membership cached.
    await tap("Sign in / Join with mobile number");
    await signIn(PHONE_2);
    await page.getByText("Create your profile").waitFor();
    const inputs = page.locator("input:visible");
    await inputs.nth(0).fill("Forced Out");
    await inputs.nth(1).fill("2015");
    await tap("Join the network");
    await barTab("More").waitFor();
    const membership = await scriptMembership(page, "demo-university");
    membership.answer(401, "SESSION_REVOKED");
    await membership.refetch();
    await page.waitForURL("**/t/demo-university/login");
    // The next person's membership can't load, so the old one would be all there is to show.
    membership.answer(503, "INTERNAL");
    await signIn(PHONE_3);
    await page.getByText("e2e INTERNAL").waitFor();
    if (await barTab("More").locator("visible=true").count()) throw new Error("the next person to sign in saw the last member's cached membership");
    await membership.stop();
  });

  console.log(results.join("\n"));
  console.log("MOBILE SMOKE OK");
} catch (err) {
  console.log(results.join("\n"));
  console.error("MOBILE SMOKE FAILED:", err);
  await page.screenshot({ path: `${SHOTS}/mobile-failure.png` }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
