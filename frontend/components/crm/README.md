# CRM UI

Phase 10. Pairs with `hooks/useCrm.ts` and `types/crm.ts`. No dedicated
top-level sidebar sub-items for Clients/Deals/Projects (the sidebar was
already at 6 top-level entries) — `CrmSubNav.tsx` is a shared tab bar
rendered at the top of all three `/crm/*` pages instead, and `/crm`
itself just redirects to `/crm/clients`.

- **`ClientDetailDialog.tsx`** — a wide modal with four tabs (Contacts,
  Deals, Projects, Activity), each its own panel component fetching and
  inline-creating records scoped to that client. Kept as one file with
  four small panel components rather than four separate files — none of
  them are reusable outside this dialog.
- **`DealsKanban.tsx`** — `@hello-pangea/dnd` (the first drag-and-drop
  library added purely for a board UI, distinct from `react-big-calendar`
  in Phase 8 which is calendar-specific). Five droppable columns (one per
  `Deal.Stage`); dropping a card into a different column is a single
  `PATCH { stage }` via `useUpdateDeal`. `app/crm/deals/page.tsx` toggles
  between this and a plain `DataGrid` list view (with an inline stage
  `<select>` per row) via two icon buttons — both view modes were
  explicitly requested, not just the kanban board.
- **`CrmSubNav.tsx`** — plain `Tabs` + `next/link`, active tab derived
  from `usePathname()`.

## A deliberate permission choice, not an oversight

Every CRM write endpoint accepts any authenticated user, not just HR —
see `backend/crm/README.md`. The frontend doesn't hide any CRM actions
behind a role check for this reason; there's no CRM-specific
"can manage" gate anywhere in this directory.
