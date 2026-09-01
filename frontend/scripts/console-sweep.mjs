/**
 * Phase E: the platform console, section by section.
 *
 * The console is one route with ten sections held in `useState`, not ten
 * routes — so unlike the tenant sweep these cannot be visited by URL. Each is
 * reached by clicking its name in the shell, which is also closer to what the
 * phase asks for: press the control rather than request the page.
 *
 * Usage:  node scripts/console-sweep.mjs [--shots]
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const ORIGIN = "http://platform.localhost:3000";
const EMAIL = process.env.PLATFORM_EMAIL ?? "admin@hrms.local";
const PASS = process.env.PLATFORM_PASS ?? "admin123";
const SHOTS = process.argv.includes("--shots");
const SHOT_DIR = "scripts/.screens/platform";

const SECTIONS = [
  "Overview", "Workspaces", "Support", "Leads", "Accounting",
  "Books", "Plans", "Customer emails", "Activity log", "System users",
];

const FAILURE_TEXT = [
  "Application error", "Something went wrong", "something went wrong",
  "Unhandled Runtime Error", "This page could not be found",
];

const browser = await chromium.launch({
  args: ["--host-resolver-rules=MAP *.localhost 127.0.0.1", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 160)); });
page.on("pageerror", (e) => errors.push(`pageerror: ${String(e).slice(0, 160)}`));

// ── sign in through the real form, not a fetch ─────────────────────────────
// `networkidle`, not `domcontentloaded`: filling before React hydrates sets
// the DOM value and then hydration overwrites it, so the submit button stays
// disabled and the click retries until it times out. This is the same
// hydration race the checklist records from an earlier session.
await page.goto(`${ORIGIN}/platform/login`, { waitUntil: "networkidle" });
await page.fill('input[type="email"]', EMAIL);
await page.fill('input[type="password"]', PASS);
// Wait for the form to agree it is ready rather than assuming it.
await page.waitForFunction(() => {
  const b = [...document.querySelectorAll("button")].find((x) => x.type === "submit");
  return b && !b.disabled;
}, { timeout: 15000 });
await page.click('button[type="submit"]');
try {
  await page.waitForURL((u) => !u.pathname.endsWith("/login"), { timeout: 30000 });
} catch {
  console.error("sign-in did not leave /platform/login");
  console.error(await page.evaluate(() => document.body.innerText.slice(0, 300)));
  await browser.close();
  process.exit(1);
}
await page.waitForLoadState("networkidle");
console.log(`signed in as ${EMAIL}\n`);

if (SHOTS) mkdirSync(SHOT_DIR, { recursive: true });

const results = [];
for (const name of SECTIONS) {
  errors.length = 0;
  let verdict = "ok";
  let detail = "";

  try {
    // The shell renders each section as a clickable row carrying its label.
    const target = page.getByText(name, { exact: true }).first();
    await target.click({ timeout: 15000 });
    await page.waitForLoadState("networkidle", { timeout: 30000 });
    await page.waitForTimeout(400);
  } catch (e) {
    results.push({ section: name, verdict: "NOT REACHABLE", detail: String(e).slice(0, 90) });
    continue;
  }

  const body = await page.evaluate(() => document.body.innerText || "");
  const failed = FAILURE_TEXT.find((t) => body.includes(t));
  if (failed) { verdict = "ERROR TEXT"; detail = failed; }
  else if (body.trim().length < 200) { verdict = "BLANK"; detail = `${body.trim().length} chars`; }
  else if (errors.length) { verdict = "console"; detail = errors[0].slice(0, 90); }

  results.push({ section: name, verdict, detail, chars: body.trim().length });

  if (SHOTS) {
    await page.screenshot({
      path: `${SHOT_DIR}/${name.toLowerCase().replace(/\s+/g, "-")}.png`,
      fullPage: true,
    });
  }
}

await browser.close();

const bad = results.filter((r) => r.verdict !== "ok");
console.log(`sections opened: ${results.length}`);
console.log(`clean          : ${results.length - bad.length}`);
console.log(`needing a look : ${bad.length}\n`);
for (const r of bad) {
  console.log(`  [${r.verdict}] ${r.section}`);
  if (r.detail) console.log(`        ${r.detail}`);
}
writeFileSync("scripts/.console-sweep.json", JSON.stringify(results, null, 2));
