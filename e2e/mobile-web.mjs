import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const BASE = "http://localhost:8081";
const SHOTS = process.env.SHOTS ?? new URL("./screenshots/", import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });
const unique = String(Date.now()).slice(-8);
const PHONE = `7${unique.slice(0, 9).padEnd(9, "3")}`;
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
    await page.getByPlaceholder("98765 43210").fill(PHONE);
    await tap("Send code");
    const dev = await page.getByText(/Development mode/).textContent();
    const code = /(\d{6})/.exec(dev)[1];
    await page.getByPlaceholder("••••••").fill(code);
    await tap("Verify and continue");
    await page.getByText("Create your profile").waitFor();
    await shot("m03-register");
    const inputs = page.locator("input");
    await inputs.nth(0).fill("Mobile Smoke");
    await inputs.nth(1).fill("2014");
    await tap("Join the network");
    await page.getByText("Welcome to the official Demo University alumni network", { exact: false }).waitFor();
    await shot("m04-feed");
  });

  await step("create a post from the feed", async () => {
    await page.getByText("+", { exact: true }).click();
    await page.locator("textarea").first().fill(`Hello from the mobile smoke ${unique}`);
    await tap("Post");
    await page.getByText(`Hello from the mobile smoke ${unique}`).waitFor();
  });

  await step("jobs tab lists seeded openings", async () => {
    await tap("Jobs");
    await page.getByText("Backend Engineer (Node.js)").waitFor();
    await shot("m05-jobs");
  });

  await step("RSVP to an event", async () => {
    await tap("Events");
    await page.getByText("Mumbai alumni coffee meetup").locator("visible=true").first().click();
    await page.getByText("Who's going").waitFor();
    const before = Number((await page.locator("text=/^\\d+$/").first().textContent()).trim());
    await tap("I'm going");
    await page.getByText("Mobile Smoke").first().waitFor();
    await shot("m06-event");
    void before;
  });

  await step("directory search and member profile", async () => {
    await tap("Directory");
    await page.getByPlaceholder("Name, company, role").fill("Priya");
    const hit = page.getByText("Priya Nair").locator("visible=true").first();
    await hit.waitFor();
    // inactive tab stacks stay mounted on web and overlap; dispatch the click straight to the card
    await hit.dispatchEvent("click");
    await page.getByText("Member since").waitFor();
    await shot("m07-member");
  });

  await step("ADMIN_APPROVAL tenant lands on the pending screen", async () => {
    // deep link straight into the college (served with SPA fallback); signed in but not a member → register
    await page.goto(BASE + "/t/demo-college");
    await page.getByText("Create your profile").waitFor();
    const inputs = page.locator("input");
    await inputs.nth(0).fill("Pending Mobile");
    await inputs.nth(1).fill("2011");
    await tap("Submit for approval");
    await page.getByText("Awaiting approval").waitFor();
    await shot("m08-pending");
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
