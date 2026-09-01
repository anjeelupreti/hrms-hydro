/**
 * First-run readiness.
 *
 * Every field here is **derived on the server from live data**. Nothing is a
 * stored completion flag, which is why `done` can go back to `false` — that is
 * the feature, not a bug: a check that kept claiming Done after the thing was
 * deleted would be trusted and wrong.
 */

export type SetupTier = "must" | "recommended" | "advanced";

export type SetupCheck = {
  key: string;
  domain: string;
  title: string;
  /** Why it matters, stated as the consequence rather than the requirement. */
  why: string;
  /** Where to go and do it. */
  href: string;
  done: boolean;
  /** False for must-haves. Enforced server-side, not just hidden here. */
  skippable: boolean;
  skipped: boolean;
  skip_reason: string | null;
};

export type SetupReadiness = {
  tiers: Record<SetupTier, SetupCheck[]>;
  must_total: number;
  must_done: number;
  /**
   * The headline, counting **must-haves only**.
   *
   * The company who has done everything that stops them paying people correctly
   * is ready; showing 71% because they have not uploaded a logo turns the one
   * number that matters into decoration.
   */
  percent: number;
  is_ready: boolean;
  /** Must-haves still outstanding — what actually blocks a first payroll. */
  blocking: SetupCheck[];
  optional_total: number;
  optional_settled: number;
};

export const TIER_LABEL: Record<SetupTier, string> = {
  must: "Before anyone can be paid",
  recommended: "You'll feel the absence in month one",
  advanced: "For the modules you're using",
};
