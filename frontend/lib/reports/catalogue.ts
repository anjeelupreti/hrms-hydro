import { REPORT_ENTRIES } from "@/lib/reports/entries";
import { MODULE_HUE } from "@/lib/theme/tokens";

/**
 * The report library.
 *
 * Every report carries the question it settles, in the words somebody would ask
 * it in. A strip of nouns — "Team", "Attendance", "Leave" — says which table is
 * about to appear and nothing about which question it answers, so choosing one
 * means opening all of them.
 *
 * **Grouped the way the product is grouped**, not alphabetically: People, Time,
 * Money and Workplace are the families the navigation already uses, so a report
 * lives where its module lives.
 *
 * **Coloured by group, not by module.** `MODULE_HUE` has no key for remote work
 * or expenses, and adding two would have been the wrong fix: `deriveModuleHues`
 * spreads hues by *index over the whole set*, so two new keys would repaint
 * every module in the sidebar as a side effect of a reports change. Four
 * families, four colours — which is also the grouping the reader is using.
 *
 * The `key` is the backend's `?type=`. Adding a report is an entry here and a
 * `_report_<key>` method there — the envelope, the XLSX export and this page's
 * rendering all come for free.
 */

export type ReportGroup = "People" | "Time" | "Money" | "Workplace";

export const GROUP_HUE: Record<ReportGroup, string> = {
  People: MODULE_HUE.employees,
  Time: MODULE_HUE.attendance,
  Money: MODULE_HUE.payroll,
  Workplace: MODULE_HUE.assets,
};

export const REPORT_GROUPS: ReportGroup[] = ["People", "Time", "Money", "Workplace"];

export type ReportDefinition = {
  key: string;
  name: string;
  /** The question this settles, phrased as somebody would ask it. */
  question: string;
  group: ReportGroup;
  /**
   * Reports whose subject is *now* rather than a span. The date range still
   * shows — it is one control above every report — but saying so stops
   * somebody narrowing the range and wondering why nothing changed.
   */
  snapshot?: boolean;
  /**
   * Reports whose interesting data is usually ahead: training is scheduled,
   * not recorded. Used to offer a forward range rather than showing an empty
   * table and letting the reader conclude nothing exists.
   */
  forward?: boolean;
  /**
   * Takes a `?department=`.
   *
   * On a hundred people across eight departments the question is nearly always
   * about *one* team, and exporting to Excel to filter is the thing a report
   * exists to avoid.
   *
   * Declared per report rather than shown everywhere, and mirrored by
   * `DEPARTMENT_FILTERABLE` on the server: a department control over the asset
   * register would silently do nothing, and a control that does nothing is
   * worse than one that is absent.
   */
  byDepartment?: boolean;
};

/** The list lives in `entries.ts` — it is the half that grows with every
 *  module, and it was crowding the types and the group colours out of view. */
export const REPORTS: ReportDefinition[] = REPORT_ENTRIES;

export function reportByKey(key: string) {
  return REPORTS.find((report) => report.key === key);
}
