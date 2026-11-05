import { mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { PAGE_COLOURS, WHITE, expectSvgNoEmoji, pageColours, scriptNotification, textColour } from "./lib.mjs";

const BASE = process.env.WEB_URL ?? "http://localhost:5173";
// fileURLToPath, not URL.pathname: on Windows .pathname gives "/C:/…", which fs can't use.
const SHOTS = process.env.SHOTS ?? fileURLToPath(new URL("./screenshots/", import.meta.url));
mkdirSync(SHOTS, { recursive: true });
const unique = String(Date.now()).slice(-6);
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

const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.setDefaultTimeout(15000);
page.on("dialog", (d) => d.accept());
await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
const shot = (n) => page.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: true });

async function loginWithPhone(number, p = page) {
  await p.fill('input[type="tel"]', number);
  await p.click('button:has-text("Send code")');
  await p.waitForSelector("text=Development mode");
  const code = (await p.textContent("span.font-mono")).trim();
  await p.fill('input[inputmode="numeric"]', code);
  await p.click('button:has-text("Verify and continue")');
}

/** Fails unless `text` shows exactly once on the page, as a step's buttons must. */
async function onlyOnce(p, text) {
  const n = await p.getByText(text, { exact: true }).count();
  if (n !== 1) throw new Error(`"${text}" shows ${n} times on the page`);
}

/** Registration's last two steps with nothing more filled in: Continue, Skip for now, then `label`, with one Back on each. */
async function finishRegistration(p, label) {
  await onlyOnce(p, "Continue");
  await onlyOnce(p, "Back");
  await p.getByRole("button", { name: "Continue", exact: true }).click();
  await p.getByRole("heading", { name: "Step 2 of 3 · Work", exact: true }).waitFor();
  await onlyOnce(p, "Skip for now");
  await onlyOnce(p, "Back");
  await p.getByRole("button", { name: "Skip for now", exact: true }).click();
  await p.getByRole("heading", { name: "Step 3 of 3 · About you", exact: true }).waitFor();
  await onlyOnce(p, "Back");
  await p.getByRole("button", { name: label, exact: true }).click();
}

/** Clicks a download button and returns the file's name and text. */
async function download(click) {
  const [file] = await Promise.all([page.waitForEvent("download"), click()]);
  return { name: file.suggestedFilename(), text: readFileSync(await file.path(), "utf8") };
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
    await page.getByText("Divya Menon approved", { exact: true }).waitFor();
    await page.goto(`${BASE}/t/demo-college/admin/members?status=APPROVED`);
    await page.waitForSelector("li:has-text('Divya Menon')");
    await shot("a02-members");
  });

  await step("a member's page shows the admin their whole profile", async () => {
    await page.goto(`${BASE}/t/demo-college/admin/members?status=APPROVED`);
    await page.getByLabel("Search members").fill("Kiran Joshi");
    await page.locator("a", { hasText: "Kiran Joshi" }).first().click();
    await page.waitForURL(/\/admin\/members\/[0-9a-f-]+$/);
    await page.waitForSelector("h1:has-text('Kiran Joshi')");
    await page.getByText("Founder of Joshi Robotics: warehouse robots for Indian logistics firms", { exact: true }).waitFor();
    await page.getByText("Warehouse automation", { exact: true }).waitFor();
    await page.getByText("Automation engineer", { exact: true }).waitFor();
    await page.getByText("IIT Bombay", { exact: true }).waitFor();
    await page.getByText("Open to hiring", { exact: true }).waitFor();
    await shot("a02b-member-detail");
  });

  await step("reject a pending member with a reason", async () => {
    await page.goto(`${BASE}/t/demo-college/admin/members?status=PENDING`);
    const row = page.locator("li", { hasText: "Amit Verma" }).first();
    await row.waitFor();
    await row.locator('button:has-text("Reject")').click();
    await page.fill("textarea", "Could not verify batch, please add your roll number");
    await page.click('button:has-text("Reject"):not(:has-text("Rejected"))  >> nth=-1');
    await page.getByText("Amit Verma's request rejected", { exact: true }).waitFor();
  });

  await step("Approve all asks first, and Cancel leaves the request waiting", async () => {
    // Pooja Bhatt is the last one waiting, so the question is about one member. The next step approves her from her notice.
    const sent = [];
    const onRequest = (r) => r.method() === "POST" && r.url().includes("/admin/members/") && sent.push(r.url());
    page.on("request", onRequest);
    try {
      await page.goto(`${BASE}/t/demo-college/admin/members?status=PENDING`);
      await page.locator("li", { hasText: "Pooja Bhatt" }).first().waitFor();
      await page.getByRole("button", { name: "Approve all pending", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Approve the 1 pending member?", exact: true });
      await dialog.getByText("They're told they're in and can sign in straight away. Reject them first if you don't recognise them.", { exact: true }).waitFor();
      await dialog.getByRole("button", { name: "Approve", exact: true }).waitFor();
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
      await dialog.waitFor({ state: "detached" });
      await page.locator("li", { hasText: "Pooja Bhatt" }).first().waitFor();
      if (sent.length) throw new Error(`Cancel still sent ${sent.join(", ")}`);
    } finally {
      page.off("request", onRequest);
    }
  });

  await step("an admin approves a request to join from its notice, its buttons beside the link to the member", async () => {
    await page.goto(`${BASE}/t/demo-college/admin/members?status=PENDING`);
    const href = await page.locator("li", { hasText: "Pooja Bhatt" }).first().getByRole("link", { name: "Pooja Bhatt", exact: true }).getAttribute("href");
    const id = href.split("/").pop();
    // As the API sends an admin's copy: who it is about, and where the request stands now.
    const subject = { kind: "membership", membershipId: id, fullName: "Pooja Bhatt", status: "PENDING" };
    const notice = await scriptNotification(page, "demo-college", { type: "NEW_MEMBER_PENDING", data: { membershipId: id }, title: "New member awaiting approval", body: "Pooja Bhatt (batch of 2021) has requested to join.", subject });
    try {
      await page.goto(`${BASE}/t/demo-college/app/notifications`);
      const row = page.locator("main li", { hasText: "New member awaiting approval" });
      const link = row.getByRole("link", { name: /^New member awaiting approval/ });
      if ((await link.getAttribute("href")) !== href) throw new Error(`the notice links to ${await link.getAttribute("href")}, not Pooja's page ${href}`);
      const approve = row.getByRole("button", { name: "Approve Pooja Bhatt", exact: true });
      const reject = row.getByRole("button", { name: "Reject Pooja Bhatt", exact: true });
      for (const [name, button] of [["Approve", approve], ["Reject", reject]]) {
        const box = await button.boundingBox();
        if (!box || box.height < 44) throw new Error(`the notice's ${name} is ${box?.height}px tall, under 44px`);
      }
      if (await link.locator("button").count()) throw new Error("a button sits inside the notice's link");
      await shot("a02c-notice-actions");

      // Decided elsewhere while Reject is open (another admin rejected her): the list refetches, and the dialog closes
      // saying where she stands, rather than vanish with what was typed. Waiting again, as if she had applied again, it
      // doesn't open again by itself. The API says the notices changed when they're marked read from outside this page,
      // with its own session; said until the list has refetched, as the live connection may still be joining its rooms.
      const whenNoticesChange = async (changed) => {
        for (let i = 0; i < 5; i++) {
          const status = await page.evaluate(async () => {
            const token = JSON.parse(localStorage.getItem("illuminize.auth") ?? "{}").state?.accessToken;
            return (await fetch("/api/v1/t/demo-college/notifications/read-all", { method: "POST", headers: { Authorization: `Bearer ${token}` } })).status;
          });
          if (status !== 204) throw new Error(`marking the notices read answered ${status}`);
          try {
            return await changed();
          } catch {
            // Not refetched yet: say it again.
          }
        }
        throw new Error("the notices weren't refetched when the API said they had changed");
      };
      await reject.click();
      const dialog = page.getByRole("dialog", { name: "Reject Pooja Bhatt?", exact: true });
      await dialog.getByRole("textbox").fill("Typed as another admin decided");
      notice.update({ subject: { ...subject, status: "REJECTED" } });
      await whenNoticesChange(() => dialog.waitFor({ state: "hidden", timeout: 3000 }));
      await page.getByText("Pooja Bhatt's request has already been rejected.", { exact: true }).waitFor();
      await row.getByText("Rejected", { exact: true }).waitFor();
      notice.update({ subject });
      await whenNoticesChange(() => approve.waitFor({ timeout: 3000 }));
      if (await page.getByRole("dialog").count()) throw new Error("Reject opened again by itself once the request waited again");

      // It sends the status the notice showed, so a notice left open can't overturn another admin's decision.
      const posted = page.waitForRequest((r) => r.method() === "POST" && r.url().endsWith(`/admin/members/${id}/approve`));
      await approve.click();
      const body = (await posted).postData();
      if (JSON.parse(body ?? "{}").expectedStatus !== "PENDING") throw new Error(`the notice's Approve sent ${body}`);
      await page.getByText("Pooja Bhatt approved", { exact: true }).waitFor();
      // Opened again once dealt with, it shows where the request stands, with nothing left to press.
      notice.update({ subject: { ...subject, status: "APPROVED" } });
      await page.reload();
      await row.getByText("Approved", { exact: true }).waitFor();
      if (await row.getByRole("button", { name: /Pooja Bhatt$/ }).count()) throw new Error("an approved request's notice still offers Approve or Reject");
    } finally {
      await notice.stop();
    }
    await page.goto(`${BASE}/t/demo-college/admin/members?status=APPROVED`);
    await page.locator("li", { hasText: "Pooja Bhatt" }).first().waitFor();
  });

  await step("approve a pending job from the moderation queue", async () => {
    await page.goto(`${BASE}/t/demo-college/admin/moderation`);
    const row = page.locator("li", { hasText: "Robotics Intern" }).first();
    await row.waitFor();
    await row.locator('button:has-text("View full content")').click();
    await page.waitForSelector("text=ROS2");
    // The whole job, not just its description: the seeded stipend among its facts.
    await row.getByText("Stipend", { exact: true }).waitFor();
    await row.getByText("₹25,000–35,000/mo", { exact: true }).waitFor();
    // Under the page's h1, the job's title is an h2 and its parts h3s, so no heading level is skipped.
    await row.getByRole("heading", { level: 2, name: "Robotics Intern", exact: true }).waitFor();
    await row.getByRole("heading", { level: 3, name: "About the company", exact: true }).waitFor();
    // Its skills are shown as they are, with nothing compared with the admin's own.
    if (await row.getByText(/you have|Add your skills/i).count()) throw new Error("the admin's preview compares the job's skills with the admin's");
    await row.locator('button:has-text("Approve")').click();
    await page.waitForSelector("text=Job approved");
    await shot("a03-moderation");
  });

  await step("approve a pending business listing, seeing its contact details first", async () => {
    await page.goto(`${BASE}/t/demo-college/admin/moderation?type=BUSINESS`);
    const row = page.locator("li", { hasText: "Joshi Automation Services" }).first();
    await row.waitFor();
    if (await row.locator("text=service@joshiautomation.example").count()) throw new Error("the queue shows contact details before opening the listing");
    await row.locator('button:has-text("View full content")').click();
    await row.locator("text=service@joshiautomation.example").waitFor();
    await row.locator('a:has-text("Open in app")').waitFor();
    await expectSvgNoEmoji(row.locator('a:has-text("Open in app")'), "Open in app");
    await row.locator('button:has-text("Approve")').click();
    await page.waitForSelector("text=Business listing approved");
    await row.waitFor({ state: "detached" });
    await shot("a03b-moderation-business");
  });

  await step("an approved post's Pin and Unpin draw their icon, named by the word alone", async () => {
    // The seeded notice is pinned and the spam post (removed in the next step) isn't. Rows hold member text, so only the
    // buttons are checked for emoji.
    await page.goto(`${BASE}/t/demo-college/admin/moderation?status=APPROVED&type=POST`);
    for (const name of ["Pin", "Unpin"]) {
      const button = page.getByRole("button", { name, exact: true }).first();
      await button.waitFor();
      await expectSvgNoEmoji(button, `the moderation queue's ${name} button`);
    }
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
    // Each save remounts the form once its refetch lands, wiping anything toggled before then, so reopen the page between saves.
    const open = async () => {
      await page.goto(`${BASE}/t/demo-college/admin/settings`);
      await page.waitForSelector("text=New member approval");
    };
    const save = async () => {
      const [res] = await Promise.all([page.waitForResponse((r) => r.request().method() === "PATCH" && r.url().endsWith("/admin/settings")), page.click('button:has-text("Save settings")')]);
      if (!res.ok()) throw new Error(`settings save failed: ${res.status()}`);
      return res.request().postDataJSON();
    };
    const sentFeatures = (body, expected) => {
      if (JSON.stringify(body.features) !== JSON.stringify(expected)) throw new Error(`settings save sent features ${JSON.stringify(body.features)}, expected ${JSON.stringify(expected)}`);
    };
    const directory = page.locator('label:has-text("Member directory") input');
    const businesses = page.locator('label:has-text("Business directory") input');

    // Only what was toggled goes out, so a stale tab can't undo another admin's change.
    await open();
    if (!(await businesses.isChecked())) throw new Error("the Business directory switch should start on");
    if (!(await page.locator('label:has-text("Messaging") input').isChecked())) throw new Error("the Messaging switch should start on outside schools");
    if (!(await page.locator('label:has-text("Groups") input').isChecked())) throw new Error("the Groups switch should start on outside schools");
    sentFeatures(await save(), undefined);
    await page.waitForSelector("text=Settings saved");

    await open();
    await directory.uncheck();
    sentFeatures(await save(), { directory: false });

    // The switch stayed off, and turning it back on restores demo-college for the later steps.
    await open();
    if (await directory.isChecked()) throw new Error("the Member directory switch didn't stay off after saving");
    await directory.check();
    sentFeatures(await save(), { directory: true });

    // Mentorship needs Messaging: unchecking Messaging unchecks Mentorship and holds it off, and one save stores both.
    const messaging = page.locator('label:has-text("Messaging") input');
    const mentorship = page.locator('label:has-text("Mentorship") input');
    await open();
    if (!(await mentorship.isChecked())) throw new Error("the Mentorship switch should start on outside schools");
    await messaging.uncheck();
    if ((await mentorship.isChecked()) || !(await mentorship.isDisabled())) throw new Error("unchecking Messaging should uncheck Mentorship and hold it off");
    await page.getByText("Needs Messaging", { exact: true }).waitFor();
    sentFeatures(await save(), { messaging: false, mentorship: false });
    await open();
    if ((await messaging.isChecked()) || (await mentorship.isChecked())) throw new Error("Messaging and Mentorship didn't both stay off after saving");

    // Both back on, as demo-college started, for the later steps and the other scripts.
    await messaging.check();
    if ((await mentorship.isChecked()) || (await mentorship.isDisabled())) throw new Error("checking Messaging should free Mentorship without turning it on");
    await mentorship.check();
    sentFeatures(await save(), { messaging: true, mentorship: true });
    await open();
    if (!(await messaging.isChecked()) || !(await mentorship.isChecked())) throw new Error("Messaging and Mentorship didn't both come back on");

    await page.click("text=Branding");
    await page.waitForSelector("text=Preview");
    await shot("a05-settings");
  });

  await step("add a profile question", async () => {
    await page.goto(`${BASE}/t/demo-college/admin/profile-fields`);
    await page.waitForSelector("text=Degree and field of study are now built into every profile");
    await page.click('button:has-text("+ Add field")');
    const modal = page.locator('[role="dialog"]');
    await modal.locator('label:has-text("Question") input').fill(`Hostel block ${unique}`);
    await modal.locator('button:has-text("Add field")').click();
    await page.waitForSelector(`text=Hostel block ${unique}`);
    await shot("a06-profile-fields");
  });

  const invitePhone = `76${unique}11`;
  await step("import an invitation from CSV, copy its link, and join through it", async () => {
    await page.goto(`${BASE}/t/demo-college/admin/invitations`);
    await page.waitForSelector("text=Import a list");
    await expectSvgNoEmoji(page.getByRole("button", { name: "Template", exact: true }), "the Template button");
    await page.setInputFiles('input[aria-label="CSV file"]', { name: "invites.csv", mimeType: "text/csv", buffer: Buffer.from(`Phone,Name,Batch\r\n+91${invitePhone},Kavita Invitee,2015\r\n`) });
    await page.click('button:has-text("Import 1 row")');
    await page.waitForSelector("text=1 new");
    const row = page.locator("tr", { hasText: "Kavita Invitee" }).first();
    await row.locator('button:has-text("Copy link")').click();
    const link = await page.evaluate(() => navigator.clipboard.readText());
    if (!/\/i\/[\w-]+$/.test(link)) throw new Error(`unexpected invite link: ${link}`);
    await shot("a07-invitations");

    const guest = await browser.newPage({ viewport: { width: 390, height: 844 } });
    guest.setDefaultTimeout(15000);
    try {
      await guest.goto(link);
      await guest.waitForSelector("text=Kavita, you're invited");
      await guest.click("text=Accept invitation");
      await loginWithPhone(invitePhone, guest);
      await guest.waitForURL(/\/register$/);
      await guest.waitForSelector("text=You were invited");
      // The invitation fills in the name and batch, so the first step is ready to leave.
      if ((await guest.inputValue('input[name="fullName"]')) !== "Kavita Invitee") throw new Error("the invitation didn't fill in the name");
      await finishRegistration(guest, "Join the network");
      await guest.waitForURL(/\/app\/feed$/); // approved straight away: invitations skip the approval queue
    } finally {
      await guest.close();
    }
    await page.reload();
    await page.locator("tr", { hasText: "Kavita Invitee" }).first().locator("text=Joined").waitFor();
  });

  await step("post an announcement that also goes by email", async () => {
    await page.goto(`${BASE}/t/demo-college/app/profile`);
    await page.click('button:has-text("Sign out")');
    await page.waitForURL(/\/t\/demo-college$/);
    await page.goto(`${BASE}/t/demo-university/login`);
    await loginWithPhone("9000000001");
    await page.waitForURL(/\/app\/feed$/);
    const text = `Homecoming ${unique}: register by Friday.`;
    await page.fill('textarea[aria-label="New post"]', text);
    await page.getByRole("button", { name: "Announce", exact: true }).click();
    await page.getByRole("button", { name: "Undo announce", pressed: true }).waitFor();
    await page.waitForSelector("text=Every member (");
    await page.locator('label:has-text("Also email it")').locator("input").check();
    await page.click('button:has-text("Post announcement")');
    await page.waitForSelector("text=Announcement posted");
    await page.locator("article", { hasText: text }).first().getByText("Announcement", { exact: true }).waitFor();
    await shot("a08-announcement");
  });

  await step("the reported business listing is in the university's reports", async () => {
    await page.goto(`${BASE}/t/demo-university/admin/reports`);
    const row = page.locator("li", { hasText: "Promises guaranteed visas" }).first();
    await row.waitFor();
    await row.locator("text=Business listing").waitFor();
    await row.locator("text=Instant Visa Desk").waitFor();
    await row.locator("text=Guaranteed visas in 24 hours").waitFor();
    await row.locator('button:has-text("Remove content")').waitFor();
    await shot("a08b-reports-business");
  });

  await step("the dashboard shows a tile and a nav entry for open chat reports", async () => {
    await page.goto(`${BASE}/t/demo-university/admin/dashboard`);
    const tile = page.locator('a[href$="/admin/chat-reports"]', { hasText: "Open chat reports" });
    await tile.waitFor();
    if ((await tile.locator(".text-2xl").textContent()).trim() !== "1") throw new Error("the tile should count the seeded chat report");
    await page.locator('nav[aria-label="Admin sections"] a', { hasText: "Chat reports" }).waitFor();
    // Exact, because "Reports" alone would match "Chat reports" as well.
    await page.locator('nav[aria-label="Admin sections"] a span:text-is("Reports")').waitFor();
    await shot("a08c-chat-report-tile");
  });

  const SEEDED_BODY = "demo-chat-report-7Q4X";
  await step("a chat report hides the message until an admin chooses to view it", async () => {
    await page.goto(`${BASE}/t/demo-university/admin/chat-reports`);
    const row = page.locator("li", { hasText: "Arjun" }).first();
    await row.waitFor();
    await row.locator("text=Harassment").waitFor();
    if (await page.locator(`text=${SEEDED_BODY}`).count()) throw new Error("the chat reports queue shows a message before anyone asked to see it");
    if (await row.locator("text=Reported message").count()) throw new Error("the chat reports queue shows a message before anyone asked to see it");
    await row.locator("text=recorded in the audit log").waitFor();
    await shot("a08d-chat-reports-queue");
    await row.locator('button:has-text("View messages")').click();
    await row.locator(`text=${SEEDED_BODY}`).waitFor();
    await row.locator("text=Reported message").waitFor();
    await shot("a08e-chat-report-view");
    await row.locator('button:text-is("Hide")').click();
    await row.locator('button:has-text("View messages")').waitFor();
    if (await page.locator(`text=${SEEDED_BODY}`).count()) throw new Error("hiding the messages left them on the page");
  });

  await step("viewing a chat report writes an audit row", async () => {
    await page.goto(`${BASE}/t/demo-university/admin/audit`);
    await page.locator("tr", { hasText: "chat_report.view" }).first().locator("text=Ananya").waitFor();
    if (await page.locator(`text=${SEEDED_BODY}`).count()) throw new Error("the audit log shows the reported message");
  });

  await step("leaving the chat reports page discards the messages", async () => {
    await page.goto(`${BASE}/t/demo-university/admin/chat-reports`);
    const row = page.locator("li", { hasText: "Arjun" }).first();
    await row.locator('button:has-text("View messages")').click();
    await row.locator(`text=${SEEDED_BODY}`).waitFor();
    // By the app's own links, because a page load would wipe the client's memory whether or not the page discards anything.
    const nav = page.locator('nav[aria-label="Admin sections"]');
    await nav.locator("a", { hasText: "Audit log" }).click();
    await page.waitForURL(/\/admin\/audit$/);
    await nav.locator("a", { hasText: "Chat reports" }).click();
    await page.waitForURL(/\/admin\/chat-reports$/);
    await row.locator('button:has-text("View messages")').waitFor();
    if (await page.locator(`text=${SEEDED_BODY}`).count()) throw new Error("the message came back without being asked for");
  });

  await step("a report another admin just handled closes the dialog and refreshes the list", async () => {
    const row = page.locator("li", { hasText: "Arjun" }).first();
    await row.locator('button:has-text("View messages")').click();
    await row.locator(`text=${SEEDED_BODY}`).waitFor();
    // Answered as the API answers the second admin, which leaves the seeded report open for the next step.
    const resolveUrl = "**/admin/chat-reports/*/resolve";
    await page.route(resolveUrl, (r) => r.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: { code: "INVALID_TRANSITION", message: "This report has already been handled" } }) }));
    await row.locator('button:has-text("Remove message")').click();
    const refetched = page.waitForResponse((r) => r.request().method() === "GET" && /\/admin\/chat-reports\?/.test(r.url()));
    await page.click('div[role="dialog"] button:has-text("Remove")');
    await page.waitForSelector("text=This report has already been handled");
    await refetched;
    await page.locator('div[role="dialog"]').waitFor({ state: "detached" });
    await row.locator('button:has-text("View messages")').waitFor();
    if (await page.locator(`text=${SEEDED_BODY}`).count()) throw new Error("the message stayed on the page after the report was handled elsewhere");
    await page.unroute(resolveUrl);
  });

  await step("removing a reported message resolves its report", async () => {
    await page.goto(`${BASE}/t/demo-university/admin/chat-reports`);
    const row = page.locator("li", { hasText: "Arjun" }).first();
    await row.locator('button:has-text("View messages")').click();
    await row.locator(`text=${SEEDED_BODY}`).waitFor();
    await row.locator('button:has-text("Remove message")').click();
    await page.fill('div[role="dialog"] textarea', "Threatening another member");
    await page.click('div[role="dialog"] button:has-text("Remove")');
    await page.waitForSelector("text=Report resolved");
    await page.waitForSelector("text=No open chat reports");
    await page.click('[role="tab"]:has-text("Resolved")');
    const closed = page.locator("li", { hasText: "Arjun" }).first();
    await closed.locator("text=Message removed").waitFor();
    if (await page.locator(`text=${SEEDED_BODY}`).count()) throw new Error("the resolved tab shows the removed message");
    await shot("a08f-chat-report-resolved");
  });

  await step("chat reports fit a phone with no sideways scrolling, messages open", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE}/t/demo-university/admin/chat-reports?status=RESOLVED`);
    const row = page.locator("li", { hasText: "Arjun" }).first();
    await row.locator('button:has-text("View messages")').click();
    await row.locator(`text=${SEEDED_BODY}`).waitFor();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (overflow > 0) throw new Error(`the chat reports page scrolls sideways by ${overflow}px on a phone`);
    await shot("a08g-chat-reports-phone");
    await page.setViewportSize({ width: 1280, height: 900 });
  });

  await step("analytics charts render and the members CSV downloads", async () => {
    await page.goto(`${BASE}/t/demo-university/admin/dashboard`);
    await page.click("text=Growth and activity charts");
    await page.waitForSelector("svg[aria-label^='New members per week']");
    await page.waitForSelector("svg[aria-label^='Activity per week']");
    await page.waitForSelector("text=Who your members are");
    await shot("a09-analytics");
    await expectSvgNoEmoji(page.locator('button:has-text("Members CSV")'), "the Members CSV button");
    const csv = await download(() => page.click('button:has-text("Members CSV")'));
    if (!/^demo-university-members-\d{4}-\d{2}-\d{2}\.csv$/.test(csv.name)) throw new Error(`unexpected file name ${csv.name}`);
    if (!csv.text.startsWith("\uFEFFName,Phone,Email,")) throw new Error("members CSV is missing its BOM or header");
    const lines = csv.text.split("\r\n");
    if (!lines[0].includes("Alumni office notes")) throw new Error("admin-only profile question missing from the export");
    // The profile's own details come after "Last active", before the institution's questions; Rahul's are seeded.
    if (!lines[0].includes("Last active,Headline,Industry,Started working,Skills,Degree,Field of study,Past roles,Studies elsewhere,")) throw new Error(`the members CSV's profile columns are missing or out of place: ${lines[0]}`);
    const rahul = lines.find((l) => l.startsWith("Rahul Mehta,"));
    if (!rahul?.includes("Founder and CEO of Zylo Labs") || !rahul.includes("Fundraising; Lending")) throw new Error(`Rahul's profile details are missing from the export: ${rahul}`);
  });

  await step("the app's header links to the console on a phone, and every admin page fits one", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    try {
      // Its icon alone at this width, a 44px target named with the work waiting, which it reads from the console's own
      // counts: the reported business listing is still open, so there is some.
      const dashboard = page.waitForResponse((r) => /\/api\/v1\/t\/demo-university\/admin\/dashboard$/.test(r.url()) && r.request().method() === "GET");
      await page.goto(`${BASE}/t/demo-university/app/feed`);
      const d = (await (await dashboard).json()).data;
      const waiting = d.pendingMembers + d.pendingContent + d.openReports + d.openChatReports;
      if (d.openReports < 1) throw new Error("the dashboard counts no open report, with the business listing's still open");
      const name = `Admin console, ${waiting} waiting`;
      const admin = page.locator("header").getByRole("link", { name, exact: true });
      await admin.waitFor();
      const box = await admin.boundingBox();
      if (!box || box.width < 44 || box.height < 44) throw new Error(`the header's Admin link is ${box?.width}×${box?.height}px, under 44px`);
      await expectSvgNoEmoji(admin, "the header's Admin link");
      // The count shows, in the amber of work waiting rather than the red of unread.
      const badge = admin.getByText(String(waiting), { exact: true });
      await badge.waitFor();
      if (!/\bbg-amber-/.test((await badge.getAttribute("class")) ?? "")) throw new Error("the header's Admin link's count isn't amber");
      // The sidebar's row, on a wider screen, carries the same count.
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.locator('aside nav[aria-label="Main"]').getByRole("link", { name, exact: true }).waitFor();
      await page.setViewportSize({ width: 390, height: 844 });
      await admin.click();
      await page.waitForURL(/\/admin\/dashboard$/);

      const fits = async (where) => {
        await page.locator("main h1").first().waitFor();
        await page.waitForLoadState("networkidle");
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        if (overflow > 0) throw new Error(`${where} scrolls sideways by ${overflow}px on a phone`);
      };
      await fits("the dashboard");
      // Every section in the console's nav, then views inside them: other status tabs, a member's page, and Branding.
      const sections = await page.locator('nav[aria-label="Admin sections"] a').evaluateAll((links) => links.map((a) => a.getAttribute("href")));
      const tabs = ["members?status=APPROVED", "members?status=REJECTED", "members?status=SUSPENDED", "moderation?status=APPROVED", "moderation?status=REMOVED", "reports?status=RESOLVED"].map((p) => `/t/demo-university/admin/${p}`);
      for (const path of [...sections, ...tabs]) {
        await page.goto(BASE + path);
        await fits(path);
      }
      await page.goto(`${BASE}/t/demo-university/admin/members?status=APPROVED`);
      await page.locator('main a[href*="/admin/members/"]').first().click();
      await page.waitForURL(/\/admin\/members\/[0-9a-f-]+$/);
      await fits("a member's admin page");
      await page.goto(`${BASE}/t/demo-university/admin/settings`);
      await page.getByRole("tab", { name: "Branding", exact: true }).click();
      await page.waitForSelector("text=Preview");
      await fits("the Branding tab");
      await shot("a09b-admin-phone");
    } finally {
      await page.setViewportSize({ width: 1280, height: 900 });
    }
  });

  await step("a background chosen on My profile tints the member app, saved, but not the admin console, and Plain puts it back", async () => {
    await page.goto(`${BASE}/t/demo-university/app/profile`);
    const group = page.getByRole("radiogroup", { name: "Background", exact: true });
    const tile = (name) => group.getByRole("radio", { name, exact: true });
    await tile("Plain").waitFor();
    // Demo University has no cover, so no Cover tile; Plain is chosen until the member chooses another.
    for (const [name, checked] of [["Plain", "true"], ["Institution colour", "false"], ["Your photo", "false"]]) {
      if ((await tile(name).getAttribute("aria-checked")) !== checked) throw new Error(`the ${name} tile has aria-checked ${await tile(name).getAttribute("aria-checked")}, expected ${checked}`);
    }
    if (await tile("Institution cover").count()) throw new Error("an institution without a cover offers the Institution cover tile");
    const main = page.locator("main").first();
    if ((await pageColours(main)).page !== PAGE_COLOURS.plain) throw new Error("My profile isn't on the plain page before a background is chosen");
    // Grey text on the page itself (the header's "Signed in as …"), which steps one shade darker on a tint.
    const greyLine = page.locator("main h1 + p").first();
    const plainGrey = await textColour(greyLine);
    const choose = async (name) => {
      const saved = page.waitForResponse((r) => /\/t\/demo-university\/memberships\/me\/appearance$/.test(r.url()) && r.request().method() === "PATCH");
      await tile(name).click();
      if (!(await saved).ok()) throw new Error(`choosing ${name} wasn't saved`);
      if ((await tile(name).getAttribute("aria-checked")) !== "true") throw new Error(`the ${name} tile isn't checked once saved`);
    };
    await choose("Institution colour");
    const tinted = (await pageColours(main)).page;
    if (tinted !== PAGE_COLOURS.demoUniversity) throw new Error(`with Institution colour chosen the page is rgb ${tinted}, not Demo University's tint ${PAGE_COLOURS.demoUniversity}`);
    const tintGrey = await textColour(greyLine);
    const lightness = (rgb) => rgb.split(" ").reduce((sum, c) => sum + Number(c), 0);
    if (!(lightness(tintGrey) < lightness(plainGrey))) throw new Error(`grey text on the tint is rgb ${tintGrey}, not darker than on the plain page (${plainGrey})`);
    // Saved on the membership, so a fresh load has it, on the feed too, where post cards stay white: each paints white
    // itself, so the tint can't show through one.
    await page.goto(`${BASE}/t/demo-university/app/feed`);
    const card = page.locator("main article").first();
    await card.waitFor();
    const feed = await pageColours(card);
    if (feed.page !== PAGE_COLOURS.demoUniversity) throw new Error(`the feed is rgb ${feed.page} after a reload, not Demo University's tint`);
    if (feed.own !== WHITE) throw new Error(`a post card's own background is ${feed.own ? `rgb ${feed.own}` : "clear"} on the tinted feed, not white`);
    await shot("a09c-appearance-colour");
    // The console, Branding included, shows the institution as everyone sees it.
    const plainConsole = async (where) => {
      const consolePage = (await pageColours(page.locator("main").first())).page;
      if (consolePage !== PAGE_COLOURS.plain) throw new Error(`${where} is rgb ${consolePage} under the admin's own background, not the plain page`);
    };
    await page.goto(`${BASE}/t/demo-university/admin/dashboard`);
    await page.locator("main h1").first().waitFor();
    await plainConsole("the admin dashboard");
    await page.goto(`${BASE}/t/demo-university/admin/settings`);
    await page.getByRole("tab", { name: "Branding", exact: true }).click();
    await page.waitForSelector("text=Preview");
    await plainConsole("the Branding tab");
    await page.goto(`${BASE}/t/demo-university/app/profile`);
    await tile("Plain").waitFor();
    await choose("Plain");
    if ((await pageColours(main)).page !== PAGE_COLOURS.plain) throw new Error("Plain didn't put the plain page back");
    if ((await textColour(greyLine)) !== plainGrey) throw new Error("Plain didn't put the plain page's grey text back");
  });

  await step("platform admin signs in and sees institutions", async () => {
    await page.goto(`${BASE}/t/demo-university/app/profile`);
    await page.click('button:has-text("Sign out")');
    await page.waitForURL(/\/t\/demo-university$/);
    await page.goto(`${BASE}/platform/login`);
    await loginWithPhone("9999999999");
    await page.waitForURL(/\/platform\/tenants$/);
    await page.waitForSelector("text=Demo University");
    await page.waitForSelector("text=Demo International School");
    // The console's nav draws SVG icons, as the admin console's does, each link named by its label alone and 40px tall.
    const nav = page.locator('nav[aria-label="Platform sections"]');
    await expectSvgNoEmoji(nav, "the platform console's nav");
    for (const label of ["Institutions", "Users", "Stats", "Compare", "Chat reports", "Audit log"]) {
      const link = nav.getByRole("link", { name: label, exact: true });
      if ((await link.locator("svg").count()) !== 1) throw new Error(`the platform nav's ${label} link has no icon`);
      const box = await link.boundingBox();
      if (!box || box.height < 40) throw new Error(`the platform nav's ${label} link is ${box?.height}px tall, under 40px`);
    }
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
    await expectSvgNoEmoji(page.locator(`a[href="/t/smoke-institute-${unique}"]`), "the link to the institution's app");
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
    await page.waitForSelector("text=/calendar days in Asia\\/Kolkata/");
    // Edit the plan's price and notes; the cycle and currency stay as they were.
    await page.click('li:has-text("Per active user") >> button:has-text("Edit")');
    const dialog = page.locator('[role="dialog"]');
    await dialog.locator('input[type="number"]').fill("60");
    await dialog.locator("textarea").fill("Renewed for the academic year");
    await dialog.locator('button:has-text("Save")').click();
    await page.waitForSelector("text=Plan updated");
    await page.waitForSelector("text=Per active user · ₹60 per active member");
    await page.waitForSelector("text=Renewed for the academic year");
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

  await step("compare institutions for chargeback and download the CSV", async () => {
    await page.goto(`${BASE}/platform/compare`);
    await page.waitForSelector("h1:has-text('Compare institutions')");
    await page.locator("tbody tr", { hasText: "Demo University" }).first().waitFor();
    await page.click('th button:has-text("Approved")');
    await page.waitForSelector("h2:has-text('Approved members')");
    await shot("p05-compare");
    await expectSvgNoEmoji(page.locator('button:has-text("Download CSV")'), "the Download CSV button");
    const csv = await download(() => page.click('button:has-text("Download CSV")'));
    if (!/^institutions-\d{4}-\d{2}-\d{2}-to-\d{4}-\d{2}-\d{2}\.csv$/.test(csv.name)) throw new Error(`unexpected file name ${csv.name}`);
    if (!csv.text.includes("Demo University,demo-university,ACTIVE")) throw new Error("comparison CSV is missing Demo University");
  });

  await step("the platform console lists only escalated chat reports, and a row fits a phone", async () => {
    await page.goto(`${BASE}/platform/chat-reports`);
    await page.waitForSelector("h1:has-text('Chat reports')");
    await page.waitForSelector("text=No open escalated reports");
    // The seeded report sits on this tab now and isn't escalated, so only the filter can keep it off.
    await page.click('[role="tab"]:has-text("Resolved")');
    await page.waitForSelector("text=No resolved escalated reports");

    // The seed has no escalated report, so these rows are answered here, to measure them and to follow where they link.
    // The nav's count reads the same list, so it answers 3 as well.
    const listUrl = "**/api/v1/platform/chat-reports*";
    const member = (fullName) => ({ id: "00000000-0000-4000-8000-000000000001", fullName, avatarUrl: null });
    const report = { id: "00000000-0000-4000-8000-000000000002", targetKind: "MESSAGE", reason: "HARASSMENT", status: "OPEN", reporter: member("Venkataraghavan Subramaniam Iyer"), reported: member("Anantharamakrishnan Chandrasekaran"), resolutionAction: null, resolvedAt: null, createdAt: new Date().toISOString(), tenant: { slug: "demo-university", name: "Demo University of Science and Technology" }, basis: "REPORTED_ADMIN", needsOtherStaff: false, noStaffCanTake: false };
    // One this member of staff can't take, having changed that institution's admins since it was filed.
    const notTheirs = { ...report, id: "00000000-0000-4000-8000-000000000003", reason: "SPAM", tenant: { slug: "demo-college", name: "Demo College" }, basis: "NO_ELIGIBLE_ADMIN", needsOtherStaff: true };
    // And one no other member of staff may take either, so it says how to get one.
    const nobodys = { ...notTheirs, id: "00000000-0000-4000-8000-000000000004", tenant: { slug: "demo-school", name: "Demo School" }, noStaffCanTake: true };
    // Closed, so it waits for nobody, though its messages still aren't this member of staff's to read.
    const closed = { ...notTheirs, id: "00000000-0000-4000-8000-000000000005", status: "RESOLVED", resolutionAction: "NONE", resolvedAt: new Date().toISOString() };
    await page.route(listUrl, (r) => {
      const data = new URL(r.request().url()).searchParams.get("status") === "RESOLVED" ? [closed] : [report, notTheirs, nobodys];
      return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data, page: 1, pageSize: 25, total: data.length }) });
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE}/platform/chat-reports`);
    const link = page.locator('main a[href="/t/demo-university/admin/chat-reports?status=OPEN"]');
    await link.waitFor();
    const navLink = page.locator('nav[aria-label="Platform sections"]').getByRole("link", { name: "Chat reports, 3 open", exact: true });
    await navLink.locator('span[aria-hidden="true"]', { hasText: /^3$/ }).waitFor();
    const needsOther = "You changed this institution's admins after this report was filed, so another member of Illuminize staff needs to handle it.";
    const noneYet = "No other member of staff can take it yet: make someone a platform admin under Users.";
    const theirs = page.locator("main li", { hasText: "Demo University of Science and Technology" });
    await theirs.getByText("About an admin", { exact: true }).waitFor();
    if (await theirs.getByText("another member of Illuminize staff").count()) throw new Error("a report this member of staff can take says another must");
    const other = page.locator("main li", { hasText: "Demo College" });
    await other.getByText("No other admin", { exact: true }).waitFor();
    await other.getByText(needsOther, { exact: true }).waitFor();
    if (await other.locator("a").count()) throw new Error("a report another member of staff must handle still links to where it's handled");
    await page.locator("main li", { hasText: "Demo School" }).getByText(`${needsOther} ${noneYet}`, { exact: true }).waitFor();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (overflow > 0) throw new Error(`the platform chat reports page scrolls sideways by ${overflow}px on a phone`);
    await shot("p01b-platform-chat-reports");
    await page.click('[role="tab"]:has-text("Resolved")');
    const closedRow = page.locator("main li", { hasText: "Demo College" });
    await closedRow.getByText("You changed this institution's admins after this report was filed, so you can't open it.", { exact: true }).waitFor();
    if (await closedRow.locator("a").count()) throw new Error("a closed report this member of staff can't open still links to it");
    if (await page.locator("main").getByText("needs to handle it").count()) throw new Error("a closed report says another member of staff needs to handle it");
    await page.unroute(listUrl);
    await page.setViewportSize({ width: 1280, height: 900 });
  });

  await step("platform admin opens an institution's admin console without being a member", async () => {
    await page.goto(`${BASE}/t/demo-school/admin/members`);
    await page.waitForURL(/\/t\/demo-school\/admin\/members$/);
    await page.waitForSelector('nav[aria-label="Admin sections"] >> text=Moderation');
    await page.waitForSelector("text=Platform console");
  });

  await step("messaging, groups and mentorship start off at a school, with the reason shown", async () => {
    await page.goto(`${BASE}/t/demo-school/admin/settings`);
    await page.waitForSelector("text=New member approval");
    if (await page.locator('label:has-text("Messaging") input').isChecked()) throw new Error("the Messaging switch should start off at a school");
    if (await page.locator('label:has-text("Groups") input').isChecked()) throw new Error("the Groups switch should start off at a school");
    const mentorship = page.locator('label:has-text("Mentorship") input');
    if ((await mentorship.isChecked()) || !(await mentorship.isDisabled())) throw new Error("the Mentorship switch should start off at a school, and wait for Messaging");
    await page.getByText("Needs Messaging", { exact: true }).waitFor();
    await page.waitForSelector("text=Messaging, Groups and Mentorship start off for schools");
    await page.waitForSelector("text=current pupils still can't use them");
    await shot("p05b-school-settings");
  });

  await step("admin console stacks on a phone", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE}/t/demo-school/admin/dashboard`);
    const nav = await page.locator('nav[aria-label="Admin sections"]').boundingBox();
    const main = await page.locator("main").boundingBox();
    if (!nav || !main) throw new Error("admin nav or main missing");
    if (main.width < 300) throw new Error(`main column is only ${Math.round(main.width)}px wide on a phone`);
    if (main.y < nav.y + nav.height - 1) throw new Error("admin nav and content overlap on a phone");
    await shot("p06-admin-phone");
    await page.setViewportSize({ width: 1280, height: 900 });
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
