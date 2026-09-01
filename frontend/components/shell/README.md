# App Shell

- **`AppSidebar.tsx`** — the primary navigation, `md`+ screens only (fixed,
  left, `SIDEBAR_WIDTH = 260`px, exported so `AppShellLayout` can offset
  main content by the same value). Logo, nav items with an animated
  active-item pill (`motion.div layoutId="sidebar-active-pill"`, same
  spring-pill technique `FloatingNav` used), and a user account card
  pinned at the bottom (avatar/name/role, opens a menu: notifications,
  settings, holidays, log out).
- **`FloatingNav.tsx`** — now the **mobile fallback** only
  (`display: { xs: "flex", md: "none" }`), not the primary nav. Switched
  from primary-nav to fallback when the shell moved to a sidebar layout
  (see `docs/development-plan.md` — a prior explicit "no traditional sidebar"
  decision was reversed on request after seeing a reference design).
  Keep both in sync when adding a new top-level nav destination — add it
  to `NAV_ITEMS` in both files.
- **`AppShellLayout.tsx`** — renders both `AppSidebar` and `FloatingNav`
  (CSS `display` sorts out which one is visible at a given breakpoint;
  never both, never neither), and offsets `<main>` by `SIDEBAR_WIDTH` on
  `md`+ via `ml: { xs: 0, md: \`${SIDEBAR_WIDTH}px\` }`.
