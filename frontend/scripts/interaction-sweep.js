/**
 * An interaction pass: press the controls and check something happened.
 *
 * The route sweep only proved pages *load*. This presses things. For each
 * control it takes a before-picture — the URL, how many dialogs are open, the
 * page's text, whether any request went out — clicks, waits, and compares. A
 * control that changes none of those is a **dead click**: it did something or
 * nothing, and either way the person who pressed it cannot tell. That is the
 * defect behind the recruitment "Advance" button and the memorandum inline
 * fields, and neither was visible to the type-checker.
 *
 * **A filter that is already selected reports as a dead click, and should.**
 * Pressing "All" when All is already on genuinely changes nothing; the finding
 * carries the control's state so a reader can tell that apart from a button
 * that should have done something and did not. A heuristic that suppressed
 * them would also suppress the real ones.
 *
 * Run it with `node scripts/interaction-sweep.js`, optionally with
 * `ROUTES_ONLY=/meetings,/sites` to narrow it, against a running stack.
 *
 * **Nothing destructive is pressed.** The deny-list is matched against the
 * button's own text, and anything that decides, sends, deletes, retires or
 * approves is left alone — this runs against the real seeded database.
 *
 * **Everything measurable is gathered in one `evaluate` per step.** The first
 * version asked Playwright for each control's text one at a time; on a calendar
 * with forty day-buttons that is forty round trips, and the pass was taking two
 * hours. One round trip per measurement instead.
 */
const { chromium } = require("playwright");
const fs = require("fs");

const BASE = "http://localhost:3001";
const OUT = process.env.OUTFILE;
const T0 = Date.now();
/** Elapsed seconds on every line: a slow step then names itself, which is
 *  how the `getByRole` problem above was finally found. */
const say = (line) => {
  const stamped = "[" + ((Date.now() - T0) / 1000).toFixed(1) + "s] " + line;
  if (OUT) fs.appendFileSync(OUT, stamped + "\n");
  else console.log(stamped);
};

const DENY_SRC =
  "delete|remove|retire|discard|decline|approve|reject|refuse|send|terminate|suspend|deactivate|reset|clear|sign ?out|log ?out|archive|complete|advance|submit|save|confirm|pay|publish|finali|put it back|resend|revoke|withdraw|mark |apply|generate|import|unassign|clock";
const ALLOW_SRC =
  "new|add|create|schedule|register|invite|upload|preview|report|export|edit|open|view|details|all|draft|sent|held|coming up|cancelled|waiting|decided|active|past|current|mine|i called|i was invited|by hand|failed";

const ROUTES = [
  "/dashboard", "/portal", "/events", "/meetings",
  "/employees", "/employees/change-requests", "/team", "/companies",
  "/recruitment", "/checklists", "/training", "/goals", "/reviews", "/surveys",
  "/attendance", "/leave", "/wfh", "/timesheets", "/field-visits", "/sites",
  "/payroll", "/expenses", "/reports",
  "/assets", "/memoranda", "/helpdesk", "/documents", "/announcements",
  "/correspondence/outgoing", "/correspondence/incoming",
  "/crm/tickets", "/crm", "/projects", "/settings/reminders",
];

const MAX_PER_PAGE = 6;

// Set ROUTES_ONLY to a comma-separated list to try a handful first.
const ONLY = process.env.ROUTES_ONLY ? process.env.ROUTES_ONLY.split(",") : null;

/** Dismiss the setup banner if it is up. One round trip, by text. */
async function dismissSetup(page) {
  const clicked = await page.evaluate(() => {
    const node = [...document.querySelectorAll("button")].find((b) =>
      /I'll do this later/i.test(b.innerText || "")
    );
    if (!node) return false;
    node.click();
    return true;
  });
  if (clicked) await page.waitForTimeout(600);
  return clicked;
}

/** One round trip: every clickable label on the page, filtered. */
const COLLECT = ({ deny, allow, max }) => {
  const denyRe = new RegExp(deny, "i");
  const allowRe = new RegExp(allow, "i");
  const seen = new Set();
  const out = [];
  const nodes = document.querySelectorAll(
    "button, [role='tab'], .MuiChip-clickable"
  );
  for (const node of nodes) {
    if (out.length >= max) break;
    const box = node.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) continue;
    const text = (node.innerText || "").trim();
    if (!text || text.length > 40) continue;
    if (denyRe.test(text) || !allowRe.test(text)) continue;
    if (seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out;
};

/** One round trip: everything the comparison needs. */
const SNAPSHOT = () => ({
  url: location.pathname,
  dialogs: document.querySelectorAll(".MuiDialog-paper").length,
  text: (document.body.innerText || "").length,
});

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });

  let requests = 0;
  const pageErrors = [];
  const httpErrors = [];
  page.on("request", () => requests++);
  page.on("pageerror", (e) => pageErrors.push(e.message.slice(0, 140)));
  page.on("response", (r) => {
    if (r.status() >= 400 && !r.url().includes("_rsc=")) {
      httpErrors.push(`${r.status()} ${r.url().replace(BASE, "").slice(0, 90)}`);
    }
  });

  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.fill('input[name="username"]', "owner");
  await page.fill('input[name="password"]', "TestPass123!");
  await page.click('button[type="submit"]');
  await page.waitForURL(/dashboard|portal/, { timeout: 90000 });
  await page.waitForTimeout(3000);
  await dismissSetup(page);
  say("signed in");

  const dead = [];
  const dialogProblems = [];

  async function closeDialogs() {
    for (let i = 0; i < 3; i++) {
      const open = await page.evaluate(
        () => document.querySelectorAll(".MuiDialog-paper").length
      );
      if (open === 0) return true;
      const cancel = page
        .locator(".MuiDialog-paper button")
        .filter({ hasText: /^(cancel|close|keep it|not now|dismiss)$/i })
        .first();
      if (await cancel.count()) await cancel.click({ timeout: 3000 }).catch(() => {});
      else await page.keyboard.press("Escape");
      await page.waitForTimeout(500);
    }
    return (
      (await page.evaluate(() => document.querySelectorAll(".MuiDialog-paper").length)) === 0
    );
  }

  for (const route of ONLY ?? ROUTES) {
    try {
      await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded", timeout: 40000 });
    } catch {
      say(`${route} :: NAVIGATION FAILED`);
      continue;
    }
    say(`${route} :: loaded`);
    await page.waitForTimeout(1200);
    await dismissSetup(page);

    const labels = await page.evaluate(COLLECT, {
      deny: DENY_SRC,
      allow: ALLOW_SRC,
      max: MAX_PER_PAGE,
    });

    say(`${route} :: ${labels.length} controls — ${labels.join(", ")}`);

    let pressed = 0;
    for (const label of labels) {
      const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const target = page
        .locator("button:visible, [role='tab']:visible, .MuiChip-clickable:visible")
        .filter({ hasText: new RegExp(`^${escaped}$`) })
        .first();
      if (!(await target.count().catch(() => 0))) continue;

      const before = await page.evaluate(SNAPSHOT);
      const requestsBefore = requests;

      try {
        await target.click({ timeout: 3500, noWaitAfter: true });
      } catch {
        continue;
      }
      pressed++;
      await page.waitForTimeout(650);

      const after = await page.evaluate(SNAPSHOT).catch(() => before);
      const opened = after.dialogs > before.dialogs;
      const navigated = after.url !== before.url;
      const changed = after.text !== before.text;
      const fetched = requests > requestsBefore;

      if (opened) {
        const title = await page.evaluate(
          () => (document.querySelector(".MuiDialogTitle-root")?.innerText || "").trim()
        );
        if (!title) {
          dialogProblems.push(`${route} :: "${label}" — dialog with no title`);
          say(`  !! DIALOG NO TITLE :: ${route} :: "${label}"`);
        }
        if (!(await closeDialogs())) {
          dialogProblems.push(`${route} :: "${label}" — dialog will not close`);
          say(`  !! DIALOG WILL NOT CLOSE :: ${route} :: "${label}"`);
          await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded", timeout: 40000 });
          await page.waitForTimeout(1200);
        }
      } else if (navigated) {
        await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded", timeout: 40000 });
        await page.waitForTimeout(1200);
      } else if (!changed && !fetched) {
        // Already-selected filters legitimately do nothing when pressed again,
        // so the state of the control is recorded beside the finding rather
        // than the finding being suppressed — a human reads the difference
        // faster than a heuristic guesses it.
        const selected = await page.evaluate((text) => {
          const node = [...document.querySelectorAll("button, [role='tab'], .MuiChip-clickable")]
            .find((n) => (n.innerText || "").trim() === text);
          if (!node) return "gone";
          if (node.getAttribute("aria-selected") === "true") return "already selected";
          if (node.className.includes("filled") || node.className.includes("colorPrimary")) {
            return "already selected";
          }
          return "not selected";
        }, label);
        dead.push(`${route} :: "${label}" (${selected})`);
        say(`  !! DEAD CLICK :: ${route} :: "${label}" (${selected})`);
      }
    }
    say(`${route} :: pressed ${pressed}/${labels.length}`);
  }

  say("");
  say("=== DEAD CLICKS (no dialog, no navigation, no request, no text change) ===");
  say(dead.length ? dead.join("\n") : "none");
  say("");
  say("=== DIALOG PROBLEMS ===");
  say(dialogProblems.length ? dialogProblems.join("\n") : "none");
  say("");
  say("=== PAGE ERRORS ===");
  say(pageErrors.length ? [...new Set(pageErrors)].slice(0, 15).join("\n") : "none");
  say("");
  say("=== HTTP ERRORS ===");
  say(httpErrors.length ? [...new Set(httpErrors)].slice(0, 25).join("\n") : "none");

  await browser.close();
})().catch((e) => say("SCRIPT ERROR " + e.message));
