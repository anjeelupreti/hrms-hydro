"use client";

/**
 * Everybody's fund contributions for a year — the reconciliation sheet.
 *
 * **This is the figure that gets checked against the deposit**, so the totals
 * lead and the per-person breakdown supports them, not the other way round.
 * Somebody opening this is answering "does what we paid the fund match what we
 * deducted", and a list of two hundred rows does not answer that.
 *
 * **Both sides are added here, unlike everywhere else.** On a payslip or a
 * profile the employer's share is kept separate, because merging it overstates
 * what the *employee* contributed. Here the question is what left the
 * *company*, and that is genuinely the sum.
 */

import SavingsIcon from "@mui/icons-material/Savings";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import CircularProgress from "@mui/material/CircularProgress";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";

import Amount from "@/components/common/Amount";
import EmptyState from "@/components/common/EmptyState";
import PageContainer from "@/components/shell/PageContainer";
import PageHeader from "@/components/shell/PageHeader";
import { useContributionReport } from "@/hooks/usePayroll";

export default function ContributionReportPage() {
  const { data, isLoading } = useContributionReport();

  if (isLoading) {
    return (
      <PageContainer>
        <CircularProgress />
      </PageContainer>
    );
  }

  const totals = data?.totals ?? [];
  const people = data?.people ?? [];

  return (
    <PageContainer>
      <PageHeader
        title="Fund contributions"
        subtitle={`What has gone to the funds${data?.fiscal_year ? ` · FY ${data.fiscal_year}` : ""}`}
        icon={<SavingsIcon />}
      />

      {totals.length === 0 ? (
        <EmptyState
          surface
          title="Nothing contributed yet"
          description="Once a retirement fund is chosen in company settings and payroll has been finalised, what was deducted and what the company added appears here for reconciling against the deposit."
        />
      ) : (
        <>
          {/* Said plainly, because somebody reconciling needs to know whether a
              missing month is a missing month or just an unfinalised run. */}
          <Alert severity="info" sx={{ mb: 2 }}>
            Draft payroll runs are not counted — only what has been finalised.
          </Alert>

          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={2}
            sx={{ mb: 3, flexWrap: "wrap" }}
            useFlexGap
          >
            {totals.map((row) => (
              <Card key={row.scheme} sx={{ flex: "1 1 240px" }}>
                <CardContent>
                  <Typography variant="overline" color="text.secondary">
                    {row.label}
                  </Typography>
                  <Typography variant="h5" sx={{ fontWeight: 800 }}>
                    <Amount value={row.total} />
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    <Amount value={row.employee_total} /> from staff ·{" "}
                    <Amount value={row.employer_total} /> from the company
                  </Typography>
                </CardContent>
              </Card>
            ))}
          </Stack>

          <TableContainer
            component={Box}
            sx={{
              bgcolor: "background.paper",
              borderRadius: 2,
              border: "1px solid",
              borderColor: "divider",
            }}
          >
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Employee</TableCell>
                  <TableCell>Scheme</TableCell>
                  <TableCell align="right">Employee</TableCell>
                  <TableCell align="right">Employer</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {people.map((row) => (
                  <TableRow key={`${row.employee}-${row.scheme}`}>
                    <TableCell>
                      {row.employee_name}
                      <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                        {row.employee_code}
                      </Typography>
                    </TableCell>
                    <TableCell>{row.label}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums" }}>
                      <Amount value={row.employee_total} />
                    </TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums" }}>
                      <Amount value={row.employer_total} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </>
      )}
    </PageContainer>
  );
}
