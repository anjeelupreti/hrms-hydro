/**
 * Screenshot a page **and** write down where its parts are.
 *
 * The manual points at things — "click the Actions button", "the status chips
 * are both the count and the filter" — and a marking drawn at a guessed
 * position is wrong the first time anything on the page moves. So each entry
 * here names the elements it cares about, and the run records their bounding
 * boxes as fractions of the image next to the PNG.
 *
 * Fractions, not pixels: capture is at `deviceScaleFactor: 2`, so the file is
 * twice the viewport, and anything written in device pixels breaks the day
 * somebody recaptures at a different scale.
 *
 * Usage:
 *   node scripts/guide-boxes.mjs <out-dir> [host] [user] [pass]
 */

import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const OUT = process.argv[2] ?? "shots";
const HOST = process.argv[3] ?? "127.0.0.1:3001";
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

async function dismissSetup() {
  const later = page.getByRole("button", { name: /do this later/i });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (await later.isVisible().catch(() => false)) {
      await later.click().catch(() => {});
      await page.waitForTimeout(600);
      return;
    }
    await page.waitForTimeout(600);
  }
}
await dismissSetup();

const VIEW = { width: 1600, height: 1000 };

/** One element's box, as fractions of the viewport, or null if it is not there. */
async function boxOf(locator) {
  try {
    const b = await locator.first().boundingBox({ timeout: 4000 });
    if (!b) return null;
    return {
      x1: +(b.x / VIEW.width).toFixed(4),
      y1: +(b.y / VIEW.height).toFixed(4),
      x2: +((b.x + b.width) / VIEW.width).toFixed(4),
      y2: +((b.y + b.height) / VIEW.height).toFixed(4),
      cx: +((b.x + b.width / 2) / VIEW.width).toFixed(4),
      cy: +((b.y + b.height / 2) / VIEW.height).toFixed(4),
    };
  } catch {
    return null;
  }
}

const PAGES = [
  {
    name: "b01-employees",
    route: "/employees",
    parts: {
      search: () => page.getByPlaceholder(/search employees/i),
      chips: () => page.locator('[role="group"][aria-label*="status" i]'),
      tabs: () => page.getByRole("tab", { name: /current/i }),
      add: () => page.getByRole("button", { name: /add employee/i }),
      firstRow: () => page.locator(".MuiDataGrid-row"),
      sidebar: () => page.locator("nav").first(),
    },
  },
  {
    name: "b02-memoranda",
    route: "/memoranda",
    parts: {
      newMemo: () => page.getByRole("button", { name: /new memorandum/i }),
      actions: () => page.getByRole("button", { name: /^actions$/i }),
      search: () => page.getByPlaceholder(/number, subject/i),
      needsYou: () => page.getByText(/needs you/i),
      raisedByYou: () => page.getByText(/raised by you/i),
      handled: () => page.getByText(/you have handled/i),
    },
  },
  {
    name: "b03-memorandum-actions",
    route: "/settings/memorandum-actions",
    parts: {
      add: () => page.getByRole("button", { name: /add an action/i }),
      table: () => page.locator("table"),
      back: () => page.getByRole("link", { name: /memoranda/i }),
    },
  },
  {
    name: "b04-payroll",
    route: "/payroll",
    parts: {
      search: () => page.getByPlaceholder(/search/i),
      table: () => page.locator(".MuiDataGrid-root, table"),
    },
  },
  {
    name: "b05-field-visits",
    route: "/field-visits",
    parts: {
      newVisit: () => page.getByRole("button", { name: /new visit/i }),
      search: () => page.getByPlaceholder(/search visits/i),
      chips: () => page.locator('[role="group"][aria-label*="status" i]'),
      purpose: () => page.getByLabel(/purpose/i),
    },
  },
];

const boxes = {};

for (const spec of PAGES) {
  try {
    await page.goto(`${BASE}${spec.route}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await page.waitForLoadState("networkidle", { timeout: 45_000 }).catch(() => {});
    await dismissSetup();
    await page.waitForTimeout(2500);
    await page.screenshot({ path: path.join(OUT, `${spec.name}.png`) });

    const found = {};
    for (const [key, locator] of Object.entries(spec.parts)) {
      found[key] = await boxOf(locator());
    }
    boxes[spec.name] = found;
    const hits = Object.values(found).filter(Boolean).length;
    console.log(`  ${spec.name}: ${hits}/${Object.keys(found).length} parts located`);
  } catch (error) {
    console.log(`  SKIP ${spec.name}: ${String(error).split("\n")[0].slice(0, 90)}`);
  }
}

fs.writeFileSync(path.join(OUT, "boxes.json"), JSON.stringify(boxes, null, 2));
await browser.close();
console.log(`\ndone -> ${OUT}/boxes.json`);
