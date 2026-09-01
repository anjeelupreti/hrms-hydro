# Dashboard UI (`app/dashboard/page.tsx`)

Every number and list on this page is real HRMS data. There are no fabricated
metrics and no invented "vs. last period" deltas — a delta is drawn only where
a previous period actually exists to compare against. See
`docs/development-plan.md` for the mapping decision behind that rule.

Data hook: `hooks/useDashboard.ts`. Types: `types/dashboard.ts`. The endpoint is
`backend/dashboard/views.py`.

## The rule the cards share

**The finding goes in words above the marks.** Every analytics card opens with
one caption naming what the chart shows — *"Tuesday was thinnest at 74"*,
*"Engineering is furthest through at 81%"* — and the chart underneath is the
evidence for it. A card that draws a shape and leaves the reader to infer the
point is a card that has not finished its job.

## Chrome and layout

- **`StatCard.tsx`** — label, value, optional hint and destination. No delta
  chip unless the data supports one.
- **`SectionCard`** (`components/common/`) — the one header + spacing wrapper
  for a dashboard card. Cards that hand-roll their own `Typography` + padding
  are why no two used to line up.
- **`DashboardTopBar.tsx`** — title, a real employee search (navigates to
  `/employees?search=…`), today's date, a client-side CSV export of the
  recently-joined list, and the account menu.
- **`AttentionBar.tsx`** — one strip for everything waiting on the reader:
  pending change requests, approvals, active announcements. Given a banner each
  they crowd out the page they sit above.
- **`AnnouncementsRail.tsx`**, **`CardEmpty.tsx`**, **`AnimatedNumber.tsx`** —
  supporting pieces.

## The charts, and the question each answers

| Component | Question | Form, and why |
|---|---|---|
| `WeekAttendance` | How many were in, each day? | Columns. Late is drawn as a hatched share *inside* the day's column — it is counted within present, so a second bar would invite adding 77 + 12 and reading 89 out of 88. Closed days are hollow, not zero. |
| `DeptAttendance` | Which team is thin? | `RateDots`, ranked worst-first. Rates cluster at 87–100%, and a bar must start at zero — so near-identical bars. A dot encodes position and may sit on a truncated scale, provided the floor is drawn and labelled. |
| `DepartmentDonut` | What is headcount made of? | A ring, the one on this page. Uses `foldSeries` so a ninth department becomes "Other" rather than reusing the first department's colour. |
| `LeaveMix` | What did people take leave *for*? | `RankedBars`, not a second ring. Bars share a baseline, so which type dominates is read rather than estimated from arc lengths. |
| `LeaveUsageDots` | Is a department running out of leave? | Used against entitlement, one track per department. Each track is its own 100% — Engineering has 2,084 days and HR 322, and a shared scale would squash the small teams to a stub. |
| `UnitBreakdown` | What is this month made of? | A hundred-square waffle. At these sizes a stacked bar turns 4% into three pixels; a hundred squares makes "four in a hundred" countable. |
| `WorkforcePyramid` | How long have people been here? | A split pyramid, both wings on one scale. Letting each half scale to its own maximum is what makes a diverging chart lie. |
| `HiringFunnel` | Where are the candidates now? | Occupancy in stage order — **not** conversion. `by_stage` is a snapshot of where people sit, and dividing adjacent stages by each other produces "133%" the moment somebody moves on. The recruitment page's own funnel recovers cumulative counts and *can* show conversion; this one deliberately does not. |
| `ClaimsFlow` | How much expense money is stuck, and on whom? | One segmented bar of a single total, by amount rather than by count. "Seven claims pending" does not say whether that is a lunch receipt or a fortnight of site travel. |
| `PayrollSummaryCard` | Is this month's payroll unusual? | `MiniBars` over the last six runs, with a delta against the previous one — shown only when a previous run exists and was not zero, because a percentage change from nothing is not a percentage. |
| `RightNowCard` | Who is out, who has arrived? | Names where there are few enough; counts above that. |
| `PersonStrip` | Birthdays, upcoming leave, new joiners | One component, three variants. Faces, because a photograph is the fastest way to recognise somebody. |
| `MyAttendanceWidget`, `CompanyPulse` | Personal and secondary counts | Tiles. |

## Colour

Series colours come from `seriesColor()` in `lib/theme/chartSeries.ts`, never
from `palette[i % palette.length]` — cycling paints two different categories
identically, which is worse than running out. Past the validated palette,
`foldSeries()` groups the tail into one grey "Other". The palette itself
(`DATA_PALETTE` in `lib/theme/tokens.ts`) is validator output, not taste: a
lightness band, a chroma floor, adjacent-pair separation under deuteranopia and
tritanopia, and contrast against each scheme's own surface.
