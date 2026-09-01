/**
 * Screenshot a page in both colour schemes, against a running stack.
 *
 * `render-check.mjs` proves a page renders and says nothing about how it looks.
 * §1.6 has carried "screenshot diff, light and dark — still not done" as an
 * open item since Phase 1 opened; this is the piece that was missing.
 *
 * Usage:
 *   node scripts/screenshot.mjs <out-dir> [route] [host] [user] [pass]
 */

import { chromium } from "@playwright/test";

const OUT = process.argv[2] ?? ".";
const ROUTE = process.argv[3] ?? "/dashboard";
const HOST = process.argv[4] ?? "acme.localhost:3000";
const USER = process.argv[5] ?? "hr";
const PASS = process.argv[6] ?? "password123";
const BASE = `http://${HOST}`;
const NAME = ROUTE.replace(/^\/|\/$/g, "").replace(/\//g, "-") || "root";

// One login for both shots. /api/auth/login is throttled, and signing in once
// per scheme is what made earlier versions of this script look like a broken
// app rather than a script racing itself.
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
const page = await context.newPage();
page.on("response", (r) => { if (process.env.SHOT_DEBUG && r.url().includes("/api/")) console.log("  dbg", r.status(), r.url().split("/api/")[1].slice(0,45)); });

await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 240_000 });

/**
 * Fill the credentials and prove **both** survived, together.
 *
 * `domcontentloaded` fires before React hydrates; a `fill()` in that window
 * writes to the DOM node, and hydration then mounts the controlled input with
 * its initial `""` and wipes it. Checking each field as it is filled is not
 * enough — hydration can land *between* the two and simply move the empty
 * string to the other field. Same fix as `render-check.mjs`.
 */
async function signInFields() {
  const user = page.getByLabel(/username/i);
  const pass = page.getByLabel(/password/i);
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await user.fill(USER);
    await pass.fill(PASS);
    if ((await user.inputValue()) === USER && (await pass.inputValue()) === PASS) return;
    await page.waitForTimeout(250);
  }
  throw new Error("credentials keep resetting — the page never settled after hydration");
}
await signInFields();
// Wait on the session landing, not on a navigation event: the redirect is a
// client-side router.push, which fires no `load` for waitForURL to catch.
//
// Armed before the click — `waitForResponse` only sees responses that arrive
// after it starts listening, so awaiting it after the click loses the race
// whenever the round-trip is quick.
const sessionLanded = page.waitForResponse(
  (r) => r.url().includes("/api/proxy/accounts/me") && r.status() === 200,
  { timeout: 180_000 }
);
await page.getByRole("button", { name: /sign in|log in/i }).first().click();
await sessionLanded;

async function shoot(scheme) {
  // Drive MUI's own stored preference. `emulateMedia` is not enough: an
  // explicit light/dark choice ignores the OS setting entirely, so it produced
  // a "dark" screenshot byte-identical to the light one — a dark mode that was
  // never actually verified, which is worse than not checking.
  await page.evaluate((s) => localStorage.setItem("mui-mode", s), scheme);
  await page.goto(`${BASE}${ROUTE}`, { waitUntil: "domcontentloaded", timeout: 240_000 });
  await page.getByText("HR Admin", { exact: true }).first().waitFor({ timeout: 180_000 });
  await page.waitForLoadState("networkidle", { timeout: 120_000 }).catch(() => {});
  await page.waitForTimeout(3000);

  // Prove the ground actually changed rather than trusting the setting.
  const dark = await page.evaluate(() => {
    const [r, g, b] = getComputedStyle(document.body).backgroundColor.match(/\d+/g).map(Number);
    return r * 0.299 + g * 0.587 + b * 0.114 < 128;
  });
  if (dark !== (scheme === "dark")) {
    throw new Error(`asked for ${scheme} but the page ground reports dark=${dark}`);
  }

  const file = `${OUT}/${NAME}-${scheme}.png`;
  await page.screenshot({ path: file, fullPage: true });
  console.log(`  ${file}  (ground verified ${scheme})`);
}

await shoot("light");
await shoot("dark");

await browser.close();
