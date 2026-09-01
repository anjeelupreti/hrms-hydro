"use client";

/**
 * The panels that describe one person's record, wherever it is being read.
 *
 * **Extracted because there are two readers, not one.** These lived inside
 * `/profile` and said "My Payslips", "My Training" — fine while the only
 * audience was the person themselves. HR and the owner need the same panels
 * about somebody else, and a second copy is how the two drift until one of them
 * quietly stops showing a column.
 *
 * So the heading is a prop and the pronoun goes away. `mine` renders the
 * first-person wording on `/profile`; everywhere else the person is named by
 * the page around it.
 *
 * **None of these decide what may be seen.** Each asks the API filtered by
 * employee, and the API applies the same rules it always did — an employee
 * fetching a colleague's payslips gets nothing back, and that is the server's
 * answer, not a hidden button here.
 */

import VerifiedIcon from "@mui/icons-material/Verified";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Link from "next/link";
import type { ReactNode } from "react";

import Amount from "@/components/common/Amount";
import DateText from "@/components/common/DateText";
import DownloadButton from "@/components/common/DownloadButton";
import ListInsight from "@/components/common/ListInsight";
import MyAttendanceWidget from "@/components/dashboard/MyAttendanceWidget";
import ContributionTotals from "@/components/payroll/ContributionTotals";
import SchemeEnrolmentPanel from "@/components/payroll/SchemeEnrolmentPanel";
import { ENROLLMENT_META } from "@/components/training/trainingMeta";
import { usePersonAttendanceSummary } from "@/hooks/useAttendance";
import { useEnrollments } from "@/hooks/useTraining";
import { usePayslips } from "@/hooks/usePayroll";

export function EmptyHint({ children }: { children: ReactNode }) {
  return (
    <Typography variant="body2" color="text.secondary" sx={{ py: 3, textAlign: "center" }}>
      {children}
    </Typography>
  );
}

const PAYSLIP_STATUS = { draft: "default", finalized: "info", paid: "success" } as const;

export function PayrollPanel({ employeeId, mine = false }: { employeeId: number | null; mine?: boolean }) {
  const { data } = usePayslips(employeeId ? { employee: employeeId } : {});
  const payslips = data?.results ?? [];

  // This total covers the rows fetched, and says so when that is not all of
  // them. The request asks for 100 payslips, which is the server's maximum and
  // about eight years of monthly payroll — enough for almost everybody, but a
  // ceiling rather than none. Past it the sum would stop counting while still
  // reading as a lifetime figure, so it is checked against the server's
  // `count` and the wording changes instead.
  const truncated = (data?.count ?? 0) > payslips.length;
  // **Finalized as well as paid, and draft never.** A finalized payslip is one
  // whose run is locked — the figures cannot move again — so it is honest to
  // add up, even though the money may not have left yet. A draft can still
  // change, and summing one would put a number on screen that is different
  // tomorrow for no reason anybody can see. Most payslips live at `finalized`,
  // so counting only `paid` would have left this reading blank on almost every
  // real record.
  const paid = payslips.filter((p) => p.status === "finalized" || p.status === "paid");
  const totals = paid.reduce(
    (acc, p) => ({
      gross: acc.gross + Number(p.gross_earnings || 0),
      net: acc.net + Number(p.net_pay || 0),
    }),
    { gross: 0, net: 0 },
  );
  const withheld = totals.gross - totals.net;
  const takeHome = totals.gross > 0 ? Math.round((totals.net / totals.gross) * 100) : null;

  return (
    <Stack spacing={2}>
      {/* What the payslips add up to.
          A list of months answers "what did I get in Shrawan"; it never
          answers "how much of what I earn actually reaches me", which is the
          question people bring to their own payroll record. Masked like every
          other figure — somebody else's pay on an HR screen is the case the
          masking exists for. */}
      {paid.length > 0 ? (
        <ListInsight
          headline={<Amount personal value={String(totals.net)} prefix="Rs " />}
          reading={
            <>
              net across {truncated ? "the most recent " : ""}
              {paid.length} final payslip{paid.length === 1 ? "" : "s"}
              {takeHome != null ? ` — ${takeHome}% of gross, the rest withheld as tax and contributions.` : "."}
            </>
          }
          aside={
            withheld > 0 ? (
              <>
                <Typography sx={{ fontWeight: 700, fontSize: "1.1rem", lineHeight: 1.2 }}>
                  <Amount personal value={String(Math.round(withheld))} prefix="Rs " />
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  withheld in total
                </Typography>
              </>
            ) : undefined
          }
        />
      ) : null}

      {/* Fund contributions sit above the payslips: a payslip answers "what did
          I get this month", and this answers "what has gone in this year",
          which is the question somebody brings to their record. */}
      {employeeId ? (
        <Card>
          <CardContent>
            <ContributionTotals employeeId={employeeId} pronoun={mine ? "you" : "they"} />
          </CardContent>
        </Card>
      ) : null}

      {/* HR only. Whether somebody sits outside the fund, or on a
          grandfathered rate, is a payroll decision *about* them — not one they
          make on their own record. The server gates it too. */}
      {employeeId && !mine ? (
        <Card>
          <CardContent>
            <SchemeEnrolmentPanel employeeId={employeeId} />
          </CardContent>
        </Card>
      ) : null}

    <Card>
      <CardContent>
        <Typography variant="overline" color="text.secondary">
          {mine ? "My payslips" : "Payslips"}
        </Typography>
        {!employeeId ? (
          <EmptyHint>No employee record linked to this account.</EmptyHint>
        ) : payslips.length === 0 ? (
          <EmptyHint>No payslips yet.</EmptyHint>
        ) : (
          <Stack spacing={1} sx={{ mt: 1 }} divider={<Divider flexItem />}>
            {payslips.map((p) => (
              <Stack
                key={p.id}
                direction="row"
                sx={{ alignItems: "center", justifyContent: "space-between", gap: 1 }}
              >
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {p.period_label}
                  </Typography>
                  {/* Masked by default, like every other figure in the product.
                      Somebody else's salary on an HR screen is the case the
                      masking was built for, not an exception to it. */}
                  <Typography variant="caption" color="text.secondary" component="div">
                    Gross <Amount personal value={p.gross_earnings} /> · Net <Amount personal value={p.net_pay} />
                  </Typography>
                </Box>
                <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                  <Chip size="small" label={p.status} color={PAYSLIP_STATUS[p.status]} />
                  <DownloadButton
                    iconOnly
                    title="Download payslip"
                    url={`/api/proxy/payroll/payslips/${p.id}/download`}
                    filename={`payslip-${p.id}.pdf`}
                  >
                    Payslip
                  </DownloadButton>
                </Stack>
              </Stack>
            ))}
          </Stack>
        )}
      </CardContent>
    </Card>
    </Stack>
  );
}

export function AttendancePanel({
  employeeId,
  mine = false,
}: {
  employeeId: number | null;
  mine?: boolean;
}) {
  const { data: summary } = usePersonAttendanceSummary(employeeId, 30);

  if (!employeeId) {
    return (
      <Card>
        <CardContent>
          <EmptyHint>No employee record linked to this account.</EmptyHint>
        </CardContent>
      </Card>
    );
  }

  return (
    <Stack spacing={2}>
      {/* The reading, above the grid.
          This tab was a month strip and nothing else — two dots on an
          otherwise empty row. A grid shows which days had a record; it cannot
          answer the question somebody opens the tab with, which is *am I
          turning up on time*. Counted on the server over thirty days so it
          does not collapse to nothing on the first of the month, which is
          exactly when somebody is most likely to look. */}
      {summary && summary.recorded > 0 ? (
        <ListInsight
          headline={
            summary.punctuality == null
              ? `${summary.turned_up} days recorded`
              : `${summary.punctuality}% on time`
          }
          reading={
            summary.average_arrival
              ? `over the last ${summary.days} days — ${summary.turned_up} of them worked, arriving at ${summary.average_arrival} on average.`
              : `over the last ${summary.days} days, across ${summary.recorded} recorded days.`
          }
          aside={
            summary.late > 0 || summary.absent > 0 ? (
              <>
                <Typography sx={{ fontWeight: 700, fontSize: "1.1rem", lineHeight: 1.2 }}>
                  {summary.late > 0 ? `${summary.late} late` : `${summary.absent} absent`}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {summary.late > 0 && summary.absent > 0
                    ? `and ${summary.absent} absent`
                    : "in this period"}
                </Typography>
              </>
            ) : undefined
          }
          segments={[
            { label: "On time", value: summary.present, depth: 1 },
            { label: "Late", value: summary.late, depth: 0.45 },
            { label: "Half day", value: summary.half_day, depth: 0.2 },
            { label: "Absent", value: summary.absent, depth: 0, attention: true },
          ]}
        />
      ) : null}

      <MyAttendanceWidget employeeId={employeeId} mine={mine} />
    </Stack>
  );
}

export function TrainingPanel({ employeeId, mine = false }: { employeeId: number | null; mine?: boolean }) {
  const { data: enrollments } = useEnrollments(employeeId ? { employee: employeeId } : {});
  const shown = (enrollments ?? []).filter(
    (e) => e.status !== "cancelled" && e.status !== "declined"
  );

  // Counted from the rows on screen. The §2.6 rule against client-side totals
  // guards lists capped at a page; this is one person's training history and
  // `useEnrollments` asks for 100, far more courses than anybody enrols in.
  //
  // Still a ceiling, though: the hook returns `data.results` and drops `count`,
  // so a 101st enrolment would go missing with nothing here able to detect it.
  // If training histories ever run long, this needs the `count` comparison the
  // payroll panel above makes.
  const completed = shown.filter((e) => e.status === "completed");
  const scored = completed.filter((e) => e.score != null);
  const averageScore = scored.length
    ? Math.round(scored.reduce((sum, e) => sum + (e.score ?? 0), 0) / scored.length)
    : null;
  const upcoming = shown.filter((e) => e.status !== "completed").length;

  return (
    <Stack spacing={2}>
      {/* What the list adds up to. A column of course names says somebody has
          done training; it does not say whether they finished any of it, which
          is the only part a review or a compliance check cares about. */}
      {shown.length > 0 ? (
        <ListInsight
          headline={`${completed.length} of ${shown.length} completed`}
          reading={
            averageScore != null
              ? `${mine ? "You have" : "They have"} finished ${completed.length} course${completed.length === 1 ? "" : "s"}, scoring ${averageScore} on average.`
              : upcoming > 0
                ? `${upcoming} still open — nothing scored yet.`
                : "Completed, but none of it carried a score."
          }
          aside={
            upcoming > 0 ? (
              <>
                <Typography sx={{ fontWeight: 700, fontSize: "1.1rem", lineHeight: 1.2 }}>
                  {upcoming} open
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  enrolled, not finished
                </Typography>
              </>
            ) : undefined
          }
        />
      ) : null}

      <Card>
      <CardContent>
        <Typography variant="overline" color="text.secondary">
          {mine ? "My training" : "Training"}
        </Typography>
        {!employeeId ? (
          <EmptyHint>No employee record linked to this account.</EmptyHint>
        ) : shown.length === 0 ? (
          <EmptyHint>No training yet.</EmptyHint>
        ) : (
          <Stack spacing={1} sx={{ mt: 1 }} divider={<Divider flexItem />}>
            {shown.map((enr) => (
              <Stack
                key={enr.id}
                direction="row"
                sx={{ alignItems: "center", justifyContent: "space-between", gap: 1 }}
              >
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
                    {enr.program_title}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    <DateText value={enr.session_start} />
                    {enr.status === "completed" && enr.score != null ? ` · Score ${enr.score}` : ""}
                  </Typography>
                </Box>
                <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                  {enr.certificate_issued_at && (
                    <Button
                      size="small"
                      color="success"
                      startIcon={<VerifiedIcon />}
                      component={Link}
                      href={`/training/certificate/${enr.id}`}
                    >
                      Certificate
                    </Button>
                  )}
                  <Chip
                    size="small"
                    label={ENROLLMENT_META[enr.status].label}
                    color={ENROLLMENT_META[enr.status].color}
                  />
                </Stack>
              </Stack>
            ))}
          </Stack>
        )}
      </CardContent>
      </Card>
    </Stack>
  );
}
