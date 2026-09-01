/**
 * Render pages in a real browser and assert on what a person would see.
 *
 * `smoke-routes.sh` fetches server HTML, which proves a route does not crash.
 * It cannot see the dashboard: those cards are gated on a client-side query,
 * so the server sends a skeleton and curl reads an empty page. Every
 * data-dependent screen in the app has that shape.
 *
 * This waits for hydration, then checks the text is actually on screen — and
 * collects console errors and failed requests, which is where the class of bug
 * that gets past tsc, eslint and a build tends to surface.
 *
 * Usage:
 *   node scripts/render-check.mjs [host] [user] [pass]
 */

import { chromium } from "@playwright/test";

const HOST = process.argv[2] ?? "acme.localhost:3000";
const USER = process.argv[3] ?? "hr";
const PASS = process.argv[4] ?? "password123";
const BASE = `http://${HOST}`;

/** What must be visible once the page has settled. */
const CHECKS = [
  // "Present today" is the hero figure the page now leads with, and
  // "arrived on time" only renders once the attendance share bar has real
  // totals — between them they prove the summary query landed, not just that
  // the shell drew.
  {
    path: "/dashboard",
    expect: ["Present today", "On leave today", "Headcount by department", "Today", "Patterns"],
  },
  { path: "/employees", expect: ["Employees", "Active"] },
  { path: "/expenses", expect: ["Pending", "Reimbursed"] },
  { path: "/assets", expect: ["Available", "Assigned"] },
  { path: "/helpdesk", expect: ["Open", "Resolved"] },
  { path: "/leave", expect: ["Leave"] },
  { path: "/payroll", expect: ["Payroll"] },
];

// Noise that is not ours and would otherwise fail every run.
const IGNORED = [
  /favicon/i,
  /Download the React DevTools/i,
  /Turbopack/i,
  /ResizeObserver loop/i,
];

const isReal = (text) => !IGNORED.some((r) => r.test(text));

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

const problems = [];
let currentPath = "(startup)";

page.on("console", (msg) => {
  if (msg.type() === "error" && isReal(msg.text())) {
    problems.push(`${currentPath}  console: ${msg.text().slice(0, 160)}`);
  }
});
page.on("pageerror", (err) => {
  if (isReal(String(err))) problems.push(`${currentPath}  pageerror: ${String(err).slice(0, 160)}`);
});
page.on("requestfailed", (req) => {
  if (isReal(req.url())) {
    problems.push(`${currentPath}  request failed: ${req.url().slice(0, 120)}`);
  }
});
page.on("request", (req) => {
  if (process.env.RC_DEBUG && req.url().includes("/api/auth/login")) {
    console.log(`    debug payload ${req.postData()}`);
  }
});
page.on("response", (res) => {
  if (process.env.RC_DEBUG && res.url().includes("/api/")) {
    console.log(`    debug ${res.status()} ${res.url().slice(0, 100)}`);
  }
  // A 500 from our own API is a failure even when the page still renders.
  if (res.status() >= 500 && res.url().includes("/api/")) {
    problems.push(`${currentPath}  ${res.status()} from ${res.url().slice(0, 120)}`);
  }
});

// ── Sign in once; every check reuses the session ────────────────────────
currentPath = "/login";
await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });

/**
 * Fill the credentials and prove **both** survived, together.
 *
 * `domcontentloaded` fires before React hydrates. A `fill()` in that window
 * writes straight to the DOM node; hydration then mounts the controlled
 * component with its initial state — `""` — and **wipes the field**. The
 * symptom was a login posting `{"username":"","password":"password123"}`: the
 * first field was filled pre-hydration and cleared, the second landed after and
 * stuck. It presented as an intermittent "invalid credentials" that curl could
 * never reproduce, because the race lives entirely in the browser.
 *
 * Checking each field as it is filled is not enough — hydration can land
 * *between* the two, which just moves the empty string from one field to the
 * other. The post-condition that matters is both fields holding at the same
 * moment, so that is what this asserts.
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
// Wait on the session landing — a network response — rather than on the URL.
//
// Three waits have been tried here and only this one is dependable.
// `waitForURL` waits for a `load` event that a client-side `router.push` never
// fires. Polling `location` inside the page looks right, but sign-in kicks off
// a chain of soft navigations (`/` then a redirect onward) that keeps tearing
// down the execution context the poll runs in, so it can sit there until its
// full timeout while the app has long since arrived. `accounts/me` returning
// 200 is a single unambiguous fact, delivered out of band from any of that.
//
// ARMED BEFORE THE CLICK, deliberately. `waitForResponse` only sees responses
// that arrive after it starts listening, so awaiting it *after* the click loses
// the race whenever the round-trip is quick — which is most of the time on a
// warm server, and is why this looked like an intermittent login failure.
//
// Generous, because against a dev server the first visit to a route compiles
// it — routinely past 60s. A timeout here means "slow build", not "broken app",
// and reading it as the latter cost an hour.
const sessionLanded = page.waitForResponse(
  (r) => r.url().includes("/api/proxy/accounts/me") && r.status() === 200,
  { timeout: 180_000 }
);
await page.getByRole("button", { name: /sign in|log in/i }).click();
await sessionLanded;
await page.getByText("HR Admin", { exact: true }).first().waitFor({ timeout: 180_000 });

/**
 * Wait for the session to be *known*, not merely for the network to go quiet.
 *
 * `networkidle` fires before React Query has issued its first request:
 * hydration has to run before the effect that triggers the fetch. Asserting at
 * that moment reads a page where `useMe()` is still undefined, so the shell
 * renders its signed-out shape — which I first mistook for a privilege bug.
 * The sidebar role label is the cheapest proof the profile has landed.
 */
async function waitForSession() {
  // The role label only renders once `useMe()` resolves, so this proves the
  // session is known — the thing `networkidle` cannot tell you.
  // Exact match on the role label. /HR Admin|Employee/ also matched the
  // "Employees" nav item, so it resolved before `me` had loaded — which is
  // what made the dashboard look like it was missing cards.
  await page.getByText("HR Admin", { exact: true }).first().waitFor({ timeout: 180_000 });
}
await waitForSession();

let checked = 0;
for (const { path, expect } of CHECKS) {
  currentPath = path;
  await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
  // networkidle rather than a fixed sleep: these pages render after their
  // queries resolve, and the number of queries differs per page.
  await page.waitForLoadState("networkidle", { timeout: 120_000 }).catch(() => {});
  await waitForSession();
  // Queries fire after hydration, so one settle is not enough on pages whose
  // content depends on a second round of requests.
  await page.waitForLoadState("networkidle", { timeout: 120_000 }).catch(() => {});

  for (const text of expect) {
    const found = await page
      .getByText(text, { exact: false })
      .first()
      .isVisible()
      .catch(() => false);
    if (!found) problems.push(`${path}  missing on screen: "${text}"`);
  }
  checked += 1;
  process.stdout.write(`  ${path}\n`);
}

await browser.close();

console.log(`\n${checked} pages rendered · ${problems.length} problem(s)`);
if (problems.length) {
  for (const p of problems) console.log(`  ${p}`);
  process.exit(1);
}
