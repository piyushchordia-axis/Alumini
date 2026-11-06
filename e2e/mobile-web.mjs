import { mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { API, GREY_TEXT, PAGE_COLOURS, WHITE, apiSession, bigPhoto, dropFrames, expectChosenChip, expectSvgNoEmoji, holdPhotoPreparation, pageColours, pickBigPhoto, reconnect, scriptBusiness, scriptConversation, scriptFeatures, scriptJob, scriptMembership, scriptMentor, scriptNotification, scriptTenant, signedInMobileContext, textColour } from "./lib.mjs";

const BASE = process.env.MOBILE_WEB_URL ?? "http://localhost:8081";
// fileURLToPath, not URL.pathname: on Windows .pathname gives "/C:/…", which fs can't use.
const SHOTS = process.env.SHOTS ?? fileURLToPath(new URL("./screenshots/", import.meta.url));
mkdirSync(SHOTS, { recursive: true });
const unique = String(Date.now()).slice(-8);
const PHONE = `7${unique.slice(0, 9).padEnd(9, "3")}`;
const PHONE_2 = `6${unique.slice(0, 9).padEnd(9, "4")}`;
// Jignesh Patel, the Samaj admin: the next person to sign in after a forced sign-out, then the admin console's journey,
// so the console costs no code of its own. No other script signs him in.
const SAMAJ_ADMIN = "9000000004";
const results = [];
const step = async (name, fn) => {
  try {
    await fn();
    results.push(`✓ ${name}`);
  } catch (err) {
    results.push(`✗ ${name}: ${String(err).split("\n")[0]}`);
    // What every open page showed (a step may drive several), best effort: nothing here may hide the step's own error.
    const file = `FAILED-${name.replace(/\W+/g, "-").replace(/^-|-$/g, "").slice(0, 80)}`;
    for (const [i, p] of browser.contexts().flatMap((c) => c.pages()).entries()) {
      const each = p === page ? `${file}.png` : `${file}-page${i + 1}.png`;
      await p.screenshot({ path: `${SHOTS}/${each}`, fullPage: true, timeout: 10_000 }).catch(() => {});
      results.push(`  ${p === page ? "main page" : `page ${i + 1}`} at ${p.url()} (${each})`);
    }
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
/**
 * Whether the page holds going back: registration's hold on Back (expo-router's usePreventRemove) asks before the page
 * unloads too, on the web, so a beforeunload event shows whether it's on.
 */
const holdsBack = () =>
  page.evaluate(() => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });
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
const expectOnce = async (name) => {
  const shown = await page.getByText(name, { exact: true }).locator("visible=true").count();
  if (shown !== 1) throw new Error(`"${name}" shows ${shown} times on the register screen`);
};
const pressStepButton = async (name) => {
  const button = page.getByRole("button", { name, exact: true });
  await button.waitFor();
  await expectOnce(name);
  await button.click();
};
/**
 * From step 1 with its inputs filled: Continue, "Skip for now" on Work (after `onWork`, to look at it), then `label` on
 * About you, which says when an admin looks first. Each step has one Back.
 */
const finishRegistration = async (label, { onWork } = {}) => {
  await stepHeading(1, "Basics").waitFor();
  await expectOnce("Back");
  await pressStepButton("Continue");
  await stepHeading(2, "Work").waitFor();
  await expectOnce("Continue");
  await expectOnce("Back");
  await onWork?.();
  await pressStepButton("Skip for now");
  await stepHeading(3, "About you").waitFor();
  await expectOnce("Back");
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
    // Basics names the number the code went to, with a way to use another, and has Back, as every step does. With
    // nothing typed, Back goes where they came from: the landing screen, which offers Join rather than sending a
    // signed-in non-member straight back into a fresh form.
    // The landing screen under this one says it too, now.
    await page.getByText(`Signed in as +91 ${PHONE.slice(0, 5)} ${PHONE.slice(5)}`, { exact: true }).locator("visible=true").waitFor();
    if (await holdsBack()) throw new Error("an untouched Basics holds going back");
    await pressStepButton("Back");
    await page.waitForURL("**/t/demo-university");
    await page.getByText("Use a different number", { exact: true }).locator("visible=true").waitFor();
    if (await page.getByText("Sign in / Join with mobile number").locator("visible=true").count()) throw new Error("the landing screen offers a signed-in member to sign in");
    await shot("m02b-landing-signed-in");
    const inputs = page.locator("input:visible");
    // The years by their labels, which this institution words as a university's, never by position.
    const startBox = page.getByLabel("Year you joined *", { exact: true }).locator("visible=true");
    const endBox = page.getByLabel("Year you left (or will leave) *", { exact: true }).locator("visible=true");
    const fillBasics = async () => {
      await tap("Join DemoU");
      await stepHeading(1, "Basics").waitFor();
      await inputs.nth(0).fill("Mobile Smoke");
      await endBox.fill("2014");
      if (!(await holdsBack())) throw new Error("Basics with a name typed doesn't hold going back");
    };
    await fillBasics();
    // With something typed, Use a different number asks first, as signing out loses it; Cancel keeps them signed in.
    await page.getByText("Use a different number", { exact: true }).locator("visible=true").click();
    const signOutNote = page.getByText("You'll be signed out, and what you've entered here won't be kept.", { exact: true });
    await signOutNote.waitFor();
    await shot("m03a-register-other-number");
    await tap("Cancel");
    await signOutNote.waitFor({ state: "detached" });
    if ((await inputs.nth(0).inputValue()) !== "Mobile Smoke") throw new Error("Cancel on Use a different number lost the name");
    // So does Back: Cancel stays with the name, and Leave goes to the landing screen, from where Join starts afresh.
    const leaveNote = page.getByText("What you've entered here won't be kept.", { exact: true });
    await pressStepButton("Back");
    await leaveNote.waitFor();
    await shot("m03a2-register-leave");
    await tap("Cancel");
    await leaveNote.waitFor({ state: "detached" });
    if ((await inputs.nth(0).inputValue()) !== "Mobile Smoke") throw new Error("Cancel on Leave registration? lost the name");
    await pressStepButton("Back");
    await leaveNote.waitFor();
    await tap("Leave");
    await page.waitForURL("**/t/demo-university");
    await page.getByText("Join DemoU", { exact: true }).locator("visible=true").waitFor();
    // The registration screen goes, and its hold with it.
    await page.getByText("Create your profile").waitFor({ state: "detached" });
    if (await holdsBack()) throw new Error("the landing screen holds going back: Leave left registration's hold behind");
    await fillBasics();
    // The year they joined is required: Continue stays on Basics and says what's missing on its box.
    await pressStepButton("Continue");
    await page.getByText("Enter the year you joined", { exact: true }).locator("visible=true").waitFor();
    await stepHeading(1, "Basics").waitFor();
    await startBox.fill("2010");
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
    // Back on Work goes to Basics, and both steps keep what's in them.
    await headlineBox.fill("Kept by Back");
    await pressStepButton("Back");
    await stepHeading(1, "Basics").waitFor();
    if ((await inputs.nth(0).inputValue()) !== "Mobile Smoke") throw new Error("Back on Work lost the name");
    await pressStepButton("Continue");
    await stepHeading(2, "Work").waitFor();
    if ((await headlineBox.inputValue()) !== "Kept by Back") throw new Error("Back on Work lost what was typed there");
    // Left blank, as the profile card below expects.
    await headlineBox.fill("");
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
    // Going back is still held after a refusal: nothing typed may be lost to it.
    if (!(await holdsBack())) throw new Error("a refused profile left going back unheld");
    await page.unroute(register);
    await pressStepButton("Continue");
    await stepHeading(3, "About you").waitFor();
    await pressStepButton("Join the network");
    // Sending lets the screen go: Back's hold on it, kept while the profile is sent, mustn't keep the member there, nor
    // outlive it.
    const welcome = page.getByText("Welcome to the official Demo University alumni network", { exact: false });
    await welcome.waitFor();
    await page.waitForURL("**/t/demo-university/feed");
    await page
      .getByText("Create your profile")
      .waitFor({ state: "detached", timeout: 5000 })
      .catch(() => {
        throw new Error("the registration screen stayed after Join the network");
      });
    if (await holdsBack()) throw new Error("the feed holds going back: registration's hold outlived it");
    for (let i = 0; i < 50 && liveSockets.length === 0; i++) await page.waitForTimeout(100);
    if (liveSockets.length === 0) throw new Error("the app did not open a live-updates connection after signing in");
    await shot("m04-feed");
  });

  await step("the profile card on the feed lists what to add, opens its section, and Not now puts it away", async () => {
    const card = page.getByRole("region", { name: "Complete your profile", exact: true });
    await card.waitFor();
    // Nothing but a name and years yet: the heaviest three of everything.
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
    if (await page.getByRole("button", { name: "Announce", exact: true }).count()) throw new Error("a member's post form offers Announce");
    const chooser = page.waitForEvent("filechooser");
    await tap("Add image");
    await (await chooser).setFiles({ name: "smoke.png", mimeType: "image/png", buffer: png });
    await page.locator('img[src*="/uploads/"]').first().waitFor();
    await tap("Post");
    await page.getByText(`Hello from the mobile smoke ${unique}`).waitFor();
    // The author's grey line leads with the years they registered with, ahead of when they posted, and so does their row's name.
    await page.getByRole("link", { name: /^Mobile Smoke, 2010–2014 · / }).locator("visible=true").first().getByText(/^2010–2014 · /).waitFor();
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
    const text = page.getByText(`Edited on mobile ${unique}`, { exact: true }).locator("visible=true").first();
    await text.waitFor();
    // The post's card is the nearest box around its text that holds a Like. While the feed settles after the edit, that
    // box can briefly be the whole list, so wait until it holds exactly one Like.
    const card = text.locator('xpath=ancestor::div[.//*[@aria-label="Like"]][1]');
    for (let tries = 0; (await card.locator('[aria-label="Like"]').count()) !== 1; tries++) {
      if (tries >= 50) throw new Error("couldn't find the edited post's own card with its Like");
      await page.waitForTimeout(200);
    }
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
    // Each row says what it celebrates, and its years are the member's years here, never a birth year.
    await page.getByText(/^Birthday · \d{4}(–(\d{4}|present))?$/).locator("visible=true").first().waitFor();
    await page.getByText(/^\d+ years? with us · \d{4}(–(\d{4}|present))?$/).locator("visible=true").first().waitFor();
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
    // Were there in: a year from a list, counted with the other filters. Priya was here 2008–2012, so not in 2013 but in
    // 2012; "Any year" at the top of the list takes it off.
    const thereIn = (year) => page.getByRole("button", { name: `Were there in, ${year}`, exact: true }).locator("visible=true").first();
    const chooseYear = async (from, to) => {
      await thereIn(from).click();
      const row = page.getByRole("button", { name: to, exact: true });
      await row.locator("visible=true").last().click();
      await row.last().waitFor({ state: "hidden" });
      await thereIn(to).waitFor();
    };
    await chooseYear("Any year", "2013");
    await page.getByRole("button", { name: "Hide filters (1)", exact: true }).locator("visible=true").first().waitFor();
    await page.getByText("No members match", { exact: true }).locator("visible=true").first().waitFor();
    await chooseYear("2013", "2012");
    await hit.waitFor();
    await chooseYear("2012", "Any year");
    await page.getByRole("button", { name: "Hide filters", exact: true }).locator("visible=true").first().waitFor();
    // A seeded mentor: her card says so, to the eye and in its name, with her headline in place of her role.
    const card = page.getByRole("button", { name: /^Priya Nair, .*Mentor/ }).locator("visible=true").first();
    await card.getByText("Mentor", { exact: true }).waitFor();
    await card.getByText("Product manager at Google, working on consumer apps", { exact: true }).waitFor();
    await shot("m07-directory-filters");
    // inactive tab stacks stay mounted on web and overlap; dispatch the click straight to the card
    await hit.dispatchEvent("click");
    await page.getByText(/^Registered /).waitFor();
    // Her profile: the headline, skills, her current role then her past one, studies here and elsewhere, and a LinkedIn
    // link that opens in a new tab and passes nothing on. The screen on top is the last match.
    const onTop = (text) => page.getByText(text, { exact: true }).locator("visible=true").last();
    for (const text of ["2008–2012 · London, United Kingdom", "Product manager at Google, working on consumer apps", "User research", "Product Manager", "Software engineer", "London Business School", "B.Tech, Electronics"])
      await onTop(text).waitFor();
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
    await shown(pageA.getByText("2016–2020 · New conversation", { exact: true })).waitFor();
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
    const request = shown(pageB.getByRole("link", { name: /^Arjun Singh, 2011–2015, / }));
    await request.waitFor(live);
    // His years beside his name, since the line below is the preview, and under his name in the thread's header.
    await request.getByText("· 2011–2015", { exact: true }).waitFor();
    await pageB.screenshot({ path: `${SHOTS}/m10b-chat-request-arrived.png` });
    await request.click();
    await shown(pageB.getByText("2011–2015", { exact: true })).waitFor();
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
    // Their years as both apps write them, from the same sessions.
    const yearsOf = async (phone) => {
      const { startYear, batchYear } = (await apiSession(phone)).memberships.find((m) => m.tenant.slug === "demo-university");
      return batchYear == null ? `${startYear}–present` : startYear === batchYear ? String(startYear) : `${startYear}–${batchYear}`;
    };
    const [ownerYears, joinerYears] = [await yearsOf(OWNER), await yearsOf(JOINER)];
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
    // Named with their years, which the row shows in grey under the name.
    const candidate = inviting.getByRole("checkbox", { name: new RegExp(`^${joinerName}, ${joinerYears}$`) });
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
    await shown(joiner.getByText(`Invited by ${ownerName} (${ownerYears}) · `, { exact: false })).waitFor();
    await joiner.screenshot({ path: `${SHOTS}/m11e-group-invitation.png` });
    await shown(joiner.getByRole("button", { name: "Accept invitation" })).click();
    await joiner.waitForURL(new RegExp(`/messages/${closedId}$`));
    await log(joiner).getByText("You joined the group").waitFor();
    if (await log(joiner).getByText(early).count()) throw new Error("an invite-only group showed a new member what was said before they joined");
    await joiner.waitForFunction(() => !document.querySelector('a[role="tab"][aria-label^="More, Groups"]'), undefined, live);

    // The owner's list of members: the joiner's years in grey, the line under their name.
    await owner.goto(`${app}/groups/${closedId}`);
    const joinerLine = shown(owner.getByText(joinerName, { exact: true })).locator("xpath=following-sibling::*[1]");
    const joinerLineText = await joinerLine.textContent();
    if (joinerLineText !== joinerYears) throw new Error(`the joiner's row in the group's members reads "${joinerLineText}" under the name, not "${joinerYears}"`);

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
    // Deep link straight into the college (served with SPA fallback). Signed in but not a member: its landing screen offers
    // Join and another number, rather than sending them straight into the form.
    // Remembered as the institution to start at, as after being removed from it: the landing screen forgets it, so Choose
    // a different institution opens the list rather than this screen again.
    await page.evaluate(() => {
      const stored = JSON.parse(localStorage.getItem("illuminize.tenant"));
      localStorage.setItem("illuminize.tenant", JSON.stringify({ ...stored, state: { ...stored.state, lastTenantSlug: "demo-college" } }));
    });
    await page.goto(BASE + "/t/demo-college");
    const signedInAs = page.getByText(`Signed in as +91 ${PHONE.slice(0, 5)} ${PHONE.slice(5)}`, { exact: true }).locator("visible=true");
    await signedInAs.waitFor();
    for (let i = 0; i < 20 && (await remembered()) !== null; i++) await page.waitForTimeout(100);
    if ((await remembered()) !== null) throw new Error("the landing screen of an institution they aren't a member of stayed remembered");
    await shot("m08-landing-join");
    await tap("Choose a different institution");
    await page.getByPlaceholder(/Search by name or city/).waitFor();
    await tap("Demo College of Engineering");
    await signedInAs.waitFor();
    await tap("Join DCE");
    await page.getByText("Create your profile").waitFor();
    const inputs = page.locator("input:visible");
    await inputs.nth(0).fill("Pending Mobile");
    await page.getByLabel("Year you joined *", { exact: true }).locator("visible=true").fill("2007");
    await page.getByLabel("Year you left (or will leave) *", { exact: true }).locator("visible=true").fill("2011");
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
    await page.getByLabel("Year you joined *", { exact: true }).locator("visible=true").fill("2011");
    await page.getByLabel("Year you left (or will leave) *", { exact: true }).locator("visible=true").fill("2015");
    await finishRegistration("Join the network");
    await barTab("More").waitFor();
    const membership = await scriptMembership(page, "demo-university");
    membership.answer(401, "SESSION_REVOKED");
    await membership.refetch();
    await page.waitForURL("**/t/demo-university/login");
    // The next person's membership can't load, so the old one would be all there is to show. (The Samaj admin isn't a
    // member here, so it couldn't load for him anyway.)
    membership.answer(503, "INTERNAL");
    await signIn(SAMAJ_ADMIN);
    await page.getByText("e2e INTERNAL").waitFor();
    if (await barTab("More").locator("visible=true").count()) throw new Error("the next person to sign in saw the last member's cached membership");
    await membership.stop();
  });

  // The admin console, as the Samaj admin signed in by the step before.
  const SAMAJ = BASE + "/t/shri-gujarati-samaj";
  // The row's name carries the count of work waiting, once the counts have loaded.
  const consoleRow = () => page.getByRole("link", { name: /^Admin console(, \d+ waiting)?$/ }).locator("visible=true").first();
  const backButton = () => page.getByRole("button", { name: "Back", exact: true }).locator("visible=true").last();
  // The page, and each scrolling area around `content` (something in the screen's body). react-native-web clips a
  // vertical ScrollView's sideways overflow (overflow-x: hidden), so a body too wide for the phone is cut off without
  // ever widening the page: the ScrollView's own width is what shows it.
  const fitsPhone = async (where, content) => {
    const { overflow, scrollers } = await content.evaluate((el) => {
      const widths = [document.documentElement.scrollWidth - document.documentElement.clientWidth];
      let scrollers = 0;
      for (let box = el.parentElement; box; box = box.parentElement) {
        const { overflowX, overflowY } = getComputedStyle(box);
        if (overflowX !== "hidden" || (overflowY !== "auto" && overflowY !== "scroll")) continue;
        scrollers += 1;
        widths.push(box.scrollWidth - box.clientWidth);
      }
      return { overflow: Math.max(...widths), scrollers };
    });
    if (!scrollers) throw new Error(`found no scrolling area around ${where}'s body to measure`);
    if (overflow > 0) throw new Error(`${where} is wider than the phone by ${overflow}px`);
  };

  await step("an admin opens the console from More and from My profile, and its home shows what's waiting", async () => {
    await page.goto(SAMAJ);
    await barTab("More").click();
    await page.waitForURL("**/t/shri-gujarati-samaj/more");
    // Parth Joshi and Diya Raval wait for approval; nothing else does.
    const row = page.getByRole("link", { name: /^Admin console, \d+ waiting$/ }).locator("visible=true").first();
    await row.waitFor();
    const name = await row.getAttribute("aria-label");
    if (name !== "Admin console, 2 waiting") throw new Error(`the More row is named "${name}", expected "Admin console, 2 waiting"`);
    await expectSvgNoEmoji(row, "the More hub's Admin console row");
    await row.click();
    await page.waitForURL("**/t/shri-gujarati-samaj/admin");

    // What needs the admin, in amber when above 0, each named by its label and count.
    const pending = page.getByLabel("Pending members, 2", { exact: true });
    await pending.waitFor();
    if ((await pending.evaluate((tile) => getComputedStyle(tile).backgroundColor)) !== "rgb(255, 251, 235)") throw new Error("the Pending members tile isn't amber with members waiting");
    const content = page.getByLabel("Content to review, 0", { exact: true });
    if ((await content.evaluate((tile) => getComputedStyle(tile).backgroundColor)) === "rgb(255, 251, 235)") throw new Error("the Content to review tile is amber with nothing waiting");
    // No report is open, so neither report tile shows.
    if (await page.locator('[aria-label^="Open reports, "], [aria-label^="Open chat reports, "]').count()) throw new Error("the console's home shows report tiles with no report open");
    for (const label of ["Approved members", "New members (30d)", "Posts (7d)", "Upcoming events"]) await page.locator(`[aria-label^="${label}, "]`).first().waitFor();
    await page.getByText("New members are held for approval. Content follows your moderation settings.", { exact: true }).waitFor();
    // Every section is in the phone app, so the tiles and every row link, and nothing is left for the web console.
    await page.getByRole("link", { name: "Pending members, 2", exact: true }).waitFor();
    await page.getByRole("link", { name: "Members, 2 waiting", exact: true }).waitFor();
    await page.getByRole("link", { name: "Content to review, 0", exact: true }).waitFor();
    const sections = page.getByRole("navigation", { name: "Admin sections" }).locator("visible=true").last();
    const rows = (await sections.getByRole("link").evaluateAll((links) => links.map((a) => a.getAttribute("aria-label")))).join(", ");
    const expected = "Analytics, Members, 2 waiting, Moderation, Reports, Chat reports, Invitations, Profile fields, Settings, Audit log";
    if (rows !== expected) throw new Error(`the console's home lists ${rows}, expected ${expected}`);
    await page.getByRole("link", { name: "Growth and activity charts", exact: true }).waitFor();
    if (await page.getByText(/web console/).locator("visible=true").count()) throw new Error("the console's home still sends something to the web console");
    // The console is a stack of its own above the tabs, as on the web: no tab bar.
    if (await page.locator('a[role="tab"]').locator("visible=true").count()) throw new Error("the console shows the tab bar");
    await fitsPhone("the console's home", page.getByRole("heading", { name: "Needs you", exact: true }).locator("visible=true").last());
    await shot("m10-admin-console");
    await backButton().click();
    await page.waitForURL("**/t/shri-gujarati-samaj/more");

    // My profile's way in.
    await hubRow("My profile").click();
    await page.waitForURL("**/t/shri-gujarati-samaj/profile");
    const link = page.getByRole("link", { name: "Admin console", exact: true }).locator("visible=true").last();
    await expectSvgNoEmoji(link, "My profile's Admin console link");
    const box = await link.boundingBox();
    if (!box || box.height < 44) throw new Error(`My profile's Admin console link is ${box?.height}px tall, under 44px`);
    await link.click();
    await page.waitForURL("**/t/shri-gujarati-samaj/admin");
    await page.getByLabel("Pending members, 2", { exact: true }).waitFor();
    await backButton().click();
    await page.waitForURL("**/t/shri-gujarati-samaj/profile");
  });

  await step("an admin notice tapped in the list opens the console, and Back returns to the list", async () => {
    // A chat report notice opens the open chat reports on its report. Samaj has none, so the screen says it isn't there.
    const notice = await scriptNotification(page, "shri-gujarati-samaj", { type: "CHAT_REPORT_FILED", data: { chatReportId: "00000000-0000-4000-8000-0000000000c1" }, title: "A message was reported" });
    try {
      await page.goto(SAMAJ + "/profile/notifications");
      await page.getByText("A message was reported", { exact: true }).click();
      await page.waitForURL("**/t/shri-gujarati-samaj/admin/chat-reports?status=OPEN&item=00000000-0000-4000-8000-0000000000c1");
      await page.getByText("No open chat reports", { exact: true }).locator("visible=true").last().waitFor();
      await page.getByRole("status").filter({ hasText: "That report isn't in this list any more: it may have been handled already." }).locator("visible=true").last().waitFor();
      await backButton().click();
      await page.waitForURL("**/t/shri-gujarati-samaj/profile/notifications");
    } finally {
      await notice.stop();
    }
  });

  await step("Appearance: Institution colour tints the member app, saved, but not the console, and Plain puts it back", async () => {
    await page.goto(SAMAJ + "/profile");
    const link = page.getByRole("link", { name: "Appearance", exact: true }).locator("visible=true").last();
    await expectSvgNoEmoji(link, "My profile's Appearance link");
    const box = await link.boundingBox();
    if (!box || box.height < 44) throw new Error(`My profile's Appearance link is ${box?.height}px tall, under 44px`);
    await link.click();
    await page.waitForURL("**/t/shri-gujarati-samaj/profile/appearance");
    const group = page.getByRole("radiogroup", { name: "Background", exact: true }).locator("visible=true").last();
    await group.waitFor();
    const tile = (name) => group.getByRole("radio", { name, exact: true });
    // The Samaj has no cover, so no Cover tile; Plain is chosen until the member chooses another.
    const tiles = await group.getByRole("radio").evaluateAll((radios) => radios.map((r) => `${r.getAttribute("aria-label")}:${r.getAttribute("aria-checked")}`));
    if (tiles.join() !== "Plain:true,Institution colour:false,Your photo:false") throw new Error(`the Background tiles are ${tiles.join(", ")}`);
    for (const name of ["Plain", "Institution colour", "Your photo"]) {
      const tileBox = await tile(name).boundingBox();
      if (!tileBox || tileBox.height < 44) throw new Error(`the ${name} tile is ${tileBox?.height}px tall, under 44px`);
    }
    if ((await pageColours(group)).page !== PAGE_COLOURS.plain) throw new Error("the Appearance screen isn't on the plain page before a background is chosen");
    // Grey text (Muted), one shade darker on a tint.
    const greyLine = page.getByText(/^Your background for /).locator("visible=true").last();
    if ((await textColour(greyLine)) !== GREY_TEXT.plain) throw new Error(`grey text on the plain page is rgb ${await textColour(greyLine)}, not slate-500`);
    const choose = async (name) => {
      const saved = page.waitForResponse((r) => /\/t\/shri-gujarati-samaj\/memberships\/me\/appearance$/.test(r.url()) && r.request().method() === "PATCH");
      await tile(name).click();
      if (!(await saved).ok()) throw new Error(`choosing ${name} wasn't saved`);
      await group.locator(`[aria-label="${name}"][aria-checked="true"]`).waitFor();
    };
    await choose("Institution colour");
    const tinted = (await pageColours(group)).page;
    if (tinted !== PAGE_COLOURS.samaj) throw new Error(`with Institution colour chosen the Appearance screen is rgb ${tinted}, not the Samaj's tint ${PAGE_COLOURS.samaj}`);
    if ((await textColour(greyLine)) !== GREY_TEXT.dim) throw new Error(`grey text on the tint is rgb ${await textColour(greyLine)}, not slate-600`);
    await shot("m10b-appearance-colour");
    // Saved on the membership, so a fresh load has it, on the feed's own shell, where post cards stay white: each paints
    // white itself, so the tint can't show through one.
    await page.goto(SAMAJ + "/feed");
    const card = page
      .locator("div")
      .filter({ has: page.locator('[aria-label="Like"]') })
      .filter({ has: page.getByRole("link") })
      .locator("visible=true")
      .last();
    await card.waitFor();
    const feed = await pageColours(card);
    if (feed.page !== PAGE_COLOURS.samaj) throw new Error(`the feed is rgb ${feed.page} after a reload, not the Samaj's tint`);
    if (feed.own !== WHITE) throw new Error(`a post card's own background is ${feed.own ? `rgb ${feed.own}` : "clear"} on the tinted feed, not white`);
    // The console shows the institution as everyone sees it.
    await page.goto(SAMAJ + "/admin");
    const needsYou = page.getByRole("heading", { name: "Needs you", exact: true }).locator("visible=true").last();
    await needsYou.waitFor();
    const consolePage = (await pageColours(needsYou)).page;
    if (consolePage !== PAGE_COLOURS.plain) throw new Error(`the admin console is rgb ${consolePage} under the admin's own background, not the plain page`);
    await page.goto(SAMAJ + "/profile/appearance");
    await group.waitFor();
    await choose("Plain");
    if ((await pageColours(group)).page !== PAGE_COLOURS.plain) throw new Error("Plain didn't put the plain page back");
    if ((await textColour(greyLine)) !== GREY_TEXT.plain) throw new Error("Plain didn't put the plain page's grey text back");
  });

  // The console's checkboxes and radios, by name. Screens below the one in front stay in the page, hence the last.
  const choice = (role, name) => page.getByRole(role, { name, exact: true }).locator("visible=true").last();
  const expectChoice = async (box, where, { checked, disabled }) => {
    if (checked !== undefined && (await box.getAttribute("aria-checked")) !== String(checked)) throw new Error(`${where} should be ${checked ? "ticked" : "clear"}`);
    if (disabled !== undefined && ((await box.getAttribute("aria-disabled")) === "true") !== disabled) throw new Error(`${where} should be ${disabled ? "disabled" : "enabled"}`);
  };
  const isSettingsSave = (r) => r.request().method() === "PATCH" && r.url().endsWith("/admin/settings");
  // A pressable that is waiting on a request is aria-disabled until it's answered.
  const whenEnabled = async (target) => {
    for (let i = 0; i < 100 && (await target.getAttribute("aria-disabled")) === "true"; i++) await page.waitForTimeout(100);
    return target;
  };

  await step("the console's settings: Funding off and on again with More following at once, Mentorship held by Messaging, a blank year sending nothing, and a refusal said after the form starts again", async () => {
    await page.goto(SAMAJ + "/more");
    await hubRow("Funding").waitFor();
    await consoleRow().click();
    await page.waitForURL("**/t/shri-gujarati-samaj/admin");
    // The approval sentence links to Settings, as the web Dashboard's does, ahead of the section's own row.
    const settingsLinks = () => page.getByRole("link", { name: "Settings", exact: true }).locator("visible=true");
    await page.getByText("New members are held for approval. Content follows your moderation settings.", { exact: true }).waitFor();
    if ((await settingsLinks().count()) !== 2) throw new Error(`the console's home has ${await settingsLinks().count()} Settings links, expected the approval sentence's and the section's`);
    const sentenceLink = settingsLinks().first();
    await expectSvgNoEmoji(sentenceLink, "the approval sentence's Settings link");
    const linkBox = await sentenceLink.boundingBox();
    if (!linkBox || linkBox.height < 44) throw new Error(`the approval sentence's Settings link is ${linkBox?.height}px tall, under 44px`);
    await sentenceLink.click();
    await page.waitForURL("**/t/shri-gujarati-samaj/admin/settings");
    // Samaj's plan sends nothing but in-app notices and pushes.
    await page.getByText("Ask the Illuminize team to add WhatsApp, SMS or email messaging.", { exact: true }).waitFor();
    await page.getByRole("link", { name: "Branding", exact: true }).locator("visible=true").last().waitFor();
    await expectChoice(choice("radio", "Admin must approve members"), "Admin must approve members", { checked: true });
    const funding = choice("checkbox", "Funding");
    await expectChoice(funding, "the Funding switch", { checked: true });
    await fitsPhone("the console's settings", funding);

    // A blank year is refused in words under its box, and nothing is sent.
    const saves = [];
    const counted = (request) => {
      if (request.method() === "PATCH" && request.url().endsWith("/admin/settings")) saves.push(request);
    };
    page.on("request", counted);
    const earliest = page.getByLabel("Earliest batch year", { exact: true }).locator("visible=true").last();
    const year = await earliest.inputValue();
    await earliest.fill("");
    await page.getByRole("button", { name: "Save settings", exact: true }).locator("visible=true").last().click();
    await page.getByText(/^Enter a year from 1950 to \d{4}$/).locator("visible=true").first().waitFor();
    page.off("request", counted);
    if (saves.length) throw new Error("a blank batch year was sent to the API");
    await earliest.fill(year);

    // A save refused because another admin changed the settings meanwhile (answered by the script): the settings come
    // back changed, so the form starts again from them, and the refusal is still said under Save.
    const settingsUrl = "**/api/v1/t/shri-gujarati-samaj/admin/settings";
    const refusal = "Mentorship needs Messaging. Turn on Messaging first.";
    await page.route(settingsUrl, async (route) => {
      const method = route.request().method();
      if (method === "PATCH") {
        return route.fulfill({
          status: 400,
          contentType: "application/json",
          headers: { "Access-Control-Allow-Origin": "*" },
          body: JSON.stringify({ error: { code: "VALIDATION_ERROR", message: refusal, details: [{ path: "features.mentorship", message: refusal }] } }),
        });
      }
      if (method !== "GET") return route.fallback();
      const response = await route.fetch();
      const json = await response.json();
      return route.fulfill({ response, json: { ...json, data: { ...json.data, settings: { ...json.data.settings, updatedAt: new Date().toISOString() } } } });
    });
    try {
      await choice("radio", "Auto-approve members").click();
      await expectChoice(choice("radio", "Auto-approve members"), "Auto-approve members once chosen", { checked: true });
      await page.getByRole("button", { name: "Save settings", exact: true }).locator("visible=true").last().click();
      // Started again: the choice made here is gone, as the stored settings say.
      for (let i = 0; i < 50 && (await choice("radio", "Admin must approve members").getAttribute("aria-checked")) !== "true"; i++) await page.waitForTimeout(100);
      await expectChoice(choice("radio", "Admin must approve members"), "Admin must approve members after the refused save", { checked: true });
      await page.getByText(`Couldn't save: ${refusal}`, { exact: true }).locator("visible=true").first().waitFor();
    } finally {
      await page.unroute(settingsUrl);
    }

    // Messaging off clears Mentorship and holds it, saying why; back on, Mentorship is free but stays off until ticked.
    const mentorship = choice("checkbox", "Mentorship");
    await choice("checkbox", "Messaging").click();
    await expectChoice(mentorship, "Mentorship with Messaging off", { checked: false, disabled: true });
    await page.getByText("Needs Messaging", { exact: true }).locator("visible=true").first().waitFor();
    await choice("checkbox", "Messaging").click();
    await expectChoice(mentorship, "Mentorship with Messaging back on", { checked: false, disabled: false });
    await mentorship.click();

    // Funding off: only it is sent, as the rest ended as it began.
    await funding.click();
    const [off] = await Promise.all([page.waitForResponse(isSettingsSave), page.getByRole("button", { name: "Save settings", exact: true }).locator("visible=true").last().click()]);
    if (!off.ok()) throw new Error(`saving the settings failed: ${off.status()}`);
    if (JSON.stringify(off.request().postDataJSON().features) !== JSON.stringify({ funding: false })) throw new Error(`the save sent features ${JSON.stringify(off.request().postDataJSON().features)}, expected only Funding off`);
    await page.getByText("Settings saved", { exact: true }).locator("visible=true").first().waitFor();
    await shot("m11-admin-settings");

    // More, under the console, has already dropped Funding: no reload, and no pull to refresh.
    await backButton().click();
    await page.waitForURL("**/t/shri-gujarati-samaj/admin");
    await backButton().click();
    await page.waitForURL("**/t/shri-gujarati-samaj/more");
    await hubRow("My profile").waitFor();
    if (await page.getByRole("link", { name: "Funding", exact: true }).locator("visible=true").count()) throw new Error("More still lists Funding after the console switched it off");

    // And back on, as Samaj started, for the steps after: this time by the section's row.
    await consoleRow().click();
    await page.waitForURL("**/t/shri-gujarati-samaj/admin");
    await settingsLinks().last().click();
    await page.waitForURL("**/t/shri-gujarati-samaj/admin/settings");
    await expectChoice(choice("checkbox", "Funding"), "the Funding switch after saving it off", { checked: false });
    await choice("checkbox", "Funding").click();
    const [on] = await Promise.all([page.waitForResponse(isSettingsSave), page.getByRole("button", { name: "Save settings", exact: true }).locator("visible=true").last().click()]);
    if (JSON.stringify(on.request().postDataJSON().features) !== JSON.stringify({ funding: true })) throw new Error(`the save sent features ${JSON.stringify(on.request().postDataJSON().features)}, expected only Funding on`);
    await page.getByText("Settings saved", { exact: true }).locator("visible=true").first().waitFor();
    await backButton().click();
    await page.waitForURL("**/t/shri-gujarati-samaj/admin");
    await backButton().click();
    await page.waitForURL("**/t/shri-gujarati-samaj/more");
    await hubRow("Funding").waitFor();
  });

  await step("the console's Branding, from Settings: a tagline saved with the preview following, Save held by an upload but not by a warning, a bad colour sending nothing, a suggested colour re-theming the app at once, and the Samaj's look put back", async () => {
    await page.goto(SAMAJ + "/admin/settings");
    const link = page.getByRole("link", { name: "Branding", exact: true }).locator("visible=true").last();
    await expectSvgNoEmoji(link, "Settings' Branding row");
    const linkBox = await link.boundingBox();
    if (!linkBox || linkBox.height < 44) throw new Error(`Settings' Branding row is ${linkBox?.height}px tall, under 44px`);
    await link.click();
    await page.waitForURL("**/t/shri-gujarati-samaj/admin/settings/branding");
    const field = (name) => page.getByLabel(name, { exact: true }).locator("visible=true").last();
    const tagline = field("Tagline");
    const primary = field("Primary colour hex code");
    await tagline.waitFor();
    const original = { tagline: await tagline.inputValue(), primary: await primary.inputValue() };
    if (original.primary !== "#c2410c") throw new Error(`the Samaj's primary colour reads ${original.primary}, expected #c2410c`);
    await fitsPhone("the console's Branding", tagline);
    const save = () => page.getByRole("button", { name: "Save branding", exact: true }).locator("visible=true").last();
    const isBrandingSave = (r) => r.request().method() === "PATCH" && r.url().endsWith("/admin/branding");
    const saved = async () => {
      const [res] = await Promise.all([page.waitForResponse(isBrandingSave), save().click()]);
      if (!res.ok()) throw new Error(`saving the branding failed: ${res.status()}`);
      await page.getByText("Branding saved", { exact: true }).locator("visible=true").first().waitFor();
      return res.request().postDataJSON();
    };
    const background = (target) => target.evaluate((el) => getComputedStyle(el).backgroundColor);
    // The app's primary buttons in the institution's colour, once its refetch lands.
    const expectBrand = async (target, rgb, where) => {
      for (let i = 0; i < 50 && (await background(target)) !== rgb; i++) await page.waitForTimeout(100);
      if ((await background(target)) !== rgb) throw new Error(`${where} is ${await background(target)}, not ${rgb}`);
    };
    await expectBrand(save(), "rgb(194, 65, 12)", "Save branding in the Samaj's colour");
    // The suggested colours as radios, the Samaj's own chosen, with a drawn tick.
    const swatches = page.getByRole("radiogroup", { name: "Suggested primary colours", exact: true }).locator("visible=true").last();
    const orange = swatches.getByRole("radio", { name: "Orange, #c2410c", exact: true });
    await expectChoice(orange, "the Samaj's own colour among the suggested ones", { checked: true });
    await expectSvgNoEmoji(orange, "the chosen suggested colour");

    // The preview follows the tagline as it's typed, and Save sends it.
    const changed = `Community, culture and connection ${unique}`;
    await tagline.fill(changed);
    const preview = page.getByRole("img", { name: /^Preview, / }).locator("visible=true").last();
    await preview.getByText(changed, { exact: true }).waitFor();
    if (!(await preview.getAttribute("aria-label")).endsWith(`, ${changed}`)) throw new Error(`the preview is read as "${await preview.getAttribute("aria-label")}"`);
    if ((await saved()).tagline !== changed) throw new Error("Save didn't send the tagline typed");

    // Nothing from here to Teal is saved.
    const sent = [];
    const counted = (request) => {
      if (request.method() === "PATCH" && request.url().endsWith("/admin/branding")) sent.push(request);
    };
    page.on("request", counted);
    const held = async () => (await save().getAttribute("aria-disabled")) === "true";

    // Save waits for an upload: held while the logo is being prepared (the script holds it), and free again once it's
    // cancelled, with nothing uploaded.
    const logo = page.getByRole("group", { name: "Logo", exact: true }).locator("visible=true").last();
    const camera = await bigPhoto(page);
    const hold = await holdPhotoPreparation(page);
    const chooser = page.waitForEvent("filechooser");
    await logo.getByRole("button", { name: "Upload logo", exact: true }).click();
    await (await chooser).setFiles(camera);
    await hold.held();
    await page.getByText("Save waits for the upload to finish.", { exact: true }).locator("visible=true").first().waitFor();
    if (!(await held())) throw new Error("Save branding can be pressed while the logo is being prepared");
    await logo.getByRole("button", { name: "Cancel upload", exact: true }).click();
    await logo.getByText("Upload cancelled.", { exact: true }).waitFor({ state: "attached" });
    await logo.getByRole("button", { name: "Upload logo", exact: true }).waitFor();
    await hold.release();
    if (await held()) throw new Error("Save branding stayed held after the logo's upload was cancelled");
    // Long enough for the prepared logo to have gone up, had the cancel not stopped it.
    await page.waitForTimeout(1500);
    hold.stop();
    if (hold.uploads()) throw new Error("a logo cancelled while it was being prepared was uploaded anyway");

    // A colour too light for white text says what it does to buttons and links, and never stops a save.
    await primary.fill("#fef9c3");
    await page.getByText(/^White text is hard to read on this colour \(\d+\.\d:1\), so buttons filled with it use dark text/).locator("visible=true").first().waitFor();
    if (await held()) throw new Error("the contrast warning held Save branding");

    // A colour that isn't one is refused under its box, said by Save too, and nothing is sent.
    await primary.fill("#12");
    await save().click();
    await page.getByText("Use a #RRGGBB colour", { exact: true }).locator("visible=true").first().waitFor();
    await page.getByText("Primary colour: Use a #RRGGBB colour", { exact: true }).locator("visible=true").first().waitFor();
    page.off("request", counted);
    if (sent.length) throw new Error("a colour that isn't #RRGGBB was sent to the API");

    // A suggested colour is chosen and written in the box, and once saved the whole app takes it, with no reload.
    const teal = swatches.getByRole("radio", { name: "Teal, #0f766e", exact: true });
    await expectChoice(teal, "the Teal swatch before it's picked", { checked: false });
    const swatchBox = await teal.boundingBox();
    if (!swatchBox || swatchBox.height < 44 || swatchBox.width < 44) throw new Error(`a suggested colour is ${swatchBox?.width}×${swatchBox?.height}px, under 44px`);
    await teal.click();
    await expectChoice(teal, "the Teal swatch once picked", { checked: true });
    if ((await primary.inputValue()) !== "#0f766e") throw new Error(`picking Teal wrote ${await primary.inputValue()} in the box`);
    await page.getByText("Use a #RRGGBB colour", { exact: true }).locator("visible=true").first().waitFor({ state: "hidden" });
    if ((await saved()).primaryColor !== "#0f766e") throw new Error("Save didn't send Teal");
    await expectBrand(save(), "rgb(15, 118, 110)", "Save branding after Teal was saved");
    await shot("m11b-admin-branding");
    // Settings underneath has taken it too.
    await backButton().click();
    await page.waitForURL("**/t/shri-gujarati-samaj/admin/settings");
    await expectBrand(page.getByRole("button", { name: "Save settings", exact: true }).locator("visible=true").last(), "rgb(15, 118, 110)", "Save settings after Teal was saved");

    // The Samaj's own look back, for the steps after.
    await link.click();
    await page.waitForURL("**/t/shri-gujarati-samaj/admin/settings/branding");
    await orange.click();
    await tagline.fill(original.tagline);
    const restored = await saved();
    if (restored.primaryColor !== "#c2410c" || (restored.tagline ?? "") !== original.tagline) throw new Error(`putting the Samaj's look back sent ${JSON.stringify(restored)}`);
    await expectBrand(save(), "rgb(194, 65, 12)", "Save branding once the Samaj's colour is back");
    await page.goto(SAMAJ + "/more");
    await consoleRow().waitFor();
  });

  await step("the console's profile fields: a question added in the modal editor, moved up and down, archived after asking, and listed under Show archived", async () => {
    const label = `Seva team ${unique}`;
    await consoleRow().click();
    await page.waitForURL("**/t/shri-gujarati-samaj/admin");
    await hubRow("Profile fields").click();
    await page.waitForURL("**/t/shri-gujarati-samaj/admin/profile-fields");
    await page.getByText(/^Degree and field of study are now built into every profile/).locator("visible=true").first().waitFor();
    for (const name of ["Chapter", "Community interests"]) await page.getByRole("button", { name: `Edit ${name}`, exact: true }).locator("visible=true").first().waitFor();
    await fitsPhone("the console's profile fields", page.getByRole("button", { name: "Edit Chapter", exact: true }).locator("visible=true").first());

    // The editor: the key follows the question, a choice takes options by Return and by Add, and only a choice members
    // can see may be a directory filter.
    const add = page.getByRole("button", { name: "Add field", exact: true }).locator("visible=true").first();
    await expectSvgNoEmoji(add, "the profile fields' Add field button");
    await add.click();
    await page.waitForURL("**/t/shri-gujarati-samaj/admin/profile-fields/edit");
    await page.getByLabel("Question *", { exact: true }).locator("visible=true").last().fill(label);
    const key = await page.getByLabel("Key *", { exact: true }).locator("visible=true").last().inputValue();
    if (key !== `seva_team_${unique}`) throw new Error(`the key reads "${key}", expected seva_team_${unique}`);
    const filter = choice("checkbox", "Members can filter the directory by it");
    await expectChoice(filter, "the directory filter box for short text", { disabled: true });
    await page.getByRole("button", { name: "Answer type, Short text", exact: true }).locator("visible=true").last().click();
    const chooseOne = page.getByRole("button", { name: "Choose one", exact: true });
    await chooseOne.locator("visible=true").last().click();
    // The list slides away before the form can be typed in, as the job form's industry does.
    await chooseOne.last().waitFor({ state: "hidden" });
    await page.getByRole("button", { name: "Answer type, Choose one", exact: true }).locator("visible=true").last().waitFor();
    const option = page.getByLabel("New option", { exact: true }).locator("visible=true").last();
    await option.fill("Kitchen");
    await option.press("Enter");
    await option.fill("Stage");
    await page.getByRole("button", { name: "Add", exact: true }).locator("visible=true").last().click();
    if ((await page.getByLabel("Option 1", { exact: true }).locator("visible=true").last().inputValue()) !== "Kitchen") throw new Error("Return didn't add the option typed");
    if ((await page.getByLabel("Option 2", { exact: true }).locator("visible=true").last().inputValue()) !== "Stage") throw new Error("Add didn't add the option typed");
    await expectSvgNoEmoji(page.getByRole("button", { name: "Remove option Stage", exact: true }).locator("visible=true").last(), "the Remove option button");
    await expectChoice(filter, "the directory filter box for a choice", { disabled: false });
    await choice("radio", "Only admins (and the member)").click();
    await expectChoice(filter, "the directory filter box for admin-only answers", { disabled: true, checked: false });
    await page.getByText("Only choice and yes/no questions that members can see can be filters", { exact: true }).locator("visible=true").first().waitFor();
    await choice("radio", "Members, on profiles").click();
    await fitsPhone("the profile field editor", option);
    const [created] = await Promise.all([
      page.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith("/admin/profile-fields")),
      page.getByRole("button", { name: "Add field", exact: true }).locator("visible=true").last().click(),
    ]);
    if (!created.ok()) throw new Error(`adding the question failed: ${created.status()}`);
    const sent = created.request().postDataJSON();
    if (sent.type !== "SELECT" || sent.options.map((o) => o.label).join() !== "Kitchen,Stage") throw new Error(`the editor sent ${JSON.stringify(sent)}`);
    await page.waitForURL("**/t/shri-gujarati-samaj/admin/profile-fields");
    await page.getByText("Field added", { exact: true }).locator("visible=true").first().waitFor();
    await page.getByRole("button", { name: `Edit ${label}`, exact: true }).locator("visible=true").first().waitFor();

    // Moved at once, before the API answers (the script holds the move until the order has been read), and saved: last,
    // then above Community interests; a move the API refuses (answered by the script) is put back, saying so; then last
    // again.
    const fields = ["Chapter", "Community interests", label];
    const order = () =>
      page
        .getByRole("button", { name: /^Edit / })
        .locator("visible=true")
        .evaluateAll((buttons, names) => buttons.map((b) => b.getAttribute("aria-label").slice(5)).filter((name) => names.includes(name)), fields);
    const expectOrder = async (expected) => {
      for (let i = 0; i < 20 && (await order()).join() !== expected.join(); i++) await page.waitForTimeout(100);
      if ((await order()).join() !== expected.join()) throw new Error(`the fields read ${(await order()).join(", ")}, expected ${expected.join(", ")}`);
    };
    await expectOrder(["Chapter", "Community interests", label]);
    const moveUp = page.getByRole("button", { name: `Move ${label} up`, exact: true }).locator("visible=true").first();
    const moveDown = page.getByRole("button", { name: `Move ${label} down`, exact: true }).locator("visible=true").first();
    await expectChoice(moveDown, "Move down on the last field", { disabled: true });
    const isReorder = (r) => r.request().method() === "POST" && r.url().endsWith("/admin/profile-fields/reorder");
    // The script holds a move (`gate`) or refuses it (`refuse`), and can hold the list's refetch (`listGate`).
    const listPath = "/api/v1/t/shri-gujarati-samaj/admin/profile-fields";
    const reorderPath = `${listPath}/reorder`;
    const fieldsRoute = (url) => url.pathname === listPath || url.pathname === reorderPath;
    let gate = null;
    let release = () => {};
    let listGate = null;
    let openList = () => {};
    let reached = () => {};
    let refuse = false;
    await page.route(fieldsRoute, async (route) => {
      const method = route.request().method();
      if (new URL(route.request().url()).pathname === listPath) {
        if (method === "GET" && listGate) await listGate;
        return route.fallback();
      }
      if (method !== "POST") return route.fallback();
      if (refuse) {
        return route.fulfill({ status: 500, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ error: { code: "INTERNAL", message: "e2e INTERNAL" } }) });
      }
      reached();
      if (gate) await gate;
      return route.fallback();
    });
    try {
      gate = new Promise((resolve) => (release = resolve));
      const held = new Promise((resolve) => (reached = resolve));
      await moveUp.click();
      await held;
      // The API hasn't answered: the rows have moved, the move is said, and the arrows wait for the answer.
      await expectOrder(["Chapter", label, "Community interests"]);
      await page.getByText(`${label} moved up: 2 of 3`, { exact: true }).locator("visible=true").first().waitFor();
      await expectChoice(moveDown, "Move down while a move is being saved", { disabled: true });
      const answered = page.waitForResponse(isReorder);
      gate = null;
      release();
      const up = await answered;
      if (!up.ok()) throw new Error(`moving the question up failed: ${up.status()}`);
      await whenEnabled(moveDown);
      await expectOrder(["Chapter", label, "Community interests"]);
      await expectSvgNoEmoji(moveDown, "the Move down button");

      // Refused: put back where it was, with a warning. The list's refetch is held meanwhile, so the refusal itself put
      // it back.
      refuse = true;
      listGate = new Promise((resolve) => (openList = resolve));
      await moveDown.click();
      await page.getByText(/^Couldn't move it: /).locator("visible=true").first().waitFor();
      await expectOrder(["Chapter", label, "Community interests"]);
      refuse = false;
      listGate = null;
      openList();

      await whenEnabled(moveDown);
      const [down] = await Promise.all([page.waitForResponse(isReorder), moveDown.click()]);
      if (!down.ok()) throw new Error(`moving the question down failed: ${down.status()}`);
      await expectOrder(["Chapter", "Community interests", label]);
    } finally {
      // Nothing left held.
      gate = null;
      listGate = null;
      release();
      openList();
      await page.unroute(fieldsRoute);
    }

    // Archived after asking: Cancel keeps it, Archive takes it off the list.
    await page.getByRole("button", { name: `Archive ${label}`, exact: true }).locator("visible=true").first().click();
    const sheet = page.getByRole("alertdialog", { name: `Archive “${label}”?` });
    await sheet.getByRole("button", { name: "Cancel", exact: true }).click();
    await sheet.waitFor({ state: "detached" });
    await page.getByRole("button", { name: `Archive ${label}`, exact: true }).locator("visible=true").first().click();
    await Promise.all([page.waitForResponse((r) => r.request().method() === "POST" && /\/admin\/profile-fields\/[^/]+\/archive$/.test(r.url())), sheet.getByRole("button", { name: "Archive", exact: true }).click()]);
    await page.getByText("Field archived; answers are kept", { exact: true }).locator("visible=true").first().waitFor();
    await expectOrder(["Chapter", "Community interests"]);

    // Show archived lists it again, to restore, and a reload keeps the choice.
    const showArchived = choice("checkbox", "Show archived fields");
    await showArchived.click();
    await page.waitForURL("**/t/shri-gujarati-samaj/admin/profile-fields?archived=1");
    await expectChoice(showArchived, "Show archived fields", { checked: true });
    const restore = page.getByRole("button", { name: `Restore ${label}`, exact: true }).locator("visible=true").first();
    await restore.waitFor();
    await page.reload();
    await restore.waitFor();
    await expectChoice(choice("checkbox", "Show archived fields"), "Show archived fields after a reload", { checked: true });
    await shot("m12-admin-profile-fields");
  });

  await step("an admin who loses the role is taken out of the console, and More drops its row", async () => {
    await page.goto(SAMAJ + "/more");
    await consoleRow().click();
    await page.waitForURL("**/t/shri-gujarati-samaj/admin");
    await page.getByLabel("Pending members, 2", { exact: true }).waitFor();
    // The API's own answer with the role taken away, found by a refetch, as when another admin demotes them.
    const url = "**/api/v1/t/shri-gujarati-samaj/memberships/me";
    await page.route(url, async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      const response = await route.fetch();
      return route.fulfill({ response, json: { data: { ...(await response.json()).data, role: "MEMBER" } } });
    });
    // Routed after, so it runs first: it counts the requests and passes each on to the answer above.
    const membership = await scriptMembership(page, "shri-gujarati-samaj");
    try {
      await membership.refetch();
      await page.waitForURL("**/t/shri-gujarati-samaj/feed");
      // Down to the tabs underneath, not a second set of them on top of the console.
      if ((await barTab("More").locator("visible=true").count()) !== 1) throw new Error("leaving the console left more than one tab bar");
      await barTab("More").click();
      await hubRow("My profile").waitFor();
      if (await page.getByRole("link", { name: /^Admin console/ }).locator("visible=true").count()) throw new Error("More still offers the admin console to someone who isn't an admin");
      // Opened cold, as from a link or a push, the console sends them to the member app too.
      await page.goto(SAMAJ + "/admin");
      await page.waitForURL("**/t/shri-gujarati-samaj/feed");
      await barTab("More").waitFor();
    } finally {
      await membership.stop();
      await page.unroute(url);
    }
  });

  // The members list and the new-member notice, as the Samaj admin again (opened afresh, so the role is his own again).
  const shown = (locator) => locator.locator("visible=true").last();
  const memberButton = (name) => shown(page.getByRole("button", { name, exact: true }));
  const memberTab = (label) => shown(page.getByRole("tab", { name: new RegExp(`^${label}`) }));
  const statusSays = (text) => shown(page.getByRole("status").filter({ hasText: text }));
  const answer = (route, status, body) => route.fulfill({ status, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify(body) });
  // The API telling the app's live connection that the admin's notices changed, as when another admin handles a request
  // to join: marking them read from outside the app, with its own session, sends notification:unread to all its screens.
  // Sent until `changed()` sees the list refetched, as the connection may still be joining its rooms.
  const whenNoticesChange = async (changed) => {
    for (let i = 0; i < 5; i++) {
      const token = await page.evaluate(() => localStorage.getItem("illuminize.access"));
      const res = await fetch(`${API}/api/v1/t/shri-gujarati-samaj/notifications/read-all`, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
      if (res.status !== 204) throw new Error(`marking the notices read answered ${res.status}`);
      try {
        return await changed();
      } catch {
        // Not refetched yet: say it again.
      }
    }
    throw new Error("the notices weren't refetched when the API said they had changed");
  };
  let parthId = null;

  await step("the members list shows who waits, each with actions named for them, and Approve all asks first", async () => {
    await page.goto(SAMAJ + "/admin");
    const listed = page.waitForResponse((r) => /\/admin\/members\?/.test(r.url()) && r.url().includes("status=PENDING") && r.request().method() === "GET");
    await shown(page.getByRole("link", { name: "Pending members, 2", exact: true })).click();
    await page.waitForURL("**/t/shri-gujarati-samaj/admin/members?status=PENDING");
    parthId = (await (await listed).json()).data.find((m) => m.fullName === "Parth Joshi")?.id;
    if (!parthId) throw new Error("Parth Joshi isn't among the members waiting");
    const pending = memberTab("Pending");
    await pending.waitFor();
    if ((await pending.getAttribute("aria-selected")) !== "true") throw new Error("the members list didn't open on Pending");
    if (!/^Pending\s*2$/.test((await pending.innerText()).trim())) throw new Error(`the Pending tab reads "${await pending.innerText()}", not its count of 2`);
    // A community member who still belongs: their years run to the present.
    await shown(page.getByText(/^2018–present · \+91 91000 00037 · Infosys, Pune · requested /)).waitFor();
    for (const name of ["Approve Parth Joshi", "Reject Parth Joshi", "Approve Diya Raval", "Reject Diya Raval"]) {
      const box = await memberButton(name).boundingBox();
      if (!box || box.height < 44) throw new Error(`"${name}" is ${box?.height}px tall, under 44px`);
    }
    await fitsPhone("the members list", shown(page.getByText("Diya Raval", { exact: true })));
    await shot("m14-admin-members");

    const sent = [];
    const onRequest = (r) => r.method() === "POST" && r.url().includes("/admin/members/") && sent.push(r.url());
    page.on("request", onRequest);
    try {
      await shown(page.getByText("2 waiting", { exact: true })).waitFor();
      await memberButton("Approve all pending members").click();
      const sheet = shown(page.getByRole("alertdialog", { name: "Approve all 2 pending members?", exact: true }));
      await sheet.getByText("Each is told they're in and can sign in straight away. Reject anyone you don't recognise first.", { exact: true }).waitFor();
      await sheet.getByRole("button", { name: "Cancel", exact: true }).click();
      await sheet.waitFor({ state: "hidden" });
      await shown(page.getByText("2 waiting", { exact: true })).waitFor();
      if (sent.length) throw new Error(`Cancel still sent ${sent.join(", ")}`);
    } finally {
      page.off("request", onRequest);
    }
  });

  await step("a request to join is approved from its notice, which then says where it stands", async () => {
    // As the API sends an admin's copy: who it is about, and where the request stands now.
    const subject = { kind: "membership", membershipId: parthId, fullName: "Parth Joshi", status: "PENDING" };
    const notice = await scriptNotification(page, "shri-gujarati-samaj", { type: "NEW_MEMBER_PENDING", data: { membershipId: parthId }, title: "New member awaiting approval", body: "Parth Joshi (2018–present) has requested to join.", subject });
    try {
      await page.goto(SAMAJ + "/profile/notifications");
      const approve = memberButton("Approve Parth Joshi");
      const reject = memberButton("Reject Parth Joshi");
      for (const [name, button] of [["Approve", approve], ["Reject", reject]]) {
        await button.waitFor();
        const box = await button.boundingBox();
        if (!box || box.height < 44) throw new Error(`the notice's ${name} is ${box?.height}px tall, under 44px`);
      }
      // Beside the notice's text, never inside the button that opens it.
      if (await page.locator('[role="button"] [role="button"]').locator("visible=true").count()) throw new Error("a notice's action sits inside its row's button");

      await reject.click();
      const reasonSheet = shown(page.getByRole("dialog", { name: "Reject Parth Joshi?", exact: true }));
      await reasonSheet.getByPlaceholder("Reason (shown to the member)").waitFor();
      await reasonSheet.getByRole("button", { name: "Cancel", exact: true }).click();
      await reasonSheet.waitFor({ state: "hidden" });

      // Decided elsewhere while Reject is open (another admin rejected him): the list refetches, and the sheet closes
      // saying where he stands, rather than vanish with what was typed. Waiting again, as if he had applied again, it
      // doesn't open again by itself.
      await reject.click();
      await reasonSheet.getByPlaceholder("Reason (shown to the member)").fill("Typed as another admin decided");
      notice.update({ subject: { ...subject, status: "REJECTED" } });
      await whenNoticesChange(() => reasonSheet.waitFor({ state: "hidden", timeout: 3000 }));
      await statusSays("Parth Joshi's request has already been rejected.").waitFor();
      await shown(page.getByText("Rejected", { exact: true })).waitFor();
      notice.update({ subject });
      await whenNoticesChange(() => approve.waitFor({ timeout: 3000 }));
      if (await page.getByRole("dialog", { name: "Reject Parth Joshi?" }).locator("visible=true").count()) throw new Error("the reason sheet opened again by itself once the request waited again");

      // Approve asks first, then sends the status the notice showed.
      await approve.click();
      const confirm = shown(page.getByRole("alertdialog", { name: "Approve Parth Joshi?", exact: true }));
      await confirm.getByText("They're told they're in and can sign in straight away.", { exact: true }).waitFor();
      await shot("m14b-notice-approve");
      const posted = page.waitForRequest((r) => r.method() === "POST" && r.url().endsWith(`/admin/members/${parthId}/approve`));
      await confirm.getByRole("button", { name: "Approve", exact: true }).click();
      const body = (await posted).postData();
      if (JSON.parse(body ?? "{}").expectedStatus !== "PENDING") throw new Error(`the notice's Approve sent ${body}`);
      await statusSays("Parth Joshi approved").waitFor();
      await confirm.waitFor({ state: "hidden" });

      // The same notice still showing him waiting, as on another admin's phone: the API refuses to approve him twice.
      await approve.click();
      await confirm.getByRole("button", { name: "Approve", exact: true }).click();
      await statusSays("Parth Joshi has already been approved.").waitFor();
      await confirm.waitFor({ state: "hidden" });

      // Once dealt with, the notice shows where the request stands, with nothing left to press; or that it's gone.
      notice.update({ subject: { ...subject, status: "APPROVED" } });
      await page.goto(SAMAJ + "/profile/notifications");
      await shown(page.getByText("Approved", { exact: true })).waitFor();
      if (await page.getByRole("button", { name: /Parth Joshi$/ }).locator("visible=true").count()) throw new Error("an approved request's notice still offers Approve or Reject");
      notice.update({ subject: { ...subject, fullName: null, status: null } });
      await page.goto(SAMAJ + "/profile/notifications");
      await shown(page.getByText("No longer waiting", { exact: true })).waitFor();

      // Its text still opens his page in the console, now approved, and Back returns to the notices.
      await shown(page.getByText("New member awaiting approval", { exact: true })).click();
      await page.waitForURL(`**/t/shri-gujarati-samaj/admin/members/${parthId}`);
      await shown(page.getByRole("heading", { name: "Parth Joshi", exact: true })).waitFor();
      await shown(page.getByText("Approved", { exact: true })).waitFor();
      await backButton().click();
      await page.waitForURL("**/t/shri-gujarati-samaj/profile/notifications");
    } finally {
      await notice.stop();
    }
  });

  await step("Reject in the members list asks for a reason, and a refusal says where the member stands", async () => {
    await page.goto(SAMAJ + "/admin/members?status=PENDING");
    await memberButton("Reject Diya Raval").click();
    const sheet = shown(page.getByRole("dialog", { name: "Reject Diya Raval?", exact: true }));
    const reason = sheet.getByPlaceholder("Reason (shown to the member)");
    const confirm = sheet.getByRole("button", { name: "Reject", exact: true });
    // The API wants 3 characters at least.
    await reason.fill("ab");
    if ((await confirm.getAttribute("aria-disabled")) !== "true") throw new Error("the sheet's Reject isn't held with 2 characters");
    await reason.fill("Not a Samaj member yet");
    if ((await confirm.getAttribute("aria-disabled")) === "true") throw new Error("the sheet's Reject is still held with a reason");
    await shot("m14c-reason-sheet");

    // A failure that says nothing about her (the server busy) keeps the sheet open with what was typed, to try again. One
    // that says she has moved on (another admin rejected her first) closes it, says so, and refreshes the list.
    const rejectUrl = "**/admin/members/*/reject";
    const refusals = [
      [503, { error: { code: "INTERNAL", message: "The server is busy. Try again in a minute." } }],
      [409, { error: { code: "INVALID_TRANSITION", message: "This member has already been rejected", details: { status: "REJECTED" } } }],
    ];
    await page.route(rejectUrl, (route) => {
      const next = route.request().method() === "POST" ? refusals.shift() : undefined;
      return next ? answer(route, ...next) : route.fallback();
    });
    try {
      await confirm.click();
      await sheet.getByText("The server is busy. Try again in a minute.", { exact: true }).waitFor();
      if ((await reason.inputValue()) !== "Not a Samaj member yet") throw new Error(`after a failure the sheet holds "${await reason.inputValue()}", not the reason typed`);
      const refetched = page.waitForRequest((r) => r.method() === "GET" && /\/admin\/members\?/.test(r.url()) && r.url().includes("status=PENDING"));
      await confirm.click();
      await sheet.waitFor({ state: "hidden" });
      await statusSays("Diya Raval's request has already been rejected.").waitFor();
      await refetched;
      if (refusals.length) throw new Error("the sheet didn't send both tries");
    } finally {
      await page.unroute(rejectUrl);
    }

    // She still waits in fact, so she is rejected for real.
    await memberButton("Reject Diya Raval").click();
    await reason.fill("Not a Samaj member yet");
    await confirm.click();
    await statusSays("Diya Raval's request rejected").waitFor();
    await sheet.waitFor({ state: "hidden" });
    await shown(page.getByText("No pending members", { exact: true })).waitFor();

    // Under Rejected with the reason she was given, and an Approve that sends the status her row shows. Answered by the
    // script as if another admin had approved her meanwhile: the line says so rather than a bare error.
    await memberTab("Rejected").click();
    await page.waitForURL(/status=REJECTED/);
    await shown(page.getByText("Reason: Not a Samaj member yet", { exact: true })).waitFor();
    const url = "**/admin/members/*/approve";
    let sent = null;
    await page.route(url, (route) => {
      sent = route.request().postData();
      return answer(route, 409, { error: { code: "INVALID_TRANSITION", message: "This member has already been approved", details: { status: "APPROVED" } } });
    });
    try {
      const refetched = page.waitForRequest((r) => r.method() === "GET" && /\/admin\/members\?/.test(r.url()) && r.url().includes("status=REJECTED"));
      await memberButton("Approve Diya Raval").click();
      await statusSays("Diya Raval has already been approved.").waitFor();
      if (JSON.parse(sent ?? "{}").expectedStatus !== "REJECTED") throw new Error(`the list's Approve sent ${sent}`);
      // Refused as out of date, the list asks again for where everyone stands.
      await refetched;
    } finally {
      await page.unroute(url);
    }
  });

  await step("searching the members list, the admin's own row says You and offers nothing", async () => {
    // Approved's first answer held back: until it comes, nothing of Rejected's stands in for it, as Diya's row there has
    // an Approve that would act on her as rejected.
    const listUrl = /\/admin\/members\?/;
    let release = () => {};
    const held = new Promise((resolve) => (release = resolve));
    let holding = false;
    await page.route(listUrl, async (route) => {
      if (route.request().method() !== "GET" || !route.request().url().includes("status=APPROVED")) return route.fallback();
      holding = true;
      await held;
      return route.fallback();
    });
    try {
      await memberTab("Approved").click();
      await page.waitForURL(/status=APPROVED/);
      for (let i = 0; i < 100 && !holding; i++) await page.waitForTimeout(50);
      if (!holding) throw new Error("the Approved tab didn't ask for its rows");
      await shown(page.getByRole("tabpanel", { name: "Approved", exact: true })).getByRole("progressbar", { name: "Loading", exact: true }).waitFor();
      if (await page.getByText("Diya Raval", { exact: true }).locator("visible=true").count()) throw new Error("the Approved tab shows Rejected's rows while its own load");
      if (await page.getByRole("button", { name: /Diya Raval$/ }).locator("visible=true").count()) throw new Error("the Approved tab offers Rejected's buttons while its own rows load");
    } finally {
      release();
    }
    await memberButton("Suspend Parth Joshi").waitFor();
    await page.unroute(listUrl);
    const search = shown(page.getByLabel("Search members", { exact: true }));
    await search.fill("Nisha");
    await page.waitForURL(/q=Nisha/);
    await memberButton("Suspend Nisha Modi").waitFor();
    // Once the search's answer is in, it's the only row.
    await page.waitForFunction(() => [...document.querySelectorAll('[role="button"][aria-label^="Suspend "]')].filter((b) => b.getBoundingClientRect().height > 0).length === 1);
    await search.fill("Jignesh");
    await page.waitForURL(/q=Jignesh/);
    await shown(page.getByText("Jignesh Patel", { exact: true })).waitFor();
    await shown(page.getByText("You", { exact: true })).waitFor();
    if (await page.getByRole("button", { name: /Jignesh Patel$/ }).locator("visible=true").count()) throw new Error("the admin's own row offers actions on himself");
    await memberButton("Clear search").click();
    await memberButton("Suspend Parth Joshi").waitFor();
  });

  await step("the members list scrolls on to page 2, showing a row repeated across the pages once", async () => {
    // Page 1 as the API has it, said to be 1 of 2; page 2 starts with page 1's first row again, as when someone newer
    // pushes it over between the two requests.
    const url = /\/api\/v1\/t\/shri-gujarati-samaj\/admin\/members\?/;
    let first = null;
    const asked = [];
    await page.route(url, async (route) => {
      const q = new URL(route.request().url()).searchParams;
      if (route.request().method() !== "GET" || q.get("status") !== "APPROVED" || q.get("q")) return route.fallback();
      const n = Number(q.get("page") ?? "1");
      asked.push(n);
      if (n === 1) {
        const real = await (await route.fetch()).json();
        first = real.data;
        return answer(route, 200, { ...real, total: 27 });
      }
      return answer(route, 200, { data: [first[0], { ...first[1], id: "00000000-0000-4000-8000-0000000000d2", fullName: "Zara Pagetwo" }], page: n, pageSize: 25, total: 27 });
    });
    try {
      await page.goto(SAMAJ + "/admin/members?status=APPROVED");
      await shown(page.getByText(/^Showing \d+ of 27$/)).waitFor();
      const footer = shown(page.getByText(`Showing ${first.length + 1} of 27`, { exact: true }));
      for (let i = 0; i < 40 && !(await footer.count()); i++) {
        await page.mouse.move(195, 600);
        await page.mouse.wheel(0, 800);
        await page.waitForTimeout(150);
      }
      await footer.waitFor();
      await shown(page.getByText("Zara Pagetwo", { exact: true })).waitFor();
      const times = await page.getByText(first[0].fullName, { exact: true }).locator("visible=true").count();
      if (times !== 1) throw new Error(`${first[0].fullName}, on both pages, shows ${times} times`);
      // 27 rows at 25 a page make two pages: nothing past page 2 is asked for.
      if (!asked.includes(2) || asked.some((n) => n > 2)) throw new Error(`the list asked for pages ${asked.join(", ")}`);
      await shot("m14d-members-page-2");
    } finally {
      await page.unroute(url);
    }
  });

  // A member's page in the console, and the audit log, as the Samaj admin still.
  const pressed = async (button) => (await button.getAttribute("aria-pressed")) === "true";
  // The audit log's chips (AUDIT_ACTION_FILTERS), All first.
  const AUDIT_CHIPS = ["All", "Members", "Content", "Reports", "Chat reports", "Invitations", "Profile fields", "Settings", "Mentors", "Mentorships", "Referrals", "Exports", "Platform"];
  let nishaId = null;

  await step("a member's page shows their facts and mentor profile, and Remove as mentor asks first", async () => {
    await page.goto(SAMAJ + "/admin/members?status=APPROVED&q=Nisha");
    // The row's name and details open her page; its actions sit beside the link, never in it.
    await shown(page.getByRole("link", { name: /^Nisha Modi, Approved, 2010–present/ })).click();
    await page.waitForURL(/\/t\/shri-gujarati-samaj\/admin\/members\/[0-9a-f-]{36}$/);
    nishaId = page.url().split("/").pop();
    await shown(page.getByRole("heading", { name: "Nisha Modi", exact: true })).waitFor();
    // The facts her profile doesn't show, the phone as the console writes it, and the place by name.
    await shown(page.getByText("+91 91000 00036", { exact: true })).waitFor();
    await shown(page.getByText("New Jersey, United States", { exact: true })).waitFor();
    await shown(page.getByText("Working at a company", { exact: true })).waitFor();
    // Seeded as a mentor, in her own words.
    await shown(page.getByText("Listed in Mentors", { exact: true })).waitFor();
    await shown(page.getByText("Career advice, Working abroad, Consulting", { exact: true })).waitFor();
    await shown(page.getByText("Every two weeks. Weekday evenings, US East time", { exact: true })).waitFor();
    await fitsPhone("a member's page", shown(page.getByText("Listed in Mentors", { exact: true })));
    await shot("m15-admin-member");

    const sent = [];
    const onRequest = (r) => r.method() === "POST" && r.url().includes("/admin/mentors/") && sent.push(r.url());
    page.on("request", onRequest);
    try {
      await memberButton("Remove as mentor").click();
      const sheet = shown(page.getByRole("alertdialog", { name: "Remove as mentor?", exact: true }));
      await sheet.getByText(/^They'll no longer appear in Mentors, and requests waiting for them will be declined\./).waitFor();
      await sheet.getByRole("button", { name: "Cancel", exact: true }).click();
      await sheet.waitFor({ state: "hidden" });
      if (sent.length) throw new Error(`Cancel still sent ${sent.join(", ")}`);
    } finally {
      page.off("request", onRequest);
    }
    await shown(page.getByText("Listed in Mentors", { exact: true })).waitFor();
  });

  await step("an admin edits a member's answers, the admin-managed ones too: Save keeps them, and Cancel puts back what was chosen", async () => {
    // On Nisha's page from the step before. Samaj asks every member their Chapter.
    await memberButton("Edit answers").click();
    await memberButton("Diaspora").click();
    const patched = page.waitForRequest((r) => r.method() === "PATCH" && r.url().endsWith(`/admin/members/${nishaId}/profile`));
    await memberButton("Save answers").click();
    const sent = JSON.parse((await patched).postData() ?? "{}");
    if (sent.fields?.chapter !== "diaspora") throw new Error(`Save answers sent ${JSON.stringify(sent)}`);
    await statusSays("Answers saved").waitFor();
    await shown(page.getByText("Diaspora", { exact: true })).waitFor();
    if (await page.getByRole("button", { name: "Save answers" }).locator("visible=true").count()) throw new Error("the answers editor stayed open after saving");

    // Another choice, then Cancel: nothing is sent, the saved answer stands, and editing again starts from it.
    const later = [];
    const onRequest = (r) => r.method() === "PATCH" && r.url().includes(`/admin/members/${nishaId}`) && later.push(r.url());
    page.on("request", onRequest);
    try {
      await memberButton("Edit answers").click();
      await memberButton("Surat").click();
      if (!(await pressed(memberButton("Surat")))) throw new Error("the Surat chip isn't chosen after pressing it");
      await memberButton("Cancel").click();
      await shown(page.getByText("Diaspora", { exact: true })).waitFor();
      if (await page.getByText("Surat", { exact: true }).locator("visible=true").count()) throw new Error("Cancel kept the answer it was meant to drop");
      await memberButton("Edit answers").click();
      if (!(await pressed(memberButton("Diaspora"))) || (await pressed(memberButton("Surat")))) throw new Error("editing again didn't start from the saved answer, Diaspora");
      await memberButton("Cancel").click();
      if (later.length) throw new Error(`Cancel still sent ${later.join(", ")}`);
    } finally {
      page.off("request", onRequest);
    }

    // Out of the console to her profile in the app: down to the tabs under it, rather than a second set on top.
    await shown(page.getByRole("link", { name: "View profile in the app", exact: true })).click();
    await page.waitForURL(`**/t/shri-gujarati-samaj/directory/${nishaId}`);
    await shown(page.getByText("Nisha Modi", { exact: true })).waitFor();
    if (!(await page.locator('a[role="tab"]').locator("visible=true").count())) throw new Error("leaving the console for Nisha's profile didn't come back to the tabs");

    // An admin-managed question (added by the script: the Samaj's own two are members' to answer) is the admin's to
    // answer here, with a hint that the member never sees it, and Save sends it. The script takes it out of what goes to
    // the API, which doesn't know it.
    const OFFICE = { id: "00000000-0000-4000-8000-0000000000f1", key: "e2e_office_notes", label: "Office notes", helpText: null, type: "LONG_TEXT", options: [], required: false, visibility: "ADMINS", memberEditable: false, filterable: false, position: 99, archivedAt: null };
    const fieldsUrl = /\/api\/v1\/t\/shri-gujarati-samaj\/admin\/profile-fields(\?|$)/;
    await page.route(fieldsUrl, async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      const response = await route.fetch();
      return route.fulfill({ response, json: { data: [...(await response.json()).data, OFFICE] } });
    });
    const profileUrl = new RegExp(`/admin/members/${nishaId}/profile$`);
    const office = [];
    await page.route(profileUrl, (route) => {
      if (route.request().method() !== "PATCH") return route.fallback();
      const body = JSON.parse(route.request().postData() ?? "{}");
      office.push(body.fields?.[OFFICE.key]);
      const fields = { ...body.fields };
      delete fields[OFFICE.key];
      return route.continue({ postData: JSON.stringify({ ...body, fields }) });
    });
    try {
      await page.goto(SAMAJ + `/admin/members/${nishaId}`);
      await shown(page.getByText("Office notes", { exact: true })).waitFor();
      await memberButton("Edit answers").click();
      const notes = shown(page.getByLabel("Office notes", { exact: true }));
      if ((await notes.evaluate((el) => el.tagName)) !== "TEXTAREA") throw new Error("the admin-managed question isn't an input for the admin");
      await shown(page.getByText("Only admins see this answer.", { exact: true })).waitFor();
      await notes.fill("Met at the Edison meetup");
      await memberButton("Save answers").click();
      await statusSays("Answers saved").waitFor();
      if (office.join() !== "Met at the Edison meetup") throw new Error(`Save answers sent the admin-managed answer as ${JSON.stringify(office)}`);
    } finally {
      await page.unroute(fieldsUrl);
      await page.unroute(profileUrl);
    }
  });

  await step("Make admin and Remove admin role each ask first, and recent activity names who acted", async () => {
    await page.goto(SAMAJ + `/admin/members/${parthId}`);
    await shown(page.getByRole("heading", { name: "Parth Joshi", exact: true })).waitFor();
    // The bar's own Admin badge is there throughout; Parth's own is one more.
    const adminBadges = () => page.getByText("Admin", { exact: true }).locator("visible=true").count();
    const before = await adminBadges();
    const roles = [];
    const onRequest = (r) => r.method() === "PATCH" && r.url().endsWith(`/admin/members/${parthId}/role`) && roles.push(JSON.parse(r.postData() ?? "{}").role);
    page.on("request", onRequest);
    try {
      await memberButton("Make admin").click();
      let sheet = shown(page.getByRole("alertdialog", { name: "Make Parth Joshi an admin?", exact: true }));
      await sheet.getByText("They'll be able to approve members, moderate content, change settings and read the audit log for Shri Gujarati Samaj.", { exact: true }).waitFor();
      await sheet.getByRole("button", { name: "Cancel", exact: true }).click();
      await sheet.waitFor({ state: "hidden" });
      if (roles.length) throw new Error("Cancel still changed his role");

      await memberButton("Make admin").click();
      await sheet.getByRole("button", { name: "Make admin", exact: true }).click();
      await statusSays("Parth Joshi is now an admin").waitFor();
      await sheet.waitFor({ state: "hidden" });
      await memberButton("Remove admin role").waitFor();
      if ((await adminBadges()) !== before + 1) throw new Error("Parth's Admin badge didn't show once he was made an admin");
      await shot("m15b-admin-role");

      await memberButton("Remove admin role").click();
      sheet = shown(page.getByRole("alertdialog", { name: "Remove Parth Joshi's admin role?", exact: true }));
      await sheet.getByText("They keep their membership but lose the admin console.", { exact: true }).waitFor();
      await sheet.getByRole("button", { name: "Remove admin role", exact: true }).click();
      await statusSays("Parth Joshi is no longer an admin").waitFor();
      await sheet.waitFor({ state: "hidden" });
      await memberButton("Make admin").waitFor();
      if ((await adminBadges()) !== before) throw new Error("Parth's Admin badge stayed once the role was taken away");
      if (roles.join() !== "TENANT_ADMIN,MEMBER") throw new Error(`the role changes sent ${roles.join(", ")}`);
    } finally {
      page.off("request", onRequest);
    }

    // What was done to him, newest first, each by the admin's name, with the change it made.
    await shown(page.getByRole("heading", { name: "Recent activity", exact: true })).waitFor();
    await shown(page.getByText("membership.approve", { exact: true })).waitFor();
    await shown(page.getByText("PENDING → APPROVED", { exact: true })).waitFor();
    await shown(page.getByText("TENANT_ADMIN → MEMBER", { exact: true })).waitFor();
    if ((await page.getByText("Jignesh Patel", { exact: true }).locator("visible=true").count()) < 3) throw new Error("recent activity doesn't name Jignesh Patel for the approval and both role changes");
    if (await page.getByText("Platform / system", { exact: true }).locator("visible=true").count()) throw new Error("recent activity calls an admin's action the system's");
  });

  await step("the audit log filters by chip and by prefix, a row opens its member, and no phone hash shows", async () => {
    // Diya, rejected by the members list's steps: her row in the log links to her page.
    const token = await page.evaluate(() => localStorage.getItem("illuminize.access"));
    const rejected = await fetch(`${API}/api/v1/t/shri-gujarati-samaj/admin/members?status=REJECTED&q=Diya`, { headers: { Authorization: `Bearer ${token}` } });
    const diyaId = (await rejected.json()).data?.[0]?.id;
    if (!diyaId) throw new Error("Diya Raval isn't among the rejected members");

    await page.goto(SAMAJ + "/admin");
    await shown(page.getByRole("link", { name: "Audit log", exact: true })).click();
    await page.waitForURL("**/t/shri-gujarati-samaj/admin/audit");
    await shown(page.getByText("Every admin and member action, newest first", { exact: true })).waitFor();
    if (!(await pressed(memberButton("All")))) throw new Error("the audit log didn't open on All");

    await memberButton("Members").click();
    await page.waitForURL(/[?&]action=membership\./);
    await shown(page.getByText("membership.reject", { exact: true })).waitFor();
    await shown(page.getByText("Reason: Not a Samaj member yet", { exact: true })).waitFor();
    await shown(page.getByText("PENDING → REJECTED", { exact: true })).waitFor();
    await fitsPhone("the audit log", shown(page.getByText("membership.reject", { exact: true })));
    await shot("m16-audit-log");

    // A prefix typed that is no chip's leaves none chosen; one that is a chip's chooses it. Finding nothing says what it
    // looked for.
    const field = shown(page.getByLabel("Filter by action", { exact: true }));
    await field.fill("membership.app");
    await page.waitForURL(/[?&]action=membership\.app/);
    await shown(page.getByText("membership.approve", { exact: true })).waitFor();
    for (const chip of AUDIT_CHIPS) if (await pressed(memberButton(chip))) throw new Error(`the ${chip} chip is chosen for a prefix typed by hand`);
    await field.fill("chat_report.");
    await page.waitForURL(/[?&]action=chat_report\./);
    await shown(page.getByText("Nothing starts with “chat_report.”", { exact: true })).waitFor();
    if (!(await pressed(memberButton("Chat reports")))) throw new Error("typing the Chat reports chip's prefix didn't choose it");
    if ((await pressed(memberButton("Members"))) || (await pressed(memberButton("All")))) throw new Error("another chip stays chosen for the Chat reports prefix");
    await memberButton("Clear search").click();
    await page.waitForURL((url) => !url.searchParams.has("action"));
    if (!(await pressed(memberButton("All")))) throw new Error("clearing the filter didn't choose All");

    // A membership row opens that member's page; Back returns to the log, its chip still chosen.
    await memberButton("Members").click();
    await page.waitForURL(/[?&]action=membership\./);
    await shown(page.getByRole("link", { name: `membership ${diyaId.slice(0, 8)}`, exact: true })).click();
    await page.waitForURL(`**/t/shri-gujarati-samaj/admin/members/${diyaId}`);
    await shown(page.getByRole("heading", { name: "Diya Raval", exact: true })).waitFor();
    await backButton().click();
    await page.waitForURL(/\/admin\/audit\?action=membership\./);
    if (!(await pressed(memberButton("Members")))) throw new Error("Back to the audit log lost its filter");

    // A row whose metadata carries a phone hash, as a deleted account's does (answered by the script): its other details
    // show, the hash never does.
    const hash = "f00dcafe".repeat(8);
    const url = /\/api\/v1\/t\/shri-gujarati-samaj\/admin\/audit\?/;
    await page.route(url, (route) => {
      if (route.request().method() !== "GET" || new URL(route.request().url()).searchParams.get("action") !== "auth.") return route.fallback();
      const row = { id: "00000000-0000-4000-8000-0000000000e1", tenantId: null, actorUserId: null, actorMembershipId: null, actorName: null, action: "auth.account_deleted", targetType: "user", targetId: "00000000-0000-4000-8000-0000000000e2", metadata: { phoneHash: hash, memberships: 1, heldSuspensions: 1 }, createdAt: new Date().toISOString() };
      return answer(route, 200, { data: [row], page: 1, pageSize: 50, total: 1 });
    });
    try {
      await field.fill("auth.");
      await shown(page.getByText("auth.account_deleted", { exact: true })).waitFor();
      await shown(page.getByText("Memberships: 1", { exact: true })).waitFor();
      await shown(page.getByText("Held suspensions: 1", { exact: true })).waitFor();
      if ((await page.evaluate(() => document.body.innerText)).includes(hash.slice(0, 8))) throw new Error("the audit log shows a phone hash");
    } finally {
      await page.unroute(url);
    }
  });

  // The moderation and reports queues, as the Samaj admin. Samaj content is published as posted, so nothing waits: a
  // group waiting is answered by the script, and the rest acts on the seeded posts and jobs.
  // An item of a queue: the innermost box holding its text and its own View full content (or Hide).
  const queueRow = (text) =>
    page
      .locator("div")
      .filter({ has: page.getByText(text, typeof text === "string" ? { exact: true } : undefined) })
      .filter({ has: page.getByRole("button", { name: /^(View full content|Hide)$/ }) })
      .locator("visible=true")
      .last();
  // The API as the app's own session sees it, for ids the screens don't show.
  const adminGet = async (path) => {
    const token = await page.evaluate(() => localStorage.getItem("illuminize.access"));
    const res = await fetch(`${API}/api/v1/t/shri-gujarati-samaj/admin${path}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`GET admin${path} answered ${res.status}`);
    return res.json();
  };
  const chosenChip = async (label) => {
    const chip = shown(page.getByRole("button", { name: label, exact: true }));
    await chip.waitFor();
    if ((await chip.getAttribute("aria-pressed")) !== "true") throw new Error(`the "${label}" chip isn't the chosen one`);
  };
  const NISHA_POST = "Any Samaj members in the New York / New Jersey area? Thinking of a small dinner before Diwali.";
  const HETAL_POST = /^Shah Fabrics has a new range of cotton blends/;
  let nishaPostId = null;
  let nishaItem = null;

  await step("the moderation queue opens from the console on Awaiting approval with its count, all types, saying nothing waits", async () => {
    await page.goto(SAMAJ + "/admin");
    await shown(page.getByRole("link", { name: "Moderation", exact: true })).click();
    await page.waitForURL("**/t/shri-gujarati-samaj/admin/moderation");
    await shown(page.getByRole("heading", { name: "Moderation", exact: true })).waitFor();
    const pending = memberTab("Awaiting approval");
    await pending.waitFor();
    if ((await pending.getAttribute("aria-selected")) !== "true") throw new Error("the moderation queue didn't open on Awaiting approval");
    await shown(page.getByRole("tab", { name: /^Awaiting approval\s*0$/ })).waitFor();
    await chosenChip("All types");
    await shown(page.getByText("Nothing is waiting for review.", { exact: true })).waitFor();
    await fitsPhone("the moderation queue", shown(page.getByText("Review what members post before (or after) it goes live", { exact: true })));
    await shot("m17-admin-moderation");
  });

  await step("a group waiting is approved in two presses, the second sending what was shown, a change meanwhile refused in its row, and a preview changed since asking again", async () => {
    // Answered by the script: a group whose owner renamed it after it was approved, so members still see the old name.
    const id = "00000000-0000-4000-8000-0000000000a1";
    const owner = { id: "00000000-0000-4000-8000-0000000000a2", fullName: "Hetal Shah", startYear: 2005, batchYear: null, professionType: "BUSINESS_OWNER", companyName: null, designation: null, city: "Surat", country: "IN", avatarUrl: null, role: "MEMBER", isOpenToWork: false, headline: null };
    const at = new Date().toISOString();
    const item = { contentType: "GROUP", id, title: "Surat traders", excerpt: "Buying and selling in Surat", author: owner, moderationStatus: "PENDING", moderatedAt: null, createdAt: at, reportCount: 0, isPinned: false, kind: null };
    const group = { id, name: "Surat traders", description: "Buying and selling in Surat", approvedName: "Surat chapter", approvedDescription: "Chapter news", visibility: "OPEN", memberCount: 4, owner, archived: false, createdAt: at, updatedAt: at, moderationStatus: "PENDING", moderationNote: null, moderatedAt: null };
    const listUrl = /\/api\/v1\/t\/shri-gujarati-samaj\/admin\/moderation(\?|$)/;
    const groupUrl = new RegExp(`/admin/moderation/GROUP/${id}$`);
    const approveUrl = new RegExp(`/admin/moderation/GROUP/${id}/approve$`);
    let loads = 0;
    const sent = [];
    // Renamed by its owner as the first approval is refused, so the preview fetched again says something else.
    let current = group;
    const renamed = { ...group, name: "Surat traders club" };
    await page.route(listUrl, (route) => (route.request().method() === "GET" && new URL(route.request().url()).searchParams.get("status") === "PENDING" ? answer(route, 200, { data: [item], page: 1, pageSize: 20, total: 1 }) : route.fallback()));
    await page.route(groupUrl, (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      loads += 1;
      return answer(route, 200, { data: current });
    });
    await page.route(approveUrl, (route) => {
      sent.push(route.request().postData());
      current = renamed;
      return answer(route, 409, { error: { code: "CONFLICT", message: "This group changed while you were looking at it. Reload it and try again." } });
    });
    try {
      await page.goto(SAMAJ + "/admin/moderation");
      const row = queueRow("Surat traders");
      await row.getByText(/^by Hetal Shah \(2005–present\) · /).waitFor();
      // The first press opens the name and description to check, and sends nothing.
      await row.getByRole("button", { name: "Approve", exact: true }).click();
      await row.getByRole("status").filter({ hasText: "Check the group's name and description, then approve it." }).waitFor();
      await row.getByText("Until you decide, members see what was approved before:", { exact: true }).waitFor();
      await row.getByText("Surat chapter", { exact: true }).waitFor();
      await row.getByText("Chat messages are never shown here: only a group's name and description are reviewed.", { exact: true }).waitFor();
      if ((await row.getByRole("button", { name: "Hide", exact: true }).getAttribute("aria-expanded")) !== "true") throw new Error("the opened row doesn't say it's expanded");
      if (sent.length) throw new Error("the first Approve sent the approval before the group was shown");
      await shot("m17b-moderation-group");
      // The second sends the name and description on screen; the group changed meanwhile, so the row says so and the
      // group is fetched again, to read before pressing once more.
      const shownLoads = loads;
      await row.getByRole("button", { name: "Approve", exact: true }).click();
      await row.getByRole("status").filter({ hasText: "This group changed while you were looking at it. Reload it and try again." }).waitFor();
      const body = JSON.parse(sent[0] ?? "{}");
      if (body.reviewed?.name !== "Surat traders" || body.reviewed?.description !== "Buying and selling in Surat") throw new Error(`the second Approve sent ${sent[0]}`);
      for (let i = 0; i < 50 && loads === shownLoads; i++) await page.waitForTimeout(100);
      if (loads === shownLoads) throw new Error("the group wasn't fetched again after the refusal");
      // The preview now shows the new name, which the admin hasn't read yet: the next press sends nothing and asks them
      // to check it again, and the one after sends what it says now.
      await row.getByText("Surat traders club", { exact: true }).waitFor();
      await row.getByRole("button", { name: "Approve", exact: true }).click();
      await row.getByRole("status").filter({ hasText: "This group changed while you were looking at it. Check its name and description again, then approve it." }).waitFor();
      if (sent.length !== 1) throw new Error("Approve sent a name the preview had only just changed to");
      await row.getByRole("button", { name: "Approve", exact: true }).click();
      for (let i = 0; i < 50 && sent.length < 2; i++) await page.waitForTimeout(100);
      const again = JSON.parse(sent[1] ?? "{}");
      if (again.reviewed?.name !== "Surat traders club" || again.reviewed?.description !== "Buying and selling in Surat") throw new Error(`the Approve after checking again sent ${sent[1]}`);
    } finally {
      await page.unroute(listUrl);
      await page.unroute(groupUrl);
      await page.unroute(approveUrl);
    }
  });

  await step("a job's preview has the page's headings under the queue's, its contacts as text, and a closed job's parts", async () => {
    await page.goto(SAMAJ + "/admin/moderation");
    await memberTab("Published").click();
    await page.waitForURL(/status=APPROVED/);
    await shown(page.getByRole("button", { name: "Job", exact: true })).click();
    await page.waitForURL(/type=JOB/);
    await chosenChip("Job");
    const job = queueRow("Export Documentation Executive");
    await job.getByRole("button", { name: "View full content", exact: true }).click();
    await job.getByRole("heading", { level: 2, name: "Export Documentation Executive", exact: true }).waitFor();
    await job.getByRole("heading", { level: 3, name: "About the role", exact: true }).waitFor();
    await job.getByText("Apply link", { exact: true }).waitFor();
    await job.getByText("https://example.com/shah-fabrics/careers", { exact: true }).waitFor();
    // Text to read, never something to follow: no link but the row's own Open in app, and no Apply to press.
    const links = (await job.getByRole("link").allInnerTexts()).map((t) => t.trim());
    if (links.join() !== "Open in app") throw new Error(`the job's row has the links ${links.join(", ")}, not Open in app alone`);
    if (await job.getByRole("button", { name: /^Apply/ }).count()) throw new Error("the job's preview offers Apply");
    // Its skills listed as they are, with nothing compared with the admin's own.
    if (await job.getByText(/you have|Add your skills/i).count()) throw new Error("the admin's preview compares the job's skills with the admin's");
    await fitsPhone("the moderation queue with a job open", job.getByText("Apply link", { exact: true }));
    await shot("m17c-moderation-job");
    const closed = queueRow("Store Manager – Ring Road");
    await closed.getByRole("button", { name: "View full content", exact: true }).click();
    await closed.getByText("Applications closed", { exact: true }).waitFor();
    await closed.getByText("No apply link, email or phone.", { exact: true }).waitFor();
  });

  await step("Nisha's post is removed with a note, kept through Cancel, and restored from Removed", async () => {
    nishaItem = (await adminGet("/moderation?status=APPROVED&contentType=POST&pageSize=50")).data.find((i) => i.title === NISHA_POST) ?? null;
    nishaPostId = nishaItem?.id ?? null;
    if (!nishaPostId) throw new Error("Nisha's post isn't among the published posts");
    await page.goto(SAMAJ + "/admin/moderation?status=APPROVED&type=POST");
    const row = queueRow(NISHA_POST);
    await row.getByRole("button", { name: "Remove", exact: true }).click();
    const sheet = shown(page.getByRole("dialog", { name: "Remove this content?", exact: true }));
    await sheet.getByText("It disappears for members; you can restore it later.", { exact: true }).waitFor();
    const note = sheet.getByPlaceholder("Optional note");
    await note.fill("Off topic for the feed");
    await shot("m17d-moderation-remove");
    // Cancel keeps the note for next time.
    await sheet.getByRole("button", { name: "Cancel", exact: true }).click();
    await sheet.waitFor({ state: "hidden" });
    await row.getByRole("button", { name: "Remove", exact: true }).click();
    if ((await note.inputValue()) !== "Off topic for the feed") throw new Error(`the sheet opened again holding "${await note.inputValue()}", not the note typed`);
    await sheet.getByRole("button", { name: "Remove", exact: true }).click();
    await statusSays("Post removed").waitFor();
    await sheet.waitFor({ state: "hidden" });
    await row.waitFor({ state: "detached" });

    await memberTab("Removed").click();
    await page.waitForURL(/status=REMOVED/);
    await chosenChip("Post");
    await queueRow(NISHA_POST).getByRole("button", { name: "Restore", exact: true }).click();
    await statusSays("Post restored").waitFor();
    await shown(page.getByText("No removed content.", { exact: true })).waitFor();
  });

  await step("a published post is pinned and unpinned from the queue, its button saying which, with an SVG icon", async () => {
    await memberTab("Published").click();
    await page.waitForURL(/status=APPROVED/);
    const row = queueRow(HETAL_POST);
    const pin = row.getByRole("button", { name: "Pin", exact: true });
    await pin.waitFor();
    await expectSvgNoEmoji(pin, "the queue's Pin button");
    await pin.click();
    await row.getByRole("status").filter({ hasText: "Pinned to the top of the feed" }).waitFor();
    await row.getByRole("button", { name: "Unpin", exact: true }).click();
    await row.getByRole("status").filter({ hasText: "Unpinned" }).waitFor();
    await row.getByRole("button", { name: "Pin", exact: true }).waitFor();
  });

  await step("a link naming an item opens it in the queue, a notice's item already handled says so, and a cached list isn't taken for the answer", async () => {
    await page.goto(`${SAMAJ}/admin/moderation?status=APPROVED&type=POST&item=${nishaPostId}`);
    const row = queueRow(NISHA_POST);
    await row.getByRole("button", { name: "Hide", exact: true }).waitFor();
    // Its words twice: the row's opening line, and the preview it opened with.
    await row.getByText(NISHA_POST, { exact: true }).nth(1).waitFor();

    const gone = "That item isn't waiting here any more. Another admin may have handled it.";
    const notice = await scriptNotification(page, "shri-gujarati-samaj", { type: "CONTENT_PENDING", data: { contentType: "POST", contentId: nishaPostId }, title: "A post is waiting for review" });
    const listUrl = /\/api\/v1\/t\/shri-gujarati-samaj\/admin\/moderation(\?|$)/;
    try {
      await page.goto(SAMAJ + "/profile/notifications");
      await shown(page.getByText("A post is waiting for review", { exact: true })).click();
      await page.waitForURL(new RegExp(`/t/shri-gujarati-samaj/admin/moderation\\?status=PENDING&type=POST&item=${nishaPostId}$`));
      await chosenChip("Post");
      // Published long since, so nothing of it waits.
      await statusSays(gone).waitFor();
      await backButton().click();
      await page.waitForURL("**/t/shri-gujarati-samaj/profile/notifications");

      // A second notice moments later, for an item that now waits (answered by the script): the list cached by the visit
      // just made, with nothing waiting, is fetched again rather than taken for the answer, and the item opens.
      await page.route(listUrl, (route) => {
        const params = new URL(route.request().url()).searchParams;
        if (route.request().method() !== "GET" || params.get("status") !== "PENDING") return route.fallback();
        return answer(route, 200, { data: [{ ...nishaItem, moderationStatus: "PENDING" }], page: 1, pageSize: 20, total: 1 });
      });
      const fetched = page.waitForResponse((r) => listUrl.test(r.url()) && new URL(r.url()).searchParams.get("status") === "PENDING");
      await shown(page.getByText("A post is waiting for review", { exact: true })).click();
      await page.waitForURL(new RegExp(`/t/shri-gujarati-samaj/admin/moderation\\?status=PENDING&type=POST&item=${nishaPostId}$`));
      await fetched;
      const waiting = queueRow(NISHA_POST);
      await waiting.getByRole("button", { name: "Hide", exact: true }).waitFor();
      await waiting.getByRole("button", { name: "Approve", exact: true }).waitFor();
      if (await page.getByRole("status").filter({ hasText: gone }).locator("visible=true").count()) throw new Error("the queue said the item had gone, from the list cached before the notice");
    } finally {
      await page.unroute(listUrl);
      await notice.stop();
    }
  });

  await step("Open in app leaves the console for the post's own page, with one tab bar", async () => {
    await page.goto(SAMAJ + "/admin/moderation?status=APPROVED&type=POST");
    const link = queueRow(NISHA_POST).getByRole("link", { name: "Open in app", exact: true });
    await expectSvgNoEmoji(link, "Open in app");
    await link.click();
    await page.waitForURL(`**/t/shri-gujarati-samaj/feed/${nishaPostId}`);
    await shown(page.getByText(NISHA_POST, { exact: true })).waitFor();
    // Down to the tabs underneath, not a second set of them on top of the console.
    if ((await barTab("More").locator("visible=true").count()) !== 1) throw new Error("leaving the console for the post left more than one tab bar");
  });

  let reportId = null;
  let openReport = null;
  await step("Hetal's post reported from the feed is in the console's Reports, labelled, with an Open tab counting it", async () => {
    await page.goto(SAMAJ + "/feed");
    const card = page
      .locator("div")
      .filter({ has: page.getByText(HETAL_POST) })
      .filter({ has: page.getByRole("button", { name: "Report this content", exact: true }) })
      .locator("visible=true")
      .last();
    await card.getByRole("button", { name: "Report this content", exact: true }).click();
    const sheet = shown(page.getByRole("dialog", { name: "Report content", exact: true }));
    await sheet.getByRole("button", { name: "Spam", exact: true }).click();
    await sheet.getByLabel("Details (optional)", { exact: true }).fill("e2e check");
    const filed = page.waitForResponse((r) => r.request().method() === "POST" && /\/t\/shri-gujarati-samaj\/reports$/.test(r.url()));
    await sheet.getByRole("button", { name: "Submit report", exact: true }).click();
    if ((await filed).status() !== 201) throw new Error(`reporting the post answered ${(await filed).status()}`);
    await sheet.waitFor({ state: "hidden" });

    // Afresh, so the console's counts are asked for now.
    await page.goto(SAMAJ + "/more");
    await consoleRow().click();
    await page.waitForURL("**/t/shri-gujarati-samaj/admin");
    await shown(page.getByRole("link", { name: "Open reports, 1", exact: true })).click();
    await page.waitForURL("**/t/shri-gujarati-samaj/admin/reports");
    const open = memberTab("Open");
    await open.waitFor();
    if ((await open.getAttribute("aria-selected")) !== "true") throw new Error("Reports didn't open on Open");
    await shown(page.getByRole("tab", { name: /^Open\s*1$/ })).waitFor();
    const row = page
      .locator("div")
      .filter({ has: page.getByText("“e2e check”", { exact: true }) })
      .filter({ has: page.getByRole("button", { name: "Dismiss", exact: true }) })
      .locator("visible=true")
      .last();
    for (const text of ["Spam", "Post", "Published"]) await row.getByText(text, { exact: true }).waitFor();
    if (await row.getByText("APPROVED", { exact: true }).count()) throw new Error("the report's content status shows the raw APPROVED");
    await row.getByText(/^Reported by Jignesh Patel · /).waitFor();
    await row.getByText(HETAL_POST).waitFor();
    await fitsPhone("the reports queue", row.getByText("“e2e check”", { exact: true }));
    await shot("m18-admin-reports");
    openReport = (await adminGet("/reports?status=OPEN")).data.find((r) => r.details === "e2e check") ?? null;
    reportId = openReport?.id ?? null;
    if (!reportId) throw new Error("the report isn't among the open ones");
  });

  await step("a report already handled elsewhere closes its sheet and says so, one resolved keeping the content lists its note, and a cached list isn't taken for a notice's answer", async () => {
    const row = page
      .locator("div")
      .filter({ has: page.getByText("“e2e check”", { exact: true }) })
      .filter({ has: page.getByRole("button", { name: "Dismiss", exact: true }) })
      .locator("visible=true")
      .last();
    // Answered by the script as if another admin had dismissed it first.
    const dismissUrl = /\/admin\/reports\/[^/]+\/dismiss$/;
    await page.route(dismissUrl, (route) => (route.request().method() === "POST" ? answer(route, 409, { error: { code: "INVALID_TRANSITION", message: "This report has already been handled" } }) : route.fallback()));
    try {
      await row.getByRole("button", { name: "Dismiss", exact: true }).click();
      const sheet = shown(page.getByRole("dialog", { name: "Dismiss this report", exact: true }));
      await sheet.getByPlaceholder("Optional note").fill("Not worth keeping");
      const refetched = page.waitForRequest((r) => r.method() === "GET" && /\/admin\/reports\?/.test(r.url()));
      await sheet.getByRole("button", { name: "Dismiss", exact: true }).click();
      await sheet.waitFor({ state: "hidden" });
      await statusSays("This report has already been handled").waitFor();
      await refetched;
    } finally {
      await page.unroute(dismissUrl);
    }

    // It's still open in fact, so it's resolved for real.
    await row.getByRole("button", { name: "Resolve, keep content", exact: true }).click();
    const sheet = shown(page.getByRole("dialog", { name: "Resolve without removing", exact: true }));
    await sheet.getByText("Add a note for the audit trail.", { exact: true }).waitFor();
    await sheet.getByPlaceholder("Optional note").fill("Checked: not spam");
    await sheet.getByRole("button", { name: "Resolve", exact: true }).click();
    await statusSays("Report resolved").waitFor();
    await shown(page.getByText("No open reports", { exact: true })).waitFor();
    await memberTab("Resolved").click();
    await page.waitForURL(/status=RESOLVED/);
    await shown(page.getByText("Resolution: Checked: not spam", { exact: true })).waitFor();

    // A notice of it, tapped now, finds it handled.
    const handled = "That report has already been handled.";
    const notice = await scriptNotification(page, "shri-gujarati-samaj", { type: "REPORT_FILED", data: { reportId }, title: "Post reported: spam" });
    const listUrl = /\/api\/v1\/t\/shri-gujarati-samaj\/admin\/reports(\?|$)/;
    try {
      await page.goto(SAMAJ + "/profile/notifications");
      await shown(page.getByText("Post reported: spam", { exact: true })).click();
      await page.waitForURL(new RegExp(`/t/shri-gujarati-samaj/admin/reports\\?status=OPEN&item=${reportId}$`));
      await statusSays(handled).waitFor();
      await backButton().click();
      await page.waitForURL("**/t/shri-gujarati-samaj/profile/notifications");

      // Tapped again moments later, with the report open again as far as the list goes (answered by the script): the
      // Open list cached by the visit just made, with nothing open, is fetched again rather than taken for the answer.
      await page.route(listUrl, (route) => {
        const params = new URL(route.request().url()).searchParams;
        if (route.request().method() !== "GET" || params.get("status") !== "OPEN") return route.fallback();
        return answer(route, 200, { data: [openReport], page: 1, pageSize: 20, total: 1 });
      });
      const fetched = page.waitForResponse((r) => listUrl.test(r.url()) && new URL(r.url()).searchParams.get("status") === "OPEN");
      await shown(page.getByText("Post reported: spam", { exact: true })).click();
      await page.waitForURL(new RegExp(`/t/shri-gujarati-samaj/admin/reports\\?status=OPEN&item=${reportId}$`));
      await fetched;
      await shown(page.getByText("“e2e check”", { exact: true })).waitFor();
      if (await page.getByRole("status").filter({ hasText: handled }).locator("visible=true").count()) throw new Error("Reports said the report was handled, from the list cached before the notice");
    } finally {
      await page.unroute(listUrl);
      await notice.stop();
    }
  });

  // Chat reports, as the Samaj admin. The list and every view are answered by the script, so no view writes an audit row
  // and no Samaj chat is needed; the reported member is real, for the link to their page. Each view the app asks for is
  // counted, as each would be an audit row. Hidden screens stay in the page on the web build, so the words are looked
  // for in the whole document, attributes too.
  const CHAT_MARK = "e2e-chat-7Q4X";
  const MESSAGE_REPORT = "00000000-0000-4000-8000-0000000000d1";
  const REQUEST_REPORT = "00000000-0000-4000-8000-0000000000d2";
  const marks = () => page.evaluate((mark) => document.documentElement.outerHTML.split(mark).length - 1, CHAT_MARK);
  const noMarks = (why) => page.waitForFunction((mark) => !document.documentElement.outerHTML.includes(mark), CHAT_MARK, { timeout: 5000 }).catch(() => Promise.reject(new Error(`the reported words are still in the page ${why}`)));
  const setAppVisible = (visible) =>
    page.evaluate((v) => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (v ? "visible" : "hidden") });
      document.dispatchEvent(new Event("visibilitychange"));
    }, visible);
  // A report's card: the innermost box holding its headline and its own View (or Hide).
  const chatRow = (headline) =>
    page
      .locator("div")
      .filter({ has: page.getByText(new RegExp(`^${headline} · `)) })
      .filter({ has: page.getByRole("button", { name: /^(View messages|View request|Hide)$/ }) })
      .locator("visible=true")
      .last();
  const MESSAGE_ROW = "Hetal Shah reported Ravi Mehta";
  const REQUEST_ROW = "Nisha Modi reported Ravi Mehta";
  let raviId = null;
  /**
   * Answers the chat reports list (two open reports, or with `many`, the message report after eleven others, less those
   * in `dismissed`), each view (the one for `slow` late by `delay`, and each failing with the next of `viewFails`, taken
   * as it is asked for), a dismiss (which takes the report off the list) and the dashboard's open count.
   */
  const scriptChatReports = async () => {
    if (!raviId) {
      const token = await page.evaluate(() => localStorage.getItem("illuminize.access"));
      const res = await fetch(`${API}/api/v1/t/shri-gujarati-samaj/admin/members?status=APPROVED&q=Ravi`, { headers: { Authorization: `Bearer ${token}` } });
      raviId = (await res.json()).data?.find((m) => m.fullName === "Ravi Mehta")?.id;
      if (!raviId) throw new Error("Ravi Mehta isn't among the approved members");
    }
    const at = new Date().toISOString();
    const member = (id, fullName) => ({ id, fullName, avatarUrl: null });
    const hetal = member("00000000-0000-4000-8000-0000000000d3", "Hetal Shah");
    const ravi = member(raviId, "Ravi Mehta");
    const report = (id, targetKind, reason, reporter) => ({ id, targetKind, reason, status: "OPEN", reporter, reported: ravi, resolutionAction: null, resolvedAt: null, createdAt: at });
    const messageReport = report(MESSAGE_REPORT, "MESSAGE", "HARASSMENT", hetal);
    const requestReport = report(REQUEST_REPORT, "REFERRAL_NOTE", "SPAM", member("00000000-0000-4000-8000-0000000000d4", "Nisha Modi"));
    const views = {
      [MESSAGE_REPORT]: {
        ...messageReport,
        details: `He keeps writing ${CHAT_MARK}-details`,
        noteSnapshot: null,
        resolutionNote: null,
        messages: [
          { id: "00000000-0000-4000-8000-0000000000e1", kind: "SYSTEM", sender: null, body: `Hetal Shah accepted the request ${CHAT_MARK}-system`, removed: false, isTarget: false, createdAt: at },
          { id: "00000000-0000-4000-8000-0000000000e2", kind: "TEXT", sender: ravi, body: `Answer me or else ${CHAT_MARK}-reported`, removed: false, isTarget: true, createdAt: at },
          { id: "00000000-0000-4000-8000-0000000000e3", kind: "TEXT", sender: hetal, body: `Please stop ${CHAT_MARK}-removed`, removed: true, isTarget: false, createdAt: at },
        ],
      },
      [REQUEST_REPORT]: { ...requestReport, details: null, noteSnapshot: `Refer me or I'll tell everyone ${CHAT_MARK}-note`, resolutionNote: null, messages: [] },
    };
    const others = Array.from({ length: 11 }, (_, i) => report(`00000000-0000-4000-8000-0000000001${String(i).padStart(2, "0")}`, "MESSAGE", "SPAM", member(`00000000-0000-4000-8000-0000000002${String(i).padStart(2, "0")}`, `Member ${i + 1}`)));
    const state = { views: [], lists: 0, dismissed: [], dismissBody: null, slow: null, delay: 0, many: false, viewFails: [] };
    const open = () => (state.many ? [...others, messageReport] : [messageReport, requestReport]).filter((r) => !state.dismissed.includes(r.id));
    const listUrl = /\/api\/v1\/t\/shri-gujarati-samaj\/admin\/chat-reports(\?|$)/;
    const viewUrl = /\/api\/v1\/t\/shri-gujarati-samaj\/admin\/chat-reports\/([^/]+)\/view$/;
    const dismissUrl = /\/api\/v1\/t\/shri-gujarati-samaj\/admin\/chat-reports\/([^/]+)\/dismiss$/;
    const dashboardUrl = /\/api\/v1\/t\/shri-gujarati-samaj\/admin\/dashboard$/;
    await page.route(listUrl, (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      state.lists += 1;
      const rows = new URL(route.request().url()).searchParams.get("status") === "OPEN" ? open() : [];
      return answer(route, 200, { data: rows, page: 1, pageSize: 20, total: rows.length });
    });
    await page.route(viewUrl, async (route) => {
      const id = viewUrl.exec(route.request().url())[1];
      state.views.push(id);
      const fail = state.viewFails.shift();
      if (id === state.slow) await new Promise((resolve) => setTimeout(resolve, state.delay));
      if (fail) return answer(route, fail.status, { error: { code: fail.code, message: fail.message } });
      return answer(route, 200, { data: views[id] });
    });
    await page.route(dismissUrl, (route) => {
      const id = dismissUrl.exec(route.request().url())[1];
      state.dismissed.push(id);
      state.dismissBody = route.request().postDataJSON();
      return answer(route, 200, { data: { ...(id === REQUEST_REPORT ? requestReport : messageReport), status: "DISMISSED" } });
    });
    await page.route(dashboardUrl, async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      try {
        const response = await route.fetch();
        await route.fulfill({ response, json: { data: { ...(await response.json()).data, openChatReports: open().length } } });
      } catch {
        // The console polls its counts, so a request can be cut off by the next step's page load.
      }
    });
    state.stop = async () => {
      for (const url of [listUrl, viewUrl, dismissUrl, dashboardUrl]) await page.unroute(url);
    };
    return state;
  };
  const expectViews = (chat, n, why) => {
    if (chat.views.length !== n) throw new Error(`the app asked for ${chat.views.length} views ${why}, expected ${n}`);
  };
  // Every query goes stale (the page's clock moved past their 30 seconds) and is fetched again as after a lost
  // connection, which leaves the app active: so the list is fetched again with a report's words still open.
  const refetchStale = async (chat, why) => {
    const lists = chat.lists;
    await page.evaluate(() => {
      const now = Date.now;
      Date.now = () => now() + 31_000;
    });
    await reconnect(page);
    for (let i = 0; i < 50 && chat.lists === lists; i++) await page.waitForTimeout(100);
    if (chat.lists === lists) throw new Error(`the list wasn't fetched again ${why}`);
  };
  // Whether a note box holds the mark: what is typed is in no attribute, so the page's HTML doesn't show it.
  const noteHeld = () => page.evaluate((mark) => [...document.querySelectorAll("input, textarea")].some((el) => el.value.includes(mark)), CHAT_MARK);

  await step("chat reports say who reported whom and why, with no words until View, which shows the thread oldest first, and Hide takes it away", async () => {
    const chat = await scriptChatReports();
    try {
      await page.goto(SAMAJ + "/admin");
      // The console's home links the open chat reports by its tile and its row.
      await shown(page.getByRole("link", { name: "Chat reports, 2 waiting", exact: true })).waitFor();
      await shown(page.getByRole("link", { name: "Open chat reports, 2", exact: true })).click();
      await page.waitForURL("**/t/shri-gujarati-samaj/admin/chat-reports");
      await shown(page.getByRole("heading", { name: "Chat reports", exact: true })).waitFor();
      const open = memberTab("Open");
      await open.waitFor();
      if ((await open.getAttribute("aria-selected")) !== "true") throw new Error("chat reports didn't open on Open");
      if (!/^Open\s*2$/.test((await open.innerText()).trim())) throw new Error(`the Open tab reads "${await open.innerText()}", not its count of 2`);
      await shown(page.getByText("Private messages members reported. You see a message only if you choose to, and never a whole conversation.", { exact: true })).waitFor();
      await shown(page.getByText("Messages you open are hidden again when you leave this screen, change tab or switch to another app. Seeing them again is another recorded view.", { exact: true })).waitFor();
      const row = chatRow(MESSAGE_ROW);
      for (const text of ["Harassment", "Message", "Each view is recorded in the audit log."]) await row.getByText(text, { exact: true }).waitFor();
      await chatRow(REQUEST_ROW).getByText("Referral request", { exact: true }).waitFor();
      if (await marks()) throw new Error("the chat reports list shows reported words before anyone asked to see them");
      expectViews(chat, 0, "before any View");

      await row.getByRole("button", { name: "View messages", exact: true }).click();
      await row.getByText(`Answer me or else ${CHAT_MARK}-reported`, { exact: true }).waitFor();
      expectViews(chat, 1, "after one View");
      await row.getByText(`He keeps writing ${CHAT_MARK}-details`).waitFor();
      for (const text of ["Reported message", "System message", "Removed"]) await row.getByText(text, { exact: true }).waitFor();
      const thread = (await row.getByRole("listitem").allInnerTexts()).map((t) => /-(system|reported|removed)$/.exec(t.trim())?.[1]);
      if (thread.join() !== "system,reported,removed") throw new Error(`the thread reads ${thread.join(", ")}, not oldest first`);
      await row.getByRole("link", { name: "Ravi Mehta's member page", exact: true }).waitFor();
      for (const name of ["Remove message", "Resolve, keep message", "Dismiss", "Hide"]) {
        const box = await row.getByRole("button", { name, exact: true }).boundingBox();
        if (!box || box.height < 44) throw new Error(`"${name}" is ${box?.height}px tall, under 44px`);
      }
      await fitsPhone("chat reports with a thread open", row.getByText(`Answer me or else ${CHAT_MARK}-reported`, { exact: true }));
      await shot("m19-admin-chat-report");
      await row.getByRole("button", { name: "Hide", exact: true }).click();
      await noMarks("after Hide");
      await row.getByRole("button", { name: "View messages", exact: true }).waitFor();
      expectViews(chat, 1, "after Hide");
    } finally {
      await chat.stop();
    }
  });

  await step("chat report words go when the member's page opens over them, when the tab changes and when the app goes to the background", async () => {
    const chat = await scriptChatReports();
    try {
      await page.goto(SAMAJ + "/admin/chat-reports");
      const row = chatRow(MESSAGE_ROW);
      const reported = row.getByText(`Answer me or else ${CHAT_MARK}-reported`, { exact: true });
      // The member page, pushed within the console, leaves this screen mounted under it.
      await row.getByRole("button", { name: "View messages", exact: true }).click();
      await reported.waitFor();
      await row.getByRole("link", { name: "Ravi Mehta's member page", exact: true }).click();
      await page.waitForURL(`**/t/shri-gujarati-samaj/admin/members/${raviId}`);
      await shown(page.getByRole("heading", { name: "Ravi Mehta", exact: true })).waitFor();
      await noMarks("with the member's page open over them");
      await backButton().click();
      await page.waitForURL("**/t/shri-gujarati-samaj/admin/chat-reports");
      await row.getByRole("button", { name: "View messages", exact: true }).waitFor();
      if (await marks()) throw new Error("the reported words came back with Back");

      await row.getByRole("button", { name: "View messages", exact: true }).click();
      await reported.waitFor();
      await memberTab("Resolved").click();
      await page.waitForURL(/status=RESOLVED/);
      await shown(page.getByText("No resolved chat reports", { exact: true })).waitFor();
      await noMarks("after changing tab");
      await memberTab("Open").click();
      await row.getByRole("button", { name: "View messages", exact: true }).waitFor();
      if (await marks()) throw new Error("the reported words came back with the Open tab");

      // What react-native-web's AppState reads, as the app switcher or another app would make it.
      await row.getByRole("button", { name: "View messages", exact: true }).click();
      await reported.waitFor();
      await setAppVisible(false);
      try {
        await noMarks("with the app in the background");
      } finally {
        await setAppVisible(true);
      }
      await row.getByRole("button", { name: "View messages", exact: true }).waitFor();
      if (await marks()) throw new Error("the reported words came back with the app");
      expectViews(chat, 3, "for three Views, none asked for again by itself");
    } finally {
      await chat.stop();
    }
  });

  await step("a request report shows its note with Resolve and no Remove message, and a late answer to another report is dropped", async () => {
    const chat = await scriptChatReports();
    try {
      await page.goto(SAMAJ + "/admin/chat-reports");
      const message = chatRow(MESSAGE_ROW);
      const request = chatRow(REQUEST_ROW);
      await message.getByRole("button", { name: "View messages", exact: true }).waitFor();
      // The message's view lands late, after the request was opened in its place: it must not show.
      chat.slow = MESSAGE_REPORT;
      chat.delay = 1500;
      await message.getByRole("button", { name: "View messages", exact: true }).click();
      for (let i = 0; i < 50 && chat.views.length < 1; i++) await page.waitForTimeout(50);
      await request.getByRole("button", { name: "View request", exact: true }).click();
      await request.getByText(`Refer me or I'll tell everyone ${CHAT_MARK}-note`, { exact: true }).waitFor();
      await request.getByRole("button", { name: "Resolve", exact: true }).waitFor();
      if (await request.getByRole("button", { name: "Remove message", exact: true }).count()) throw new Error("a request report offers Remove message");
      await page.waitForTimeout(2500);
      expectViews(chat, 2, "for the two Views");
      if ((await page.content()).includes(`${CHAT_MARK}-reported`)) throw new Error("the late answer brought the message's words back");
      await request.getByText(`Refer me or I'll tell everyone ${CHAT_MARK}-note`, { exact: true }).waitFor();
      await message.getByRole("button", { name: "View messages", exact: true }).waitFor();
    } finally {
      await chat.stop();
    }
  });

  await step("a view refused says why: in its row when limited, under the tabs with the list fetched again when out of date, and not at all when it lands late", async () => {
    const chat = await scriptChatReports();
    try {
      await page.goto(SAMAJ + "/admin/chat-reports");
      const message = chatRow(MESSAGE_ROW);
      const request = chatRow(REQUEST_ROW);
      // Over the hourly limit: said in the report's own row, and no words.
      chat.viewFails.push({ status: 429, code: "RATE_LIMITED", message: "e2e too many views" });
      await message.getByRole("button", { name: "View messages", exact: true }).click();
      await message.getByRole("status").filter({ hasText: "e2e too many views" }).waitFor();
      await message.getByRole("button", { name: "View messages", exact: true }).waitFor();
      if (await marks()) throw new Error("a view refused by the limit showed words");
      if ((await page.getByRole("status").filter({ hasText: "e2e too many views" }).locator("visible=true").count()) !== 1) throw new Error("a view refused by the limit was said under the tabs as well as in its row");

      // Gone since, as when another admin's action took it: said under the tabs, and the list fetched again.
      chat.viewFails.push({ status: 404, code: "NOT_FOUND", message: "e2e report gone" });
      const lists = chat.lists;
      await request.getByRole("button", { name: "View request", exact: true }).click();
      await statusSays("e2e report gone").waitFor();
      for (let i = 0; i < 50 && chat.lists === lists; i++) await page.waitForTimeout(100);
      if (chat.lists === lists) throw new Error("the list wasn't fetched again after a view refused as out of date");
      await request.getByRole("button", { name: "View request", exact: true }).waitFor();
      if (await message.getByRole("status").filter({ hasText: "e2e too many views" }).count()) throw new Error("the limit's line stayed in its row after another View");
      if (await marks()) throw new Error("a view refused as out of date showed words");

      // Refused, but only after the request was opened in its place: dropped like a late answer, so nothing is said
      // about a report the admin has left, and nothing fetched.
      chat.slow = MESSAGE_REPORT;
      chat.delay = 1500;
      chat.viewFails.push({ status: 409, code: "INVALID_TRANSITION", message: "e2e late refusal" });
      await message.getByRole("button", { name: "View messages", exact: true }).click();
      for (let i = 0; i < 50 && chat.views.length < 3; i++) await page.waitForTimeout(50);
      await request.getByRole("button", { name: "View request", exact: true }).click();
      await request.getByText(`Refer me or I'll tell everyone ${CHAT_MARK}-note`, { exact: true }).waitFor();
      const before = chat.lists;
      await page.waitForTimeout(2500);
      expectViews(chat, 4, "for the four Views");
      if (await page.getByRole("status").filter({ hasText: "e2e late refusal" }).count()) throw new Error("a refusal that landed late was said");
      if (chat.lists !== before) throw new Error("a refusal that landed late fetched the list again");
      await request.getByText(`Refer me or I'll tell everyone ${CHAT_MARK}-note`, { exact: true }).waitFor();
    } finally {
      await chat.stop();
    }
  });

  await step("a report that leaves the list takes its words with it, and they don't come back with the report", async () => {
    const chat = await scriptChatReports();
    try {
      await page.goto(SAMAJ + "/admin/chat-reports");
      const row = chatRow(MESSAGE_ROW);
      await row.getByRole("button", { name: "View messages", exact: true }).click();
      await row.getByText(`Answer me or else ${CHAT_MARK}-reported`, { exact: true }).waitFor();
      // Closed by another admin, which only the list's next answer shows: the app stays active and the screen in front.
      chat.dismissed.push(MESSAGE_REPORT);
      await refetchStale(chat, "with the report closed elsewhere");
      await page.getByText(new RegExp(`^${MESSAGE_ROW} · `)).waitFor({ state: "detached" });
      await noMarks("with the report gone from the list");
      // Back in the list, as when it was reopened or the list changed under it: closed, and not asked for by itself.
      chat.dismissed.length = 0;
      await refetchStale(chat, "with the report back");
      await row.getByRole("button", { name: "View messages", exact: true }).waitFor();
      if (await marks()) throw new Error("the words came back with the report");
      expectViews(chat, 1, "with the report gone and back");
    } finally {
      await chat.stop();
    }
  });

  await step("a note typed in the sheet goes with the words when the app goes to the background", async () => {
    const chat = await scriptChatReports();
    try {
      await page.goto(SAMAJ + "/admin/chat-reports");
      const row = chatRow(MESSAGE_ROW);
      await row.getByRole("button", { name: "View messages", exact: true }).click();
      await row.getByText(`Answer me or else ${CHAT_MARK}-reported`, { exact: true }).waitFor();
      const sheet = shown(page.getByRole("dialog", { name: "Remove this message?", exact: true }));
      const note = sheet.getByPlaceholder("Optional note");
      // A note quoting the message, cancelled: kept for the next try while the report stays open.
      await row.getByRole("button", { name: "Remove message", exact: true }).click();
      await note.fill(`He wrote ${CHAT_MARK}-quoted`);
      await sheet.getByRole("button", { name: "Cancel", exact: true }).click();
      await sheet.waitFor({ state: "hidden" });
      await row.getByRole("button", { name: "Remove message", exact: true }).click();
      if ((await note.inputValue()) !== `He wrote ${CHAT_MARK}-quoted`) throw new Error("Cancel lost the note while the report stayed open");
      await setAppVisible(false);
      try {
        await sheet.waitFor({ state: "hidden" });
        await noMarks("with the sheet open and the app in the background");
        if (await noteHeld()) throw new Error("the note stayed in the page with the app in the background");
      } finally {
        await setAppVisible(true);
      }
      // Seeing the words again is another View, and its sheet starts with no note.
      await row.getByRole("button", { name: "View messages", exact: true }).click();
      await row.getByText(`Answer me or else ${CHAT_MARK}-reported`, { exact: true }).waitFor();
      await row.getByRole("button", { name: "Remove message", exact: true }).click();
      if ((await note.inputValue()) !== "") throw new Error(`the note came back with the next View: "${await note.inputValue()}"`);
      await sheet.getByRole("button", { name: "Cancel", exact: true }).click();
      await sheet.waitFor({ state: "hidden" });
      await row.getByRole("button", { name: "Hide", exact: true }).click();
      await noMarks("after Hide");
      expectViews(chat, 2, "for two Views");
    } finally {
      await chat.stop();
    }
  });

  await step("Remove message answered as already handled closes the sheet, says so and fetches the list again, the words gone", async () => {
    const chat = await scriptChatReports();
    const resolveUrl = /\/api\/v1\/t\/shri-gujarati-samaj\/admin\/chat-reports\/[^/]+\/resolve$/;
    const sent = [];
    await page.route(resolveUrl, (route) => {
      sent.push(route.request().postDataJSON());
      return answer(route, 409, { error: { code: "INVALID_TRANSITION", message: "This report has already been handled" } });
    });
    try {
      await page.goto(SAMAJ + "/admin/chat-reports");
      const row = chatRow(MESSAGE_ROW);
      await row.getByRole("button", { name: "View messages", exact: true }).click();
      await row.getByText(`Answer me or else ${CHAT_MARK}-reported`, { exact: true }).waitFor();
      await row.getByRole("button", { name: "Remove message", exact: true }).click();
      const sheet = shown(page.getByRole("dialog", { name: "Remove this message?", exact: true }));
      await sheet.getByText("Everyone in the thread sees that it was removed. The sender is notified and sees your note in the app. All open reports on it are resolved.", { exact: true }).waitFor();
      await sheet.getByPlaceholder("Optional note").fill("Threatening another member");
      const lists = chat.lists;
      await sheet.getByRole("button", { name: "Remove", exact: true }).click();
      await sheet.waitFor({ state: "hidden" });
      await statusSays("This report has already been handled").waitFor();
      for (let i = 0; i < 50 && chat.lists === lists; i++) await page.waitForTimeout(100);
      if (chat.lists === lists) throw new Error("the list wasn't fetched again after the refusal");
      if (sent.length !== 1 || sent[0].action !== "REMOVE_MESSAGE" || sent[0].note !== "Threatening another member") throw new Error(`Remove sent ${JSON.stringify(sent)}`);
      await noMarks("after the refusal");
      await row.getByRole("button", { name: "View messages", exact: true }).waitFor();
    } finally {
      await page.unroute(resolveUrl);
      await chat.stop();
    }
  });

  await step("Remove message failing after the app went to the background, which took the sheet, says so on the screen", async () => {
    const chat = await scriptChatReports();
    const resolveUrl = /\/api\/v1\/t\/shri-gujarati-samaj\/admin\/chat-reports\/[^/]+\/resolve$/;
    let asked = 0;
    let release = () => {};
    const held = new Promise((resolve) => (release = resolve));
    await page.route(resolveUrl, async (route) => {
      asked += 1;
      await held;
      return answer(route, 500, { error: { code: "INTERNAL", message: "e2e INTERNAL" } });
    });
    try {
      await page.goto(SAMAJ + "/admin/chat-reports");
      const row = chatRow(MESSAGE_ROW);
      await row.getByRole("button", { name: "View messages", exact: true }).click();
      await row.getByText(`Answer me or else ${CHAT_MARK}-reported`, { exact: true }).waitFor();
      await row.getByRole("button", { name: "Remove message", exact: true }).click();
      const sheet = shown(page.getByRole("dialog", { name: "Remove this message?", exact: true }));
      await sheet.getByPlaceholder("Optional note").fill("Threatening another member");
      await sheet.getByRole("button", { name: "Remove", exact: true }).click();
      for (let i = 0; i < 50 && !asked; i++) await page.waitForTimeout(100);
      if (!asked) throw new Error("Remove sent nothing");
      // On its way when the app goes to the background, which takes the words and the sheet with its note.
      await setAppVisible(false);
      try {
        await sheet.waitFor({ state: "hidden" });
        await noMarks("with Remove on its way and the app in the background");
      } finally {
        await setAppVisible(true);
      }
      release();
      await statusSays("The report wasn't resolved: e2e INTERNAL").waitFor();
      await row.getByRole("button", { name: "View messages", exact: true }).waitFor();
    } finally {
      release();
      await page.unroute(resolveUrl);
      await chat.stop();
    }
  });

  await step("Dismiss sends its note, says so, and the report leaves the list", async () => {
    const chat = await scriptChatReports();
    try {
      await page.goto(SAMAJ + "/admin/chat-reports");
      const request = chatRow(REQUEST_ROW);
      await request.getByRole("button", { name: "View request", exact: true }).click();
      await request.getByText(`Refer me or I'll tell everyone ${CHAT_MARK}-note`, { exact: true }).waitFor();
      await request.getByRole("button", { name: "Dismiss", exact: true }).click();
      const sheet = shown(page.getByRole("dialog", { name: "Dismiss this report", exact: true }));
      await sheet.getByPlaceholder("Optional note").fill("A misunderstanding, sorted out");
      await sheet.getByRole("button", { name: "Dismiss", exact: true }).click();
      await sheet.waitFor({ state: "hidden" });
      await statusSays("Report dismissed").waitFor();
      if (chat.dismissed.join() !== REQUEST_REPORT || chat.dismissBody?.note !== "A misunderstanding, sorted out") throw new Error(`Dismiss sent ${JSON.stringify(chat.dismissBody)} for ${chat.dismissed.join()}`);
      await page.getByText(new RegExp(`^${REQUEST_ROW} · `)).waitFor({ state: "detached" });
      await noMarks("after the dismissal");
      await shown(page.getByRole("tab", { name: /^Open\s*1$/ })).waitFor();
    } finally {
      await chat.stop();
    }
  });

  await step("a chat report notice opens the open chat reports scrolled to its report, and never opens it", async () => {
    const chat = await scriptChatReports();
    chat.many = true;
    const notice = await scriptNotification(page, "shri-gujarati-samaj", { type: "CHAT_REPORT_FILED", data: { chatReportId: MESSAGE_REPORT }, title: "A message was reported" });
    try {
      await page.goto(SAMAJ + "/profile/notifications");
      await page.getByText("A message was reported", { exact: true }).click();
      await page.waitForURL(`**/t/shri-gujarati-samaj/admin/chat-reports?status=OPEN&item=${MESSAGE_REPORT}`);
      // Twelfth in the list, well below the fold until the screen scrolls to it.
      const view = chatRow(MESSAGE_ROW).getByRole("button", { name: "View messages", exact: true });
      let box = null;
      for (let i = 0; i < 50; i++) {
        box = await view.boundingBox().catch(() => null);
        if (box && box.y >= 0 && box.y + box.height <= 844) break;
        await page.waitForTimeout(100);
      }
      if (!box || box.y < 0 || box.y + box.height > 844) throw new Error(`the linked report's View is at ${JSON.stringify(box)}, not on screen`);
      await page.waitForTimeout(1000);
      expectViews(chat, 0, "from a notice");
      if (await marks()) throw new Error("a notice opened the reported words");

      // Opened at the foot of the screen, its words would reach below it: the row's top is scrolled up into view, with
      // everything down to Hide on screen.
      await view.evaluate((el) => el.scrollIntoView({ block: "end" }));
      await page.waitForTimeout(300);
      await view.click();
      const row = chatRow(MESSAGE_ROW);
      const hide = row.getByRole("button", { name: "Hide", exact: true });
      await hide.waitFor();
      expectViews(chat, 1, "for one View");
      const tabs = await shown(page.getByRole("tablist")).boundingBox();
      const headline = row.getByText(new RegExp(`^${MESSAGE_ROW} · `));
      let boxes = null;
      for (let i = 0; i < 30; i++) {
        boxes = { headline: await headline.boundingBox(), hide: await hide.boundingBox() };
        if (boxes.headline && boxes.hide && boxes.headline.y >= tabs.y + tabs.height - 1 && boxes.hide.y + boxes.hide.height <= 844) break;
        await page.waitForTimeout(100);
      }
      if (!(boxes.headline && boxes.hide && boxes.headline.y >= tabs.y + tabs.height - 1 && boxes.hide.y + boxes.hide.height <= 844)) throw new Error(`the opened report wasn't scrolled into view: ${JSON.stringify(boxes)}, the tabs ending at ${tabs.y + tabs.height}`);
      await hide.click();
      await noMarks("after Hide");
      await backButton().click();
      await page.waitForURL("**/t/shri-gujarati-samaj/profile/notifications");
    } finally {
      await notice.stop();
      await chat.stop();
    }
  });

  // Announce in the phone's composer, as the Samaj admin. The Samaj's plan includes no messaging, so nothing is billed;
  // the sheet for billed channels is checked on ones the script offers, with the post answered by the script too. The
  // announcement is unpinned at the end, leaving the Samaj's pinned strip as seeded.
  const ANNOUNCEMENT = `Samaj AGM ${unique}: Sunday at 10am, at the community hall.`;
  const audienceUrl = /\/api\/v1\/t\/shri-gujarati-samaj\/admin\/announcements\/audience$/;
  const postsUrl = /\/api\/v1\/t\/shri-gujarati-samaj\/posts$/;
  const feedCard = (text) =>
    page
      .locator("div")
      .filter({ has: page.getByText(text, { exact: true }) })
      .filter({ has: page.getByRole("button", { name: /^\d+ comments$/ }) })
      .locator("visible=true")
      .last();
  let phonePost = null;

  await step("platform staff who are only members of the Samaj aren't offered Announce, which the API refuses them, though the app counts them as admins", async () => {
    // Staff (isPlatformAdmin) with a member's role here, both from the API's own answers: isTenantAdmin is true for them,
    // and the post form must still go by the role.
    const meUrl = "**/api/v1/me";
    const membershipUrl = "**/api/v1/t/shri-gujarati-samaj/memberships/me";
    let asMember = false;
    await page.route(meUrl, async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      const response = await route.fetch();
      const { data } = await response.json();
      return route.fulfill({ response, json: { data: { ...data, user: { ...data.user, isPlatformAdmin: true } } } });
    });
    await page.route(membershipUrl, async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      const response = await route.fetch();
      asMember = true;
      return route.fulfill({ response, json: { data: { ...(await response.json()).data, role: "MEMBER" } } });
    });
    try {
      const staff = page.waitForResponse((r) => r.request().method() === "GET" && /\/api\/v1\/me$/.test(r.url()));
      await page.goto(SAMAJ + "/feed/new");
      await shown(page.getByLabel("Post text", { exact: true })).waitFor();
      await staff;
      if (!asMember) throw new Error("the membership wasn't answered with a member's role");
      // The note members get goes once the app knows they're staff: it counts them as admins here.
      await page
        .getByText("Posts are subject to this institution's moderation settings.", { exact: true })
        .locator("visible=true")
        .waitFor({ state: "hidden", timeout: 10_000 })
        .catch(() => {
          throw new Error("the post form never treated platform staff as admins, so this step proves nothing");
        });
      await shown(page.getByRole("button", { name: "Add a poll", exact: true })).waitFor();
      if (await page.getByRole("button", { name: /^(Announce|Undo announce)$/ }).count()) throw new Error("platform staff who are only members are offered Announce");
    } finally {
      await page.unroute(meUrl);
      await page.unroute(membershipUrl);
    }
  });

  await step("the admin announces from the phone's composer, with Pin and no channels to choose, sent with no sheet, and the feed shows it first, pinned and marked", async () => {
    const asked = [];
    const onRequest = (r) => audienceUrl.test(r.url()) && asked.push(r.url());
    page.on("request", onRequest);
    try {
      await page.goto(SAMAJ + "/feed");
      await shown(page.getByRole("button", { name: "New post", exact: true })).click();
      await page.waitForURL("**/t/shri-gujarati-samaj/feed/new");
      const announce = shown(page.getByRole("button", { name: "Announce", exact: true }));
      await announce.waitFor();
      await expectSvgNoEmoji(announce, "the post form's Announce button");
      if ((await announce.getAttribute("aria-pressed")) !== "false") throw new Error("Announce starts pressed");
      await shown(page.getByLabel("Post text", { exact: true })).fill(ANNOUNCEMENT);
      if (asked.length) throw new Error("the post form asked who an announcement would reach before Announce was pressed");
      const reached = page.waitForResponse((r) => audienceUrl.test(r.url()));
      await announce.click();
      const audience = (await (await reached).json()).data;
      if (audience.channels.length) throw new Error(`the Samaj's plan offers ${audience.channels.join(", ")} for announcements`);
      const undo = shown(page.getByRole("button", { name: "Undo announce", exact: true }));
      if ((await undo.getAttribute("aria-pressed")) !== "true") throw new Error("Announce, once pressed, doesn't say it's on");
      await shown(page.getByText(`Every member (${audience.members}) gets it in the app and as a push notification.`, { exact: true })).waitFor();
      await shown(page.getByText("Your plan doesn't include email, WhatsApp or SMS announcements.", { exact: true })).waitFor();
      if (await page.getByRole("checkbox", { name: /^Also / }).count()) throw new Error("the post form offers a channel the Samaj's plan doesn't include");
      const pin = shown(page.getByRole("checkbox", { name: "Pin to the top of the feed", exact: true }));
      if ((await pin.getAttribute("aria-checked")) !== "true") throw new Error("Pin isn't on to start with");
      await pin.click();
      if ((await pin.getAttribute("aria-checked")) !== "false") throw new Error("Pin didn't turn off");
      await pin.click();
      if ((await pin.getAttribute("aria-checked")) !== "true") throw new Error("Pin didn't turn on again");
      await fitsPhone("the post form with Announce on", pin);
      await shot("m19-announce-composer");

      const posted = page.waitForResponse((r) => r.request().method() === "POST" && postsUrl.test(r.url()));
      await shown(page.getByRole("button", { name: "Post announcement", exact: true })).click();
      const res = await posted;
      const sent = res.request().postDataJSON().announcement;
      if (sent?.pin !== true || JSON.stringify(sent.channels) !== "[]") throw new Error(`the post sent the announcement ${JSON.stringify(sent)}, expected pinned with no channels`);
      if (res.status() !== 201) throw new Error(`posting the announcement answered ${res.status()}`);
      const post = (await res.json()).data;
      if (post.kind !== "ANNOUNCEMENT" || !post.isPinned) throw new Error(`the post was saved as ${post.kind}, ${post.isPinned ? "pinned" : "not pinned"}`);
      phonePost = post;
    } finally {
      page.off("request", onRequest);
    }
    // Nothing billed, so nothing asked: straight back to the feed.
    await page.waitForURL("**/t/shri-gujarati-samaj/feed");
    if (await page.getByRole("alertdialog").locator("visible=true").count()) throw new Error("posting with no channels asked first");
    const card = feedCard(ANNOUNCEMENT);
    await card.waitFor();
    for (const label of ["Announcement", "Pinned"]) await expectSvgNoEmoji(card.getByText(label, { exact: true }).locator(".."), `the announcement's ${label} badge`);
    // First on the feed, above the Samaj's own pinned welcome: the newest pinned post leads.
    const ours = await shown(page.getByText(ANNOUNCEMENT, { exact: true })).boundingBox();
    const welcome = await shown(page.getByText(/^Welcome to the Shri Gujarati Samaj member network!/)).boundingBox();
    if (!ours || !welcome || ours.y >= welcome.y) throw new Error("the announcement isn't first on the feed, above the pinned welcome");
    await shot("m19b-announcement-feed");
  });

  await step("on a plan with WhatsApp and email (offered by the script), a billed announcement asks first in a sheet with how many it reaches, in what order and who pays; Cancel sends nothing, and Post and send sends it as chosen", async () => {
    // The API would refuse these channels for the Samaj, so the script answers the audience and the post itself: nothing
    // is billed or stored.
    await page.route(audienceUrl, (route) => (route.request().method() === "GET" ? answer(route, 200, { data: { members: 7, withEmail: 3, withPhone: 7, channels: ["WHATSAPP", "EMAIL"] } }) : route.fallback()));
    const text = `Billed ${ANNOUNCEMENT}`;
    const sent = [];
    await page.route(postsUrl, (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      sent.push(route.request().postDataJSON());
      return answer(route, 201, { data: { ...phonePost, id: "00000000-0000-4000-8000-00000000ac10", body: text } });
    });
    try {
      // Opened afresh, so the audience is asked for again rather than taken from the cache.
      await page.goto(SAMAJ + "/feed");
      await shown(page.getByRole("button", { name: "New post", exact: true })).click();
      await page.waitForURL("**/t/shri-gujarati-samaj/feed/new");
      await shown(page.getByLabel("Post text", { exact: true })).fill(text);
      await shown(page.getByRole("button", { name: "Announce", exact: true })).click();
      const whatsapp = shown(page.getByRole("checkbox", { name: "Also send by WhatsApp (7 members)", exact: true }));
      const email = shown(page.getByRole("checkbox", { name: "Also email it (3 members with a confirmed email)", exact: true }));
      await whatsapp.waitFor();
      // Two channels are a chain, not a message each.
      await shown(page.getByText("If you tick more than one, each member still gets one message: by the first of them, in the order listed, that can be sent.", { exact: true })).waitFor();
      await email.click();
      if ((await email.getAttribute("aria-checked")) !== "true") throw new Error("the email box didn't tick");
      await shown(page.getByRole("button", { name: "Post announcement", exact: true })).click();
      const byEmail = shown(page.getByRole("alertdialog", { name: "Send this announcement by email?", exact: true }));
      await byEmail.getByText("It goes by email to 3 members. Messages are billed to your institution.", { exact: true }).waitFor();
      await byEmail.getByRole("button", { name: "Post and send", exact: true }).waitFor();
      await shot("m19c-announce-billed");
      await byEmail.getByRole("button", { name: "Cancel", exact: true }).click();
      await byEmail.waitFor({ state: "hidden" });
      if (sent.length) throw new Error("Cancel still sent the announcement");
      if ((await shown(page.getByLabel("Post text", { exact: true })).inputValue()) !== text) throw new Error("Cancel cleared the post's text");

      // Both: each member once, by WhatsApp, and by email only when that can't be sent.
      await whatsapp.click();
      if ((await whatsapp.getAttribute("aria-checked")) !== "true") throw new Error("the WhatsApp box didn't tick");
      await shown(page.getByRole("button", { name: "Post announcement", exact: true })).click();
      const byBoth = shown(page.getByRole("alertdialog", { name: "Send this announcement by WhatsApp or email?", exact: true }));
      await byBoth.getByText("It goes to 7 members, one message each: by WhatsApp, or when that can't be sent, by email. Messages are billed to your institution.", { exact: true }).waitFor();
      if (sent.length) throw new Error("the announcement was sent before Post and send");
      await byBoth.getByRole("button", { name: "Post and send", exact: true }).click();
      await page.waitForURL("**/t/shri-gujarati-samaj/feed");
      await byBoth.waitFor({ state: "hidden" });
      if (sent.length !== 1) throw new Error(`Post and send sent ${sent.length} posts`);
      const [{ body, announcement }] = sent;
      if (body !== text) throw new Error(`Post and send sent "${body}"`);
      if (announcement?.pin !== true || [...(announcement.channels ?? [])].sort().join() !== "EMAIL,WHATSAPP") throw new Error(`Post and send sent the announcement ${JSON.stringify(announcement)}, expected pinned by WhatsApp and email`);
    } finally {
      await page.unroute(postsUrl);
      await page.unroute(audienceUrl);
    }
  });

  await step("the console's queue lists the phone's announcement as one, and Unpin there takes it off the pinned strip while it stays an announcement", async () => {
    await page.goto(SAMAJ + "/admin/moderation?status=APPROVED&type=POST");
    const row = queueRow(ANNOUNCEMENT);
    for (const label of ["Announcement", "Pinned"]) await row.getByText(label, { exact: true }).waitFor();
    await row.getByRole("button", { name: "Unpin", exact: true }).click();
    await row.getByRole("status").filter({ hasText: "Unpinned" }).waitFor();
    await page.goto(SAMAJ + "/feed");
    const card = feedCard(ANNOUNCEMENT);
    await card.getByText("Announcement", { exact: true }).waitFor();
    if (await card.getByText("Pinned", { exact: true }).count()) throw new Error("the announcement still shows as pinned after Unpin");
  });

  // Invitations, as the Samaj admin: the Samaj has none and its plan sends nothing, so anything sent is answered by the
  // script and nothing is billed.
  const invitePhones = [`76${unique.slice(0, 6)}21`, `76${unique.slice(0, 6)}22`];
  const invitationRow = (name) => shown(page.getByRole("article").filter({ hasText: name }));

  await step("the console's invitations: the template with its BOM, a CSV imported through the file chooser, a link copied, WhatsApp, a search, and Revoke after asking", async () => {
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
    await page.goto(SAMAJ + "/admin");
    await shown(page.getByRole("link", { name: "Invitations", exact: true })).click();
    await page.waitForURL("**/t/shri-gujarati-samaj/admin/invitations");
    await shown(page.getByText("No invitations here", { exact: true })).waitFor();
    // Nothing to send by: no figure for today, no Send pending, and the links are shared by hand.
    await shown(page.getByLabel("Can send today, none", { exact: true })).waitFor();
    await shown(page.getByText("Your plan doesn't include WhatsApp, SMS or email messages: copy an invitation's link or share it on WhatsApp from your own phone.", { exact: true })).waitFor();
    if (await page.getByRole("button", { name: /^Send \d+ pending$/ }).locator("visible=true").count()) throw new Error("Send pending shows on a plan that sends nothing");
    await fitsPhone("the invitations list", shown(page.getByText("No invitations here", { exact: true })));

    // The import, a modal above the list. Its buttons wait for the profile questions, whose keys are columns too.
    await shown(page.getByRole("link", { name: "Import a list", exact: true })).click();
    await page.waitForURL("**/t/shri-gujarati-samaj/admin/invitations/import");
    const template = memberButton("Template");
    await expectSvgNoEmoji(template, "the import's Template button");
    const [saved] = await Promise.all([page.waitForEvent("download"), template.click()]);
    if (saved.suggestedFilename() !== "invitations-template.csv") throw new Error(`the template downloads as ${saved.suggestedFilename()}`);
    const templateText = readFileSync(await saved.path(), "utf8");
    if (templateText.charCodeAt(0) !== 0xfeff) throw new Error("the template has no byte order mark, so Excel would garble names");
    if (!templateText.slice(1).startsWith("phone,name,start_year,end_year,email,chapter,interests")) throw new Error(`the template starts "${templateText.slice(1, 60)}"`);
    if (!templateText.includes("\r\n+919876543210,")) throw new Error("the template's example phone is guarded as a formula");
    // A community's example still belongs: no end year.
    if (!templateText.includes("\r\n+919876543210,Asha Rao,2008,,asha@example.com,")) throw new Error(`the template's example row is "${templateText.split("\r\n")[1]}"`);
    await shown(page.getByText("A CSV with a phone column, and optionally name, start year, end year (blank for someone who still belongs), email and your profile field keys. Numbers without a country code use your institution's country.", { exact: true })).waitFor();

    const csv = `Phone,Name,Member Since,Until,Chapter,Notes\r\n+91${invitePhones[0]},Mitesh Shah,2015,,surat,met at Garba\r\n+91${invitePhones[1]},Komal Desai,2009,2016,surat,\r\n`;
    const [chooser] = await Promise.all([page.waitForEvent("filechooser"), memberButton("Choose CSV file").click()]);
    await chooser.setFiles({ name: "invites.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
    await shown(page.getByText("invites.csv: 2 rows. Using phone, name, start year, end year, Chapter.", { exact: true })).waitFor();
    await shown(page.getByText("Ignoring: notes.", { exact: true })).waitFor();
    await shown(page.getByText("Mitesh Shah · From 2015", { exact: true })).waitFor();
    await shown(page.getByText("Komal Desai · 2009–2016", { exact: true })).waitFor();
    const sendNow = shown(page.getByRole("checkbox", { name: "Sending isn't included in your plan; you'll share the links yourself", exact: true }));
    if ((await sendNow.getAttribute("aria-disabled")) !== "true") throw new Error("Send now can be chosen on a plan that sends nothing");
    // While the import runs (the script holds its request), it counts up and Back leaves the screen where it is.
    const importUrl = "**/api/v1/t/shri-gujarati-samaj/admin/invitations/import";
    let release;
    const held = new Promise((resolve) => (release = resolve));
    await page.route(importUrl, async (route) => {
      if (route.request().method() === "POST") await held;
      await route.fallback();
    });
    try {
      await memberButton("Import 2 rows").click();
      await memberButton("Importing 0 of 2…").waitFor();
      await shown(page.getByText("Keep this screen open until the import finishes.", { exact: true })).waitFor();
      await backButton().click();
      // Give a Back that went through the time to leave.
      await page.waitForTimeout(500);
      if (!new URL(page.url()).pathname.endsWith("/admin/invitations/import")) throw new Error(`Back left the import while it ran, for ${page.url()}`);
      await shown(page.getByText("Keep this screen open until the import finishes.", { exact: true })).waitFor();
    } finally {
      release();
    }
    await statusSays("2 new, 0 updated, 0 skipped.").waitFor();
    // Only once the request is answered: a handler still waiting would find its route gone.
    await page.unroute(importUrl);
    await fitsPhone("the import", shown(page.getByText("2 new, 0 updated, 0 skipped.", { exact: true })));
    await shot("m19a-invitations-import");
    await memberButton("Done").click();
    await page.waitForURL((url) => url.pathname.endsWith("/t/shri-gujarati-samaj/admin/invitations"));
    await statusSays("2 invited, 0 updated").waitFor();
    for (const name of ["Mitesh Shah", "Komal Desai"]) await invitationRow(name).getByText("Not sent", { exact: true }).waitFor();
    await invitationRow("Mitesh Shah").getByText(/ · From 2015$/).waitFor();
    await invitationRow("Komal Desai").getByText(/ · 2009–2016$/).waitFor();

    // Copy link, read back from the clipboard.
    await memberButton("Copy link for Mitesh Shah").click();
    await invitationRow("Mitesh Shah").getByText("Link copied", { exact: true }).waitFor();
    const link = await page.evaluate(() => navigator.clipboard.readText());
    if (!/\/i\/[\w-]+$/.test(link)) throw new Error(`the copied invite link is "${link}"`);

    // WhatsApp opens its chat with the number and the message, in a new tab on the web build (answered by the script).
    const context = page.context();
    await context.route("https://wa.me/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<title>WhatsApp</title>" }));
    try {
      const [chat] = await Promise.all([context.waitForEvent("page"), memberButton("Share on WhatsApp with Mitesh Shah").click()]);
      await chat.waitForURL(/^https:\/\/wa\.me\//);
      const url = chat.url();
      await chat.close();
      if (!url.startsWith(`https://wa.me/91${invitePhones[0]}?text=`) || !url.includes("Shri%20Gujarati%20Samaj") || !url.includes(encodeURIComponent(link))) throw new Error(`WhatsApp opened ${url}`);
    } finally {
      await context.unroute("https://wa.me/**");
    }
    await shot("m19b-invitations");

    // The search, kept in the address.
    const search = shown(page.getByLabel("Search invitations", { exact: true }));
    await search.fill("Mitesh");
    await page.waitForURL(/[?&]q=Mitesh/);
    await page.waitForFunction(() => [...document.querySelectorAll('[role="button"][aria-label^="Revoke the invitation for "]')].filter((b) => b.getBoundingClientRect().height > 0).length === 1);
    await memberButton("Revoke the invitation for Mitesh Shah").waitFor();
    await memberButton("Clear search").click();
    await memberButton("Revoke the invitation for Komal Desai").waitFor();

    // Revoke asks first; Cancel keeps it.
    const revoke = memberButton("Revoke the invitation for Komal Desai");
    const sheet = shown(page.getByRole("alertdialog", { name: "Revoke the invitation for Komal Desai?", exact: true }));
    await revoke.click();
    await sheet.getByText("The link stops working.", { exact: true }).waitFor();
    await sheet.getByRole("button", { name: "Cancel", exact: true }).click();
    await sheet.waitFor({ state: "hidden" });
    await invitationRow("Komal Desai").getByText("Not sent", { exact: true }).waitFor();
    await revoke.click();
    await Promise.all([page.waitForResponse((r) => r.request().method() === "POST" && /\/admin\/invitations\/[^/]+\/revoke$/.test(r.url())), sheet.getByRole("button", { name: "Revoke", exact: true }).click()]);
    await sheet.waitFor({ state: "hidden" });
    await invitationRow("Komal Desai").getByText("Invitation revoked", { exact: true }).waitFor();
    await invitationRow("Komal Desai").getByText("Revoked", { exact: true }).waitFor();

    // The Revoked tab lists it, and a reload keeps the tab.
    await memberTab("Revoked").click();
    await page.waitForURL(/[?&]status=REVOKED/);
    await invitationRow("Komal Desai").waitFor();
    await page.reload();
    await page.waitForURL(/[?&]status=REVOKED/);
    if ((await memberTab("Revoked").getAttribute("aria-selected")) !== "true") throw new Error("a reload lost the Revoked tab");
    await invitationRow("Komal Desai").getByText("Revoked", { exact: true }).waitFor();
    if (await page.getByText("Mitesh Shah", { exact: true }).locator("visible=true").count()) throw new Error("the Revoked tab lists an invitation that isn't revoked");
  });

  await step("on a plan that sends (answered by the script), Send pending asks first, saying it's billed, and a row's Send says it went", async () => {
    const summaryUrl = "**/api/v1/t/shri-gujarati-samaj/admin/invitations/summary";
    const sendUrl = /\/api\/v1\/t\/shri-gujarati-samaj\/admin\/invitations\/(send|send-pending)$/;
    let over = false;
    await page.route(summaryUrl, async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      try {
        const response = await route.fetch();
        await route.fulfill({ response, json: { data: { ...(await response.json()).data, channels: ["WHATSAPP"] } } });
      } catch (err) {
        // A refetch the last Send started can still be on its way when the step ends and unroutes it: Playwright has
        // passed it on by then, and nothing is left to answer.
        if (!over) throw err;
      }
    });
    // The first Send pending is refused, as for a plan that stopped sending since the list was loaded.
    const refused = "Your plan doesn't include WhatsApp, SMS or email messages. Copy or share the invite links instead.";
    const sent = [];
    await page.route(sendUrl, (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      const what = new URL(route.request().url()).pathname.split("/").pop();
      sent.push(what);
      if (what === "send-pending" && sent.length === 1) return answer(route, 409, { error: { code: "CONFLICT", message: refused } });
      return answer(route, 200, { data: { queued: 1, skipped: 0 } });
    });
    try {
      await page.goto(SAMAJ + "/admin/invitations");
      await shown(page.getByText("Your plan sends invitations by WhatsApp. Each invitation can be resent once a day.", { exact: true })).waitFor();
      await memberButton("Send 1 pending").click();
      const sheet = shown(page.getByRole("alertdialog", { name: "Send 1 invitation?", exact: true }));
      await sheet.getByText(/^By WhatsApp\. Messages are billed per delivery; up to [\d,]+ more can go today\.$/).waitFor();
      await sheet.getByRole("button", { name: "Cancel", exact: true }).click();
      await sheet.waitFor({ state: "hidden" });
      if (sent.length) throw new Error(`Cancel still sent ${sent.join(", ")}`);
      // Refused: the question no longer stands, so the sheet closes and the list says why.
      await memberButton("Send 1 pending").click();
      await sheet.getByRole("button", { name: "Send", exact: true }).click();
      await sheet.waitFor({ state: "hidden" });
      await statusSays(refused).waitFor();
      await memberButton("Send 1 pending").click();
      await sheet.getByRole("button", { name: "Send", exact: true }).click();
      await sheet.waitFor({ state: "hidden" });
      await statusSays("Sending 1 invitation").waitFor();
      await memberButton("Send to Mitesh Shah").click();
      await invitationRow("Mitesh Shah").getByText("Invitation sent", { exact: true }).waitFor();
      if (sent.join() !== "send-pending,send-pending,send") throw new Error(`sent ${sent.join(", ")}`);
    } finally {
      over = true;
      await page.unroute(summaryUrl);
      await page.unroute(sendUrl);
    }
  });

  await step("the console's analytics: the headline figures' changes, a chart stepped from the keyboard, 26 weeks in the address with the old charts up while it loads, a chart's table with a row a week and whole headers, the invitations funnel, and the members CSV with its BOM, one export at a time", async () => {
    // The 12 weeks' headline figures with the period before scripted, so each direction shows (the seed may have none).
    const twelveUrl = "**/api/v1/t/shri-gujarati-samaj/admin/analytics?weeks=12";
    await page.route(twelveUrl, async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      body.data.kpis = { ...body.data.kpis, newMembers: 12, newMembersPrev: 10, activeMembers: 6, activeMembersPrev: 8, posts: 4, postsPrev: 4 };
      await route.fulfill({ response, json: body });
    });
    await page.goto(SAMAJ + "/admin");
    await shown(page.getByRole("link", { name: "Analytics", exact: true })).click();
    await page.waitForURL((url) => url.pathname.endsWith("/t/shri-gujarati-samaj/admin/analytics"));
    const newMembers = shown(page.getByRole("slider", { name: /^New members per week, \d+ in total$/ }));
    await newMembers.waitFor();
    await shown(page.getByRole("heading", { name: "Who your members are", exact: true })).waitFor();
    if ((await memberButton("Last 12 weeks").getAttribute("aria-pressed")) !== "true") throw new Error("Analytics doesn't open on the last 12 weeks");
    await shown(page.getByText(/previous 12 weeks/)).waitFor();
    await expectSvgNoEmoji(memberButton("Members CSV"), "the Members CSV button");
    // Each compared tile is named with its change, not only hinted (hints can be off, and the web build has none), and
    // draws its direction as an SVG arrow beside the words, never a text arrow.
    for (const [label, change] of [
      ["New members, 12", "+20% vs the previous 12 weeks (10)"],
      ["Active members, 6", "-25% vs the previous 12 weeks (8)"],
      ["Posts, 4", "0% vs the previous 12 weeks (4)"],
    ]) {
      const tile = shown(page.locator(`[aria-label="${label}. ${change}"]`));
      await tile.waitFor();
      await expectSvgNoEmoji(tile, `the "${label}" tile`);
      const text = await tile.innerText();
      if (!text.includes(change) || /[\u2190-\u21ff\u2b00-\u2bff]/.test(text)) throw new Error(`the "${label}" tile shows "${text}"`);
    }
    await page.unroute(twelveUrl);

    // An adjustable chart: its value is the chosen week's readout, the latest until another is chosen, and the arrow keys
    // step through the weeks (as a screen reader's swipes do on a phone).
    const week = /^Week of \d{1,2} [A-Z][a-z]{2} \d{4}, [\d,]+ approved$/;
    const latest = await newMembers.getAttribute("aria-valuetext");
    if (!week.test(latest ?? "")) throw new Error(`the New members chart's value is "${latest}"`);
    await newMembers.focus();
    await page.keyboard.press("ArrowLeft");
    await page.waitForFunction(
      (was) => [...document.querySelectorAll('[role="slider"][aria-label^="New members per week"]')].some((el) => el.getBoundingClientRect().height > 0 && el.getAttribute("aria-valuetext") !== was),
      latest,
    );
    const earlier = await newMembers.getAttribute("aria-valuetext");
    if (!week.test(earlier ?? "")) throw new Error(`after ArrowLeft the New members chart's value is "${earlier}"`);

    // Six months, in the address and asked of the API, with the 12 weeks' charts kept up (and said to be updating) while
    // the script holds the answer.
    const rangeUrl = "**/api/v1/t/shri-gujarati-samaj/admin/analytics?weeks=26";
    let release;
    const held = new Promise((resolve) => (release = resolve));
    await page.route(rangeUrl, async (route) => {
      await held;
      await route.fallback();
    });
    try {
      const asked = page.waitForRequest((r) => r.method() === "GET" && /\/t\/shri-gujarati-samaj\/admin\/analytics\?weeks=26$/.test(r.url()));
      await memberButton("Last 6 months").click();
      await asked;
      await page.waitForURL(/[?&]weeks=26/);
      await statusSays("Updating…").waitFor();
      await newMembers.waitFor();
    } finally {
      release();
    }
    await shown(page.getByText(/previous 6 months/)).waitFor();
    // Only once the request is answered: a handler still waiting would find its route gone.
    await page.unroute(rangeUrl);
    if (await page.getByRole("status").filter({ hasText: "Updating…" }).locator("visible=true").count()) throw new Error(`"Updating…" stays once the new period has loaded`);
    if ((await memberButton("Last 6 months").getAttribute("aria-pressed")) !== "true") throw new Error("Last 6 months isn't chosen");

    // A chart's table: the switch keeps its name and says it's on, and lists a row a week under its header.
    const tableSwitch = (title) =>
      shown(page.locator("div").filter({ has: page.getByRole("heading", { name: title, exact: true }) }).filter({ has: page.getByRole("button", { name: "Table", exact: true }) })).getByRole("button", { name: "Table", exact: true });
    await tableSwitch("New members per week").click();
    if ((await tableSwitch("New members per week").getAttribute("aria-pressed")) !== "true") throw new Error("the Table switch doesn't say it's on");
    const weeks = shown(page.getByRole("table", { name: "New members per week", exact: true }));
    await weeks.getByRole("row").first().waitFor();
    const rows = await weeks.getByRole("row").count();
    if (rows !== 27) throw new Error(`the New members table has ${rows} rows, expected 27 (a header and 26 weeks)`);
    if (await page.getByRole("slider", { name: /^New members per week/ }).locator("visible=true").count()) throw new Error("the New members chart still shows beside its table");
    // The two the invitations step imported, one since revoked.
    await tableSwitch("Invitations").click();
    // A table draws once its columns are measured, a frame after the switch is pressed.
    const importedRow = shown(page.getByRole("table", { name: "Invitations", exact: true })).getByRole("row").filter({ hasText: "Imported" });
    await importedRow.waitFor();
    const imported = await importedRow.getByRole("cell").allInnerTexts();
    if (imported.map((c) => c.trim()).join() !== "Imported,2") throw new Error(`the invitations funnel says ${imported.join(" ")}`);
    // Activity's five columns on a phone: each header whole on one line (as tall as the others), and every row's figures
    // right under their header.
    await tableSwitch("Activity per week").click();
    const activity = shown(page.getByRole("table", { name: "Activity per week", exact: true }));
    await activity.getByRole("row").nth(1).waitFor();
    const heads = await activity.getByRole("columnheader").evaluateAll((els) => els.map((el) => ({ text: el.textContent, height: el.getBoundingClientRect().height, right: el.getBoundingClientRect().right })));
    if (heads.map((h) => h.text).join() !== "Week,Posts,Comments,Jobs,Events") throw new Error(`Activity's table has the columns ${heads.map((h) => h.text).join(", ")}`);
    const heights = heads.map((h) => h.height);
    if (Math.max(...heights) - Math.min(...heights) > 1) throw new Error(`a header of Activity's table wraps: ${heads.map((h) => `${h.text} ${h.height}px`).join(", ")}`);
    for (const row of [1, 26]) {
      const rights = await activity.getByRole("row").nth(row).getByRole("cell").evaluateAll((els) => els.map((el) => el.getBoundingClientRect().right));
      for (let j = 1; j < heads.length; j++) if (Math.abs(rights[j] - heads[j].right) > 1) throw new Error(`row ${row}'s ${heads[j].text} isn't under its header (${rights[j]} against ${heads[j].right})`);
    }
    // A community counts its members by the year they joined, since most have no end year: Bhavin Trivedi since 1996.
    const joinedChart = shown(page.getByRole("slider", { name: "Members by year joined", exact: true }));
    const joinedLatest = await joinedChart.getAttribute("aria-valuetext");
    if (!/^Joined in \d{4}, [\d,]+ members?$/.test(joinedLatest ?? "")) throw new Error(`the Members by year joined chart's value is "${joinedLatest}"`);
    await tableSwitch("Members by year joined").click();
    const joined = shown(page.getByRole("table", { name: "Members by year joined", exact: true }));
    await joined.getByRole("row").nth(1).waitFor();
    const joinedColumns = await joined.getByRole("columnheader").allTextContents();
    if (joinedColumns.join() !== "Year joined,Members") throw new Error(`the Members by year joined table has the columns ${joinedColumns.join(", ")}`);
    await joined.getByRole("cell", { name: "1996", exact: true }).waitFor();
    await fitsPhone("Analytics", shown(page.getByRole("heading", { name: "Who your members are", exact: true })));
    await shot("m20-analytics");

    // The members CSV: "Preparing…" while the script holds it, then downloaded with one byte order mark.
    const exportUrl = "**/api/v1/t/shri-gujarati-samaj/admin/exports/members.csv";
    let releaseExport;
    const exportHeld = new Promise((resolve) => (releaseExport = resolve));
    await page.route(exportUrl, async (route) => {
      await exportHeld;
      await route.fallback();
    });
    let saved;
    try {
      const download = page.waitForEvent("download");
      await memberButton("Members CSV").click();
      await memberButton("Preparing…").waitFor();
      // One export at a time: a phone shares one file at a time, and the next save deletes the file before it.
      if ((await memberButton("Activity CSV").getAttribute("aria-disabled")) !== "true") throw new Error("Activity CSV can start while the members CSV is being prepared");
      releaseExport();
      saved = await download;
    } finally {
      releaseExport();
    }
    await page.unroute(exportUrl);
    if (!/^shri-gujarati-samaj-members-\d{4}-\d{2}-\d{2}\.csv$/.test(saved.suggestedFilename())) throw new Error(`the members CSV downloads as ${saved.suggestedFilename()}`);
    const csv = readFileSync(await saved.path(), "utf8");
    if (csv.charCodeAt(0) !== 0xfeff) throw new Error("the members CSV has no byte order mark, so Excel would garble names");
    if (csv.charCodeAt(1) === 0xfeff) throw new Error("the members CSV has two byte order marks");
    const header = csv.slice(1).split("\r\n")[0];
    if (!header.startsWith("Name,Phone,Email,Start year,End year,Status,") || !header.includes(",Chapter")) throw new Error(`the members CSV starts "${header.slice(0, 120)}"`);
    // A member who still belongs has a blank end year.
    const hetal = csv.slice(1).split("\r\n").find((l) => l.startsWith("Hetal Shah,"));
    if (!/^Hetal Shah,[^,]*,[^,]*,2005,,Approved,/.test(hetal ?? "")) throw new Error(`Hetal Shah's years in the members CSV read "${hetal?.slice(0, 80)}"`);
    await memberButton("Members CSV").waitFor();
    if ((await memberButton("Activity CSV").getAttribute("aria-disabled")) === "true") throw new Error("Activity CSV stays disabled once the members CSV is saved");

    // A reload keeps the period.
    await page.reload();
    await page.waitForURL(/[?&]weeks=26/);
    await shown(page.getByRole("slider", { name: /^New members per week/ })).waitFor();
    if ((await memberButton("Last 6 months").getAttribute("aria-pressed")) !== "true") throw new Error("a reload lost the period");
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
