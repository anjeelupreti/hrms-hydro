/**
 * Phase E: open every screen and record what actually happens.
 *
 * A route that answers 200 has not necessarily rendered — Next serves the
 * shell, then the client hydrates and asks the API, and a screen can arrive
 * blank, throw into an error boundary, or fill with "something went wrong"
 * while the HTTP status stays cheerful. So this reads the DOM after the
 * network settles, not the status code.
 *
 * Two things the checklist already learned the hard way:
 *   - Chromium needs `--host-resolver-rules` or `*.localhost` does not resolve.
 *   - Sign in with an **in-page fetch**. `page.request.post` runs in Node,
 *     whose DNS does not know `vision.localhost` either.
 *
 * Usage:  node scripts/screen-sweep.mjs [--shots]
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const HOST = process.env.SWEEP_HOST ?? "vision.localhost";
const ORIGIN = `http://${HOST}:3000`;
const USER = process.env.SWEEP_USER ?? "hr_vision";
const PASS = process.env.SWEEP_PASS ?? "password123";
const SHOTS = process.argv.includes("--shots");
const SHOT_DIR = "scripts/.screens";

/** Every screen worth opening, tenant-side. Detail routes need a real id and
 *  are handled separately once the list pages have told us one. */
const ROUTES = [
  "/dashboard", "/portal", "/calendar", "/meetings",
  "/employees", "/employees/change-requests", "/employees/org-chart",
  "/employees/lifecycle", "/team",
  "/recruitment", "/checklists", "/training", "/goals", "/reviews", "/surveys",
  "/attendance", "/attendance/calendar", "/leave", "/wfh", "/timesheets",
  "/payroll", "/payroll/components", "/payroll/structures", "/payroll/tax-slabs",
  "/payroll/statutory-rates", "/payroll/contributions", "/payroll/loans",
  "/expenses", "/reports",
  "/assets", "/helpdesk", "/documents", "/announcements",
  "/crm", "/crm/clients", "/crm/deals", "/crm/invoices", "/crm/tickets",
  "/projects", "/mail", "/messages", "/notifications", "/profile",
  "/settings", "/settings/company", "/settings/org", "/settings/holidays",
  "/settings/attendance", "/settings/notifications", "/settings/reminders",
  "/settings/devices", "/settings/email", "/settings/billing",
  "/setup",
];

/** Text that means the screen gave up, whatever the HTTP status said. */
// Text that means the screen failed.
//
// **Not a bare "500".** That was here, and it matched money: an expense of
// 6,500.00 and a basic of 62,500 both made a working page report a server
// error. A harness that cries wolf on two pages gets its whole output
// discounted, which is worse than the two false alarms.
//
// Real server failures are caught by the console listener above, which sees
// the actual HTTP status. This list is for the ones that render as a page.
const FAILURE_TEXT = [
  "Application error",
  "something went wrong",
  "Something went wrong",
  "Unhandled Runtime Error",
  "This page could not be found",
  "Internal Server Error",
];

const browser = await chromium.launch({
  args: [
    // Without this, Chromium sends *.localhost to a real DNS server and fails.
    "--host-resolver-rules=MAP *.localhost 127.0.0.1",
    "--no-sandbox",
  ],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

const consoleErrors = [];
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push({ url: page.url(), text: m.text().slice(0, 200) });
});
page.on("pageerror", (e) => {
  consoleErrors.push({ url: page.url(), text: `pageerror: ${String(e).slice(0, 200)}` });
});

// ── sign in ────────────────────────────────────────────────────────────────
await page.goto(`${ORIGIN}/login`, { waitUntil: "domcontentloaded" });
const auth = await page.evaluate(
  async ([u, p]) => {
    const r = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: u, password: p }),
    });
    return { ok: r.ok, status: r.status };
  },
  [USER, PASS]
);
if (!auth.ok) {
  console.error(`sign-in failed: HTTP ${auth.status}`);
  await browser.close();
  process.exit(1);
}
// Prove the session actually took, rather than trusting the 200.
//
// This check exists because its absence cost a whole sweep. Signing in against
// `/api/proxy/accounts/token/` returns the tokens in the body and sets no
// cookie, so every route afterwards was redirected to `/login` — and the sweep
// called all 54 screens clean, because a login page renders perfectly well.
// A harness that passes while measuring nothing is worse than no harness.
await page.goto(`${ORIGIN}/dashboard`, { waitUntil: "domcontentloaded" });
if (new URL(page.url()).pathname.startsWith("/login")) {
  console.error("sign-in did not stick: /dashboard redirected to /login.");
  await browser.close();
  process.exit(1);
}
console.log(`signed in as ${USER} on ${HOST}\n`);

if (SHOTS) mkdirSync(SHOT_DIR, { recursive: true });

const results = [];
for (const route of ROUTES) {
  consoleErrors.length = 0;
  let status = 0;
  try {
    const resp = await page.goto(ORIGIN + route, {
      waitUntil: "networkidle",
      timeout: 45000,
    });
    status = resp?.status() ?? 0;
  } catch (e) {
    results.push({ route, status: 0, verdict: "TIMEOUT", detail: String(e).slice(0, 90) });
    continue;
  }

  const body = await page.evaluate(() => document.body.innerText || "");
  const failed = FAILURE_TEXT.find((t) => body.includes(t));
  // A screen that rendered almost nothing is as broken as one that threw.
  const thin = body.trim().length < 120;

  let verdict = "ok";
  let detail = "";
  if (failed) {
    verdict = "ERROR TEXT";
    detail = failed;
  } else if (thin) {
    verdict = "BLANK";
    detail = `${body.trim().length} chars rendered`;
  } else if (consoleErrors.length) {
    verdict = "console";
    detail = consoleErrors[0].text.slice(0, 80);
  }

  results.push({ route, status, verdict, detail, chars: body.trim().length });

  if (SHOTS) {
    const name = route.replace(/\//g, "_").replace(/^_/, "") || "root";
    await page.screenshot({ path: `${SHOT_DIR}/${name}.png`, fullPage: true });
  }
}

await browser.close();

const bad = results.filter((r) => r.verdict !== "ok");
console.log(`screens opened: ${results.length}`);
console.log(`clean         : ${results.length - bad.length}`);
console.log(`needing a look: ${bad.length}\n`);
for (const r of bad) {
  console.log(`  [${r.verdict}] ${r.route}  (HTTP ${r.status})`);
  if (r.detail) console.log(`        ${r.detail}`);
}

writeFileSync("scripts/.screen-sweep.json", JSON.stringify(results, null, 2));
console.log(`\nfull result written to scripts/.screen-sweep.json`);
