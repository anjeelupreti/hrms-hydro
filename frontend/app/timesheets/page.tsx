"use client";

import AddIcon from "@mui/icons-material/Add";
import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import DeleteIcon from "@mui/icons-material/Delete";
import ScheduleIcon from "@mui/icons-material/Schedule";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Grid from "@mui/material/Grid";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useEffect, useState } from "react";

import StateChip, { toneFor } from "@/components/common/StateChip";
import DateText from "@/components/common/DateText";
import DateField from "@/components/common/DateField";
import EmptyState from "@/components/common/EmptyState";
import PageContainer from "@/components/shell/PageContainer";
import ListControls from "@/components/common/ListControls";
import PageHeader from "@/components/shell/PageHeader";
import { useCan, useMe } from "@/hooks/useMe";
import ListPagination from "@/components/common/ListPagination";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { usePagedList } from "@/hooks/usePagedList";
import {
  useDecideTimeEntry,
  useDeleteTimeEntry,
  useLogTime,
  useTimeEntries,
  useTimesheetWeek,
  useTimeSummary,
} from "@/hooks/useTimesheets";
import { ProjectPicker, TaskPicker } from "@/components/common/pickers";
import WeekStrip from "@/components/timesheets/WeekStrip";
import { toIsoDate } from "@/lib/format/period";


/**
 * A calendar date as `YYYY-MM-DD`, read in **local** time.
 *
 * Named locally because the call sites below read as `localISO`; the rule and
 * the implementation are `toIsoDate`'s. Getting this wrong asks the server for
 * a week beginning Monday and renders one beginning Sunday.
 */
const localISO = toIsoDate;

/** Today, as the local calendar has it. */
function today(): string {
  return localISO(new Date());
}

/**
 * The Sunday starting the week containing `iso`.
 *
 * **Sunday, not Monday.** Nepal's working week runs Sunday to Friday with
 * Saturday as the weekend, so a Sunday-anchored week puts the six working days
 * together and the day off at the end. A Monday anchor would open on Monday and
 * push Sunday — a working day — to the far side of the weekend, splitting the
 * week people actually work across two screens.
 */
function weekStartOf(iso: string): string {
  const day = new Date(`${iso}T00:00:00`);
  day.setDate(day.getDate() - day.getDay()); // getDay(): Sunday is 0
  return localISO(day);
}

function shiftDate(iso: string, days: number): string {
  const day = new Date(`${iso}T00:00:00`);
  day.setDate(day.getDate() + days);
  return localISO(day);
}

export default function TimesheetsPage() {
  const { data: me } = useMe();
  const isHR = useCan("workplace.manage");
  // Search and paging on the server. Filtering `entries` in the browser only
  // ever matched the rows already fetched, and the fetch was capped at 100 —
  // so on the system with thousands of entries most of them could not be
  // found by typing their exact description.
  const [query, setQuery] = useState("");
  const search = useDebouncedValue(query, 300);
  const { page, pageSize, setPage, setPageSize, reset } = usePagedList();
  const { data } = useTimeEntries({ search: search || undefined, page, pageSize });
  const { data: summary } = useTimeSummary();
  const log = useLogTime();
  const decide = useDecideTimeEntry();
  const del = useDeleteTimeEntry();

  const [project, setProject] = useState<number | "">("");
  // Optional. Hours belong to a project; naming the task as well is what makes
  // an estimate checkable against reality, but plenty of work is not on a card.
  const [task, setTask] = useState<number | null>(null);
  const [date, setDate] = useState(() => today());
  const [weekStart, setWeekStart] = useState(() => weekStartOf(today()));
  const { data: weekData } = useTimesheetWeek(weekStart);
  const [hours, setHours] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);

  // The list stays a list — every entry, searchable — while the strip above it
  // answers the week. Two surfaces, because "what did I do" and "what did I
  // miss" are different questions and one table cannot hold both.
  const entries = data?.results ?? [];
  const filtered = entries;
  const isEmptyResult = Boolean(search) && entries.length === 0;

  useEffect(() => {
    reset();
  }, [search, reset]);

  async function submit() {
    setError(null);
    if (!project || !hours) {
      setError("Pick a project and enter hours.");
      return;
    }
    try {
      await log.mutateAsync({ project: Number(project), task, date, hours, description });
      setHours("");
      setDescription("");
      setTask(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not log time.");
    }
  }

  return (
    <PageContainer>
      <PageHeader
        title="Timesheets"
        subtitle="Log hours against projects"
        icon={<ScheduleIcon />}
      />

      <ListControls
        search={query}
        onSearchChange={setQuery}
        searchPlaceholder="Search entries…"
        searchLabel="Search time entries by date, project, description or status"
      />

      {/* The week comes first, and there is no lifetime total. "Total
          hours: 214" is true, unactionable, and impossible to be behind on.
          What this page has to answer is whether *this* week is complete — a
          question about the days nobody logged. See `WeekStrip`. */}
      {weekData ? (
        <WeekStrip
          week={weekData}
          selectedDate={date}
          onPickDay={setDate}
          onShiftWeek={(delta) => setWeekStart(shiftDate(weekStart, delta))}
          onThisWeek={() => setWeekStart(weekStartOf(today()))}
        />
      ) : null}

      {summary && summary.by_project.length > 0 && (
        <Card sx={{ mb: 3 }}>
          <CardContent>
            <Typography variant="overline" color="text.secondary">
              Where the hours went
            </Typography>
            {/* Proportional, not a row of equal chips: the point of splitting
                hours by project is which one is eating the week, and equal-width
                chips hide exactly that. */}
            <Stack spacing={1} sx={{ mt: 1 }}>
              {summary.by_project.map((p) => {
                const share = Number(p.hours) / Math.max(Number(summary.total_hours), 1);
                return (
                  <Box key={p.project}>
                    <Stack direction="row" sx={{ justifyContent: "space-between", mb: 0.5 }}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {p.project_name}
                      </Typography>
                      <Typography variant="body2" color="text.secondary" sx={{ fontVariantNumeric: "tabular-nums" }}>
                        {p.hours}h
                      </Typography>
                    </Stack>
                    <Box sx={{ height: 6, borderRadius: 999, bgcolor: "action.hover", overflow: "hidden" }}>
                      <Box
                        sx={{
                          width: `${Math.max(share * 100, 2)}%`,
                          height: "100%",
                          borderRadius: 999,
                          backgroundColor: `color-mix(in srgb, var(--mui-palette-primary-main) ${
                            35 + Math.round(share * 65)
                          }%, var(--mui-palette-background-paper))`,
                        }}
                      />
                    </Box>
                  </Box>
                );
              })}
            </Stack>
          </CardContent>
        </Card>
      )}

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1.5 }}>
            Log time
            {/* Clicking a day in the strip aims this form at it. Without the
                echo, the click looks like it did nothing. */}
            {date !== today() ? (
              <Typography component="span" variant="body2" color="text.secondary" sx={{ ml: 1, fontWeight: 400 }}>
                for {new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" })}
              </Typography>
            ) : null}
          </Typography>
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          <Grid container spacing={2} sx={{ alignItems: "center" }}>
            <Grid size={{ xs: 12, sm: 3 }}>
              <ProjectPicker
                value={project || null}
                onChange={(id) => {
                  setProject(id ?? 0);
                  // A task belongs to one project, so changing the project
                  // cannot leave the old task selected underneath it.
                  setTask(null);
                }}
                size="small"
                required
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 3 }}>
              <TaskPicker
                projectId={project || null}
                value={task}
                onChange={(id) => setTask(id ?? null)}
                size="small"
              />
            </Grid>
            <Grid size={{ xs: 6, sm: 2 }}>
              <DateField label="Date" value={date} onChange={setDate} size="small" />
            </Grid>
            <Grid size={{ xs: 6, sm: 1 }}>
              <TextField fullWidth size="small" type="number" label="Hours" value={hours} onChange={(e) => setHours(e.target.value)} />
            </Grid>
            <Grid size={{ xs: 12, sm: 2 }}>
              <TextField fullWidth size="small" label="Description" value={description} onChange={(e) => setDescription(e.target.value)} />
            </Grid>
            <Grid size={{ xs: 12, sm: 1 }}>
              <Button fullWidth variant="contained" startIcon={<AddIcon />} onClick={submit} disabled={log.isPending}>
                Log
              </Button>
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      <TableContainer component={Box} sx={{ bgcolor: "background.paper", borderRadius: 2, border: "1px solid", borderColor: "divider" }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Date</TableCell>
              {isHR && <TableCell>Employee</TableCell>}
              <TableCell>Project</TableCell>
              <TableCell>Description</TableCell>
              <TableCell align="right">Hours</TableCell>
              <TableCell>Status</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filtered.map((e) => (
              <TableRow key={e.id} hover>
                <TableCell><DateText value={e.date} /></TableCell>
                {isHR && <TableCell>{e.employee_name}</TableCell>}
                <TableCell>
                  {e.project_name}
                  {/* The task under the project rather than in its own column:
                      most entries have no task, and an empty column on most
                      rows costs more width than it explains. */}
                  {e.task_title ? (
                    <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                      {e.task_title}
                    </Typography>
                  ) : null}
                </TableCell>
                <TableCell>{e.description || "—"}</TableCell>
                <TableCell align="right">{e.hours}</TableCell>
                <TableCell><StateChip label={String(e.status)} tone={toneFor(e.status)} /></TableCell>
                <TableCell align="right">
                  {isHR && e.status === "submitted" && (
                    <>
                      <IconButton size="small" color="success" title="Approve" onClick={() => decide.mutate({ id: e.id, action: "approve" })}>
                        <CheckIcon fontSize="small" />
                      </IconButton>
                      <IconButton size="small" color="error" title="Reject" onClick={() => decide.mutate({ id: e.id, action: "reject" })}>
                        <CloseIcon fontSize="small" />
                      </IconButton>
                    </>
                  )}
                  {e.employee === me?.employee_id && e.status !== "approved" && (
                    <IconButton size="small" title="Delete" onClick={() => del.mutate(e.id)}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={isHR ? 7 : 6}>
                  <EmptyState
                    variant={isEmptyResult ? "noResults" : "empty"}
                    title={isEmptyResult ? `No time entries match “${query}”` : "No time logged yet"}
                    description={
                      isEmptyResult
                      ? "Try a different search, or clear it to see everything."
                      : "Log hours against projects to see where the week actually went, and to bill it accurately."
                    }
                    compact
                  />
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <ListPagination
        page={page}
        pageSize={pageSize}
        count={data?.count ?? 0}
        noun="entries"
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
      />
    </PageContainer>
  );
}
