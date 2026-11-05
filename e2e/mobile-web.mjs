import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { API, apiSession, bigPhoto, dropFrames, expectChosenChip, expectSvgNoEmoji, holdPhotoPreparation, pickBigPhoto, reconnect, scriptBusiness, scriptConversation, scriptFeatures, scriptJob, scriptMembership, scriptMentor, scriptNotification, scriptTenant, signedInMobileContext } from "./lib.mjs";

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

// The groups journey's two members, kept signed in for the mentorship journey, and then for the referral journey, so they
// cost no extra login: every e2e script shares 20 codes an hour, and a fresh context would start from tokens the first may
// have rotated since.
let groupsMembers = null;
let mentorshipMembers = null;
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
// Registration is three steps. A click waits out the moment a step that has just opened ignores taps (so a double tap
// moves one step), and each button's label must be on the page once.
const stepHeading = (n, name) => page.getByRole("heading", { name: `Step ${n} of 3 · ${name}`, exact: true });
const pressStepButton = async (name) => {
  const button = page.getByRole("button", { name, exact: true });
  await button.waitFor();
  const shown = await page.getByText(name, { exact: true }).locator("visible=true").count();
  if (shown !== 1) throw new Error(`"${name}" shows ${shown} times on the register screen`);
  await button.click();
};
/**
 * From step 1 with its inputs filled: Continue, "Skip for now" on Work (after `onWork`, to look at it), then `label` on
 * About you, which says when an admin looks first.
 */
const finishRegistration = async (label, { onWork } = {}) => {
  await stepHeading(1, "Basics").waitFor();
  await pressStepButton("Continue");
  await stepHeading(2, "Work").waitFor();
  if ((await page.getByText("Continue", { exact: true }).locator("visible=true").count()) !== 1) throw new Error('"Continue" isn\'t on the Work step once');
  await onWork?.();
  await pressStepButton("Skip for now");
  await stepHeading(3, "About you").waitFor();
  if (label === "Submit for approval") await page.getByText(/^An admin at .+ will review your profile before you can join\.$/).waitFor();
  await pressStepButton(label);
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
    await expectSvgNoEmoji(page.getByText("Illuminize", { exact: true }).first().locator("xpath=.."), "the institution picker's hero");
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
    await pressStepButton("Continue");
    // Skip for now puts Work back as it was last accepted (here, as it started): never what was typed and left
    // unchecked, even after going back a step and returning, which keeps it.
    await stepHeading(2, "Work").waitFor();
    const headlineBox = page.getByLabel("Headline", { exact: true });
    await headlineBox.fill("Not this one");
    await shot("m03b-register-work");
    await page.getByRole("button", { name: "Step 1: Basics", exact: true }).click();
    await stepHeading(1, "Basics").waitFor();
    await pressStepButton("Continue");
    await stepHeading(2, "Work").waitFor();
    if ((await headlineBox.inputValue()) !== "Not this one") throw new Error("going back a step lost what was typed on the Work step");
    await pressStepButton("Skip for now");
    await stepHeading(3, "About you").waitFor();
    await shot("m03c-register-about");
    await pressStepButton("Back");
    await stepHeading(2, "Work").waitFor();
    if ((await headlineBox.inputValue()) !== "") throw new Error("Skip for now kept what was typed on the Work step");
    // A problem the server finds opens the step holding it, with the problem on its input.
    const register = "**/api/v1/t/demo-university/memberships";
    const refusal = { error: { code: "VALIDATION_ERROR", message: "Invalid input", details: [{ path: "headline", message: "The server can't take this headline" }] } };
    await page.route(register, (route) =>
      route.request().method() === "POST"
        ? route.fulfill({ status: 400, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify(refusal) })
        : route.fallback(),
    );
    await pressStepButton("Continue");
    await stepHeading(3, "About you").waitFor();
    await pressStepButton("Join the network");
    await stepHeading(2, "Work").waitFor();
    await page.getByText("The server can't take this headline", { exact: true }).waitFor();
    await page.unroute(register);
    await pressStepButton("Continue");
    await stepHeading(3, "About you").waitFor();
    await pressStepButton("Join the network");
    await page.getByText("Welcome to the official Demo University alumni network", { exact: false }).waitFor();
    for (let i = 0; i < 50 && liveSockets.length === 0; i++) await page.waitForTimeout(100);
    if (liveSockets.length === 0) throw new Error("the app did not open a live-updates connection after signing in");
    await shot("m04-feed");
  });

  await step("the profile card on the feed lists what to add, opens its section, and Not now puts it away", async () => {
    const card = page.getByRole("region", { name: "Complete your profile", exact: true });
    await card.waitFor();
    // Nothing but a name and a batch yet: the heaviest three of everything.
    const score = await card.getByRole("progressbar", { name: "Profile strength", exact: true }).getAttribute("aria-valuenow");
    if (score !== "0") throw new Error(`a new profile scores ${score}, not 0`);
    const items = await card.getByRole("link").allInnerTexts();
    if (items.join() !== "Add a profile photo,Write a headline,Add your current role") throw new Error(`the profile card suggests ${items.join(", ")}`);
    if (await card.locator("textarea, input").count()) throw new Error("the profile card holds a text box, which the feed's first one must not be");
    await shot("m04-profile-card");
    await card.getByRole("link", { name: "Write a headline", exact: true }).click();
    await page.waitForURL("**/t/demo-university/profile/edit?section=work");
    await page.getByRole("heading", { name: "Work", exact: true }).locator("visible=true").last().waitFor();
    // Opened from another tab, the edit screen sits on My profile: Back goes there, not to the feed with the edit screen
    // left behind in the profile stack. Back again is the feed.
    await page.getByRole("button", { name: "Back", exact: true }).locator("visible=true").last().click();
    await page.waitForURL("**/t/demo-university/profile");
    await page.getByRole("button", { name: "Edit profile" }).locator("visible=true").first().waitFor();
    await page.getByRole("button", { name: "Back", exact: true }).locator("visible=true").last().click();
    await page.waitForURL("**/t/demo-university/feed");
    await card.getByRole("button", { name: "Not now", exact: true }).click();
    const hiddenNote = page.getByText("Hidden for 14 days. My profile always shows what's left to add.", { exact: true });
    await hiddenNote.waitFor();
    if (await card.count()) throw new Error("Not now left the profile card on the feed");
    // The button went with the card: focus is on the note in its place.
    if (!(await hiddenNote.evaluate((el) => el.closest("[tabindex]")?.contains(document.activeElement)))) throw new Error("Not now left focus outside the note");
    // Put away on the server, so it stays away.
    await page.reload();
    await page.getByText("Welcome to the official Demo University alumni network", { exact: false }).locator("visible=true").first().waitFor();
    if (await card.count()) throw new Error("the profile card came back after a reload");
  });

  await step("create a post with a photo from the feed", async () => {
    await page.getByRole("button", { name: "New post" }).click();
    await page.locator("textarea").first().fill(`Hello from the mobile smoke ${unique}`);
    // A real 1×1 PNG through the browser's file chooser: the upload must send a File, not { uri, name, type }.
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
    for (const name of ["Add image", "Add a poll"]) await expectSvgNoEmoji(page.getByRole("button", { name, exact: true }).locator("visible=true").last(), `the post form's ${name} button`);
    const chooser = page.waitForEvent("filechooser");
    await tap("Add image");
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

  await step("a chosen reaction is a brand tint with a filled icon, and choosing it again takes it back", async () => {
    // Saving the edit closes its screen; until it has, the feed underneath is hidden and its card can't be found.
    await page.getByText(`Edited on mobile ${unique}`, { exact: true }).locator("visible=true").first().waitFor();
    // The innermost box holding both the post's text and its reactions is its card.
    const card = page
      .locator("div")
      .filter({ has: page.getByText(`Edited on mobile ${unique}`, { exact: true }) })
      .filter({ has: page.locator('[aria-label="Like"]') })
      .locator("visible=true")
      .last();
    await card.locator('[aria-label="Like"][aria-pressed="false"]').click();
    const chosen = card.locator('[aria-label="Like"][aria-pressed="true"]');
    await chosen.waitFor();
    // Demo University's ink and wash, as brandTones gives them (pinned in color.test.ts) and the web app draws them.
    const look = await expectChosenChip(chosen, "the chosen Like chip");
    if (look.icon.join(" ") !== "29 78 216") throw new Error(`the chosen icon is rgb ${look.icon.join(" ")}, not the brand's ink`);
    if (look.chip.join(" ") !== "223 230 250") throw new Error(`the chosen chip is rgb ${look.chip.join(" ")}, not the brand's wash`);
    await shot("m04b2-reaction-chosen");
    await chosen.click();
    await card.locator('[aria-label="Like"][aria-pressed="false"]').waitFor();
  });

  await step("celebrations card and a poll vote on the feed", async () => {
    const card = page.getByText("Celebrating today", { exact: true }).locator("visible=true").first();
    await card.waitFor();
    // Each row says what it celebrates, and its year is the batch, never a birth year.
    await page.getByText(/^Birthday · batch of \d{4}$/).locator("visible=true").first().waitFor();
    await page.getByText(/^\d+ years? with us · batch of \d{4}$/).locator("visible=true").first().waitFor();
    await page.getByRole("button", { name: "Wish", exact: true }).locator("visible=true").first().click();
    await page.getByText("Wished", { exact: true }).locator("visible=true").first().waitFor();
    await shot("m04c-celebrations");
    // The poll is a few posts down; scroll until the list has rendered it.
    const question = page.getByText("Where should we hold the next London meetup?").locator("visible=true").first();
    for (let i = 0; i < 30 && !(await question.count()); i++) await page.mouse.wheel(0, 600);
    await question.scrollIntoViewIfNeeded();
    await page.getByRole("button", { name: "Canary Wharf" }).locator("visible=true").first().click();
    await page.locator('[aria-label^="Canary Wharf"][aria-label*="your vote"]').first().waitFor();
    await shot("m04d-poll");
  });

  await step("a poll with several choices draws its boxes, says which are chosen, and takes the vote", async () => {
    const question = `Which smoke checks ran? ${unique}`;
    // From the top of the feed, where the new post lands.
    await page.goto(BASE + "/t/demo-university/feed");
    await page.getByRole("button", { name: "New post" }).click();
    await page.getByLabel("Post text", { exact: true }).locator("visible=true").last().fill(question);
    await tap("Add a poll");
    await page.getByLabel("Option 1", { exact: true }).locator("visible=true").last().fill("Web");
    await page.getByLabel("Option 2", { exact: true }).locator("visible=true").last().fill("Phone");
    // "Allow several choices", the form's only switch.
    await page.getByRole("switch").locator("visible=true").last().click();
    await tap("Post");
    await page.getByText(question, { exact: true }).locator("visible=true").first().waitFor();
    // The seeded poll takes one choice, so this is the only one that says "choose several", before the vote and after.
    const poll = page.locator('[aria-label="Poll"]', { hasText: "choose several" }).locator("visible=true").first();
    const option = (name) => poll.getByRole("checkbox", { name, exact: true });
    await poll.getByText("choose several", { exact: false }).waitFor();
    await option("Web").click();
    const checked = [await option("Web").getAttribute("aria-checked"), await option("Phone").getAttribute("aria-checked")];
    if (checked.join() !== "true,false") throw new Error(`the options report aria-checked ${checked.join(", ")}, expected true, false`);
    // The box is drawn, with a tick only in the chosen one, and no ballot-box symbol is left in either option's text.
    await expectSvgNoEmoji(option("Web"), "a chosen poll option");
    if (await option("Phone").locator("svg").count()) throw new Error("an option that isn't chosen shows a tick");
    for (const name of ["Web", "Phone"]) if (/[☐☑]/.test(await option(name).innerText())) throw new Error(`the "${name}" option still draws a ballot-box symbol`);
    await option("Phone").click();
    await poll.getByRole("button", { name: "Vote", exact: true }).click();
    await poll.locator('[aria-label^="Web,"][aria-label*="your vote"]').waitFor();
    await poll.locator('[aria-label^="Phone,"][aria-label*="your vote"]').waitFor();
    await shot("m04e-poll-several");
  });

  // After the post with a photo, whose wait for its image would also find this one on the app bar.
  await step("edit profile: add a photo through the round picker, saved as a square the profile shows", async () => {
    const shown = (locator) => locator.locator("visible=true").last();
    await page.goto(BASE + "/t/demo-university/profile");
    await shown(page.getByRole("button", { name: "Edit profile" })).click();
    await page.waitForURL("**/t/demo-university/profile/edit");
    await shown(page.getByText("Members recognise faces first", { exact: false })).waitFor();
    // Cancel while a photo is still being prepared: the picker is free again at once, and nothing goes up. Preparing is
    // held here so the press lands during it.
    const camera = await bigPhoto(page);
    const hold = await holdPhotoPreparation(page);
    const preparing = page.waitForEvent("filechooser");
    await shown(page.getByRole("button", { name: "Add photo", exact: true })).click();
    await (await preparing).setFiles(camera);
    await hold.held();
    await shown(page.getByRole("button", { name: "Cancel upload", exact: true })).click();
    await page.getByText("Upload cancelled.", { exact: true }).first().waitFor({ state: "attached" });
    await shown(page.getByRole("button", { name: "Add photo", exact: true })).waitFor();
    await hold.release();
    // Long enough for the prepared photo to have gone up, had the cancel not stopped it.
    await page.waitForTimeout(1500);
    hold.stop();
    if (hold.uploads()) throw new Error("a photo cancelled while it was being prepared was uploaded anyway");
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
    const chooser = page.waitForEvent("filechooser");
    await shown(page.getByRole("button", { name: "Add photo", exact: true })).click();
    await (await chooser).setFiles({ name: "me.png", mimeType: "image/png", buffer: png });
    await shown(page.getByRole("button", { name: "Change photo", exact: true })).waitFor();
    await shown(page.getByRole("button", { name: "Remove photo", exact: true })).waitFor();
    await shot("m04f-profile-photo-picked");
    await tap("Save profile");
    await page.waitForURL("**/t/demo-university/profile");
    // Served from /uploads/ as the 512-pixel square JPEG the server makes of a profile photo (this one was a 1×1 PNG).
    const saved = page.locator('img[src*="/uploads/"]').locator("visible=true").first();
    await saved.waitFor();
    const [width, height, src] = await saved.evaluate(async (img) => {
      await img.decode();
      return [img.naturalWidth, img.naturalHeight, img.src];
    });
    if (width !== 512 || height !== 512 || !src.endsWith(".jpg")) throw new Error(`the saved photo is ${width}×${height} at ${src}, not a 512-pixel square JPEG`);
  });

  await step("jobs: with no skills on their profile, a job's page offers to add them, opening the profile's Work section", async () => {
    const shown = (locator) => locator.locator("visible=true").last();
    // An edit left open on the Profile tab, unsaved: the job's link brings back that editor, draft and all, rather than
    // stacking a second one whose save the first would later undo.
    await page.goto(BASE + "/t/demo-university/profile");
    await shown(page.getByRole("button", { name: "Edit profile" })).click();
    await page.waitForURL("**/t/demo-university/profile/edit");
    const draft = `Half-written headline ${unique}`;
    await shown(page.getByLabel("Headline", { exact: true })).fill(draft);
    await openSection("Jobs");
    await page.waitForURL(/\/t\/demo-university\/jobs$/);
    const backend = shown(page.getByRole("button", { name: /^Backend Engineer \(Node\.js\)/ }));
    await backend.waitFor();
    if ((await backend.getAttribute("aria-label")).includes("(you have this)")) throw new Error("a member with no skills has one marked on a card");
    await backend.dispatchEvent("click");
    await page.waitForURL(/\/t\/demo-university\/jobs\/[0-9a-f-]{36}$/);
    const addSkills = shown(page.getByRole("link", { name: "Add your skills to see which you match", exact: true }));
    await addSkills.waitFor();
    if (await page.getByText(/^You have \d+ of \d+ skills?$/).locator("visible=true").count()) throw new Error("a member with no skills is told how many of the job's they have");
    await addSkills.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await shot("m05c-job-add-skills");
    await addSkills.click();
    await page.waitForURL("**/t/demo-university/profile/edit?section=work");
    // Opened at Work, as the profile's own section links do.
    const work = shown(page.getByRole("heading", { name: "Work", exact: true }));
    await work.waitFor();
    let top = -1;
    for (let i = 0; i < 30 && !(top > 0 && top < 250); i++) {
      if (i) await page.waitForTimeout(100);
      top = await work.evaluate((el) => el.getBoundingClientRect().top);
    }
    if (!(top > 0 && top < 250)) throw new Error(`the job's link left "Work" ${Math.round(top)}px down the screen`);
    const headlines = page.getByLabel("Headline", { exact: true });
    if ((await headlines.count()) !== 1) throw new Error(`the job's link left ${await headlines.count()} profile editors open, not the one already there`);
    if ((await headlines.inputValue()) !== draft) throw new Error("the job's link opened a fresh profile editor, losing the one left open");
    await shot("m05d-profile-edit-work-from-job");
  });

  await step("edit profile in sections: a headline, a skill and a past role, saved together, show on the profile", async () => {
    const shown = (locator) => locator.locator("visible=true").last();
    await page.goto(BASE + "/t/demo-university/profile");
    await shown(page.getByRole("button", { name: "Edit profile" })).click();
    await page.waitForURL("**/t/demo-university/profile/edit");
    for (const name of ["Basics", "Work", "About you"]) await shown(page.getByRole("heading", { name, exact: true })).waitFor();
    const headline = `Keeps the mobile smoke ${unique} green`;
    await shown(page.getByLabel("Headline", { exact: true })).fill(headline);
    // Skills are chips: Return adds one.
    const skills = shown(page.getByLabel("Skills", { exact: true }));
    await skills.fill("React Native");
    await skills.press("Enter");
    await shown(page.getByRole("button", { name: "Remove React Native", exact: true })).waitFor();
    // Two that the seeded Backend job asks for, spelt as it doesn't: the jobs step finds them matched.
    await skills.fill("typescript, aws");
    await skills.press("Enter");
    await shown(page.getByRole("button", { name: "Remove aws", exact: true })).waitFor();
    // A past role is checked as it's folded away, its error on the input it's about.
    await shown(page.getByRole("button", { name: "Add a past role", exact: true })).click();
    const role = shown(page.getByRole("group", { name: "Past role 1", exact: true }));
    await role.getByLabel("Job title *", { exact: true }).fill("QA engineer");
    await role.getByLabel("Company *", { exact: true }).fill("Flaky Labs");
    await role.getByLabel("Start year", { exact: true }).fill("2012");
    await role.getByLabel("End year", { exact: true }).fill("2010");
    await role.getByRole("button", { name: "Done with past role 1", exact: true }).click();
    await role.getByText("Can't be before the start year", { exact: true }).waitFor();
    await role.getByLabel("End year", { exact: true }).fill("2016");
    await role.getByRole("button", { name: "Done with past role 1", exact: true }).click();
    await shown(page.getByRole("button", { name: "Edit QA engineer at Flaky Labs", exact: true })).waitFor();
    await shot("m04g-profile-edit");
    // A problem the server finds inside the list ("experiences.0.endYear") goes on that row's input too, by its full
    // path, opening the row, and the note by the button says which section to look in.
    const me = "**/api/v1/t/demo-university/memberships/me";
    const refusal = { error: { code: "VALIDATION_ERROR", message: "Invalid input", details: [{ path: "experiences.0.endYear", message: "The server can't take this year" }] } };
    await page.route(me, (route) =>
      route.request().method() === "PATCH"
        ? route.fulfill({ status: 400, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify(refusal) })
        : route.fallback(),
    );
    await tap("Save profile");
    await role.getByText("The server can't take this year", { exact: true }).waitFor();
    await shown(page.getByText("Check the details marked in Work.", { exact: true })).waitFor();
    await page.unroute(me);
    await tap("Save profile");
    await page.waitForURL("**/t/demo-university/profile");
    for (const text of [headline, "React Native", "QA engineer", "Flaky Labs", "2012–2016"]) await shown(page.getByText(text, { exact: true })).waitFor();
    await shot("m04h-profile-details");
    // The meter follows what's saved: the photo (20), the headline (15), three skills (10) and a past role (5) of 100.
    const meter = shown(page.getByRole("progressbar", { name: "Profile strength", exact: true }));
    if ((await meter.getAttribute("aria-valuenow")) !== "50") throw new Error(`My profile's meter shows ${await meter.getAttribute("aria-valuenow")}, not 50`);
    await shown(page.getByText("Still to add", { exact: true })).waitFor();
    await shown(page.getByRole("link", { name: "Add the city you live in", exact: true })).waitFor();
    if (await page.getByRole("link", { name: "Add at least 3 skills", exact: true }).locator("visible=true").count()) throw new Error("My profile still asks for skills after three were saved");

    // A link to a section opens the form there.
    await shown(page.getByRole("link", { name: "Edit About you", exact: true })).click();
    await page.waitForURL("**/t/demo-university/profile/edit?section=about");
    const about = shown(page.getByRole("heading", { name: "About you", exact: true }));
    await about.waitFor();
    let top = -1;
    for (let i = 0; i < 30 && !(top > 0 && top < 250); i++) {
      if (i) await page.waitForTimeout(100);
      top = await about.evaluate((el) => el.getBoundingClientRect().top);
    }
    if (!(top > 0 && top < 250)) throw new Error(`?section=about left "About you" ${Math.round(top)}px down the screen`);
    await shot("m04i-profile-edit-about");
  });

  // Alert.alert, which asked before, does nothing on the web export: the sheet works on both.
  await step("my profile: Delete my account asks first in a sheet, saying a suspension or blocks would come back with the number, and Cancel keeps the account", async () => {
    const shown = (locator) => locator.locator("visible=true").last();
    await page.goto(BASE + "/t/demo-university/profile");
    await shown(page.getByRole("button", { name: "Delete my account", exact: true })).click();
    const sheet = page.getByRole("alertdialog", { name: "Delete your account?", exact: true });
    await sheet.getByText("If you were suspended at an institution, or members there had blocked you, that still applies if you join again with this number.", { exact: false }).waitFor();
    const cancel = sheet.getByRole("button", { name: "Cancel", exact: true });
    // The sheet slides up from below the screen: the shot waits until it's all in view.
    for (let i = 0; i < 30 && !(await cancel.evaluate((el) => el.getBoundingClientRect().bottom <= window.innerHeight)); i++) await page.waitForTimeout(100);
    await shot("m04j-delete-account-confirm");
    await cancel.click();
    await sheet.waitFor({ state: "hidden" });
    // Still signed in, and still a member: the profile reads the same after a reload.
    await page.reload();
    await shown(page.getByRole("button", { name: "Delete my account", exact: true })).waitFor();
    // The next step starts on the feed.
    await page.goto(BASE + "/t/demo-university/feed");
    await page.getByRole("button", { name: "New post" }).locator("visible=true").first().waitFor();
  });

  await step("every section opens its own screen, with Events, Groups, Mentors and Funding behind More", async () => {
    if ((await page.locator('a[role="tab"]').locator("visible=true").count()) !== 5) throw new Error("the tab bar should show four sections, then More");
    const moreColor = () => barTab("More").evaluate((el) => getComputedStyle(el).color);
    const moreColorOnFeed = await moreColor();
    // A route folder with no Tabs.Screen redirects to the first tab rather than failing, so check the URL and the content.
    const sections = [
      ["Feed", "feed", page.getByRole("button", { name: "New post" })],
      ["Messages", "messages", page.getByText("No conversations yet", { exact: true })],
      ["Jobs", "jobs", page.getByText("Backend Engineer (Node.js)")],
      ["Directory", "directory", page.getByPlaceholder("Name, company, role or skill")],
      ["Events", "events", page.getByText("Mumbai alumni coffee meetup")],
      ["Groups", "groups", page.getByRole("link", { name: /^London & UK alumni/ })],
      ["Mentors", "mentors", page.locator('[role="tab"][aria-selected="true"]').getByText("Find mentors", { exact: true })],
      ["Funding", "funding", page.getByText("Seeking funding", { exact: true })],
    ];
    for (const [label, path, content] of sections) {
      await openSection(label);
      await page.waitForURL(`**/t/demo-university/${path}`);
      await content.locator("visible=true").first().waitFor();
      if (label === "Funding" || label === "Events" || label === "Groups" || label === "Mentors") continue;
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
    // A job whose poster offers referrals says so on its card.
    const backend = page.getByRole("button", { name: /^Backend Engineer \(Node\.js\)/ }).locator("visible=true").first();
    await backend.getByText("Can refer", { exact: true }).waitFor();
    // Where it's done and what it pays, written from its work mode and its pay range, with its experience, and three of
    // its four skills with the rest counted.
    await backend.getByText("Zylo Labs · Mumbai · Remote", { exact: true }).waitFor();
    await backend.getByText("₹25–40 LPA", { exact: true }).waitFor();
    await backend.getByText("3–6 years", { exact: true }).waitFor();
    await backend.getByText("+1 more", { exact: true }).waitFor();
    // The profile step gave this member "typescript" and "aws", the job's second and fourth skills. They come first, each
    // with a check, and the card's name says so; "+1 more" still counts the rest, and the skills stay on one line.
    const cardName = await backend.getAttribute("aria-label");
    if (!cardName.includes("Skills: TypeScript (you have this), AWS (you have this), Node.js, 1 more")) throw new Error(`the card's name lists its skills as: ${cardName}`);
    const cardChip = (name) => backend.getByText(name, { exact: true }).locator("xpath=..");
    const [tsChip, awsChip, nodeChip] = [cardChip("TypeScript"), cardChip("AWS"), cardChip("Node.js")];
    const [tsBox, awsBox, nodeBox] = [await tsChip.boundingBox(), await awsChip.boundingBox(), await nodeChip.boundingBox()];
    if (!(tsBox.x < awsBox.x && awsBox.x < nodeBox.x)) throw new Error("the skills this member has aren't shown first on the card");
    if ((await tsChip.locator("svg").count()) !== 1 || (await awsChip.locator("svg").count()) !== 1 || (await nodeChip.locator("svg").count()) !== 0) throw new Error("only the skills this member has should carry a check on the card");
    const skillRow = await tsChip.locator("xpath=..").boundingBox();
    if (skillRow.height > tsBox.height + 1) throw new Error(`the card's skills take ${skillRow.height}px, more than one line of ${tsBox.height}px`);
    await backend.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await backend.screenshot({ path: `${SHOTS}/m05e-job-card-skills.png` });
    // Each tab, and on Referrals each list, is in the URL, as a referral notification links to them.
    await tab("Looking for work", false).click();
    await tab("Looking for work", true).waitFor();
    await page.waitForURL(/\/t\/demo-university\/jobs\?tab=seekers$/);
    await tab("Referrals", false).click();
    await page.waitForURL(/\/t\/demo-university\/jobs\?tab=referrals$/);
    await tab("Received", true).waitFor();
    await page.getByText("No referral requests yet", { exact: true }).locator("visible=true").first().waitFor();
    await tab("Sent", false).click();
    await page.waitForURL(/\/t\/demo-university\/jobs\?tab=referrals&box=sent$/);
    await page.getByText("You haven't asked for a referral yet", { exact: true }).locator("visible=true").first().waitFor();
    await tab("Openings", false).click();
    await page.waitForURL(/\/t\/demo-university\/jobs$/);
    await tab("Openings", true).waitFor();
    await shot("m05-jobs");

    // Work mode, seniority and experience wait behind Filters. Remote leaves out the on-site internship; one year of
    // experience is too little for 3–6 years, enough for 1–3, and a job that asks for none still fits.
    const onTop = (locator) => locator.locator("visible=true").last();
    const intern = onTop(page.getByRole("button", { name: /^Summer Intern – Strategy/ }));
    const apm = onTop(page.getByRole("button", { name: /^Associate Product Manager/ }));
    await intern.waitFor();
    await onTop(page.getByRole("button", { name: "Filters", exact: true })).click();
    const workModes = onTop(page.getByRole("group", { name: "Work mode", exact: true }));
    await workModes.getByRole("button", { name: "Remote", exact: true }).click();
    if ((await workModes.getByRole("button", { name: "Remote", exact: true }).getAttribute("aria-selected")) !== "true") throw new Error("the Remote filter doesn't show as chosen");
    // The cards also go while the list loads, filtered or not, so what's left out is checked once the filtered list is in.
    const listed = (name) => page.getByRole("button", { name }).locator("visible=true").count();
    await intern.waitFor({ state: "hidden" });
    await backend.waitFor();
    if (await listed(/^Summer Intern – Strategy/)) throw new Error("Remote still lists the on-site internship");
    await workModes.getByRole("button", { name: "Any", exact: true }).click();
    await intern.waitFor();
    await onTop(page.getByLabel("Your experience (years)", { exact: true })).fill("1");
    await backend.waitFor({ state: "hidden" });
    await apm.waitFor();
    await intern.waitFor();
    if (await listed(/^Backend Engineer \(Node\.js\)/)) throw new Error("one year of experience still lists the 3–6 year Backend job");
    await shot("m05a-jobs-filters");
    await onTop(page.getByRole("button", { name: "Clear filters", exact: true })).click();
    await backend.waitFor();
    await onTop(page.getByRole("button", { name: "Hide filters", exact: true })).click();

    // The seeded job's own page: its facts, its sections under their headings, and the address in How to apply a link
    // that opens apart from the app. The title is its only heading.
    await backend.dispatchEvent("click");
    await page.waitForURL(/\/t\/demo-university\/jobs\/[0-9a-f-]{36}$/);
    await onTop(page.getByRole("heading", { name: "Backend Engineer (Node.js)", exact: true })).waitFor();
    const titled = await page.getByRole("heading", { name: "Backend Engineer (Node.js)" }).locator("visible=true").count();
    if (titled !== 1) throw new Error(`${titled} headings hold the job's title`);
    await onTop(page.getByText("₹25–40 LPA", { exact: true })).waitFor();
    await onTop(page.getByText("Remote", { exact: true })).waitFor();
    await onTop(page.getByRole("heading", { name: "Responsibilities", exact: true })).waitFor();
    await onTop(page.getByRole("heading", { name: "About the company", exact: true })).waitFor();
    const applyAt = "https://example.com/zylo/backend";
    const howToApply = onTop(page.getByRole("link", { name: applyAt, exact: true }));
    if ((await howToApply.getAttribute("href")) !== applyAt || (await howToApply.getAttribute("target")) !== "_blank" || !(await howToApply.getAttribute("rel"))?.includes("noopener"))
      throw new Error("How to apply's address should be a link that opens in a new tab, with noopener");
    await onTop(page.getByRole("button", { name: "Apply", exact: true })).waitFor();
    await shot("m05b-job-detail");
    // Its page keeps the job's own order, marks the same two, and says how many of its skills this member has.
    await onTop(page.getByText("You have 2 of 4 skills", { exact: true })).waitFor();
    const pageSkills = onTop(page.getByRole("list", { name: "Skills" }));
    const pageChips = pageSkills.getByRole("listitem");
    const onPage = (await pageChips.allTextContents()).map((t) => t.trim());
    if (onPage.join("|") !== "Node.js|TypeScript (you have this)|PostgreSQL|AWS (you have this)") throw new Error(`the job's skills read ${onPage.join(", ")}`);
    if ((await pageChips.filter({ hasText: "TypeScript" }).locator("svg").count()) !== 1 || (await pageChips.filter({ hasText: "Node.js" }).locator("svg").count()) !== 0)
      throw new Error("only the skills this member has should carry a check on the job's page");
    if (await page.getByRole("link", { name: "Add your skills to see which you match" }).locator("visible=true").count()) throw new Error("a member with skills is offered to add them");
    await pageSkills.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await shot("m05f-job-skills-match");
    await page.getByLabel(/back$/i).locator("visible=true").first().click();
    await page.waitForURL(/\/t\/demo-university\/jobs$/);

    // A job asking for none of them says so, and marks nothing.
    await apm.dispatchEvent("click");
    await page.waitForURL(/\/t\/demo-university\/jobs\/[0-9a-f-]{36}$/);
    const none = onTop(page.getByText("You have 0 of 4 skills", { exact: true }));
    await none.waitFor();
    if (await page.getByText("(you have this)").count()) throw new Error("a job asking for none of this member's skills marks one");
    await none.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await shot("m05g-job-skills-none");
    await page.getByLabel(/back$/i).locator("visible=true").first().click();
    await page.waitForURL(/\/t\/demo-university\/jobs$/);
  });

  await step("RSVP to an event", async () => {
    await openSection("Events");
    await page.getByText("Mumbai alumni coffee meetup").locator("visible=true").first().click();
    await page.getByText("Who's going").waitFor();
    // The seeded description's bullets are list items, and its web address a link.
    await page.getByRole("listitem").filter({ hasText: "Partners and kids welcome" }).locator("visible=true").first().waitFor();
    await page.getByRole("link", { name: "https://example.com/maps/blue-tokai-bandra", exact: true }).locator("visible=true").first().waitFor();
    // Its email address is a mail link, which opens in place rather than in a blank tab.
    const mail = page.getByRole("link", { name: "meetups@demou.example", exact: true }).locator("visible=true").first();
    if ((await mail.getAttribute("href")) !== "mailto:meetups@demou.example" || (await mail.getAttribute("target")) !== null || !(await mail.getAttribute("rel"))?.includes("nofollow"))
      throw new Error("a member's email link should be a mail link that opens in place, with nofollow");
    await expectSvgNoEmoji(page.getByText("Mumbai · Blue Tokai, Bandra West", { exact: true }).locator("visible=true").first().locator("xpath=.."), "the event's city line");
    const before = Number((await page.locator("text=/^\\d+$/").first().textContent()).trim());
    await tap("I'm going");
    // The feed's tab, with this member's post, stays mounted but hidden: the attendee is the visible match.
    await page.getByText("Mobile Smoke").locator("visible=true").first().waitFor();
    await shot("m06-event");
    void before;
  });

  await step("directory search, its new filters and a member's full profile", async () => {
    await openSection("Directory");
    await page.getByRole("button", { name: /^Filters/ }).locator("visible=true").first().click();
    await page.getByText("Company", { exact: true }).locator("visible=true").first().waitFor();
    await page.getByText("Country", { exact: true }).locator("visible=true").first().waitFor();
    const search = page.getByPlaceholder("Name, company, role or skill", { exact: true }).locator("visible=true").first();
    // A seeded skill finds the member who lists it, though her name, company, role and headline don't say it.
    await search.fill("Distributed systems");
    const sneha = page.getByRole("button", { name: /^Sneha Kulkarni, / }).locator("visible=true").first();
    await sneha.waitFor();
    // What she's open to is on her card, short, and in full in the card's name.
    await sneha.getByText("Investing", { exact: true }).waitFor();
    if (!(await sneha.getAttribute("aria-label")).includes("Open to investing")) throw new Error(`Sneha's card is named "${await sneha.getAttribute("aria-label")}", without what she's open to`);
    // The Open to filter keeps her, and leaves out Priya, who is open to hiring.
    await page.getByRole("button", { name: "Investing", exact: true }).locator("visible=true").first().click();
    await search.fill("Sneha");
    await sneha.waitFor();
    await search.fill("Priya");
    await page.getByText("No members match", { exact: true }).locator("visible=true").first().waitFor();
    await page.getByRole("button", { name: "Clear filters", exact: true }).locator("visible=true").first().click();
    const hit = page.getByText("Priya Nair").locator("visible=true").first();
    await hit.waitFor();
    // A seeded mentor: her card says so, to the eye and in its name, with her headline in place of her role.
    const card = page.getByRole("button", { name: /^Priya Nair, .*Mentor/ }).locator("visible=true").first();
    await card.getByText("Mentor", { exact: true }).waitFor();
    await card.getByText("Product manager at Google, working on consumer apps", { exact: true }).waitFor();
    await shot("m07-directory-filters");
    // inactive tab stacks stay mounted on web and overlap; dispatch the click straight to the card
    await hit.dispatchEvent("click");
    await page.getByText("Member since").waitFor();
    // Her profile: the headline, skills, her current role then her past one, studies here and elsewhere, and a LinkedIn
    // link that opens in a new tab and passes nothing on. The screen on top is the last match.
    const onTop = (text) => page.getByText(text, { exact: true }).locator("visible=true").last();
    for (const text of ["Product manager at Google, working on consumer apps", "User research", "Product Manager", "Software engineer", "London Business School", "B.Tech, Electronics"]) await onTop(text).waitFor();
    const roles = await onTop("Experience")
      .locator("xpath=../..")
      .locator('[role="listitem"]')
      .evaluateAll((items) => items.map((item) => item.firstElementChild?.nextElementSibling?.textContent));
    if (roles.join() !== "Product Manager,Software engineer") throw new Error(`her roles read ${roles.join(", ")}, expected her current role, then her past one`);
    const linkedin = page.getByRole("link", { name: "LinkedIn", exact: true }).locator("visible=true").last();
    if ((await linkedin.getAttribute("href")) !== "https://www.linkedin.com/in/priya-nair-product") throw new Error("the LinkedIn link goes somewhere else");
    if ((await linkedin.getAttribute("target")) !== "_blank" || !/\bnoopener\b.*\bnoreferrer\b.*\bnofollow\b/.test((await linkedin.getAttribute("rel")) ?? "")) throw new Error("a member's link should open in a new tab with noopener, noreferrer and nofollow");
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
    // Each way to get in touch is named for what it does, with an SVG icon where an emoji was, and a 44-point target.
    for (const name of ["Website", "Email hello@zylolabs.example", "Call +91 22 5550 0101"]) {
      const contact = visible(page.getByRole("button", { name, exact: true }));
      await expectSvgNoEmoji(contact, `the "${name}" button`);
      const box = await contact.boundingBox();
      if (!box || box.height < 44) throw new Error(`the "${name}" button is ${box?.height}px tall, under 44px`);
    }
    await visible(page.getByRole("button", { name: "Report this content" })).waitFor();
    // The description is rich text: its three bullets are one list, and its address an anchor that opens in a new tab.
    const bullets = visible(page.getByRole("list").filter({ hasText: "Credit decisions in under a day" })).getByRole("listitem");
    if ((await bullets.count()) !== 3) throw new Error(`the description's bullets should be one list of 3 items, not ${await bullets.count()}`);
    const pricing = visible(page.getByRole("link", { name: "https://example.com/zylo/pricing", exact: true }));
    if ((await pricing.getAttribute("href")) !== "https://example.com/zylo/pricing" || (await pricing.getAttribute("target")) !== "_blank") throw new Error("a description's link should be an anchor that opens in a new tab");
    if (!(await pricing.getAttribute("rel"))?.includes("nofollow")) throw new Error("a member's link should carry nofollow");
    // A bullet is only for the eye; a step's number is read out, starting where the list starts.
    if ((await visible(page.getByRole("list").filter({ hasText: "Credit decisions in under a day" })).ariaSnapshot()).includes("•")) throw new Error("a bullet should be hidden from screen readers");
    const steps = visible(page.getByRole("list").filter({ hasText: "Book a short call" }));
    const stepsTree = await steps.ariaSnapshot();
    if ((await steps.getByRole("listitem").count()) !== 3 || !/1\.\s*Book a short call/.test(stepsTree) || !/3\.\s*Lend from the first week/.test(stepsTree))
      throw new Error(`the description's numbered steps should be one list of 3, numbered for screen readers from 1:\n${stepsTree}`);
    // An English list has its numbers on the left, before the text.
    if (!(await steps.getByRole("listitem").first().evaluate((li) => li.children[0].getBoundingClientRect().right <= li.children[1].getBoundingClientRect().left)))
      throw new Error("a numbered item's number should sit to the left of its text");
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
    await expectSvgNoEmoji(visible(page.getByRole("button", { name: "Add logo", exact: true })), "the business form's Add logo button");
    const chooser = page.waitForEvent("filechooser");
    await visible(page.getByRole("button", { name: "Add logo", exact: true })).click();
    await (await chooser).setFiles({ name: "logo.png", mimeType: "image/png", buffer: png });
    await visible(page.getByRole("button", { name: "Change logo" })).waitFor();
    await visible(page.getByRole("button", { name: "Remove logo", exact: true })).waitFor();
    // Then one straight off a camera, too big to send as it is: the app makes it smaller first, and the form shows it.
    await pickBigPhoto(page, async (file) => {
      const chooser = page.waitForEvent("filechooser");
      await visible(page.getByRole("button", { name: "Change logo" })).click();
      await (await chooser).setFiles(file);
    });
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
    // Back to the list the stack put under a listing opened from a link. Expo Router hands that list the listing's params.
    await page.waitForURL(/\/t\/demo-university\/businesses(\?id=[0-9a-f-]+)?$/);
    await visible(page.getByText("Lending software for small marketplaces", { exact: false })).waitFor();
    if (await page.getByText(`${name} and Sons`, { exact: true }).count()) throw new Error("a deleted listing is still in the list");
    // The next step takes the first bell on the page, which has to be the feed's rather than this screen's underneath it.
    await page.goto(BASE + "/t/demo-university/feed");
  });

  await step("notification settings persist", async () => {
    const group = () => page.locator('[role="radiogroup"][aria-label="Birthdays and anniversaries"]').locator("visible=true").first();
    const openSettings = async () => {
      await page.getByRole("button", { name: /^Notifications/ }).locator("visible=true").first().click();
      await page.getByRole("button", { name: "Settings", exact: true }).locator("visible=true").first().click();
      await group().waitFor();
    };
    await openSection("Feed");
    await openSettings();
    // Mentorship is on here and this member can use it, so its requests and answers have a row of their own.
    await page.locator('[role="radiogroup"][aria-label="Mentorship and referrals"]').locator("visible=true").first().waitFor();
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
      await expectBar("Feed", "Messages", "Jobs", "Directory", "More");
    }

    // A job or a listing opened cold, as from a push tap that launched the app, has its section's list to go back to.
    for (const [url, list] of [
      [job, /\/t\/demo-university\/jobs(\?jobId=[0-9a-f-]+)?$/],
      [funding, /\/t\/demo-university\/funding(\?id=[0-9a-f-]+)?$/],
    ]) {
      await page.goto(url);
      await page.getByLabel(/back$/i).locator("visible=true").first().click();
      await page.waitForURL(list);
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

    // A chat notice opens its thread above the tabs. One this member isn't in says so, with a way back, rather than going blank.
    const removed = await scriptNotification(page, "demo-university", { type: "CHAT_MESSAGE_REMOVED", data: { conversationId: "00000000-0000-4000-8000-0000000000aa", messageId: "00000000-0000-4000-8000-0000000000ab" }, title: "An admin removed a message you sent" });
    await page.goto(BASE + "/t/demo-university/profile/notifications");
    await page.getByText("An admin removed a message you sent", { exact: true }).click();
    await page.waitForURL("**/t/demo-university/messages/00000000-0000-4000-8000-0000000000aa");
    await page.getByText("This conversation isn't available").locator("visible=true").first().waitFor();
    if (await page.locator('a[role="tab"]').locator("visible=true").count()) throw new Error("a thread shows the tab bar");
    await page.getByRole("button", { name: "Go back" }).locator("visible=true").last().click();
    await page.waitForURL("**/t/demo-university/profile/notifications");
    await removed.stop();
  });

  await step("two members message each other live: request, accept, replies, a report and a block", async () => {
    // Seeded members with no thread between them. web-member.mjs uses a different pair, so the two scripts can run in either order.
    const phone = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
    const contextA = await signedInMobileContext(browser, BASE, "+919100000003", phone); // Arjun Singh
    const contextB = await signedInMobileContext(browser, BASE, "+919100000005", phone); // Vikram Desai
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();
    for (const p of [pageA, pageB]) p.setDefaultTimeout(20000);
    const app = `${BASE}/t/demo-university`;
    // Screens underneath stay mounted on the web export, so the one on top is the last match.
    const shown = (locator) => locator.locator("visible=true").last();
    const log = (p) => shown(p.locator('[role="log"]'));
    const live = { timeout: 10000 };
    const send = async (p, text) => {
      await shown(p.getByLabel("Write a message")).fill(text);
      await shown(p.getByRole("button", { name: "Send message" })).click();
    };
    const tabBar = (p) => p.locator('a[role="tab"]').locator("visible=true");
    const badgeA = async () => {
      const { accessToken } = await apiSession("+919100000003");
      const res = await fetch(`${API}/api/v1/t/demo-university/chat/badge`, { headers: { Authorization: `Bearer ${accessToken}` } });
      return (await res.json()).data;
    };

    // B waits on Requests, so the request has to arrive there live.
    await pageB.goto(`${app}/messages`);
    await shown(pageB.locator('[role="tab"]').getByText("Requests", { exact: true })).click();
    await shown(pageB.getByText("No message requests")).waitFor();
    const messagesTabB = pageB.locator('a[role="tab"]').filter({ hasText: "Messages" }).locator("visible=true").first();
    if (await messagesTabB.getAttribute("aria-label")) throw new Error(`B starts with something waiting: ${await messagesTabB.getAttribute("aria-label")}`);

    // A asks from B's profile. The first message goes as a request, and nothing more can follow it until B answers.
    await pageA.goto(`${app}/directory`);
    await shown(pageA.getByPlaceholder("Name, company, role or skill")).fill("Vikram");
    const hit = shown(pageA.getByText("Vikram Desai"));
    await hit.waitFor();
    await hit.dispatchEvent("click");
    await shown(pageA.getByRole("link", { name: "Message this member" })).click();
    await pageA.waitForURL(/\/messages\/new\?to=[0-9a-f-]+$/);
    await shown(pageA.getByText("Your first message is a request")).waitFor();
    const asked = `Hello Vikram, could I ask about IIM? ${unique}`;
    await send(pageA, asked);
    await pageA.waitForURL(/\/messages\/[0-9a-f-]{36}$/);
    await shown(pageA.getByText("Request sent", { exact: true })).waitFor();
    await log(pageA).getByText(asked).waitFor();
    if (await pageA.getByLabel("Write a message").locator("visible=true").count()) throw new Error("the requester can write more before an answer");
    if (await tabBar(pageA).count()) throw new Error("a thread shows the tab bar");
    await pageA.screenshot({ path: `${SHOTS}/m10a-chat-request-sent.png` });

    // B: the tab's badge and the Requests list change with no reload. The badge sits on the icon, so the label stays put.
    const badged = pageB.locator('a[role="tab"][aria-label="Messages, 1 unread"]').locator("visible=true").first();
    await badged.waitFor(live);
    const labelBottom = (name) => tabBar(pageB).filter({ hasText: name }).first().getByText(name, { exact: true }).evaluate((el) => el.getBoundingClientRect().bottom);
    const [withBadge, without] = [await labelBottom("Messages"), await labelBottom("Jobs")];
    if (Math.abs(withBadge - without) > 1) throw new Error(`the badge moves the Messages label: ${withBadge} against ${without}`);
    const request = shown(pageB.getByRole("link", { name: /^Arjun Singh/ }));
    await request.waitFor(live);
    await pageB.screenshot({ path: `${SHOTS}/m10b-chat-request-arrived.png` });
    await request.click();
    await log(pageB).getByText(asked).waitFor();
    await shown(pageB.getByRole("button", { name: "Accept request" })).click();
    const boxB = shown(pageB.getByLabel("Write a message"));
    await boxB.waitFor();

    // A can write once B accepts, with no reload, and messages go both ways live, one bubble each.
    await shown(pageA.getByLabel("Write a message")).waitFor(live);
    const fromA = `How was Ahmedabad? ${unique}`;
    await send(pageA, fromA);
    await log(pageB).getByText(fromA).waitFor(live);
    const fromB = `Hot, and worth it.\nAsk away! ${unique}`;
    await send(pageB, fromB);
    await log(pageA).getByText(`Ask away! ${unique}`, { exact: false }).waitFor(live);
    await pageA.waitForTimeout(1500);
    for (const [p, who] of [
      [pageA, "A"],
      [pageB, "B"],
    ]) {
      for (const text of [asked, fromA, `Ask away! ${unique}`]) {
        const bubbles = await log(p).getByText(text, { exact: false }).count();
        if (bubbles !== 1) throw new Error(`${who} shows ${bubbles} bubbles for "${text}"`);
      }
    }
    await pageA.screenshot({ path: `${SHOTS}/m10c-chat-thread.png` });

    // A thread marks what arrives read only while it's being looked at: not under another screen, and not with the app in
    // the background. Each time the message does reach it, so only that rule can keep it unread.
    const readOnReturn = async (what) => {
      for (let i = 0; i < 50 && (await badgeA()).unread !== 0; i++) await pageA.waitForTimeout(200);
      if ((await badgeA()).unread !== 0) throw new Error(`coming back to the thread ${what} didn't mark it read`);
    };
    await shown(pageA.getByRole("button", { name: "Conversation options" })).click();
    await shown(pageA.getByRole("dialog", { name: "Conversation options" })).getByRole("link", { name: "Blocked members" }).click();
    await shown(pageA.getByText("You haven't blocked anyone")).waitFor();
    const underneath = `Are you around? ${unique}`;
    await send(pageB, underneath);
    // The thread is still there under the blocked list, out of sight.
    await pageA.locator('[role="log"]').getByText(underneath).first().waitFor({ ...live, state: "attached" });
    await pageA.waitForTimeout(2500);
    if ((await badgeA()).unread !== 1) throw new Error("a thread under another screen was marked read");
    await shown(pageA.getByRole("button", { name: "Back" })).click();
    await readOnReturn("from another screen");

    const setVisible = (p, visible) =>
      p.evaluate((v) => {
        Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (v ? "visible" : "hidden") });
        document.dispatchEvent(new Event("visibilitychange"));
      }, visible);
    await setVisible(pageA, false);
    const unseen = `Still there? ${unique}`;
    await send(pageB, unseen);
    await log(pageB).getByText(unseen).waitFor();
    // B's bubble shows before the server has it, so wait for the send to land.
    await log(pageB).getByText("Sending…").waitFor({ state: "detached" });
    // The live connection closes in the background, so bring the message in the way a phone would: a network change
    // refetches what's gone stale.
    await pageA.evaluate(() => {
      const now = Date.now;
      Date.now = () => now() + 31_000;
    });
    await reconnect(pageA);
    await log(pageA).getByText(unseen).waitFor(live);
    await pageA.waitForTimeout(2500);
    if ((await badgeA()).unread !== 1) throw new Error("a thread in an app in the background was marked read");
    await setVisible(pageA, true);
    await readOnReturn("in front again");

    // A send that fails stays in the thread with Try again, which sends it under the same key.
    const sendUrl = /\/api\/v1\/t\/demo-university\/chat\/conversations\/[0-9a-f-]+\/messages$/;
    const sentKeys = [];
    let fail = true;
    await pageA.route(sendUrl, (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      sentKeys.push(route.request().postDataJSON().clientKey);
      if (!fail) return route.fallback();
      return route.fulfill({ status: 503, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ error: { code: "INTERNAL", message: "e2e INTERNAL" } }) });
    });
    const retried = `Sent at the second try ${unique}`;
    await send(pageA, retried);
    const tryAgain = shown(pageA.getByRole("button", { name: "Try again" }));
    await tryAgain.waitFor();
    fail = false;
    await tryAgain.click();
    await log(pageB).getByText(retried).waitFor(live);
    await pageA.getByRole("button", { name: "Try again" }).locator("visible=true").waitFor({ state: "detached" });
    if (sentKeys.length < 2 || new Set(sentKeys).size !== 1) throw new Error(`Try again didn't reuse the client key: ${sentKeys.join(", ")}`);
    if ((await log(pageA).getByText(retried).count()) !== 1) throw new Error("a retried message isn't exactly one bubble");
    await pageA.unroute(sendUrl);

    // A failed background refetch of the thread keeps the screen and the draft, and so does leaving and coming back.
    const draft = `Half-written thought ${unique}`;
    await shown(pageA.getByLabel("Write a message")).fill(draft);
    const thread = await scriptConversation(pageA, "demo-university", pageA.url().split("/").pop());
    thread.answer(503, "INTERNAL");
    await thread.refetch();
    if ((await shown(pageA.getByLabel("Write a message")).inputValue()) !== draft) throw new Error("a failed refetch of the thread lost the draft");
    if (!(await log(pageA).getByText(fromA).isVisible())) throw new Error("a failed refetch of the thread replaced it");
    thread.answer(null);
    await thread.stop();
    await shown(pageA.getByRole("button", { name: "Back" })).click();
    await pageA.waitForURL(/\/directory\/[0-9a-f-]+$/);
    await shown(pageA.getByRole("link", { name: "Message this member" })).click();
    await pageA.waitForURL(/\/messages\/[0-9a-f-]{36}$/);
    if ((await shown(pageA.getByLabel("Write a message")).inputValue()) !== draft) throw new Error("leaving the thread and coming back lost the draft");
    await shown(pageA.getByLabel("Write a message")).fill("");

    // A reports B's message: tapping it offers Report message. The sheet says what admins will see, and a second report
    // counts as done, not as an error. A's own messages offer no report.
    const reportB = async () => {
      await shown(log(pageA).getByText(`Ask away! ${unique}`, { exact: false })).click();
      await shown(pageA.getByRole("button", { name: "Report message" })).click();
      const sheet = shown(pageA.getByRole("dialog", { name: "Report message" }));
      await sheet.getByText("Admins will see this message and up to 10 around it.").waitFor();
      await sheet.getByRole("button", { name: "Send report" }).click();
      await sheet.waitFor({ state: "detached" });
    };
    await reportB();
    await shown(pageA.getByText("Thanks. Admins will take a look.")).waitFor();
    await reportB();
    await shown(pageA.getByText("You have already reported this message")).waitFor();
    await shown(log(pageA).getByText(fromA)).click();
    await pageA.waitForTimeout(300);
    if (await pageA.getByRole("button", { name: "Report message" }).locator("visible=true").count()) throw new Error("a member can report their own message");

    // A blocks B. B's next message looks sent to B and never reaches A, even after A unblocks.
    await shown(pageA.getByRole("button", { name: "Conversation options" })).click();
    await shown(pageA.getByRole("dialog", { name: "Conversation options" })).getByRole("button", { name: "Block member" }).click();
    const confirm = pageA.getByRole("alertdialog", { name: "Block Vikram Desai?" });
    await confirm.getByRole("button", { name: "Block member" }).click();
    await shown(pageA.getByText("You blocked Vikram Desai")).waitFor();
    if (await pageA.getByLabel("Write a message").locator("visible=true").count()) throw new Error("the blocker can still write");
    const whileBlocked = `Are you still there? ${unique}`;
    await send(pageB, whileBlocked);
    await log(pageB).getByText(whileBlocked).waitFor();
    await pageB.waitForTimeout(3000);
    if (await pageB.getByRole("button", { name: "Try again" }).locator("visible=true").count()) throw new Error("a message to a member who blocked you looked failed");
    if (await log(pageB).getByText("Sending…").count()) throw new Error("a message to a member who blocked you is stuck sending");
    if ((await log(pageB).getByText(whileBlocked).count()) !== 1) throw new Error("the blocked member's message isn't exactly one bubble on their side");
    if (await log(pageA).getByText(whileBlocked).count()) throw new Error("a blocked member's message reached the blocker");
    await shown(pageA.getByRole("button", { name: "Unblock member" })).click();
    await shown(pageA.getByLabel("Write a message")).waitFor();
    // A reload is a cold start on the thread, which mounts with the layout above it, as a push tap on a closed app does. It must
    // still count as open: a message the live connection loses is fetched as soon as the next one shows the gap.
    const lost = `Lost on the way ${unique}`;
    const socket = await dropFrames(pageA, lost);
    await pageA.reload();
    await log(pageA).getByText(fromA).waitFor();
    if (await log(pageA).getByText(whileBlocked).count()) throw new Error("unblocking brought back a message sent while blocked");
    await socket.opened();
    await send(pageB, lost);
    await log(pageB).getByText(lost).waitFor();
    await log(pageB).getByText("Sending…").waitFor({ state: "detached" });
    const afterLost = `And the one after it ${unique}`;
    await send(pageB, afterLost);
    await log(pageA).getByText(afterLost).waitFor(live);
    await log(pageA).getByText(lost).waitFor(live);
    if (!socket.dropped()) throw new Error("the live connection never carried the message meant to be lost, so the gap went untested");

    // The reload was a cold start on a thread: no tab bar, and Back has somewhere real to go.
    if (await tabBar(pageA).count()) throw new Error("a thread opened cold shows the tab bar");
    await shown(pageA.getByRole("button", { name: "Back" })).click();
    await pageA.waitForURL("**/t/demo-university/feed");
    await tabBar(pageA).first().waitFor();
    await contextA.close();
    await contextB.close();
  });

  await step("groups: an open group found in Discover and joined, live messages both ways, an invitation accepted from Invitations, leaving, archiving", async () => {
    // Two seeded members in no group, thread or invitation of the seed's, and in neither script's direct-message pair.
    const OWNER = "+91931000006";
    const JOINER = "+91931000007";
    const nameOf = async (phone) => (await apiSession(phone)).memberships.find((m) => m.tenant.slug === "demo-university").fullName;
    const [ownerName, joinerName] = [await nameOf(OWNER), await nameOf(JOINER)];
    const phone = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
    const ownerContext = await signedInMobileContext(browser, BASE, OWNER, phone);
    const joinerContext = await signedInMobileContext(browser, BASE, JOINER, phone);
    const owner = await ownerContext.newPage();
    const joiner = await joinerContext.newPage();
    for (const p of [owner, joiner]) p.setDefaultTimeout(20000);
    const app = `${BASE}/t/demo-university`;
    // Screens underneath stay mounted on the web export, so the one on top is the last match.
    const shown = (locator) => locator.locator("visible=true").last();
    const log = (p) => shown(p.locator('[role="log"]'));
    const live = { timeout: 10000 };
    const openName = `Mobile runners ${unique}`;
    const closedName = `Mobile committee ${unique}`;
    const threadId = (p) => /\/messages\/([0-9a-f-]{36})$/.exec(p.url())[1];
    const send = async (p, text) => {
      await shown(p.getByLabel("Write a message")).fill(text);
      await shown(p.getByRole("button", { name: "Send message" })).click();
      await log(p).getByText(text).waitFor();
    };
    const createGroup = async (name, choice) => {
      await owner.goto(`${app}/groups`);
      await shown(owner.getByRole("link", { name: "Create group" })).click();
      await owner.waitForURL(/\/groups\/new$/);
      // Before anything is sent: what each choice means, and that it's for good.
      await shown(owner.getByText("You can't change this after the group is created.")).waitFor();
      await shown(owner.getByText("Any member can find and join this group, and new members see the whole conversation.")).waitFor();
      await shown(owner.getByText("Only people you invite can see this group. New members see messages from when they join.")).waitFor();
      await shown(owner.getByLabel("Group name", { exact: true })).fill(name);
      await shown(owner.getByLabel("Description", { exact: true })).fill(`Made by the mobile smoke run ${unique}.`);
      const radio = shown(owner.getByRole("radio", { name: choice, exact: true }));
      await radio.click();
      if ((await radio.getAttribute("aria-checked")) !== "true") throw new Error(`"${choice}" doesn't show as chosen`);
      await shown(owner.getByRole("button", { name: "Create group" })).click();
      await owner.waitForURL(/\/messages\/[0-9a-f-]{36}$/);
      await shown(owner.getByLabel("Write a message")).waitFor();
      return threadId(owner);
    };

    // An open group, with a message from before the second member arrives: they get the whole history.
    const openId = await createGroup(openName, "Open group");
    const before = `Who's in for Sunday? ${unique}`;
    await send(owner, before);
    await owner.screenshot({ path: `${SHOTS}/m11a-group-created.png` });

    // The second member finds it in Discover, opens its preview and joins.
    await joiner.goto(`${app}/groups`);
    await shown(joiner.getByLabel("Search groups")).fill(openName);
    await shown(joiner.getByRole("link", { name: new RegExp(`^${openName}`) })).click();
    await joiner.waitForURL(new RegExp(`/groups/${openId}$`));
    await shown(joiner.getByText(ownerName, { exact: true })).waitFor();
    await joiner.screenshot({ path: `${SHOTS}/m11b-group-preview.png` });
    await shown(joiner.getByRole("button", { name: "Join group" })).click();
    await joiner.waitForURL(new RegExp(`/messages/${openId}$`));
    await log(joiner).getByText(before).waitFor();
    await log(owner).getByText(`${joinerName} joined the group`).waitFor(live);

    // Live both ways, each message under its sender's name, and exactly one bubble each side.
    const fromJoiner = `Count me in ${unique}`;
    await send(joiner, fromJoiner);
    await log(owner).getByText(fromJoiner).waitFor(live);
    const fromOwner = `Great, 6am at the gate ${unique}`;
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
    await log(owner).getByText(joinerName, { exact: true }).first().waitFor();
    await log(joiner).getByText(ownerName, { exact: true }).first().waitFor();
    await owner.screenshot({ path: `${SHOTS}/m11c-group-thread.png` });

    // An invite-only group. What was said before the invitee joins stays out of their view.
    const closedId = await createGroup(closedName, "Invite-only group");
    const early = `Before anyone else is here ${unique}`;
    await send(owner, early);
    // The invitee waits on a tab, where the badge shows. Groups is behind More, so More carries it.
    await joiner.goto(`${app}/feed`);
    const more = (p) => p.locator('a[role="tab"]').filter({ hasText: "More" }).locator("visible=true").first();
    await more(joiner).waitFor();
    if (await more(joiner).getAttribute("aria-label")) throw new Error(`the joiner starts with something behind More: ${await more(joiner).getAttribute("aria-label")}`);
    await shown(owner.getByRole("link", { name: "Group details" })).click();
    await owner.waitForURL(new RegExp(`/groups/${closedId}$`));
    await shown(owner.getByRole("button", { name: "Invite members" })).click();
    const inviting = shown(owner.getByRole("dialog", { name: "Invite members" }));
    await inviting.getByLabel("Search members").fill(joinerName);
    const candidate = inviting.getByRole("checkbox", { name: joinerName, exact: true });
    await candidate.click();
    if ((await candidate.getAttribute("aria-checked")) !== "true") throw new Error("the chosen member doesn't show as chosen");
    await owner.screenshot({ path: `${SHOTS}/m11d-group-invite.png` });
    await inviting.getByRole("button", { name: "Send invitation" }).click();
    await inviting.waitFor({ state: "detached" });
    await shown(owner.getByText("Invitation sent", { exact: true })).waitFor();

    // The invitee's badge arrives live, named for what it counts, and the invitation waits under Invitations.
    await joiner.locator('a[role="tab"][aria-label="More, Groups, 1 invitation"]').locator("visible=true").first().waitFor(live);
    await more(joiner).click();
    await shown(joiner.getByRole("link", { name: "Groups, 1 invitation", exact: true })).click();
    await joiner.waitForURL(/\/groups$/);
    await shown(joiner.locator('[role="tab"]').getByText("Invitations", { exact: true })).click();
    await joiner.waitForURL(/\/groups\?tab=invitations$/);
    await shown(joiner.getByText(`Invited by ${ownerName}`, { exact: false })).waitFor();
    await joiner.screenshot({ path: `${SHOTS}/m11e-group-invitation.png` });
    await shown(joiner.getByRole("button", { name: "Accept invitation" })).click();
    await joiner.waitForURL(new RegExp(`/messages/${closedId}$`));
    await log(joiner).getByText("You joined the group").waitFor();
    if (await log(joiner).getByText(early).count()) throw new Error("an invite-only group showed a new member what was said before they joined");
    await joiner.waitForFunction(() => !document.querySelector('a[role="tab"][aria-label^="More, Groups"]'), undefined, live);

    // Leaving, through the confirm sheet. The owner sees it live, and the group is gone for the one who left.
    await owner.goto(`${app}/messages/${closedId}`);
    await log(owner).getByText(`${joinerName} joined the group`).waitFor();
    await shown(joiner.getByRole("link", { name: "Group details" })).click();
    await joiner.waitForURL(new RegExp(`/groups/${closedId}$`));
    await shown(joiner.getByRole("button", { name: "Leave group" })).click();
    const leaving = joiner.getByRole("alertdialog", { name: "Leave this group?" });
    await leaving.getByRole("button", { name: "Cancel" }).click();
    await leaving.waitFor({ state: "hidden" });
    await shown(joiner.getByRole("button", { name: "Leave group" })).click();
    await leaving.getByRole("button", { name: "Leave group" }).click();
    await joiner.waitForURL(/\/groups\?tab=mine$/);
    await log(owner).getByText(`${joinerName} left the group`).waitFor(live);
    await shown(joiner.getByRole("link", { name: new RegExp(`^${openName}`) })).waitFor();
    if (await joiner.getByRole("link", { name: new RegExp(`^${closedName}`) }).locator("visible=true").count()) throw new Error("an invite-only group stayed in My groups after leaving it");
    await joiner.goto(`${app}/messages/${closedId}`);
    await shown(joiner.getByText("This conversation isn't available")).waitFor();

    // Archiving the open group leaves it readable and closed: the member's open thread says so live.
    await joiner.goto(`${app}/messages/${openId}`);
    await log(joiner).getByText(fromOwner).waitFor();
    await owner.goto(`${app}/groups/${openId}`);
    await shown(owner.getByRole("button", { name: "Archive group" })).click();
    await owner.getByRole("alertdialog", { name: "Archive this group?" }).getByRole("button", { name: "Archive group" }).click();
    await shown(owner.getByText("Archived", { exact: true })).waitFor();
    await shown(joiner.getByText("This group has been archived")).waitFor(live);
    if (await joiner.getByLabel("Write a message").locator("visible=true").count()) throw new Error("an archived group still offers its members a message box");
    await joiner.screenshot({ path: `${SHOTS}/m11f-group-archived.png` });

    // The owner's groups are in My posts.
    await owner.goto(`${app}/profile/my-content`);
    await shown(owner.locator('[role="tab"]').getByText("Groups", { exact: true })).click();
    await shown(owner.getByRole("link", { name: new RegExp(`^${openName}`) })).waitFor();
    await shown(owner.getByRole("link", { name: new RegExp(`^${closedName}`) })).waitFor();
    await owner.screenshot({ path: `${SHOTS}/m11g-my-posts-groups.png` });
    await owner.close();
    await joiner.close();
    groupsMembers = { ownerContext, joinerContext };
  });

  await step("mentorship: offered, found and asked with a note, accepted into a live chat that opens with the note, ended read-only, and a request reported", async () => {
    // The groups journey's two members, signed in already, so this costs no code from the 20 an hour every e2e script shares:
    // no mentor profile, request or direct thread of the seed's, and in neither script's direct-message pair.
    const MENTOR = "+91931000006";
    const MENTEE = "+91931000007";
    const nameOf = async (phone) => (await apiSession(phone)).memberships.find((m) => m.tenant.slug === "demo-university").fullName;
    const [mentorName, menteeName] = [await nameOf(MENTOR), await nameOf(MENTEE)];
    const phone = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
    const kept = groupsMembers;
    groupsMembers = null;
    const mentorContext = kept?.ownerContext ?? (await signedInMobileContext(browser, BASE, MENTOR, phone));
    const menteeContext = kept?.joinerContext ?? (await signedInMobileContext(browser, BASE, MENTEE, phone));
    const mentor = await mentorContext.newPage();
    const mentee = await menteeContext.newPage();
    for (const p of [mentor, mentee]) p.setDefaultTimeout(20000);
    const app = `${BASE}/t/demo-university`;
    // Screens underneath stay mounted on the web export, so the one on top is the last match.
    const shown = (locator) => locator.locator("visible=true").last();
    const log = (p) => shown(p.locator('[role="log"]'));
    const live = { timeout: 10000 };
    const tab = (p, name, selected) => shown(p.locator(selected === undefined ? '[role="tab"]' : `[role="tab"][aria-selected="${selected}"]`).getByText(name, { exact: true }));
    const row = (p, text) => shown(p.locator("article", { hasText: text }));
    const tabBar = (p) => p.locator('a[role="tab"]').locator("visible=true");
    const areas = ["Career advice", "Entrepreneurship", "Software and IT", "Finance", "Working abroad"];
    const about = `I moved from consulting into software. Ask me about either. ${unique}`;

    // Offering to mentor: five areas at most, how often, and a note for mentees. Each choice says whether it's chosen.
    await mentor.goto(`${app}/mentors`);
    await tab(mentor, "Find mentors", true).waitFor();
    await tab(mentor, "Be a mentor").click();
    await mentor.waitForURL(/\/mentors\?tab=be-a-mentor$/);
    await tab(mentor, "Be a mentor", true).waitFor();
    await shown(mentor.getByRole("heading", { name: "Offer to mentor" })).waitFor();
    for (const area of areas) {
      const box = shown(mentor.getByRole("checkbox", { name: area, exact: true }));
      await box.click();
      if ((await box.getAttribute("aria-checked")) !== "true") throw new Error(`"${area}" doesn't show as chosen`);
    }
    const sixth = shown(mentor.getByRole("checkbox", { name: "Law", exact: true }));
    if ((await sixth.getAttribute("aria-disabled")) !== "true") throw new Error("a sixth mentor area can be chosen");
    await sixth.click({ force: true });
    if ((await sixth.getAttribute("aria-checked")) === "true") throw new Error("a sixth mentor area was chosen");
    const fortnightly = shown(mentor.getByRole("radio", { name: "Every two weeks", exact: true }));
    await fortnightly.click();
    if ((await fortnightly.getAttribute("aria-checked")) !== "true") throw new Error("the availability doesn't show as chosen");
    await shown(mentor.getByLabel("Availability note", { exact: true })).fill("Weekday evenings, India time");
    await shown(mentor.getByLabel("Note to mentees", { exact: true })).fill(about);
    await mentor.screenshot({ path: `${SHOTS}/m12a-be-a-mentor.png` });
    await shown(mentor.getByRole("button", { name: "Save mentor profile" })).click();
    await shown(mentor.getByRole("heading", { name: "You're listed as a mentor" })).waitFor();
    await shown(mentor.getByText(/^You'll leave the Mentors list, and requests waiting for you will be declined\./)).waitFor();
    await shown(mentor.getByRole("button", { name: "Stop mentoring" })).waitFor();
    // Their own profile says so now, as other members' view of it does.
    await mentor.goto(`${app}/profile`);
    await shown(mentor.getByRole("heading", { name: mentorName, exact: true })).waitFor();
    await shown(mentor.getByText("Mentor", { exact: true })).waitFor();
    await mentor.goto(`${app}/mentors`);
    await tab(mentor, "Find mentors", true).waitFor();

    // The mentor waits on Requests, so the request has to arrive there live.
    await tab(mentor, "Requests").click();
    await mentor.waitForURL(/\/mentors\?tab=requests$/);
    await tab(mentor, "Received", true).waitFor();
    await shown(mentor.getByText("No requests yet", { exact: true })).waitFor();

    // The mentee finds them by name and area, and not under an availability they didn't choose. A card's name says what it shows.
    await mentee.goto(`${app}/mentors`);
    await shown(mentee.getByLabel("Search mentors")).fill(mentorName);
    const card = shown(mentee.getByRole("link", { name: new RegExp(`^${mentorName}, `) }));
    await card.waitFor();
    for (const area of areas) await card.getByText(area, { exact: true }).waitFor();
    const spoken = await card.getAttribute("aria-label");
    for (const part of [...areas, "Availability: Every two weeks"]) if (!spoken.includes(part)) throw new Error(`a mentor card's name leaves out "${part}": ${spoken}`);
    const chip = (group, name) => shown(mentee.getByRole("group", { name: group, exact: true }).getByRole("button", { name, exact: true }));
    await chip("Area", "Working abroad").click();
    if ((await chip("Area", "Working abroad").getAttribute("aria-selected")) !== "true") throw new Error("the area filter doesn't show as chosen");
    await card.waitFor();
    await chip("Availability", "Weekly").click();
    await shown(mentee.getByText("No mentors match", { exact: true })).waitFor();
    await chip("Availability", "Every two weeks").click();
    await card.click();
    await mentee.waitForURL(/\/mentors\/[0-9a-f-]{36}$/);
    const mentorPage = mentee.url();
    await shown(mentee.getByRole("heading", { name: mentorName })).waitFor();
    await shown(mentee.getByText("Every two weeks. Weekday evenings, India time", { exact: true })).waitFor();
    await shown(mentee.getByText(about, { exact: true })).waitFor();
    if (await tabBar(mentee).count()) throw new Error("a mentor's page shows the tab bar");
    await mentee.screenshot({ path: `${SHOTS}/m12b-mentor.png` });

    // A first request, which the mentor reports. The request form says who reads the note and what becomes of it.
    await shown(mentee.getByRole("link", { name: "Request mentorship" })).click();
    await mentee.waitForURL(/\/mentors\/request\/[0-9a-f-]{36}$/);
    await shown(mentee.getByText(`${mentorName} will see this note. If they accept, it becomes the first message of a chat between you, or the latest one if you already chat.`, { exact: true })).waitFor();
    // By its accessible name, the same on both apps, which leaves out the asterisk shown beside it.
    const noteBox = shown(mentee.getByRole("textbox", { name: "Note to the mentor", exact: true }));
    const first = `Could we talk about my startup some time? ${unique}`;
    await noteBox.fill(first);
    await shown(mentee.getByRole("button", { name: "Send request" })).click();
    await mentee.waitForURL(/\/mentors\?tab=requests&box=sent$/);
    await tab(mentee, "Sent", true).waitFor();
    const firstSent = row(mentee, first);
    await firstSent.getByText("Request sent", { exact: true }).waitFor();

    // The mentor: the request arrives live, with its note, and Requests counts it.
    const reported = row(mentor, first);
    await reported.waitFor(live);
    await reported.getByText(menteeName, { exact: true }).waitFor();
    await reported.getByText("Waiting for your answer", { exact: true }).waitFor();
    await shown(mentor.locator('[role="tab"][aria-selected="true"]', { hasText: "Requests" })).getByText("1", { exact: true }).waitFor();
    await mentor.screenshot({ path: `${SHOTS}/m12d-mentorship-request-received.png` });

    // Switched off, what the mentee is already in stays theirs to leave: Mentors stays behind More, and the request has
    // Withdraw, with nothing to find or answer.
    const off = await scriptFeatures(mentee, "demo-university");
    off.only("feed", "messaging", "groups", "jobs", "directory", "events", "businesses", "funding");
    await mentee.goto(`${app}/feed`);
    await tabBar(mentee).filter({ hasText: "More" }).first().click();
    await shown(mentee.getByRole("link", { name: "Mentors", exact: true })).click();
    await mentee.waitForURL(/\/t\/demo-university\/mentors$/);
    await shown(mentee.getByText("has switched mentorship off", { exact: false })).waitFor();
    await tab(mentee, "Sent").click();
    await firstSent.getByRole("button", { name: "Withdraw request" }).waitFor();
    if (await mentee.locator('[role="tab"]').getByText("Find mentors", { exact: true }).locator("visible=true").count()) throw new Error("Find mentors is offered with mentorship switched off");
    await mentee.screenshot({ path: `${SHOTS}/m12g-mentorship-switched-off.png` });
    await off.stop();

    // The mentor reports it: it's declined, the mentee isn't told it was reported, and admins get only the note.
    await reported.getByRole("button", { name: "Report request" }).click();
    const reporting = shown(mentor.getByRole("dialog", { name: "Report request" }));
    await reporting.getByText(`Admins will see only the note in this request, and nothing else. The request is declined: ${menteeName} will see it as declined, but won't be told it was reported.`, { exact: true }).waitFor();
    await reporting.getByRole("button", { name: "Spam", exact: true }).click();
    await mentor.screenshot({ path: `${SHOTS}/m12h-mentorship-report.png` });
    await reporting.getByRole("button", { name: "Send report" }).click();
    await reporting.waitFor({ state: "detached" });
    // Said in the row it's about.
    await reported.getByText("Thanks. Admins will take a look.", { exact: true }).waitFor();
    await reported.getByText("Declined", { exact: true }).waitFor();
    if (await reported.getByRole("button", { name: "Accept request" }).count()) throw new Error("a reported request can still be accepted");
    if (await reported.getByRole("button", { name: "Report request" }).count()) throw new Error("a reported request can be reported again");

    // Asked again, through the form, which refuses a note too short before sending anything.
    await mentee.goto(mentorPage);
    await shown(mentee.getByRole("link", { name: "Request mentorship" })).click();
    await mentee.waitForURL(/\/mentors\/request\/[0-9a-f-]{36}$/);
    await noteBox.fill("Hello!");
    await shown(mentee.getByRole("button", { name: "Send request" })).click();
    await shown(mentee.getByText("Write at least 10 characters", { exact: true })).waitFor();
    // The longest a note may be, so it wraps everywhere it's shown: four sentences of 115 characters and one of 37.
    const note = `${Array(4).fill(`Could you help me plan a move into software? I run a small company and want to understand the work first. ${unique}.`).join(" ")} I would welcome any advice you give.`;
    if (note.length !== 500) throw new Error(`the test note is ${note.length} characters, not 500`);
    await noteBox.fill(note);
    // The error stays until the next send, and the help and the count stay in view beside it.
    await shown(mentee.getByText("500 / 500", { exact: true })).waitFor();
    await shown(mentee.getByText("Write at least 10 characters", { exact: true })).waitFor();
    await shown(mentee.getByText(`${mentorName} will see this note.`, { exact: false })).waitFor();
    // The mentor failing to refetch in the background keeps the form and the note.
    const mentorGet = await scriptMentor(mentee, "demo-university", mentorPage.split("/").pop());
    mentorGet.answer(503, "INTERNAL");
    await mentorGet.refetch();
    if ((await noteBox.inputValue()) !== note) throw new Error("a failed refetch of the mentor lost the note");
    mentorGet.answer(null);
    await mentorGet.stop();
    await mentee.screenshot({ path: `${SHOTS}/m12c-mentorship-request-form.png` });
    await shown(mentee.getByRole("button", { name: "Send request" })).click();
    await mentee.waitForURL(/\/mentors\?tab=requests&box=sent$/);
    await tab(mentee, "Sent", true).waitFor();
    const sent = row(mentee, note);
    await sent.getByText("Request sent", { exact: true }).waitFor();
    await sent.getByRole("button", { name: "Withdraw request" }).waitFor();

    // It arrives live too.
    const received = row(mentor, note);
    await received.waitFor(live);
    await received.getByText("Waiting for your answer", { exact: true }).waitFor();
    await shown(mentor.locator('[role="tab"][aria-selected="true"]', { hasText: "Requests" })).getByText("1", { exact: true }).waitFor();

    // Accepting opens the chat, whose first message is the note, from the mentee.
    await received.getByRole("button", { name: "Accept request" }).click();
    await mentor.waitForURL(/\/messages\/[0-9a-f-]{36}$/);
    const threadId = mentor.url().split("/").pop();
    await log(mentor).getByText(note, { exact: true }).waitFor();
    if (await tabBar(mentor).count()) throw new Error("a mentorship's chat shows the tab bar");
    // The mentee's list says so live, and its Open chat goes into the same thread.
    await sent.getByText("Active", { exact: true }).waitFor(live);
    await sent.getByRole("link", { name: "Open chat", exact: true }).click();
    await mentee.waitForURL(new RegExp(`/messages/${threadId}$`));
    await log(mentee).getByText(note, { exact: true }).waitFor();

    // Messages both ways, live, and each one a single bubble on each side, below the note.
    const send = async (p, text) => {
      await shown(p.getByLabel("Write a message")).fill(text);
      await shown(p.getByRole("button", { name: "Send message" })).click();
      await log(p).getByText(text).waitFor();
    };
    const fromMentor = `Happy to. Shall we talk on Thursday? ${unique}`;
    await send(mentor, fromMentor);
    await log(mentee).getByText(fromMentor).waitFor(live);
    const fromMentee = `Thursday works, thank you. ${unique}`;
    await send(mentee, fromMentee);
    await log(mentor).getByText(fromMentee).waitFor(live);
    await mentee.waitForTimeout(1500);
    for (const [p, who] of [
      [mentor, "the mentor"],
      [mentee, "the mentee"],
    ]) {
      for (const text of [note, fromMentor, fromMentee]) {
        const bubbles = await log(p).getByText(text, { exact: true }).count();
        if (bubbles !== 1) throw new Error(`${who} shows ${bubbles} bubbles for "${text.slice(0, 40)}…"`);
      }
      const top = async (text) => (await log(p).getByText(text, { exact: true }).boundingBox()).y;
      if (!((await top(note)) < (await top(fromMentor)) && (await top(fromMentor)) < (await top(fromMentee)))) throw new Error(`${who} doesn't see the note as the chat's first message`);
    }
    await mentor.screenshot({ path: `${SHOTS}/m12e-mentorship-chat.png` });

    // The mentee ends it from Requests, through the confirm sheet, while the mentor's thread is open: it goes read-only there live.
    await mentee.goto(`${app}/mentors?tab=requests&box=sent`);
    await sent.getByRole("button", { name: "End mentorship" }).click();
    const ending = mentee.getByRole("alertdialog", { name: "End this mentorship?" });
    await ending.getByText(`${mentorName} will be told that it has ended.`, { exact: false }).waitFor();
    await ending.getByRole("button", { name: "Cancel" }).click();
    await ending.waitFor({ state: "hidden" });
    await sent.getByText("Active", { exact: true }).waitFor();
    await sent.getByRole("button", { name: "End mentorship" }).click();
    await ending.getByRole("button", { name: "End mentorship" }).click();
    await ending.waitFor({ state: "hidden" });
    await sent.getByText("Ended", { exact: true }).waitFor();
    // Said in the row it's about, where the member tapped.
    await sent.getByText("Mentorship ended", { exact: true }).waitFor();
    await shown(mentor.getByText("This conversation has closed")).waitFor(live);
    if (await mentor.getByLabel("Write a message").locator("visible=true").count()) throw new Error("the chat of an ended mentorship still offers the mentor a message box");
    await mentor.screenshot({ path: `${SHOTS}/m12f-mentorship-ended-thread.png` });
    await sent.getByRole("link", { name: "Open chat", exact: true }).click();
    await mentee.waitForURL(new RegExp(`/messages/${threadId}$`));
    await shown(mentee.getByText("This conversation has closed")).waitFor();
    await log(mentee).getByText(fromMentor).waitFor();
    if (await mentee.getByLabel("Write a message").locator("visible=true").count()) throw new Error("the chat of an ended mentorship still offers the mentee a message box");
    await mentor.goto(`${app}/mentors?tab=requests`);
    await row(mentor, note).getByText("Ended", { exact: true }).waitFor();
    await row(mentor, first).getByText("Declined", { exact: true }).waitFor();

    // The mentee's lists, an ended mentorship and a 500-character note among them, with nothing scrolling sideways.
    await mentee.goto(`${app}/mentors?tab=requests&box=sent`);
    await row(mentee, first).getByText("Declined", { exact: true }).waitFor();
    await row(mentee, note).getByText("Ended", { exact: true }).waitFor();
    const overflow = await mentee.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (overflow > 0) throw new Error(`Requests scrolls sideways by ${overflow}px on a phone`);
    await mentee.screenshot({ path: `${SHOTS}/m12i-mentorship-sent.png`, fullPage: true });

    // The bell: the mentee heard their request was accepted, and of the reported one only that it was declined, as for any
    // decline. The mentor's request names nobody, and leads to Received.
    await mentee.goto(`${app}/profile/notifications`);
    await shown(mentee.getByText(`${mentorName} accepted your mentorship request`, { exact: true })).waitFor();
    await shown(mentee.getByText(`${mentorName} declined your mentorship request`, { exact: true })).waitFor();
    await mentor.goto(`${app}/profile/notifications`);
    await shown(mentor.getByText(`${menteeName} ended your mentorship`, { exact: true })).waitFor();
    await shown(mentor.getByText("New mentorship request", { exact: true })).click();
    await mentor.waitForURL(/\/mentors\?tab=requests&box=received$/);
    await tab(mentor, "Received", true).waitFor();

    // A mentor's page opened cold, as from a link or a push that launched the app, has no tab bar and a real way back.
    await mentee.goto(mentorPage);
    await shown(mentee.getByRole("heading", { name: mentorName })).waitFor();
    if (await tabBar(mentee).count()) throw new Error("a mentor's page opened cold shows the tab bar");
    await shown(mentee.getByRole("button", { name: "Back" })).click();
    await mentee.waitForURL("**/t/demo-university/feed");
    await tabBar(mentee).first().waitFor();

    // The directory marks a mentor's card.
    await mentee.goto(`${app}/directory`);
    await shown(mentee.getByPlaceholder("Name, company, role or skill")).fill(mentorName);
    await shown(mentee.getByRole("button", { name: new RegExp(`^${mentorName}, .*Mentor`) })).getByText("Mentor", { exact: true }).waitFor();
    await mentor.close();
    await mentee.close();
    mentorshipMembers = { mentorContext, menteeContext };
  });

  await step("referrals: a job offered for referral, asked about with a note, accepted into a live chat that opens with the note, a request reported, and one closed with its job", async () => {
    // The poster is this run's main member, who has no thread with anyone. The mentorship journey's two members ask, signed in
    // already, so this costs no code: the mentee's request is accepted, so the chat it opens is new; the mentor's is reported
    // and never accepted, so their ended mentorship chat isn't touched. web-member.mjs uses other members.
    const ASKER = "+91931000007";
    const REPORTED = "+91931000006";
    const nameOf = async (phone) => (await apiSession(phone)).memberships.find((m) => m.tenant.slug === "demo-university").fullName;
    const [askerName, reportedName] = [await nameOf(ASKER), await nameOf(REPORTED)];
    const posterName = "Mobile Smoke";
    const phone = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
    const kept = mentorshipMembers;
    mentorshipMembers = null;
    const askerContext = kept?.menteeContext ?? (await signedInMobileContext(browser, BASE, ASKER, phone));
    const reportedContext = kept?.mentorContext ?? (await signedInMobileContext(browser, BASE, REPORTED, phone));
    const poster = page;
    const asker = await askerContext.newPage();
    const other = await reportedContext.newPage();
    asker.setDefaultTimeout(20000);
    other.setDefaultTimeout(20000);
    const app = `${BASE}/t/demo-university`;
    // Screens underneath stay mounted on the web export, so the one on top is the last match.
    const shown = (locator) => locator.locator("visible=true").last();
    const log = (p) => shown(p.locator('[role="log"]'));
    const live = { timeout: 10000 };
    const tab = (p, name, selected) => shown(p.locator(selected === undefined ? '[role="tab"]' : `[role="tab"][aria-selected="${selected}"]`).getByText(name, { exact: true }));
    const row = (p, text) => shown(p.locator("article", { hasText: text }));
    const sentList = /\/t\/demo-university\/jobs\?tab=referrals&box=sent$/;
    const engineer = `Mobile Referral Engineer ${unique}`;
    const analyst = `Mobile Referral Analyst ${unique}`;
    const LONG_SKILLS = ["Distributed systems engineering", "Site reliability engineering"];

    // The poster offers referrals on two new jobs. What ticking the box means is said beside it, before anything is posted.
    // The analyst job is remote, gives skills, pay, its company's website and an email, which go once it closes; the
    // engineer job takes its company details from it.
    const contactEmail = "smoke-mobile-jobs@example.com";
    const website = "https://example.com/smoke-labs";
    const postJob = async (title, { remote = false } = {}) => {
      await poster.goto(`${app}/jobs`);
      await shown(poster.getByRole("button", { name: "Post a job" })).click();
      await poster.waitForURL(/\/jobs\/new$/);
      await shown(poster.getByLabel("Job title *", { exact: true })).fill(title);
      await shown(poster.getByLabel("Company *", { exact: true })).fill("Smoke Labs");
      await shown(poster.getByLabel("About the role *", { exact: true })).fill("Help us keep the mobile smoke tests green.");
      // Work mode is one choice of three, on-site to start with, and the chosen one says so on the web build too.
      const mode = (name) => shown(poster.getByRole("group", { name: "Work mode", exact: true }).getByRole("button", { name, exact: true }));
      const seniority = (name) => shown(poster.getByRole("group", { name: "Seniority", exact: true }).getByRole("button", { name, exact: true }));
      if ((await mode("On-site").getAttribute("aria-selected")) !== "true") throw new Error("a new job doesn't start out on-site");
      if (remote) {
        await mode("Remote").click();
        if ((await mode("Remote").getAttribute("aria-selected")) !== "true" || (await mode("On-site").getAttribute("aria-selected")) !== "false") throw new Error("the Remote work mode doesn't show as chosen");
        // The last seniority, past the right edge of a phone's screen: the edit form has to bring it into view.
        await seniority("Executive").click();
        if ((await seniority("Executive").getAttribute("aria-selected")) !== "true") throw new Error("the Executive seniority doesn't show as chosen");
        // A comma adds the skill before it, and Return the one still typed. Two are too long for one line of a card.
        const skills = shown(poster.getByLabel("Skills", { exact: true }));
        await skills.fill(`Playwright, TypeScript, ${LONG_SKILLS.join(", ")}`);
        await skills.press("Enter");
        for (const skill of ["Playwright", "TypeScript", ...LONG_SKILLS]) await shown(poster.getByRole("button", { name: `Remove ${skill}`, exact: true })).waitFor();
        await shown(poster.getByLabel("Minimum experience (years)", { exact: true })).fill("2");
        await shown(poster.getByLabel("Maximum experience (years)", { exact: true })).fill("5");
        // The pay is typed in full and previewed as the job will show it.
        await shown(poster.getByLabel("Minimum pay", { exact: true })).fill("1800000");
        await shown(poster.getByLabel("Maximum pay", { exact: true })).fill("2500000");
        await shown(poster.getByText("₹18–25 LPA", { exact: true })).waitFor();
        await shown(poster.getByLabel("Pay note", { exact: true })).fill("plus ESOPs");
        await shown(poster.getByLabel("Responsibilities", { exact: true })).fill("- Run the suites\n- Fix what breaks");
        await shown(poster.getByLabel("Website", { exact: true })).fill(website);
        // Industry is chosen from a list, as on the profile form, and the field then names the choice.
        await shown(poster.getByRole("button", { name: "Industry, Choose an industry", exact: true })).click();
        await shown(poster.getByRole("button", { name: "Software and internet", exact: true })).click();
        await poster.getByRole("button", { name: "Software and internet", exact: true }).waitFor({ state: "hidden" });
        await shown(poster.getByRole("button", { name: "Industry, Software and internet", exact: true })).waitFor();
        await shown(poster.getByLabel("Contact email", { exact: true })).fill(contactEmail);
        await poster.screenshot({ path: `${SHOTS}/m13-job-form.png` });
      } else {
        // The analyst job, posted just now at the same company, offers its company details.
        await shown(poster.getByRole("button", { name: "Use details from your last job at Smoke Labs", exact: true })).click();
        await shown(poster.getByText("Filled in from your last job at Smoke Labs. Check them before you post.", { exact: true })).waitFor();
        const filled = await shown(poster.getByLabel("Website", { exact: true })).inputValue();
        if (filled !== website) throw new Error(`the company's website filled in as "${filled}"`);
        await shown(poster.getByRole("button", { name: "Industry, Software and internet", exact: true })).waitFor();
      }
      await shown(poster.getByText("Members can ask you for a referral with a short note. If you accept, it opens a private chat between you.", { exact: true })).waitFor();
      const offer = shown(poster.getByRole("checkbox", { name: "I can refer people for this job", exact: true }));
      if ((await offer.getAttribute("aria-checked")) !== "false") throw new Error("a new job starts out offering referrals");
      await offer.click();
      if ((await offer.getAttribute("aria-checked")) !== "true") throw new Error("the referral checkbox doesn't show as ticked");
      await shown(poster.getByRole("button", { name: "Post job" })).click();
      await poster.waitForURL(/\/jobs\/[0-9a-f-]{36}$/);
      await shown(poster.getByRole("heading", { name: title })).waitFor();
      await shown(poster.getByText("Job published", { exact: true })).waitFor();
      if (remote) {
        const jobPage = poster.url();
        // What the job says, after posting it and again after an edit that changes only its title: the form gives back
        // everything it was given, so saving the edit keeps the rest.
        const says = async (heading) => {
          await shown(poster.getByRole("heading", { name: heading, exact: true })).waitFor();
          await shown(poster.getByText("Smoke Labs · Remote", { exact: true })).waitFor();
          // The facts: the pay in lakhs and its note, and the experience.
          for (const fact of ["₹18–25 LPA", "plus ESOPs", "2–5 years"]) await shown(poster.getByText(fact, { exact: true })).waitFor();
          // Its poster has "typescript", but their own job compares nothing with it.
          const skills = await shown(poster.getByRole("list", { name: "Skills" })).getByRole("listitem").allInnerTexts();
          if (skills.join(",") !== ["Playwright", "TypeScript", ...LONG_SKILLS].join(",")) throw new Error(`the job's skills are ${skills.join(", ")}`);
          if (await poster.getByText(/^You have \d+ of \d+ skills?$|^Add your skills/).locator("visible=true").count()) throw new Error("a job's page compares its poster's skills with it");
          await shown(poster.getByRole("heading", { name: "Responsibilities", exact: true })).waitFor();
          await shown(poster.getByText("Fix what breaks", { exact: true })).waitFor();
          await shown(poster.getByRole("link", { name: "example.com/smoke-labs", exact: true })).waitFor();
          // About the company names the industry chosen.
          await shown(poster.getByText("Software and internet", { exact: true })).waitFor();
          await shown(poster.getByRole("button", { name: `Email ${contactEmail}`, exact: true })).waitFor();
        };
        await says(title);
        await shown(poster.getByRole("button", { name: "Edit", exact: true })).click();
        await poster.waitForURL(/\/jobs\/edit\/[0-9a-f-]{36}$/);
        // Its saved seniority, the last chip of its row, is scrolled into view rather than left off the side of the screen.
        const executive = seniority("Executive");
        if ((await executive.getAttribute("aria-selected")) !== "true") throw new Error("the edit form doesn't show the job's seniority as chosen");
        await shown(poster.getByRole("group", { name: "Seniority", exact: true })).evaluate((el) => el.scrollIntoView({ block: "center" }));
        const width = poster.viewportSize().width;
        let chip = null;
        for (let i = 0; i < 30 && !(chip && chip.x >= 0 && chip.x + chip.width <= width); i++) {
          if (i) await poster.waitForTimeout(100);
          chip = await executive.boundingBox();
        }
        if (!(chip.x >= 0 && chip.x + chip.width <= width)) throw new Error(`the chosen seniority is drawn from ${Math.round(chip.x)} to ${Math.round(chip.x + chip.width)}px, off a ${width}px screen`);
        await poster.screenshot({ path: `${SHOTS}/m13-job-edit-chosen-chip.png` });
        await shown(poster.getByLabel("Job title *", { exact: true })).fill(`${title} (remote)`);
        await shown(poster.getByRole("button", { name: "Save changes" })).click();
        await poster.waitForURL(jobPage);
        await shown(poster.getByText("Changes saved", { exact: true })).waitFor();
        await says(`${title} (remote)`);
      }
      return poster.url();
    };
    const analystPage = await postJob(analyst, { remote: true });
    // Its card on the poster's list marks none of its skills, though they have "typescript", and its skills, too long for
    // one line of a phone, shorten rather than wrap, so the card grows no taller.
    await poster.goto(`${app}/jobs`);
    const ownCard = shown(poster.getByRole("button", { name: new RegExp(`^${analyst} \\(remote\\)`) }));
    await ownCard.waitFor();
    const ownName = await ownCard.getAttribute("aria-label");
    if (!ownName.includes(`Skills: Playwright, TypeScript, ${LONG_SKILLS[0]}, 1 more`) || ownName.includes("(you have this)")) throw new Error(`the poster's own card names its skills as: ${ownName}`);
    const ownChips = ["Playwright", "TypeScript", LONG_SKILLS[0]].map((name) => ownCard.getByText(name, { exact: true }).locator("xpath=.."));
    for (const chip of ownChips) if (await chip.locator("svg").count()) throw new Error("the poster's own card marks a skill as theirs");
    const [ownRow, ownChip] = [await ownChips[0].locator("xpath=..").boundingBox(), await ownChips[0].boundingBox()];
    if (ownRow.height > ownChip.height + 1) throw new Error(`the card's long skills take ${ownRow.height}px, more than one line of ${ownChip.height}px`);
    // Each fits by shortening: the longest is cut off with an ellipsis rather than pushing the row past the card's edge.
    const cut = await ownCard.getByText(LONG_SKILLS[0], { exact: true }).evaluate((text) => text.scrollWidth > text.clientWidth);
    const spill = await ownChips[0].locator("xpath=..").evaluate((row) => row.scrollWidth > row.clientWidth);
    if (!cut || spill) throw new Error(`the card's long skills ${spill ? "run past its edge" : "aren't shortened to fit"}`);
    await ownCard.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await ownCard.screenshot({ path: `${SHOTS}/m13c-own-job-card-long-skills.png` });
    const engineerPage = await postJob(engineer);
    // The poster's own page waits for requests, which have to arrive here live.
    await shown(poster.getByText("Can refer", { exact: true })).waitFor();
    await shown(poster.getByRole("heading", { name: "Referral requests", exact: true })).waitFor();
    await shown(poster.getByText("No referral requests yet", { exact: true })).waitFor();
    if (await poster.getByRole("link", { name: "Ask for a referral" }).locator("visible=true").count()) throw new Error("a poster is offered Ask for a referral on their own job");
    await poster.screenshot({ path: `${SHOTS}/m13a-referral-job-posted.png` });

    // The asker finds it under Can refer, which leaves out jobs that take no requests.
    await asker.goto(`${app}/jobs`);
    const filter = shown(asker.getByRole("checkbox", { name: "Can refer", exact: true }));
    await filter.click();
    if ((await filter.getAttribute("aria-checked")) !== "true") throw new Error("the Can refer filter doesn't show as chosen");
    const card = shown(asker.getByRole("button", { name: new RegExp(`^${engineer}`) }));
    await card.getByText("Can refer", { exact: true }).waitFor();
    await shown(asker.getByText("Backend Engineer (Node.js)", { exact: true })).waitFor();
    if (await asker.getByText("Summer Intern – Strategy", { exact: true }).locator("visible=true").count()) throw new Error("Can refer lists a job that takes no referral requests");
    await card.dispatchEvent("click");
    await asker.waitForURL(engineerPage);
    await shown(asker.getByText(`${posterName} can refer people for this job. Ask with a short note: if they accept, it opens a private chat between you.`, { exact: true })).waitFor();
    await shown(asker.getByRole("link", { name: "Ask for a referral" })).click();
    await asker.waitForURL(/\/jobs\/request-referral\/[0-9a-f-]{36}$/);

    // The form says who reads the note and what becomes of it, and refuses a note too short before sending anything.
    await shown(asker.getByText(`${posterName} will see this note. If they accept, it becomes the first message of a chat between you, or the latest one if you already chat.`, { exact: true })).waitFor();
    // By its accessible name, the same on both apps, which leaves out the asterisk shown beside it.
    const noteBox = shown(asker.getByRole("textbox", { name: "Note to the poster", exact: true }));
    await noteBox.fill("Hello!");
    await shown(asker.getByRole("button", { name: "Send request" })).click();
    await shown(asker.getByText("Write at least 10 characters", { exact: true })).waitFor();
    // The longest a note may be, so it wraps everywhere it's shown.
    const sentence = `I build data pipelines in Python and would love your referral for this role, if you think I fit. ${unique}.`;
    const note = `${Array(4).fill(sentence).join(" ")} Thank you for reading this far and for offering to refer alumni like me.`;
    if (note.length !== 500) throw new Error(`the test note is ${note.length} characters, not 500`);
    await noteBox.fill(note);
    await shown(asker.getByText("500 / 500", { exact: true })).waitFor();
    // The job failing to refetch in the background keeps the form and the note.
    const jobGet = await scriptJob(asker, "demo-university", engineerPage.split("/").pop());
    jobGet.answer(503, "INTERNAL");
    await jobGet.refetch();
    if ((await noteBox.inputValue()) !== note) throw new Error("a failed refetch of the job lost the note");
    jobGet.answer(null);
    await jobGet.stop();
    await asker.screenshot({ path: `${SHOTS}/m13b-referral-request-form.png` });
    await shown(asker.getByRole("button", { name: "Send request" })).click();
    await asker.waitForURL(sentList);
    await tab(asker, "Sent", true).waitFor();
    const sent = row(asker, note);
    await sent.getByText("Request sent", { exact: true }).waitFor();
    await sent.getByText(`${engineer} at Smoke Labs`, { exact: true }).waitFor();
    await sent.getByRole("button", { name: "Withdraw request" }).waitFor();

    // The poster: it arrives live on the job's page, with its note, and says how many wait.
    const received = row(poster, note);
    await received.waitFor(live);
    await received.getByText(askerName, { exact: true }).waitFor();
    await received.getByText("Waiting for your answer", { exact: true }).waitFor();
    await shown(poster.getByText("1 waiting", { exact: true })).waitFor();

    // Switched off, what the asker is already in stays theirs to leave: Referrals stays in Jobs with Withdraw, and there's
    // nothing to ask or answer.
    const off = await scriptFeatures(asker, "demo-university");
    off.only("feed", "groups", "mentorship", "jobs", "directory", "events", "businesses", "funding");
    await asker.goto(`${app}/jobs`);
    await shown(asker.getByText("Backend Engineer (Node.js)", { exact: true })).waitFor();
    if (await asker.getByRole("checkbox", { name: "Can refer" }).locator("visible=true").count()) throw new Error("the Can refer filter is offered with referrals switched off");
    await tab(asker, "Referrals").click();
    await shown(asker.getByText("has switched referral requests off", { exact: false })).waitFor();
    await tab(asker, "Sent").click();
    await sent.getByRole("button", { name: "Withdraw request" }).waitFor();
    if (await sent.getByRole("link", { name: "Open chat" }).count()) throw new Error("a waiting request offers Open chat");
    await asker.screenshot({ path: `${SHOTS}/m13c-referrals-switched-off.png` });
    await off.stop();
    await asker.goto(`${app}/jobs?tab=referrals&box=sent`);
    await sent.getByText("Request sent", { exact: true }).waitFor();

    // The mentor asks too, and the poster reports it: it's declined, and their list and bell say so, as for any decline.
    await other.goto(engineerPage);
    await shown(other.getByRole("link", { name: "Ask for a referral" })).click();
    const fromOther = `Please refer me, it would mean a lot to me. ${unique}`;
    await shown(other.getByRole("textbox", { name: "Note to the poster", exact: true })).fill(fromOther);
    await shown(other.getByRole("button", { name: "Send request" })).click();
    await other.waitForURL(sentList);
    const reported = row(poster, fromOther);
    await reported.waitFor(live);
    await shown(poster.getByText("2 waiting", { exact: true })).waitFor();
    await poster.screenshot({ path: `${SHOTS}/m13d-referral-requests.png`, fullPage: true });
    await reported.getByRole("button", { name: "Report request" }).click();
    const reporting = shown(poster.getByRole("dialog", { name: "Report request" }));
    await reporting.getByText(`Admins will see only the note in this request, and nothing else. The request is declined: ${reportedName} will see it as declined, but won't be told it was reported.`, { exact: true }).waitFor();
    await reporting.getByRole("button", { name: "Spam", exact: true }).click();
    await reporting.getByRole("button", { name: "Send report" }).click();
    await reporting.waitFor({ state: "detached" });
    // Said in the row it's about.
    await reported.getByText("Thanks. Admins will take a look.", { exact: true }).waitFor();
    await reported.getByText("Declined", { exact: true }).waitFor();
    if (await reported.getByRole("button", { name: "Accept request" }).count()) throw new Error("a reported referral request can still be accepted");
    if (await reported.getByRole("button", { name: "Report request" }).count()) throw new Error("a reported referral request can be reported again");
    await row(other, fromOther).getByText("Declined", { exact: true }).waitFor(live);

    // Accepting opens the chat, whose first message is the asker's note, from them.
    await received.getByRole("button", { name: "Accept request" }).click();
    await poster.waitForURL(/\/messages\/[0-9a-f-]{36}$/);
    const threadId = poster.url().split("/").pop();
    await log(poster).getByText(note, { exact: true }).waitFor();
    // The asker's list says so live, and its Open chat goes into the same thread.
    await sent.getByText("Accepted", { exact: true }).waitFor(live);
    await sent.getByRole("link", { name: "Open chat", exact: true }).click();
    await asker.waitForURL(new RegExp(`/messages/${threadId}$`));
    await log(asker).getByText(note, { exact: true }).waitFor();

    // Messages both ways, live, and each one a single bubble on each side, below the note.
    const send = async (p, text) => {
      await shown(p.getByLabel("Write a message")).fill(text);
      await shown(p.getByRole("button", { name: "Send message" })).click();
      await log(p).getByText(text).waitFor();
    };
    const fromPoster = `Happy to refer you. Send me your CV? ${unique}`;
    await send(poster, fromPoster);
    await log(asker).getByText(fromPoster).waitFor(live);
    const reply = `On its way, thank you! ${unique}`;
    await send(asker, reply);
    await log(poster).getByText(reply).waitFor(live);
    await asker.waitForTimeout(1500);
    for (const [p, who] of [
      [poster, "the poster"],
      [asker, "the asker"],
    ]) {
      for (const text of [note, fromPoster, reply]) {
        const bubbles = await log(p).getByText(text, { exact: true }).count();
        if (bubbles !== 1) throw new Error(`${who} shows ${bubbles} bubbles for "${text.slice(0, 40)}…"`);
      }
      const top = async (text) => (await log(p).getByText(text, { exact: true }).boundingBox()).y;
      if (!((await top(note)) < (await top(fromPoster)) && (await top(fromPoster)) < (await top(reply)))) throw new Error(`${who} doesn't see the note as the chat's first message`);
    }
    await poster.screenshot({ path: `${SHOTS}/m13e-referral-chat.png` });

    // Closing a job closes what waits on it: the asker asks about the other job, and the poster closes it, warned first.
    await asker.goto(analystPage);
    await shown(asker.getByRole("link", { name: "Ask for a referral" })).click();
    const waitingNote = `Could you refer me for the analyst role as well? ${unique}`;
    await shown(asker.getByRole("textbox", { name: "Note to the poster", exact: true })).fill(waitingNote);
    await shown(asker.getByRole("button", { name: "Send request" })).click();
    await asker.waitForURL(sentList);
    // Withdrawing asks first, and Cancel leaves the request as it was.
    await asker.goto(analystPage);
    await shown(asker.getByText(`You've asked ${posterName} for a referral. Their answer will show in Referrals.`, { exact: true })).waitFor();
    if (await asker.getByRole("link", { name: "Ask for a referral" }).locator("visible=true").count()) throw new Error("a member waiting on a request is offered Ask for a referral again");
    await shown(asker.getByRole("button", { name: "Withdraw request" })).click();
    const withdrawing = asker.getByRole("alertdialog", { name: "Withdraw this request?" });
    await withdrawing.getByText(`${posterName} can't accept it any more`, { exact: false }).waitFor();
    await withdrawing.getByRole("button", { name: "Cancel" }).click();
    await withdrawing.waitFor({ state: "hidden" });
    await shown(asker.getByRole("link", { name: "See your requests" })).click();
    await asker.waitForURL(sentList);
    const closing = row(asker, waitingNote);
    await closing.getByText("Request sent", { exact: true }).waitFor();

    await poster.goto(analystPage);
    await row(poster, waitingNote).waitFor();
    await shown(poster.getByRole("button", { name: "Mark closed" })).click();
    const confirmClose = poster.getByRole("alertdialog", { name: "Close this job?" });
    await confirmClose.getByText("1 referral request is waiting for your answer. It will close, and its sender will be told this job is no longer taking referral requests.", { exact: true }).waitFor();
    await confirmClose.getByRole("button", { name: "Close job" }).click();
    await confirmClose.waitFor({ state: "hidden" });
    await shown(poster.getByText("Job closed", { exact: true })).waitFor();
    await shown(poster.getByText("Closed", { exact: true })).waitFor();
    // Closed, it takes no more applications: its contacts go from the page, its poster's too, and the page says so.
    await shown(poster.getByText("Applications closed", { exact: true })).waitFor();
    if (await poster.getByRole("button", { name: `Email ${contactEmail}`, exact: true }).locator("visible=true").count()) throw new Error("a closed job still shows its contact email");
    await poster.screenshot({ path: `${SHOTS}/m13d2-job-closed.png` });
    await closing.getByText("Closed", { exact: true }).waitFor(live);
    if (await closing.getByRole("button", { name: "Withdraw request" }).count()) throw new Error("a request closed with its job can still be withdrawn");
    await sent.getByText("Accepted", { exact: true }).waitFor();

    // The Sent list on a phone, every state in it and a 500-character note, with nothing scrolling sideways.
    const overflow = await asker.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (overflow > 0) throw new Error(`Referrals scrolls sideways by ${overflow}px on a phone`);
    await asker.screenshot({ path: `${SHOTS}/m13f-referrals-sent.png`, fullPage: true });

    // The bell: the asker heard of the acceptance and the closing; the reported member heard of their request only that it
    // was declined, as for any decline; the poster's notice names nobody and leads to the requests they received.
    await asker.goto(`${app}/profile/notifications`);
    await shown(asker.getByText(`${posterName} accepted your referral request`, { exact: true })).waitFor();
    await shown(asker.getByText("Your referral request was closed", { exact: true })).waitFor();
    await other.goto(`${app}/profile/notifications`);
    // From the mentorship journey, so the list has loaded.
    await shown(other.getByText(`${askerName} ended your mentorship`, { exact: true })).waitFor();
    await shown(other.getByText(`${posterName} declined your referral request`, { exact: true })).waitFor();
    await poster.goto(`${app}/profile/notifications`);
    await shown(poster.getByText("New referral request", { exact: true })).click();
    await poster.waitForURL(/\/t\/demo-university\/jobs\?tab=referrals&box=received$/);
    await tab(poster, "Received", true).waitFor();
    await row(poster, note).getByText("Accepted", { exact: true }).waitFor();

    // The request form opened cold, as from a link, has the Jobs list under it to go back to.
    await other.goto(`${app}/jobs`);
    const apm = shown(other.getByRole("button", { name: /^Associate Product Manager/ }));
    await apm.dispatchEvent("click");
    await other.waitForURL(/\/jobs\/[0-9a-f-]{36}$/);
    const apmId = other.url().split("/").pop();
    await other.goto(`${app}/jobs/request-referral/${apmId}`);
    await shown(other.getByRole("textbox", { name: "Note to the poster", exact: true })).waitFor();
    await shown(other.getByLabel(/back$/i)).click();
    await other.waitForURL(/\/t\/demo-university\/jobs(\?jobId=[0-9a-f-]+)?$/);
    await tab(other, "Openings", true).waitFor();

    await asker.close();
    await other.close();
    await askerContext.close();
    await reportedContext.close();
  });

  await step("a current pupil sees no Messages, Groups, Mentors or referrals, even with all of them switched on", async () => {
    const context = await signedInMobileContext(browser, BASE, "+919100000026", { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }); // Naina Sen, demo-school
    const pupil = await context.newPage();
    pupil.setDefaultTimeout(20000);
    const chatCalls = [];
    pupil.on("request", (r) => {
      if (/\/api\/v1\/t\/[^/]+\/chat\//.test(r.url())) chatCalls.push(new URL(r.url()).pathname);
    });
    // Schools start with messaging, groups and mentorship off. On here, so only the pupil rule can be what hides them.
    const features = await scriptFeatures(pupil, "demo-school");
    features.only("feed", "messaging", "groups", "mentorship", "jobs", "directory", "events", "businesses", "funding");
    await pupil.goto(`${BASE}/t/demo-school/feed`);
    const bar = pupil.locator('a[role="tab"]').locator("visible=true");
    await bar.filter({ hasText: "More" }).first().waitFor();
    const shown = await bar.evaluateAll((tabs) => tabs.map((tab) => tab.innerText.split("\n").pop()));
    if (shown.join() !== "Feed,Jobs,Directory,Events,More") throw new Error(`a pupil's tab bar shows ${shown.join(", ")}`);
    await bar.filter({ hasText: "More" }).first().click();
    await pupil.getByRole("link", { name: "Switch institution", exact: true }).locator("visible=true").first().waitFor();
    for (const section of ["Messages", "Groups", "Mentors"]) {
      if (await pupil.getByRole("link", { name: section, exact: true }).locator("visible=true").count()) throw new Error(`a pupil's More hub offers ${section}`);
    }
    // The inbox and the Groups lists send them home; a thread, a new conversation or a group says it isn't available.
    await pupil.goto(`${BASE}/t/demo-school/messages`);
    await pupil.waitForURL("**/t/demo-school/feed");
    await pupil.goto(`${BASE}/t/demo-school/groups`);
    await pupil.waitForURL("**/t/demo-school/feed");
    // Each says so under a lock drawn in SVG, not an emoji.
    const unavailable = (title) => expectSvgNoEmoji(pupil.getByText(title, { exact: true }).locator("visible=true").first().locator("xpath=.."), `"${title}" on ${pupil.url()}`);
    await pupil.goto(`${BASE}/t/demo-school/messages/00000000-0000-4000-8000-000000000001`);
    await pupil.getByText("Messages aren't available").locator("visible=true").first().waitFor();
    await unavailable("Messages aren't available");
    await pupil.screenshot({ path: `${SHOTS}/m10d-chat-pupil.png` });
    for (const path of ["groups/00000000-0000-4000-8000-000000000001", "groups/new"]) {
      await pupil.goto(`${BASE}/t/demo-school/${path}`);
      await pupil.getByText("Groups aren't available").locator("visible=true").first().waitFor();
      await unavailable("Groups aren't available");
    }
    // With nothing of theirs to leave there, Mentors says it isn't open to them, and so do a mentor's page and the request form.
    for (const path of ["mentors", "mentors/00000000-0000-4000-8000-000000000001", "mentors/request/00000000-0000-4000-8000-000000000001"]) {
      await pupil.goto(`${BASE}/t/demo-school/${path}`);
      await pupil.getByText("Mentors aren't available").locator("visible=true").first().waitFor();
      await unavailable("Mentors aren't available");
      if (!pupil.url().endsWith(`/t/demo-school/${path}`)) throw new Error(`${path} redirected a pupil to ${pupil.url()}`);
    }
    if (await pupil.getByRole("tab", { name: "Find mentors" }).locator("visible=true").count()) throw new Error("a pupil is offered Find mentors");
    await pupil.goto(`${BASE}/t/demo-school/profile/my-content`);
    await pupil.locator('[role="tab"]').getByText("Posts", { exact: true }).locator("visible=true").first().waitFor();
    if (await pupil.locator('[role="tab"]').getByText("Groups", { exact: true }).locator("visible=true").count()) throw new Error("a pupil's My posts has a Groups tab");

    // Jobs stay open to a pupil, without referrals: no tab, no filter, nothing to tick on the form, and no way to ask, even
    // with the job served as offering referrals, so only the pupil rule can be what hides it.
    const onTop = (locator) => locator.locator("visible=true").last();
    const jobUrl = /\/api\/v1\/t\/demo-school\/jobs\/[0-9a-f-]{36}$/;
    await pupil.route(jobUrl, async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      const response = await route.fetch();
      const json = await response.json();
      return route.fulfill({ response, json: { ...json, data: { ...json.data, canRefer: true } } });
    });
    await pupil.goto(`${BASE}/t/demo-school/jobs`);
    await onTop(pupil.locator('[role="tab"][aria-selected="true"]').getByText("Openings", { exact: true })).waitFor();
    const analyst = onTop(pupil.getByText("Product Analyst", { exact: true }));
    await analyst.waitFor();
    if (await pupil.locator('[role="tab"]').getByText("Referrals", { exact: true }).locator("visible=true").count()) throw new Error("a pupil's Jobs has a Referrals tab");
    if (await pupil.getByRole("checkbox", { name: "Can refer" }).locator("visible=true").count()) throw new Error("a pupil's Jobs has the Can refer filter");
    await analyst.dispatchEvent("click");
    await pupil.waitForURL(/\/t\/demo-school\/jobs\/[0-9a-f-]{36}$/);
    await onTop(pupil.getByRole("heading", { name: "Product Analyst" })).waitFor();
    await onTop(pupil.getByText("Can refer", { exact: true })).waitFor();
    if (await pupil.getByRole("link", { name: "Ask for a referral" }).locator("visible=true").count()) throw new Error("a pupil is offered Ask for a referral");
    await pupil.goto(pupil.url().replace("/jobs/", "/jobs/request-referral/"));
    await onTop(pupil.getByText("Referrals aren't available", { exact: true })).waitFor();
    await pupil.screenshot({ path: `${SHOTS}/m13g-referrals-pupil.png` });
    await pupil.unroute(jobUrl);
    await pupil.goto(`${BASE}/t/demo-school/jobs/new`);
    await onTop(pupil.getByLabel("Job title *", { exact: true })).waitFor();
    if (await pupil.getByRole("checkbox", { name: "I can refer people for this job" }).locator("visible=true").count()) throw new Error("a pupil's job form offers referrals");
    if (chatCalls.length) throw new Error(`a pupil's app called the chat API: ${chatCalls.join(", ")}`);
    await features.stop();
    await context.close();
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
    // With the account details failing too, on a bad connection, the form opens without them, and their refetch (which
    // has nothing to show meanwhile, as when the app comes back to the front) doesn't swap it for a spinner and start it
    // again.
    const meUrl = "**/api/v1/me";
    await page.route(meUrl, (route) =>
      route.request().method() === "GET"
        ? route.fulfill({ status: 503, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ error: { code: "INTERNAL", message: "e2e INTERNAL" } }) })
        : route.fallback(),
    );
    try {
      membership.answer(404, "NOT_A_MEMBER");
      await page.reload();
      await page.getByText("Create your profile").waitFor();
      await fullName.fill("Still typing");
      await reconnect(page);
      await page.waitForTimeout(1000);
      if ((await fullName.inputValue({ timeout: 1000 })) !== "Still typing") throw new Error("refetching the account lost what was typed on the register form");
    } finally {
      await page.unroute(meUrl);
    }

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

  await step("re-applying after a rejection fills in every step and shows the reason on each", async () => {
    // Demo College answers with a rejected application, made from their Demo University membership. Nothing is sent.
    const reason = "Add the section you were in";
    const url = "**/api/v1/t/demo-college/memberships/me";
    let rejected = null;
    await page.route(url, async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      const response = await route.fetch({ url: route.request().url().replace("/t/demo-college/", "/t/demo-university/") });
      rejected = { ...(await response.json()).data, status: "REJECTED", statusReason: reason };
      return route.fulfill({ response, json: { data: rejected } });
    });
    try {
      await page.goto(BASE + "/t/demo-college/register");
      await stepHeading(1, "Basics").waitFor();
      await page.getByText("Re-apply to join", { exact: true }).waitFor();
      const why = page.getByText(`Reason: ${reason}`, { exact: true });
      await why.waitFor();
      if ((await page.locator("input:visible").nth(0).inputValue()) !== rejected.fullName) throw new Error("re-applying didn't fill in the name");
      // What's there is theirs already: nothing to bring over.
      if (await page.getByText(/Use details from/).count()) throw new Error("re-applying offered Use details from another institution");
      await shot("m08b-register-reapply");
      // Every step can be opened at once, each prefilled and with the reason.
      await page.getByRole("button", { name: "Step 3: About you", exact: true }).click();
      await stepHeading(3, "About you").waitFor();
      await why.waitFor();
      await page.getByRole("button", { name: "Step 2: Work", exact: true }).click();
      await stepHeading(2, "Work").waitFor();
      await why.waitFor();
      if ((await page.getByLabel("Headline", { exact: true }).inputValue()) !== (rejected.headline ?? "")) throw new Error("re-applying didn't fill in the headline");
    } finally {
      await page.unroute(url);
    }
  });

  await step("ADMIN_APPROVAL tenant lands on the pending screen", async () => {
    // deep link straight into the college (served with SPA fallback); signed in but not a member → register
    await page.goto(BASE + "/t/demo-college");
    await page.getByText("Create your profile").waitFor();
    const inputs = page.locator("input:visible");
    await inputs.nth(0).fill("Pending Mobile");
    await inputs.nth(1).fill("2011");
    // Their profile at Demo University is offered: it fills what they haven't typed, and Undo takes it back, all but what
    // was changed since.
    await tap("Use details from Demo University");
    // First: a hidden live region repeats it for screen readers.
    await page.getByText(/^Filled in your .+ from Demo University\.$/).first().waitFor();
    await shot("m08a-register-copy");
    await pressStepButton("Continue");
    await stepHeading(2, "Work").waitFor();
    const headline = page.getByLabel("Headline", { exact: true });
    if ((await headline.inputValue()) === "") throw new Error("Use details didn't fill in the headline");
    await headline.fill("Head of smoke at Smoke Labs");
    await page.getByRole("button", { name: "Step 1: Basics", exact: true }).click();
    await stepHeading(1, "Basics").waitFor();
    await tap("Undo");
    await page.getByText("Took out the details from Demo University. Kept your changes to your headline.", { exact: true }).first().waitFor();
    await page.getByText("Use details from Demo University", { exact: true }).waitFor();
    await shot("m08c-register-undone");
    if ((await inputs.nth(0).inputValue()) !== "Pending Mobile") throw new Error("Use details or Undo changed the name they typed");
    await finishRegistration("Submit for approval", {
      onWork: async () => {
        if ((await headline.inputValue()) !== "Head of smoke at Smoke Labs") throw new Error("Undo threw away the headline typed after the copy");
      },
    });
    await page.getByText("Awaiting approval").waitFor();
    // The title sits in its own View, under the icon's tile.
    const pending = page.getByText("Awaiting approval", { exact: true }).locator("visible=true").first().locator("xpath=../..");
    await expectSvgNoEmoji(pending, "the pending screen");
    // The same tile as the web app's: the hidden box around the icon.
    const tile = await pending.locator("svg").first().evaluate((svg) => svg.parentElement.closest('[aria-hidden="true"]').getBoundingClientRect().toJSON());
    if (Math.round(tile.width) !== 72 || Math.round(tile.height) !== 72) throw new Error(`the pending screen's icon tile is ${tile.width}×${tile.height}, not 72×72 as on the web app`);
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
    await finishRegistration("Join the network");
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
