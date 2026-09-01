"use client";

import AccessTimeIcon from "@mui/icons-material/AccessTime";
import AssignmentIcon from "@mui/icons-material/Assignment";
import BeachAccessIcon from "@mui/icons-material/BeachAccess";
import PendingActionsIcon from "@mui/icons-material/PendingActions";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import LinearProgress from "@mui/material/LinearProgress";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

import AttendanceMiniMonth from "@/components/attendance/AttendanceMiniMonth";
import AssignedToMe from "@/components/portal/AssignedToMe";
import StaffIdCard from "@/components/portal/StaffIdCard";
import NotesCard from "@/components/portal/NotesCard";
import TodoList from "@/components/portal/TodoList";
import DayFulfilment from "@/components/attendance/DayFulfilment";
import { useMyPunchHistory, useMyTodayAttendance } from "@/hooks/useAttendance";
import { useMyProfile } from "@/hooks/useProfile";
import Link from "next/link";
import { useState } from "react";

import ClockWidget from "@/components/attendance/ClockWidget";
import PunchHistory from "@/components/attendance/PunchHistory";
import ContributionTotals from "@/components/payroll/ContributionTotals";
import TaxPlanner from "@/components/payroll/TaxPlanner";
import Amount from "@/components/common/Amount";
import HeroPanel from "@/components/common/HeroPanel";
import YearScrubber from "@/components/common/YearScrubber";
import PageContainer from "@/components/shell/PageContainer";
import StatTile from "@/components/common/StatTile";
import { CURRENCY_PREFIX, money } from "@/lib/format/money";
import { usePortalSummary } from "@/hooks/usePortal";
import { useContributionTotals, useTaxPlanner } from "@/hooks/usePayroll";


function days(value: string | number | undefined) {
  const amount = Number(value ?? 0);
  // Trailing ".0" on a day count reads like a rounding artefact; a half day is
  // the only fraction that occurs and it should show.
  return Number.isInteger(amount) ? String(amount) : amount.toFixed(1);
}

export default function PortalPage() {
  const [fiscalYear, setFiscalYear] = useState<number | undefined>(undefined);
  const { data, isLoading, error } = usePortalSummary(fiscalYear);
  const { data: today } = useMyTodayAttendance();
  const { data: history } = useMyPunchHistory();
  // Only for the badge's photograph — the portal summary carries every other
  // field the card needs, and a card of initials is a poorer badge.
  const { data: profile } = useMyProfile(true);

  // The same two queries `ContributionTotals` and `TaxPlanner` run. React Query
  // dedupes on the key, so reading them here costs no extra request — and it is
  // the only way the page can know that all three of its pay panels have
  // nothing to show and collapse them into one line.
  const { data: contributions } = useContributionTotals();
  const { data: taxProjection } = useTaxPlanner();

  // The working day comes from the server — see `working_day_seconds`. The
  // first version of this subtracted nothing and used the raw office span, so
  // a nine-to-six with an hour for lunch reported a nine-hour target when the
  // paid day is eight.
  const workingDaySeconds = today?.working_day_seconds ?? null;

  if (isLoading) {
    return (
      <PageContainer>
        <Skeleton variant="rounded" height={150} sx={{ mb: 2 }} />
        <Skeleton variant="rounded" height={320} />
      </PageContainer>
    );
  }

  // An HR admin who is not themselves an employee is a real configuration, so
  // this says what is true rather than rendering an empty portal.
  if (error?.message === "no_employee_record") {
    return (
      <PageContainer>
        <Alert severity="info" sx={{ mt: 2 }}>
          This account has no employee record, so there is no personal view to show.
          Ask HR to link your account to an employee.
        </Alert>
      </PageContainer>
    );
  }
  if (error || !data) {
    return (
      <PageContainer>
        <Alert severity="error" sx={{ mt: 2 }}>Could not load your portal.</Alert>
      </PageContainer>
    );
  }

  const { me, attendance, leave, pay, work, requests, fiscal_year } = data;
  const currentYear = fiscal_year.year;
  const yearOptions = [currentYear + 1, currentYear, currentYear - 1, currentYear - 2];

  /**
   * All three pay panels have nothing to show.
   *
   * **Only when all three are empty.** Collapsing them one at a time would be
   * the same clutter with gaps in it; the single line is worth having precisely
   * because it replaces the whole run. `undefined` counts as not-empty so a
   * still-loading query never collapses a panel that is about to have content —
   * a card that appears a second after the page settles is worse than one that
   * was there all along.
   */
  const payIsEmpty =
    contributions !== undefined &&
    taxProjection !== undefined &&
    contributions.schemes.length === 0 &&
    !taxProjection.available &&
    leave.balances.length === 0;

  /** Nothing of mine is outstanding anywhere. */
  const nothingWaiting =
    requests.total_pending === 0 &&
    work.open_project_tasks + work.open_checklist_tasks === 0 &&
    work.my_onboarding_tasks === 0;

  return (
    <PageContainer>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={2}
        sx={{ alignItems: { sm: "center" }, justifyContent: "space-between", mb: 2 }}
      >
        <Box>
          <Typography variant="overline" color="text.secondary">
            {me.employee_code} · {me.designation ?? "—"}
            {me.department ? ` · ${me.department}` : ""}
          </Typography>
          <Typography variant="h4" sx={{ fontWeight: 800 }}>{me.name}</Typography>
          <Typography variant="body2" color="text.secondary">
            {me.tenure_years > 0
              ? `${me.tenure_years} year${me.tenure_years > 1 ? "s" : ""}, ${me.tenure_days % 365} days`
              : `${me.tenure_days} days`}
            {me.manager ? ` · reports to ${me.manager}` : ""}
          </Typography>
          {me.on_probation && (
            <Chip size="small" label="On probation" color="warning" sx={{ mt: 0.5 }} />
          )}
        </Box>

        {/* The filter every figure below obeys. Fiscal year, not calendar year —
            Shrawan to Ashad, which is what a leave balance is actually measured
            against here. */}
        <YearScrubber
          ariaLabel="Fiscal year"
          years={yearOptions}
          value={fiscalYear ?? currentYear}
          onChange={setFiscalYear}
          format={(year) => `${year}/${String((year + 1) % 100).padStart(2, "0")}`}
        />
      </Stack>

      <HeroPanel
        eyebrow={`FY ${fiscal_year.label} · my year so far`}
        value={
          pay.latest ? (
            <Amount personal value={money(pay.latest.net_pay)} prefix={CURRENCY_PREFIX} />
          ) : (
            "No payslip yet"
          )
        }
        caption={
          pay.latest
            ? `Latest payslip · ${pay.latest.period}${pay.latest.is_held ? " · held" : ""}`
            : "Your first payslip will appear here once a run is finalised"
        }
        figures={[
          {
            label: "Earned this year",
            value: <Amount personal value={money(pay.net_earned)} prefix={CURRENCY_PREFIX} />,
          },
          { label: "Leave remaining", value: `${days(leave.total_remaining)} days` },
          // Moved up out of "Waiting on someone", where it never belonged: a
          // payslip count is a record of what exists, not of what is
          // outstanding, and this panel is the page's pay panel.
          { label: "Payslips", value: String(pay.payslip_count) },
          { label: "Awaiting you", value: String(requests.total_pending) },
        ]}
      />

      {/* The one control an employee needs every day, on the page they land on.
          It lived only on `/dashboard` — and once that became HR-only, an
          employee had no way to clock in at all. The page an employee cannot
          reach is not a place to keep the button they use most. */}
      {/* **The clock, and the dial that gives it a scale.** The widget
          reports hours, the dial says how much of a day that is, and between
          them they answer one question — *am I where I should be right now* —
          so they sit together. The month is a different question on a different
          timescale, and lives further down. */}
      {/* The badge sits at the end of this row and everything else flows to
          its left. A personal workspace opens by saying who you are — a
          payslip figure over a row of counters is the shape of every other
          screen in the product, and says nothing this one is for. */}
      <Typography variant="overline" color="text.secondary" sx={{ mt: 3, display: "block" }}>
        Today
      </Typography>
      <Box
        sx={{
          display: "grid",
          gap: 2,
          gridTemplateColumns: { xs: "1fr", lg: "1fr auto auto" },
          alignItems: "stretch",
        }}
      >
        <ClockWidget />

        <Card variant="outlined" sx={{ display: "grid", placeItems: "center", px: 2.5, py: 2 }}>
          {/* The served figure counts closed sessions only — a total that
              changes between two reads cannot be summed — so the running
              stretch is passed separately and ticks inside. */}
          <DayFulfilment
            secondsWorked={today?.seconds_worked ?? 0}
            openSince={today?.open_since}
            targetSeconds={workingDaySeconds}
          />
        </Card>

        <StaffIdCard me={me} photo={profile?.photo} />
      </Box>

      {/* What somebody is meant to be doing, from `projects/tasks/mine`.
          Without it the page is a complete record of the employee as a
          timekeeping subject and says nothing about their work.

          Above attendance on purpose. What I owe somebody today outranks how my
          punctuality percentage is trending, and the page's first screen should
          be the half a person can act on. */}
      <Typography variant="overline" color="text.secondary" sx={{ mt: 3, display: "block" }}>
        Mine
      </Typography>
      {/* Full width above the two input cards rather than beside them. A list
          wants length, not a half column — and with nothing assigned it is a
          single strip rather than a 450px box holding one sentence. */}
      <AssignedToMe />
      <Box
        sx={{
          mt: 2,
          display: "grid",
          gap: 2,
          gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" },
          alignItems: "start",
        }}
      >
        <TodoList />
        <NotesCard />
      </Box>

      <Typography variant="overline" color="text.secondary" sx={{ mt: 3, display: "block" }}>
        Attendance
      </Typography>
      <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", sm: "repeat(4, 1fr)" } }}>
        <StatTile
          label="Attendance"
          /* Null, not zero — "no records" and "never turned up" are different
             facts, and showing the second for the first accuses somebody. */
          value={attendance.attendance_rate === null ? "—" : `${attendance.attendance_rate}%`}
          hint={`${attendance.days_logged} days logged`}
          tone="attendance"
          icon={<AccessTimeIcon />}
          href="/attendance"
        />
        <StatTile
          label="On time"
          value={attendance.punctuality_rate === null ? "—" : `${attendance.punctuality_rate}%`}
          hint={`${attendance.late} late`}
          tone={attendance.punctuality_rate !== null && attendance.punctuality_rate < 80 ? "warning" : "success"}
        />
        <StatTile label="Absences" value={attendance.absent} tone="danger" />
        <StatTile label="Half days" value={attendance.half_day} tone="info" />
      </Box>

      {/* The rates above answer "how am I doing"; these two answer "when was I
          actually in", which is the question somebody asks when a rate looks
          wrong to them. Directly under the tiles, because the second question
          is always prompted by the first.

          **The month and the last 30 days share the row.** The month was in a
          216px corner of the clock row, at a size where the numbers were barely
          legible and the shape of a week off was a smudge; the punch list ran
          the full width of the page to show a column of times that needed about
          a third of it. Two components, each the wrong width, in the wrong
          places. Side by side they are both the size their content asks for —
          and the pairing is the point, because the month says *which days* and
          the list says *what happened on one*. */}
      <Box
        sx={{
          mt: 2,
          display: "grid",
          gap: 2,
          gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" },
          alignItems: "start",
        }}
      >
        <Card>
          <CardContent>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.25 }}>
              {new Date().toLocaleDateString(undefined, { month: "long", year: "numeric" })}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 2 }}>
              Your month so far.
            </Typography>
            <AttendanceMiniMonth days={history?.days ?? []} size="full" />
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <PunchHistory />
          </CardContent>
        </Card>
      </Box>

      {/* When funds, tax and leave are all genuinely empty they collapse to
          one line naming what will appear and what has to happen first. Three
          cards each announcing absence is ~350px of furniture, and congested
          with nothing is still congested. The moment any of them has data it
          returns as a full card. */}
      {payIsEmpty ? (
        <Card variant="outlined" sx={{ mt: 2 }}>
          <CardContent sx={{ py: 1.75, "&:last-child": { pb: 1.75 } }}>
            <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.25 }}>
              Fund contributions, tax projection and leave balances
            </Typography>
            <Typography variant="caption" color="text.secondary">
              These appear once your first payslip is calculated and HR has set
              your allocation for FY {fiscal_year.label}.
            </Typography>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* What has gone into the funds. Sits with pay rather than under
              attendance, because it is money and the question it answers —
              "how much have I put in this year?" — is a payslip question. */}
          <Card sx={{ mt: 2 }}>
            <CardContent>
              <ContributionTotals pronoun="you" />
            </CardContent>
          </Card>

          {/* Directly under what has gone in, because the planner's question is
              the natural next one: "should I be putting in more?" */}
          <Card sx={{ mt: 2 }}>
            <CardContent>
              <TaxPlanner />
            </CardContent>
          </Card>
        </>
      )}

      {leave.balances.length > 0 && (
        <>
          <Typography variant="overline" color="text.secondary" sx={{ mt: 3, display: "block" }}>
            Leave
          </Typography>
          <Card>
            <CardContent>
            <Stack spacing={2}>
              {leave.balances.map((balance) => {
                const total = Number(balance.allocated) + Number(balance.carried_forward);
                const used = Number(balance.used);
                const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0;
                return (
                  <Box key={balance.leave_type}>
                    <Stack direction="row" sx={{ justifyContent: "space-between", mb: 0.5 }}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {balance.leave_type}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {days(balance.remaining)} of {days(total)} left
                      </Typography>
                    </Stack>
                    <LinearProgress variant="determinate" value={pct} sx={{ height: 6, borderRadius: 3 }} />
                  </Box>
                );
              })}
              <Divider />
              <Stack direction="row" spacing={3}>
                <Typography variant="body2" color="text.secondary">
                  Taken paid: <strong>{days(leave.taken_paid_days)}</strong>
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Taken unpaid: <strong>{days(leave.taken_unpaid_days)}</strong>
                </Typography>
              </Stack>
            </Stack>
            </CardContent>
          </Card>
        </>
      )}

      {/* A section headed "Waiting on someone" that has nothing waiting does
          not need four tiles to say so — and on a new joiner's workspace, which
          is when this page is emptiest, that is the guaranteed state.

          Counts of what *exists* rather than what is outstanding — payslips
          this year — belong in the pay section above, not here. */}
      <Typography variant="overline" color="text.secondary" sx={{ mt: 3, display: "block" }}>
        Waiting on someone
      </Typography>
      {nothingWaiting ? (
        <Card variant="outlined">
          <CardContent sx={{ py: 1.75, "&:last-child": { pb: 1.75 } }}>
            <Typography variant="body2" color="text.secondary">
              Nothing of yours is waiting on anybody — no open requests, tasks or
              onboarding steps.
            </Typography>
          </CardContent>
        </Card>
      ) : (
        <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", sm: "repeat(3, 1fr)" } }}>
          <StatTile
            label="My pending requests"
            value={requests.total_pending}
            hint="Leave, overtime, regularisation, expenses, WFH"
            tone={requests.total_pending > 0 ? "warning" : "success"}
            icon={<PendingActionsIcon />}
          />
          <StatTile
            label="Open tasks"
            value={work.open_project_tasks + work.open_checklist_tasks}
            tone="info"
            icon={<AssignmentIcon />}
          />
          <StatTile
            label="Onboarding steps left"
            value={work.my_onboarding_tasks}
            tone={work.my_onboarding_tasks > 0 ? "warning" : "success"}
          />
        </Box>
      )}

      <Typography variant="overline" color="text.secondary" sx={{ mt: 3, display: "block" }}>
        Raise a request
      </Typography>
      <Card>
        <CardContent>
          {/* One place to start anything, which is the thing a scattered set of
              module pages does not give you. */}
          <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1 }}>
            {[
              { label: "Apply for leave", href: "/leave", icon: <BeachAccessIcon fontSize="small" /> },
              { label: "Fix an attendance record", href: "/attendance" },
              { label: "Claim an expense", href: "/expenses" },
              { label: "Request remote work", href: "/wfh" },
              { label: "My documents", href: "/documents" },
              // Not `/payroll`, which needs `payroll.view` — a permission no
              // employee has, so RouteGuard would send them straight back here.
              // Their own payslips live on their profile, scoped to them.
              { label: "My payslips", href: "/profile?tab=payroll" },
            ].map((action) => (
              <Chip
                key={action.href + action.label}
                component={Link}
                href={action.href}
                clickable
                icon={action.icon}
                label={action.label}
                variant="outlined"
              />
            ))}
          </Stack>
        </CardContent>
      </Card>
    </PageContainer>
  );
}
