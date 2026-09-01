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

export const PRODUCT_NAME = "DeerX HRMS";

/** For places the full name would crowd — a nav mark, a favicon tooltip. */
export const PRODUCT_SHORT = "DeerX";
