/**
 * Capture the screenshots the testing guide and the manual are built from.
 *
 * One sign-in, then every route in turn — the login endpoint is throttled, and
 * a script that authenticates per page looks like a broken app rather than a
 * script racing itself.
 *
 * Routes are listed in this file rather than passed on the command line: Git
 * Bash rewrites a leading "/login" into "C:/Program Files/Git/login" before the
 * argument ever reaches node, and the list is worth version-controlling anyway.
 *
 * Usage:
 *   node scripts/guide-shots.mjs <out-dir> [host] [user] [pass]
 */

import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const OUT = process.argv[2] ?? "shots";
const HOST = process.argv[3] ?? "127.0.0.1:3009";
const USER = process.argv[4] ?? "owner";
const PASS = process.argv[5] ?? "TestPass123!";
const BASE = `http://${HOST}`;

/** `wide` gets a taller viewport — a page whose point is a long list. */
const ROUTES = [
  { route: "/login", name: "01-login", anon: true },
  { route: "/dashboard", name: "02-dashboard" },
  { route: "/employees", name: "03-employees" },
  { route: "/employees/org-chart", name: "04-org-chart" },
  { route: "/memoranda", name: "05-memoranda" },
  { route: "/settings/memorandum-actions", name: "06-memorandum-actions" },
  { route: "/field-visits", name: "07-field-visits" },
  { route: "/events", name: "08-events" },
  { route: "/companies", name: "09-companies" },
  { route: "/attendance", name: "10-attendance" },
  { route: "/leave", name: "11-leave" },
  { route: "/payroll", name: "12-payroll" },
  { route: "/expenses", name: "13-expenses" },
  { route: "/expenses/budgets", name: "14-expense-budgets" },
  { route: "/assets", name: "15-assets" },
  { route: "/training", name: "16-training" },
  { route: "/helpdesk", name: "17-helpdesk" },
  { route: "/recruitment", name: "18-recruitment" },
  { route: "/timesheets", name: "19-timesheets" },
  { route: "/team", name: "20-team" },
  { route: "/settings", name: "21-settings" },
  { route: "/calendar", name: "22-calendar" },
];

fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1600, height: 1000 },
  deviceScaleFactor: 2, // legible when a reader zooms into a manual
});
const page = await context.newPage();

/**
 * Fill the credentials and prove **both** survived, together.
 *
 * `domcontentloaded` fires before React hydrates; a fill in that window writes
 * to the DOM node and hydration then mounts the controlled input with its
 * initial "" and wipes it. Checking each field as it is filled is not enough —
 * hydration can land between the two and move the empty string to the other.
 */
await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 240_000 });
const user = page.locator('input[name="username"]');
const pass = page.locator('input[name="password"]');
for (let attempt = 0; attempt < 60; attempt += 1) {
  await user.fill(USER);
  await pass.fill(PASS);
  const settled =
    (await user.inputValue()) === USER &&
    (await pass.inputValue()) === PASS &&
    // The button is disabled until React is listening — see the note on
    // `hydrated` in app/login/page.tsx. Waiting for it is waiting for
    // hydration, which is the thing that actually has to have happened.
    (await page.getByRole("button", { name: /sign in/i }).isEnabled());
  if (settled) break;
  await page.waitForTimeout(250);
}

// The login screen itself, before we sign in and lose it.
await page.waitForTimeout(1200);
await page.screenshot({ path: path.join(OUT, "01-login.png"), fullPage: false });
console.log("  shot 01-login");

const landed = page.waitForResponse(
  (r) => r.url().includes("/api/proxy/accounts/me") && r.status() === 200,
  { timeout: 180_000 }
);
await page.getByRole("button", { name: /sign in/i }).click();
await landed;

for (const { route, name, anon } of ROUTES) {
  if (anon) continue;
  try {
    await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
    // Let the lists actually arrive — a screenshot of six skeletons documents
    // nothing. Network-idle alone is not enough on pages that poll.
    await page
      .waitForLoadState("networkidle", { timeout: 45_000 })
      .catch(() => {});
    await page.waitForTimeout(2500);
    await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: false });
    console.log(`  shot ${name}`);
  } catch (error) {
    console.log(`  SKIP ${name}: ${String(error).split("\n")[0].slice(0, 90)}`);
  }
}

await browser.close();
console.log(`\ndone -> ${OUT}`);
