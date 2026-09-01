/**
 * Where do form controls disagree about their own height?
 *
 * A search box a few pixels taller than the select beside it is the kind of
 * thing that reads as sloppy without being locatable — you see that a row is
 * uneven, not which control is wrong. This measures every input, select and
 * button on a page and reports the ones whose height differs from the majority
 * for their size class.
 */
import { chromium } from "playwright";

const ORIGIN = "http://vision.localhost:3000";
const ROUTES = process.env.ROUTES
  ? process.env.ROUTES.split(",")
  : ["/employees", "/expenses", "/timesheets", "/leave", "/payroll", "/assets",
     "/recruitment", "/training", "/reviews", "/surveys", "/wfh", "/attendance"];

const browser = await chromium.launch({
  args: ["--host-resolver-rules=MAP *.localhost 127.0.0.1", "--no-sandbox"],
});
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1050 } });
const page = await ctx.newPage();

await page.goto(`${ORIGIN}/login`, { waitUntil: "domcontentloaded" });
await page.evaluate(async () => {
  await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "hr_vision", password: "password123" }),
  });
});
await page.goto(`${ORIGIN}/dashboard`, { waitUntil: "domcontentloaded" });
if (new URL(page.url()).pathname.startsWith("/login")) {
  console.error("sign-in did not stick");
  process.exit(1);
}

for (const route of ROUTES) {
  await page.goto(`${ORIGIN}${route}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.evaluate(() => {
    document.querySelectorAll(".MuiDialog-root, .MuiBackdrop-root").forEach((n) => n.remove());
  });
  await page.waitForTimeout(400);

  const rows = await page.evaluate(() => {
    const out = [];
    // The outlined root is the box people actually see the edge of.
    document.querySelectorAll(".MuiOutlinedInput-root").forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.height === 0 || r.width === 0) return;
      const small = el.classList.contains("MuiInputBase-sizeSmall");
      const multiline = el.classList.contains("MuiInputBase-multiline");
      if (multiline) return;
      const label =
        el.querySelector("input,select")?.getAttribute("aria-label") ??
        el.querySelector("input")?.getAttribute("placeholder") ??
        el.textContent?.trim().slice(0, 30) ??
        "?";
      out.push({ kind: small ? "small" : "medium", h: Math.round(r.height), label });
    });
    return out;
  });

  const byKind = {};
  for (const r of rows) (byKind[r.kind] ??= []).push(r);

  const notes = [];
  for (const [kind, list] of Object.entries(byKind)) {
    const counts = {};
    for (const r of list) counts[r.h] = (counts[r.h] ?? 0) + 1;
    const common = Number(Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]);
    for (const r of list) {
      if (r.h !== common) notes.push(`${kind} ${r.h}px (most are ${common}px) — ${r.label}`);
    }
  }

  const shape = Object.entries(byKind)
    .map(([k, v]) => `${k}:${v.length}`)
    .join(" ");
  if (notes.length) {
    console.log(`\n${route}  [${shape}]`);
    for (const n of notes) console.log("   " + n);
  } else {
    console.log(`${route}  [${shape}]  consistent`);
  }
}

await browser.close();
