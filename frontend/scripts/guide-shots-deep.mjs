/**
 * The second pass: the screens you only reach by clicking something.
 *
 * `guide-shots.mjs` captures the routes. A manual that says "click Edit, then
 * pick a company from the dropdown" needs a picture of the dialog that opens,
 * and a dialog has no URL. Each entry below drives the app to a state and then
 * shoots it.
 *
 * Each step is wrapped: a step that cannot reach its state logs and moves on,
 * because one missing dialog should not cost the other twenty shots and a
 * fifteen-minute run.
 *
 * Usage:
 *   node scripts/guide-shots-deep.mjs <out-dir> [host] [user] [pass]
 */

import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const OUT = process.argv[2] ?? "shots";
const HOST = process.argv[3] ?? "127.0.0.1:3001";
// The HR admin, not the owner: the owner has no employee record, so their
// memorandum desk is empty and half the screens document nothing.
const USER = process.argv[4] ?? "sushma.ghimire";
const PASS = process.argv[5] ?? "TestPass123!";
const BASE = `http://${HOST}`;

fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1600, height: 1000 },
  deviceScaleFactor: 2,
});
const page = await context.newPage();

await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 240_000 });
const signIn = page.getByRole("button", { name: /sign in/i });
for (let attempt = 0; attempt < 60; attempt += 1) {
  await page.locator('input[name="username"]').fill(USER);
  await page.locator('input[name="password"]').fill(PASS);
  if (await signIn.isEnabled()) break;
  await page.waitForTimeout(250);
}
const landed = page.waitForResponse(
  (r) => r.url().includes("/api/proxy/accounts/me") && r.status() === 200,
  { timeout: 180_000 }
);
await signIn.click();
await landed;
console.log("signed in");

/**
 * Send the setup wizard away before anything else.
 *
 * `SetupInvitation` opens over every page until the checklist is finished, and
 * a modal intercepts pointer events — which is why half of these steps timed
 * out clicking things that were plainly on screen behind it. It is also not
 * what the manual is documenting.
 */
async function dismissSetup() {
  const later = page.getByRole("button", { name: /do this later/i });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (await later.isVisible().catch(() => false)) {
      await later.click().catch(() => {});
      await page.waitForTimeout(600);
      return;
    }
    await page.waitForTimeout(700);
  }
}

await dismissSetup();

/** Go to a route and let its lists actually arrive. */
async function open(route) {
  await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.waitForLoadState("networkidle", { timeout: 45_000 }).catch(() => {});
  // The wizard remounts on every navigation, not just after signing in — a
  // single dismiss at the start leaves it covering the second page onwards,
  // which is what "element intercepts pointer events" meant here.
  await dismissSetup();
  await page.waitForTimeout(2000);
}

async function shot(name) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log(`  shot ${name}`);
}

/** Press Escape until no dialog is left standing, so the next step starts clean. */
async function clearDialogs() {
  for (let i = 0; i < 4; i += 1) {
    if ((await page.locator('[role="dialog"]').count()) === 0) return;
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
  }
}

const STEPS = [
  {
    name: "30-employee-profile",
    async run() {
      await open("/employees");
      // Not `a[href^='/employees/']` — that matches the sidebar's own
      // "/employees/change-requests" link first, and the shot lands on the
      // wrong page entirely. A grid row is unambiguously a person.
      await page.locator(".MuiDataGrid-row").first().click({ timeout: 15_000 });
      await page.waitForTimeout(3500);
    },
  },
  {
    name: "31-employee-edit",
    async run() {
      await page.getByRole("button", { name: /^edit$/i }).first().click({ timeout: 15_000 });
      await page.waitForTimeout(2500);
    },
  },
  {
    name: "32-memorandum-new",
    async run() {
      await clearDialogs();
      await open("/memoranda");
      await page.getByRole("button", { name: /new memorandum/i }).click({ timeout: 15_000 });
      await page.waitForTimeout(2500);
    },
  },
  {
    name: "33-memorandum-chain",
    async run() {
      await page.getByRole("tab", { name: /chain/i }).click({ timeout: 10_000 });
      await page.waitForTimeout(1500);
    },
  },
  {
    name: "34-memorandum-open",
    async run() {
      await clearDialogs();
      await open("/memoranda");
      await page.locator('[role="button"], .MuiCardActionArea-root').first().click({ timeout: 15_000 });
      await page.waitForTimeout(3000);
    },
  },
  {
    name: "35-memorandum-history",
    async run() {
      await page.getByRole("tab", { name: /history/i }).click({ timeout: 10_000 });
      await page.waitForTimeout(1500);
    },
  },
  {
    name: "36-field-visit-new",
    async run() {
      await clearDialogs();
      await open("/field-visits");
      await page.getByRole("button", { name: /new visit/i }).click({ timeout: 15_000 });
      await page.waitForTimeout(2500);
    },
  },
  {
    name: "37-payroll-run",
    async run() {
      await clearDialogs();
      await open("/payroll");
      await page.locator("a[href*='/payroll/runs/'], [role='row']").first().click({ timeout: 15_000 });
      await page.waitForTimeout(3500);
    },
  },
  {
    name: "38-statutory-rates",
    async run() {
      await clearDialogs();
      await open("/payroll/statutory-rates");
    },
  },
  {
    name: "39-employee-conduct",
    async run() {
      await clearDialogs();
      await open("/employees");
      // Not `a[href^='/employees/']` — that matches the sidebar's own
      // "/employees/change-requests" link first, and the shot lands on the
      // wrong page entirely. A grid row is unambiguously a person.
      await page.locator(".MuiDataGrid-row").first().click({ timeout: 15_000 });
      await page.waitForTimeout(3000);
      await page.getByRole("tab", { name: /conduct/i }).click({ timeout: 10_000 });
      await page.waitForTimeout(2000);
    },
  },
  {
    name: "40-training-program",
    async run() {
      await clearDialogs();
      await open("/training");
      await page.locator("a[href^='/training/']").first().click({ timeout: 15_000 });
      await page.waitForTimeout(3000);
    },
  },
];

for (const step of STEPS) {
  try {
    await step.run();
    await shot(step.name);
  } catch (error) {
    console.log(`  SKIP ${step.name}: ${String(error).split("\n")[0].slice(0, 100)}`);
    await clearDialogs();
  }
}

await browser.close();
console.log(`\ndone -> ${OUT}`);
