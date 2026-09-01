"use client";

import AssessmentIcon from "@mui/icons-material/Assessment";
import DownloadIcon from "@mui/icons-material/Download";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import Link from "@mui/material/Link";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import { useMemo, useState, useSyncExternalStore } from "react";

import Columns from "@/components/charts/Columns";
import RankedBars from "@/components/charts/RankedBars";
import DateField from "@/components/common/DateField";
import { DepartmentPicker } from "@/components/common/pickers";
import DateText from "@/components/common/DateText";
import PageContainer from "@/components/shell/PageContainer";
import PageHeader from "@/components/shell/PageHeader";
import { useReport } from "@/hooks/useReports";
import { GROUP_HUE, REPORTS, REPORT_GROUPS, reportByKey } from "@/lib/reports/catalogue";
import { QUICK_RANGES, defaultRange, matchQuickRange } from "@/lib/reports/ranges";

/**
 * Reports.
 *
 * A library that says what each report settles, the chart the server chose to
 * show its shape, and a range control with the answers people actually want —
 * rather than a strip of nouns over a bare table, which ends every question in
 * reading a spreadsheet in a web page.
 *
 * **The chart comes from the server, and that is deliberate.** Only the builder
 * knows whether its rows are a sequence or a ranking, which is exactly the
 * choice between columns and bars. Guessing here from the column headers would
 * be wrong the first time a report has two numeric columns.
 */

/** Number cells; currency reports get grouped digits and no decimals. */
function formatCell(value: string | number, currency: boolean) {
  if (typeof value !== "number") return value;
  return currency && Math.abs(value) >= 1000
    ? value.toLocaleString(undefined, { maximumFractionDigits: 0 })
    : value.toLocaleString();
}

/**
 * `2026-08-29` in a cell, exactly.
 *
 * Every date the product shows goes through `DateText`, so a Bikram Sambat
 * company reads its own calendar. The generic report envelope sends rows as
 * opaque strings, so the renderer has to recognise a date itself or the table
 * prints ISO under a control reading "15 Bhadra 2083".
 *
 * Matched on shape rather than on column name: an ISO date is unambiguous, and
 * a heuristic on the header ("Date", "From", "When", "Applied", "Joined"…) is a
 * list that goes stale the first time a report adds a column. Anchored, so a
 * description that merely *contains* a date is left alone.
 */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * "Has the browser taken over from the prerender."
 *
 * The default range is clock-derived, and the server has no way to know the
 * reader's clock: the container runs UTC and the browser runs Kathmandu
 * (UTC+05:45), which are different days for 5h45m out of every 24. Computed in
 * a `useState` initialiser the two renders disagree and React reports the tree
 * as unpatchable, so the server renders no range at all.
 *
 * A store subscription rather than a `setState` in an effect — that is the
 * React idiom, and the lint rule rejecting the effect version is right. Both
 * snapshots return a *constant*, so there is nothing to cache: a `getSnapshot`
 * returning a fresh value each call is an infinite render loop, which is
 * exactly what took the system down earlier in this project.
 */
const NEVER_CHANGES = () => () => {};
const ON_CLIENT = () => true;
const ON_SERVER = () => false;

export default function ReportsPage() {
  const [type, setType] = useState("team");
  const mounted = useSyncExternalStore(NEVER_CHANGES, ON_CLIENT, ON_SERVER);
  const [chosen, setChosen] = useState<{ start: string; end: string } | null>(null);
  // The default is derived, not stored, so it is never computed on the server.
  // `chosen` takes over the moment the reader touches a chip or a date field.
  const fallback = useMemo(() => (mounted ? defaultRange() : null), [mounted]);
  const range = chosen ?? fallback;
  const setRange = setChosen;

  const start = range?.start ?? "";
  const end = range?.end ?? "";
  const setStart = (value: string) => setRange((current) => ({ start: value, end: current?.end ?? value }));
  const setEnd = (value: string) => setRange((current) => ({ start: current?.start ?? value, end: value }));

  const definition = reportByKey(type);
  // Cleared when moving to a report that cannot filter by it — otherwise a
  // department chosen on Attendance would silently narrow nothing on Payroll
  // while the control that set it was no longer on screen.
  const [department, setDepartment] = useState<number | null>(null);
  const activeDepartment = definition?.byDepartment ? department : null;

  const { data, isLoading } = useReport(type, start, end, range !== null, activeDepartment);
  const activeQuick = range ? matchQuickRange(range) : undefined;

  const exportUrl =
    `/api/proxy/reports?type=${type}&start=${start}&end=${end}` +
    `${activeDepartment ? `&department=${activeDepartment}` : ""}&export=xlsx`;
  const rowCount = data?.rows.length ?? 0;
  const currency = type === "payroll" || type === "expenses" || type === "statutory";

  return (
    <PageContainer>
      <PageHeader
        title="Reports"
        // Counted, not typed. It said "Ten reports" while there were fourteen —
        // a number in prose beside the list it describes goes stale the first
        // time somebody adds to the list.
        subtitle={`${REPORTS.length} reports across the whole workspace, each one exportable`}
        icon={<AssessmentIcon />}
        actions={
          <Button
            startIcon={<DownloadIcon />}
            variant="contained"
            component={Link}
            href={exportUrl}
            target="_blank"
            rel="noopener"
            // Exporting nothing produces a workbook with a header row and no
            // data, which looks like a broken export rather than an empty
            // period.
            disabled={rowCount === 0}
          >
            Export Excel
          </Button>
        }
      />

      {/* ── The library ─────────────────────────────────────────────────── */}
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", sm: "repeat(2, 1fr)", lg: "repeat(4, 1fr)" },
          gap: 2,
          mb: 3,
          alignItems: "start",
        }}
      >
        {REPORT_GROUPS.map((group) => {
          const hue = GROUP_HUE[group];
          return (
            <Stack key={group} spacing={1}>
              <Stack direction="row" spacing={0.75} sx={{ alignItems: "center", px: 0.25 }}>
                <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: hue }} />
                <Typography
                  variant="overline"
                  sx={{ fontWeight: 700, color: "text.secondary", lineHeight: 1 }}
                >
                  {group}
                </Typography>
              </Stack>

              {REPORTS.filter((report) => report.group === group).map((report) => {
                const selected = report.key === type;
                return (
                  <Card
                    key={report.key}
                    onClick={() => setType(report.key)}
                    sx={{
                      cursor: "pointer",
                      // The selected report is the one with the coloured edge.
                      // A filled card would compete with the summary tiles
                      // below it, which are the numbers this page is for.
                      borderLeft: "3px solid",
                      borderLeftColor: selected ? hue : "transparent",
                      bgcolor: selected
                        ? `color-mix(in srgb, ${hue} 8%, transparent)`
                        : "background.paper",
                      transition: "background-color .15s, border-color .15s",
                      "&:hover": { bgcolor: `color-mix(in srgb, ${hue} 12%, transparent)` },
                    }}
                  >
                    <CardContent sx={{ py: 1.4, px: 1.6, "&:last-child": { pb: 1.4 } }}>
                      <Typography sx={{ fontWeight: 700, fontSize: "0.86rem", lineHeight: 1.3 }}>
                        {report.name}
                      </Typography>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ display: "block", mt: 0.25, lineHeight: 1.35 }}
                      >
                        {report.question}
                      </Typography>
                    </CardContent>
                  </Card>
                );
              })}
            </Stack>
          );
        })}
      </Box>

      {/* ── The range ───────────────────────────────────────────────────── */}
      <Stack
        direction="row"
        spacing={1}
        useFlexGap
        sx={{ flexWrap: "wrap", alignItems: "center", mb: 2 }}
      >
        {QUICK_RANGES.filter(
          // The forward range is offered only where it makes sense. A "next 90
          // days" button on a payroll report is a control that can only ever
          // produce an empty table.
          (quick) => !quick.forward || definition?.forward
        ).map((quick) => (
          <Chip
            key={quick.key}
            size="small"
            clickable
            label={quick.label}
            variant={activeQuick === quick.key ? "filled" : "outlined"}
            color={activeQuick === quick.key ? "primary" : "default"}
            onClick={() => {
              const built = quick.build();
              setRange(built);
            }}
          />
        ))}
        <Box sx={{ flexGrow: 1 }} />
        {/* Shown only where the server actually filters on it — see
            `byDepartment`. A control that does nothing is worse than none. */}
        {definition?.byDepartment ? (
          <Box sx={{ minWidth: 210 }}>
            <DepartmentPicker
              multiple={false}
              value={department}
              onChange={setDepartment}
              size="small"
              placeholder="Every department"
            />
          </Box>
        ) : null}
        <DateField label="From" value={start} onChange={setStart} size="small" fullWidth={false} />
        <DateField label="To" value={end} onChange={setEnd} size="small" fullWidth={false} />
      </Stack>

      {definition?.snapshot ? (
        <Alert severity="info" sx={{ mb: 2 }}>
          {definition.name} describes the system as it stands now — the dates
          above do not narrow it.
        </Alert>
      ) : null}

      {!range || isLoading || !data ? (
        <Skeleton variant="rounded" height={360} />
      ) : (
        <>
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "repeat(2, 1fr)", md: "repeat(4, 1fr)" },
              gap: 2,
              mb: 2,
            }}
          >
            {data.summary.map((entry) => (
              <Card key={entry.label}>
                <CardContent>
                  <Typography variant="overline" color="text.secondary">
                    {entry.label}
                  </Typography>
                  <Typography sx={{ fontWeight: 800, fontSize: "1.9rem", lineHeight: 1.1 }}>
                    {formatCell(entry.value, currency)}
                  </Typography>
                </CardContent>
              </Card>
            ))}
          </Box>

          {data.chart ? (
            <Card sx={{ mb: 2 }}>
              <CardContent>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5 }}>
                  {data.chart.title}
                </Typography>
                {data.chart.kind === "columns" ? (
                  <Columns
                    data={data.chart.points.map((point) => ({
                      label: point.label,
                      value: point.value,
                    }))}
                    height={200}
                    format={(value) => formatCell(value, data.chart?.unit === "currency")}
                  />
                ) : (
                  <RankedBars
                    items={data.chart.points}
                    unit={data.chart.unit === "currency" ? undefined : data.chart.unit}
                    empty="Nothing to rank in this range."
                  />
                )}
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <Stack
              direction="row"
              sx={{
                px: 2,
                py: 1.25,
                alignItems: "baseline",
                justifyContent: "space-between",
                borderBottom: "1px solid",
                borderColor: "divider",
              }}
            >
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                {definition?.name ?? "Report"}
              </Typography>
              {/* The count, said once. A table you scroll gives no idea how
                  much of it there is, and "did this return 12 rows or 1200"
                  changes what you do next. */}
              <Typography variant="caption" color="text.secondary">
                {rowCount === 0 ? "no rows" : `${rowCount.toLocaleString()} row${rowCount === 1 ? "" : "s"}`}
              </Typography>
            </Stack>

            <TableContainer sx={{ maxHeight: 560 }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    {data.columns.map((column, index) => (
                      <TableCell
                        // Keyed with the index too. The labels come from the
                        // server and this screen renders whatever any report
                        // sends; one repeated header must not make React
                        // reconcile the row by position.
                        key={`${column}-${index}`}
                        align={index === 0 ? "left" : "right"}
                        sx={{ fontWeight: 700, whiteSpace: "nowrap" }}
                      >
                        {column}
                      </TableCell>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rowCount === 0 ? (
                    <TableRow>
                      <TableCell colSpan={data.columns.length}>
                        <Stack sx={{ py: 4, alignItems: "center", textAlign: "center" }}>
                          <Typography variant="body2" color="text.secondary">
                            {/* Through `DateText` for the same reason the cells
                                are: the range control above this reads "16
                                Shrawan 2083", and an empty state answering in
                                Gregorian looks like a different range. */}
                            Nothing in <DateText value={start} /> to <DateText value={end} />.
                          </Typography>
                          {/* A report whose data is usually ahead says where to
                              look. Training's sessions are all scheduled
                              forward, so a month-to-date range is empty and
                              "no data" reads as "we run no training". */}
                          <Typography variant="caption" color="text.disabled" sx={{ mt: 0.5 }}>
                            {definition?.forward
                              ? "This report is usually about what is scheduled — try Next 90 days."
                              : "Widen the range above, or pick another report."}
                          </Typography>
                        </Stack>
                      </TableCell>
                    </TableRow>
                  ) : (
                    data.rows.map((row, rowIndex) => (
                      <TableRow key={rowIndex} hover>
                        {row.map((cell, cellIndex) => (
                          <TableCell
                            key={cellIndex}
                            align={cellIndex === 0 ? "left" : "right"}
                            sx={{ whiteSpace: cellIndex === 0 ? "nowrap" : undefined }}
                          >
                            {typeof cell === "string" && ISO_DATE.test(cell) ? (
                              <DateText value={cell} />
                            ) : (
                              formatCell(cell, currency)
                            )}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </Card>
          <Box sx={{ height: 24 }} />
        </>
      )}
    </PageContainer>
  );
}
