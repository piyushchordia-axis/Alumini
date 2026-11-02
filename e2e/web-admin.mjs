import { mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const BASE = "http://localhost:5173";
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

  await step("approve a pending business listing, seeing its contact details first", async () => {
    await page.goto(`${BASE}/t/demo-college/admin/moderation?type=BUSINESS`);
    const row = page.locator("li", { hasText: "Joshi Automation Services" }).first();
    await row.waitFor();
    if (await row.locator("text=service@joshiautomation.example").count()) throw new Error("the queue shows contact details before opening the listing");
    await row.locator('button:has-text("View full content")').click();
    await row.locator("text=service@joshiautomation.example").waitFor();
    await row.locator('a:has-text("Open in app")').waitFor();
    await row.locator('button:has-text("Approve")').click();
    await page.waitForSelector("text=Business listing approved");
    await row.waitFor({ state: "detached" });
    await shot("a03b-moderation-business");
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

    await page.click("text=Branding");
    await page.waitForSelector("text=Preview");
    await shot("a05-settings");
  });

  await step("add a profile question", async () => {
    await page.goto(`${BASE}/t/demo-college/admin/profile-fields`);
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
      await guest.click('button:has-text("Join the network")');
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
    await page.click('button:has-text("📣 Announcement")');
    await page.waitForSelector("text=Every member (");
    await page.locator('label:has-text("Also email it")').locator("input").check();
    await page.click('button:has-text("Post announcement")');
    await page.waitForSelector("text=Announcement posted");
    await page.locator("article", { hasText: text }).first().locator("text=📣 Announcement").waitFor();
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

  await step("analytics charts render and the members CSV downloads", async () => {
    await page.goto(`${BASE}/t/demo-university/admin/dashboard`);
    await page.click("text=Growth and activity charts");
    await page.waitForSelector("svg[aria-label^='New members per week']");
    await page.waitForSelector("svg[aria-label^='Activity per week']");
    await page.waitForSelector("text=Who your members are");
    await shot("a09-analytics");
    const csv = await download(() => page.click('button:has-text("Members CSV")'));
    if (!/^demo-university-members-\d{4}-\d{2}-\d{2}\.csv$/.test(csv.name)) throw new Error(`unexpected file name ${csv.name}`);
    if (!csv.text.startsWith("\uFEFFName,Phone,Email,")) throw new Error("members CSV is missing its BOM or header");
    if (!csv.text.split("\r\n")[0].includes("Alumni office notes")) throw new Error("admin-only profile question missing from the export");
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
    const csv = await download(() => page.click('button:has-text("Download CSV")'));
    if (!/^institutions-\d{4}-\d{2}-\d{2}-to-\d{4}-\d{2}-\d{2}\.csv$/.test(csv.name)) throw new Error(`unexpected file name ${csv.name}`);
    if (!csv.text.includes("Demo University,demo-university,ACTIVE")) throw new Error("comparison CSV is missing Demo University");
  });

  await step("platform admin opens an institution's admin console without being a member", async () => {
    await page.goto(`${BASE}/t/demo-school/admin/members`);
    await page.waitForURL(/\/t\/demo-school\/admin\/members$/);
    await page.waitForSelector('nav[aria-label="Admin sections"] >> text=Moderation');
    await page.waitForSelector("text=Platform console");
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
