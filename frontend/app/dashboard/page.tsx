"use client";

import Divider from "@mui/material/Divider";
import Grid from "@mui/material/Grid";
import Skeleton from "@mui/material/Skeleton";
import Typography from "@mui/material/Typography";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";

import { motion } from "motion/react";

import HeroPanel from "@/components/common/HeroPanel";
import PageContainer from "@/components/shell/PageContainer";
import ClockWidget from "@/components/attendance/ClockWidget";
import AnnouncementsRail from "@/components/dashboard/AnnouncementsRail";
import AttentionBar from "@/components/dashboard/AttentionBar";
import HiringFunnel from "@/components/dashboard/HiringFunnel";
import ClaimsFlow from "@/components/dashboard/ClaimsFlow";
import LeaveMix from "@/components/dashboard/LeaveMix";
import UnitBreakdown from "@/components/dashboard/UnitBreakdown";
import DeptAttendance from "@/components/dashboard/DeptAttendance";
import WorkforcePyramid from "@/components/dashboard/WorkforcePyramid";
import WeekAttendance from "@/components/dashboard/WeekAttendance";
import PersonStrip from "@/components/dashboard/PersonStrip";
import CompanyPulse from "@/components/dashboard/CompanyPulse";
import DashboardTopBar from "@/components/dashboard/DashboardTopBar";
import PayrollSummaryCard from "@/components/dashboard/PayrollSummaryCard";
import LeaveUsageDots from "@/components/dashboard/LeaveUsageDots";
import MyAttendanceWidget from "@/components/dashboard/MyAttendanceWidget";
import RightNowCard from "@/components/dashboard/RightNowCard";
import { useDashboardSummary } from "@/hooks/useDashboard";
import { useMe } from "@/hooks/useMe";

const containerVariants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.1 } },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { type: "spring" as const, stiffness: 300, damping: 24 } },
};

/**
 * Row heights, named once.
 *
 * A skeleton is a promise about how much space is about to be filled. When the
 * placeholders in one row disagree — 340 beside 260 — the page settles by
 * jumping, and the eye reads the jump as a fault rather than as loading.
 */
const CHART_ROW = 340;

/**
 * The only chart in the product drawn by a charting library.
 *
 * `@mui/x-charts` is the heaviest dependency here and exactly one component
 * uses it — this donut, three quarters of the way down the page everybody
 * lands on. Every other figure on this dashboard is drawn by hand. Importing
 * it statically put a charting engine in the critical path of the first screen
 * after login so that one card could render a pie.
 *
 * Loaded on demand instead, behind the same `CHART_ROW` skeleton the card
 * already shows while its data is in flight — so the layout does not move when
 * the chunk lands, and the wait is indistinguishable from the wait for the
 * numbers themselves.
 *
 * `ssr: false` because it renders to a `<canvas>`-shaped tree that is thrown
 * away and rebuilt on hydration; server-rendering it costs work twice and buys
 * nothing.
 */
const DepartmentDonut = dynamic(() => import("@/components/dashboard/DepartmentDonut"), {
  ssr: false,
  loading: () => <Skeleton variant="rounded" height={CHART_ROW} />,
});
const PANEL_ROW = 288;
const PEOPLE_ROW = 248;

/** A section label, so the page reads as chapters rather than one long grid. */
function SectionLabel({ children }: { children: string }) {
  return (
    <Typography variant="overline" sx={{ color: "text.secondary", display: "block", mb: 1.5 }}>
      {children}
    </Typography>
  );
}

export default function Home() {
  const { data: me } = useMe();
  const router = useRouter();
  const { data: summary, isLoading } = useDashboardSummary();

  const loading = isLoading || !summary;

  /**
   * Has today produced any attendance at all?
   *
   * Derived rather than fetched: a shift start time is per-employee and per
   * shift, so there is no single "the day starts at 9" to compare a clock
   * against — and asking the browser's clock would be the timezone bug this
   * session has now fixed three times. If not one person is marked present,
   * absent or on leave, nothing has been recorded, which is what "the day has
   * not started" actually means.
   */
  const dayHasStarted = Boolean(
    summary &&
      (summary.present_today > 0 || summary.absent_today > 0 || summary.on_leave_today > 0),
  );

  return (
    <PageContainer>
      <DashboardTopBar recentEmployees={summary?.recent_employees ?? []} />

      {/* One strip rather than a stack of full-width alerts: `AttentionBar`
          for what needs a decision, `AnnouncementsRail` for what needs knowing.
          Both vanish when empty, so nothing stands between the reader and the
          first number unless it has earned the space. */}
      <AttentionBar pendingApprovals={summary?.pending_my_approval ?? 0} />
      <AnnouncementsRail />

      {/*
        The page leads with one number rather than four equal tiles.
        Four identically-weighted cards say everything matters equally, which
        says nothing — and the number a person actually opens this page for is
        "is my team here today". `present_today` was already being fetched and
        thrown away; the four tiles it replaces showed the headcount, the two
        exception counts and the approval queue, all of which are supporting
        figures to that one, and all of which are still here as such.
      */}
      {loading ? (
        <Skeleton variant="rounded" height={180} sx={{ mb: 3, borderRadius: 4 }} />
      ) : (
        <HeroPanel
          {...(summary.today_is_working && dayHasStarted
            ? {
                eyebrow: "Present today",
                value: `${summary.present_today}`,
                caption: `of ${summary.total_employees} active ${
                  summary.total_employees === 1 ? "person" : "people"
                }`,
              }
            : summary.today_is_working
              ? {
                  // Early morning on a working day: nothing recorded yet is
                  // not the same fact as nobody came in. Without this the
                  // largest element on the page reads "0 of 88" every morning
                  // until people start arriving.
                  eyebrow: "Nobody has clocked in yet",
                  value: `${summary.total_employees}`,
                  caption: "active people · the day has not started",
                }
              : {
                // A closed day. "0 of 95" would be correct and would read as
                // an emergency every weekend, with nothing to distinguish
                // "nobody came in" from "nobody was expected".
                //
                // The headcount still leads, because on a closed day the
                // question the page can actually answer is "how big are we",
                // not "who is in". Printing a zero nobody should act on is how
                // a dashboard teaches people to stop reading it.
                eyebrow: "Closed today",
                value: `${summary.total_employees}`,
                caption: "active people · not a working day for this company",
              })}
          tone="dashboard"
          figures={
            summary.today_is_working && dayHasStarted
              ? [
                  { label: "On leave", value: `${summary.on_leave_today}` },
                  { label: "Absent", value: `${summary.absent_today}` },
                  // Approvals are deliberately absent here: the attention
                  // strip above carries that count with the queue behind it,
                  // and a figure stated twice makes a reader check whether the
                  // two agree instead of reading either.
                ]
              : // "On leave 0 · Absent 0" on a Saturday is two zeros dressed as
                // information, and approvals now live in the strip above.
                []
          }
        />
      )}

      <motion.div variants={containerVariants} initial="hidden" animate="show">
        {/*
          **Every row adds to twelve.** Four `md={4}` cards in one container
          is sixteen columns: the fourth wraps and sits alone against two-thirds
          of empty page, and the next section starts at a different height on
          each side.

          The rhythm is 8/4 — a chart that needs width beside a card that reads
          as a column — then 6/6, then 4/4/4. Skeleton heights match the row
          they stand in, so the page does not jump as each card lands.
        */}

        {/*
          **Paired by how tall their content actually is.** A row stretches every
          card to the tallest, so putting a 270px chart beside a 120px summary
          leaves 150px of empty card — which is what made the page look unfinished
          even after the columns added up. The trend chart goes with the donut
          because both are tall; the heatmap goes with the month's figures because
          both are short.
        */}

        {/* Today — the week's shape, and the split it is made of. */}
        <SectionLabel>Today</SectionLabel>
        <Grid container spacing={2} sx={{ mb: 3 }}>
          <Grid size={{ xs: 12, md: 8 }}>
            <motion.div variants={itemVariants} style={{ height: "100%" }}>
              {loading ? (
                <Skeleton variant="rounded" height={CHART_ROW} />
              ) : (
                <WeekAttendance data={summary.attendance_trend} />
              )}
            </motion.div>
          </Grid>
          <Grid size={{ xs: 12, md: 4 }}>
            <motion.div variants={itemVariants} style={{ height: "100%" }}>
              {loading ? (
                <Skeleton variant="rounded" height={CHART_ROW} />
              ) : (
                <DepartmentDonut data={summary.department_distribution} />
              )}
            </motion.div>
          </Grid>
        </Grid>

        {/* Patterns — the same subjects widened from today to the period, which
            is where a shape shows up that a single day cannot. */}
        <SectionLabel>Patterns</SectionLabel>
        <Grid container spacing={2} sx={{ mb: 2 }}>
          {/* The heatmap needs the width: a column per day and a row per
              department, and squeezed into a third it stops being readable. */}
          <Grid size={{ xs: 12, md: 8 }}>
            <motion.div variants={itemVariants} style={{ height: "100%" }}>
              {loading ? (
                <Skeleton variant="rounded" height={PANEL_ROW} />
              ) : (
                <DeptAttendance data={summary.attendance_heatmap} />
              )}
            </motion.div>
          </Grid>
          {/* The month's figures beside the fortnight's shape. Same subject,
              two time-frames — the comparison is the point. */}
          <Grid size={{ xs: 12, md: 4 }}>
            <motion.div variants={itemVariants} style={{ height: "100%" }}>
              {loading ? (
                <Skeleton variant="rounded" height={PANEL_ROW} />
              ) : (
                <UnitBreakdown
                  title="This month, day by day"
                  subtitle="Every logged day, by how it ended"
                  empty="No attendance logged this month yet."
                  unit="day"
                  headline={{
                    value: `${Math.round(
                      ((summary.attendance_month.present + summary.attendance_month.late) /
                        Math.max(
                          summary.attendance_month.present +
                            summary.attendance_month.late +
                            summary.attendance_month.absent +
                            summary.attendance_month.half_day,
                          1,
                        )) *
                        100,
                    )}%`,
                    caption: "of logged days were worked",
                  }}
                  parts={[
                    { label: "On time", value: summary.attendance_month.present },
                    { label: "Late", value: summary.attendance_month.late },
                    { label: "Half day", value: summary.attendance_month.half_day },
                    { label: "Absent", value: summary.attendance_month.absent },
                  ]}
                />
              )}
            </motion.div>
          </Grid>
        </Grid>
        <Grid container spacing={2} sx={{ mb: 3 }}>
          {/* Two halves rather than three thirds and a gap. Both are leave, and
              they read as a pair: what was taken, and how much is left. */}
          <Grid size={{ xs: 12, md: 6 }}>
            <motion.div variants={itemVariants} style={{ height: "100%" }}>
              {loading ? (
                <Skeleton variant="rounded" height={PANEL_ROW} />
              ) : (
                <LeaveMix data={summary.leave_breakdown} />
              )}
            </motion.div>
          </Grid>
          <Grid size={{ xs: 12, md: 6 }}>
            <motion.div variants={itemVariants} style={{ height: "100%" }}>
              {loading ? (
                <Skeleton variant="rounded" height={PANEL_ROW} />
              ) : (
                <LeaveUsageDots data={summary.leave_usage} />
              )}
            </motion.div>
          </Grid>
        </Grid>

        {/* People — the human feed. Faces and names, not counts. */}
        <SectionLabel>People</SectionLabel>
        <Grid container spacing={2} sx={{ mb: 3 }}>
          <Grid size={{ xs: 12, md: 8 }}>
            <motion.div variants={itemVariants} style={{ height: "100%" }}>
              {loading ? (
                <Skeleton variant="rounded" height={PEOPLE_ROW} />
              ) : (
                <WorkforcePyramid data={summary.workforce_tenure} />
              )}
            </motion.div>
          </Grid>

          {/* One card for three answers — on leave, latest check-ins, remote
              today. Given a frame each they are three titles over one sentence
              between them, stretched to the height of the chart beside them:
              empty cards weighted like full ones, which is what reads as a
              misarranged grid. */}
          <Grid size={{ xs: 12, md: 4 }}>
            <motion.div variants={itemVariants} style={{ height: "100%" }}>
              {loading ? (
                <Skeleton variant="rounded" height={PEOPLE_ROW} />
              ) : (
                <RightNowCard
                  onLeave={summary.on_leave_today_list}
                  checkins={summary.recent_checkins}
                  // `remoteToday` omitted on purpose. `CompanyPulse` already
                  // shows it in the Elsewhere strip from its own query, so
                  // passing it here would state the same figure twice on one
                  // screen — the duplication that had to be removed from the
                  // finance Books page for the same reason.
                  //
                  // The card defaults it to `null`, not `0`: this summary genuinely
                  // does not carry the field, and "Nobody is remote today" from
                  // data we never fetched is a confident sentence about nothing.
                />
              )}
            </motion.div>
          </Grid>

          {/* Three people strips at 4/4/4 — same weight each, one row rather
              than two, and wide enough that the person cards inside are not
              sliced in half by the column edge. */}
          <Grid size={{ xs: 12, md: 4 }}>
            <motion.div variants={itemVariants} style={{ height: "100%" }}>
              {loading ? (
                <Skeleton variant="rounded" height={PEOPLE_ROW} />
              ) : (
                <PersonStrip
                  title="Birthdays"
                  subtitle="Today and the next few weeks"
                  empty="No birthdays coming up."
                  variant="birthday"
                  onOpen={(id) => router.push(`/employees/${id}`)}
                  people={[
                    // Today first, and marked — a birthday you can still act on
                    // is a different thing from one three weeks out.
                    ...summary.todays_birthdays.map((person) => ({
                      id: `today-${person.id}`,
                      name: person.full_name,
                      photo: person.photo,
                      detail: person.designation_title ?? person.department_name,
                      code: person.employee_code,
                      extra: person.department_name
                        ? { label: "Team", value: person.department_name }
                        : null,
                      badge: "Today",
                      // The owner's rule: only *today* gets the bright badge.
                      highlight: true,
                    })),
                    ...summary.upcoming_birthdays.map((person) => ({
                      id: person.employee_id,
                      name: person.employee,
                      detail: null,
                      badge: `in ${person.days_until}d`,
                    })),
                  ]}
                />
              )}
            </motion.div>
          </Grid>
          <Grid size={{ xs: 12, md: 4 }}>
            <motion.div variants={itemVariants} style={{ height: "100%" }}>
              {loading ? (
                <Skeleton variant="rounded" height={PEOPLE_ROW} />
              ) : (
                <PersonStrip
                  title="Upcoming leave"
                  subtitle="Approved, starting soon"
                  empty="Nobody is booked off."
                  defaultView="list"
                  onOpen={(id) => router.push(`/employees/${id}`)}
                  people={summary.upcoming_leaves.map((leave) => ({
                    id: leave.id,
                    name: leave.employee_name,
                    detail: leave.leave_type_name,
                    badge: leave.start_date,
                  }))}
                />
              )}
            </motion.div>
          </Grid>
          <Grid size={{ xs: 12, md: 4 }}>
            <motion.div variants={itemVariants} style={{ height: "100%" }}>
              {loading ? (
                <Skeleton variant="rounded" height={PEOPLE_ROW} />
              ) : (
                <PersonStrip
                  title="Recently joined"
                  subtitle="The newest people on the books"
                  empty="Nobody has joined recently."
                  variant="joiner"
                  onOpen={(id) => router.push(`/employees/${id}`)}
                  people={summary.recent_employees.map((person) => ({
                    id: person.id,
                    name: person.full_name,
                    photo: person.photo,
                    detail: person.designation_title ?? person.department_name,
                    code: person.employee_code,
                    extra: person.department_name
                      ? { label: "Team", value: person.department_name }
                      : null,
                  }))}
                />
              )}
            </motion.div>
          </Grid>
        </Grid>

        {/* The modules beyond timekeeping — otherwise "your team at a glance"
            means "your team's attendance at a glance" and the rest of what a
            company pays for is invisible on the page it opens every morning.

            Two forms the dashboard does not otherwise use: a funnel for a
            pipeline that narrows, and one segmented total for money split by
            who is holding it up. */}
        <SectionLabel>Across the system</SectionLabel>
        <Grid container spacing={2} sx={{ mb: 3 }}>
          <Grid size={{ xs: 12, md: 6 }}>
            <motion.div variants={itemVariants} style={{ height: "100%" }}>
              <HiringFunnel />
            </motion.div>
          </Grid>
          <Grid size={{ xs: 12, md: 6 }}>
            <motion.div variants={itemVariants} style={{ height: "100%" }}>
              <ClaimsFlow />
            </motion.div>
          </Grid>
        </Grid>

        {/* One row for four facts of the same weight — a number and where to
            go for it. Payroll takes half, the two counts a quarter each; given
            a row apiece they are ~300px of mostly white page. */}
        <Grid container spacing={2} sx={{ mb: 3 }}>
          {summary?.payroll_summary && (
            <Grid size={{ xs: 12, md: 6 }}>
              <motion.div variants={itemVariants} style={{ height: "100%" }}>
                <PayrollSummaryCard data={summary.payroll_summary} />
              </motion.div>
            </Grid>
          )}
          <CompanyPulse />
        </Grid>
      </motion.div>

      {me?.employee_id && (
        <motion.div variants={containerVariants} initial="hidden" whileInView="show" viewport={{ once: true }}>
          <Divider sx={{ my: 4 }} />
          <Typography variant="h6" sx={{ fontWeight: 700, mb: 2 }}>
            My Day
          </Typography>
          <Grid container spacing={2}>
            <Grid size={{ xs: 12, md: 5 }}>
              <motion.div variants={itemVariants} style={{ height: "100%" }}>
                <ClockWidget />
              </motion.div>
            </Grid>
            <Grid size={{ xs: 12, md: 7 }}>
              <motion.div variants={itemVariants} style={{ height: "100%" }}>
                {/* No personal activity feed here. This is the company
                    dashboard, read mostly by HR and owners looking at everyone;
                    "my punches, my requests" belongs in My workspace, where it
                    lives. */}
              </motion.div>
            </Grid>
            <Grid size={12}>
              <motion.div variants={itemVariants} style={{ height: "100%" }}>
                <MyAttendanceWidget employeeId={me.employee_id} />
              </motion.div>
            </Grid>
          </Grid>
        </motion.div>
      )}
    </PageContainer>
  );
}
