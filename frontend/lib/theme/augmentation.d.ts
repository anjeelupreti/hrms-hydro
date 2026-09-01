import type { CssVarsTheme } from "@mui/material/styles";
import type { DATA_PALETTE, MOTION, ModuleKey, RADIUS, STATUS, Density } from "./tokens";

/**
 * Puts our own tokens on the MUI theme object.
 *
 * Without this, `theme.hrms.rowHeight` is a type error and `createTheme({ hrms:
 * … })` is rejected outright. Both `Theme` and `ThemeOptions` need augmenting —
 * the first is what components read, the second is what the factory is allowed
 * to pass in.
 *
 * The density fields are written out rather than derived from `typeof DENSITY`:
 * that type is a *union* of the two variants, and an interface cannot extend a
 * union, so every field would come back as "does not exist".
 */

interface DensityTokens {
  rowHeight: number;
  headerHeight: number;
  cellPaddingY: number;
  cellPaddingX: number;
  listItemPaddingY: number;
  controlHeight: number;
  cardPadding: number;
  /** Spacing multipliers, not pixels — pass straight to `px` / `py`. */
  pageGutterX: number;
  pageGutterY: number;
}

interface HrmsTokens extends DensityTokens {
  density: Density;
  radius: typeof RADIUS;
  status: typeof STATUS;
  /** Derived from the system accent, so these are runtime strings
   *  rather than the literal fallbacks `MODULE_HUE` declares. The keys
   *  still come from that constant — it remains the list of modules. */
  module: Record<ModuleKey, string>;
  data: Omit<typeof DATA_PALETTE, "categorical" | "categoricalDark"> & {
    categorical: string[];
    categoricalDark: string[];
  };
  motion: typeof MOTION;
}

declare module "@mui/material/styles" {
  interface Theme {
    hrms: HrmsTokens;
  }
  interface ThemeOptions {
    hrms?: HrmsTokens;
  }

  /**
   * MUI types `vars` as optional because `cssVariables` can be switched off.
   * Ours never is (see `buildTheme`), and the distinction matters: reading
   * `theme.palette.*` in an sx callback resolves against the *default* scheme
   * and bakes a literal, so a colour picked that way stops responding to
   * light/dark. `theme.vars.*` emits the live custom property instead.
   *
   * Marking it required is what lets `theme.vars.palette.background.paper` be
   * written without a non-null assertion at every call site — the assertion
   * being exactly the friction that pushed people back to `theme.palette`.
   */
  interface Theme {
    vars: CssVarsTheme["vars"];
  }
}
