/**
 * What the product is called.
 *
 * One constant, imported by both the public site and the system. A rename
 * that has to find five string literals is a rename that gets done four
 * times.
 *
 * Lives here rather than in `lib/marketing/` — the top bar is not marketing,
 * and the system should not have to import from the public site to know
 * what it is called.
 */

export const PRODUCT_NAME = "Xenex HRMS";

/** For places the full name would crowd — a nav mark, a favicon tooltip. */
export const PRODUCT_SHORT = "Xenex";

/**
 * Who this deployment belongs to.
 *
 * This is a single-company product, not a tenanted one: the build is installed
 * for one group and every screen in it belongs to them. The sign-in page is the
 * only place a person sees before they have an identity, so it is the one place
 * that has to say whose system this is — a generic panel there leaves somebody
 * wondering whether they have the right URL.
 *
 * Kept beside `PRODUCT_NAME` rather than fetched: the login screen renders
 * before any request has been made, and a company name that arrives after a
 * round trip is a company name that flashes in.
 */
export const DEPLOYMENT = {
  company: "Vision Lumbini Urja Company Limited",
  short: "Vision Lumbini Urja",
  code: "VLUCL",
  seat: "Butwal-8, Rupandehi · Lumbini Province",
  /** The group as it actually is — one holding company over three ventures. */
  group: [
    { code: "VLUCL", name: "Vision Lumbini Urja", note: "Holding company" },
    { code: "SNHL", name: "Seti Nadi Hydropower", note: "25.0 MW · in operation" },
    { code: "SJCL", name: "Sanjen Jalavidyut", note: "42.5 MW · under construction" },
    { code: "MCTL", name: "Marsyangdi Corridor Transmission", note: "Licensed" },
  ],
} as const;
