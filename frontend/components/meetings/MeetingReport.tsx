"use client";

import GroupsIcon from "@mui/icons-material/Groups";
import ThumbDownIcon from "@mui/icons-material/ThumbDown";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import LinearProgress from "@mui/material/LinearProgress";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";

import DateText from "@/components/common/DateText";
import { useMeetingReport } from "@/hooks/useMeetingRecord";
import { withCode } from "@/lib/people";

/**
 * What the meetings add up to.
 *
 * **Two readings of the same data, because they answer different questions.**
 * Across meetings: who turns up, whether decisions get answered, what people
 * have disagreed with — "this person has missed six of eight" is a fact
 * somebody can act on. Down the meetings: one row each, with its own register
 * and its own decisions, which is what anybody asks for when they are looking
 * at a particular Tuesday.
 *
 * Only the first half existed, which left the obvious question — "how did the
 * board meeting go" — unanswerable on the one screen that exists to answer
 * questions about meetings.
 *
 * Scoped by the server to the meetings the reader may already see, so this is
 * a different arrangement of their own data rather than a wider view of
 * everybody's.
 */
export default function MeetingReport() {
  const { data, isPending } = useMeetingReport();

  if (isPending) return <Skeleton variant="rounded" height={320} />;
  if (!data || data.meetings === 0) {
    return <Alert severity="info">No meetings in range yet.</Alert>;
  }

  const { positions } = data;
  const answered = positions.consent + positions.dissent + positions.abstain;
  const asked = answered + positions.pending;

  return (
    <Stack spacing={3}>
      <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }} useFlexGap>
        <Chip icon={<GroupsIcon />} label={`${data.meetings} meetings`} />
        <Chip variant="outlined" label={`${data.decisions} decisions`} />
        <Chip variant="outlined" color="success" label={`${positions.consent} consented`} />
        <Chip variant="outlined" color="error" label={`${positions.dissent} dissented`} />
        {positions.abstain > 0 ? (
          <Chip variant="outlined" label={`${positions.abstain} abstained`} />
        ) : null}
        {positions.pending > 0 ? (
          <Chip variant="outlined" color="warning" label={`${positions.pending} not answered`} />
        ) : null}
      </Stack>

      {/* Whether decisions actually get answered — the question behind
          "we circulated it" that a tally of consents alone cannot settle. */}
      {asked > 0 ? (
        <Box>
          <Stack direction="row" sx={{ justifyContent: "space-between", mb: 0.5 }}>
            <Typography variant="body2" color="text.secondary">
              Decisions answered
            </Typography>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {answered} of {asked}
            </Typography>
          </Stack>
          <LinearProgress
            variant="determinate"
            value={(answered / asked) * 100}
            sx={{ height: 8, borderRadius: 4 }}
          />
        </Box>
      ) : null}

      {/* ── Meeting by meeting ──────────────────────────────────────── */}
      <Box>
        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
          Meeting by meeting
        </Typography>
        <Box sx={{ overflowX: "auto" }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Meeting</TableCell>
                <TableCell>When</TableCell>
                <TableCell align="right">Invited</TableCell>
                <TableCell align="right">Came</TableCell>
                <TableCell align="right">Turnout</TableCell>
                <TableCell align="right">Agenda</TableCell>
                <TableCell>Decisions</TableCell>
                <TableCell>Minute</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data.by_meeting.map((row) => (
                <TableRow
                  key={row.id}
                  hover
                  // A cancelled meeting stays in the report — it was called,
                  // people planned around it — but must not read as one that
                  // happened.
                  sx={row.state === "cancelled" ? { opacity: 0.6 } : undefined}
                >
                  <TableCell sx={{ maxWidth: 260 }}>
                    <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap title={row.title}>
                      {row.title}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {[row.company_name, row.organiser].filter(Boolean).join(" · ") || "—"}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <DateText value={row.date} />
                    {row.state !== "ended" ? (
                      <Typography
                        variant="caption"
                        sx={{ display: "block" }}
                        color={row.state === "cancelled" ? "error.main" : "info.main"}
                      >
                        {row.state === "cancelled" ? "Cancelled" : "Scheduled"}
                      </Typography>
                    ) : null}
                  </TableCell>
                  <TableCell align="right">{row.invited}</TableCell>
                  <TableCell align="right">{row.present}</TableCell>
                  <TableCell align="right">
                    {/* Null, not 0%, where nobody took the register — the
                        same rule the per-person table follows. */}
                    {row.rate === null ? (
                      <Typography variant="caption" color="text.disabled">
                        not taken
                      </Typography>
                    ) : (
                      `${Math.round(row.rate * 100)}%`
                    )}
                  </TableCell>
                  <TableCell align="right">{row.agenda_items}</TableCell>
                  <TableCell>
                    {row.decisions === 0 ? (
                      <Typography variant="caption" color="text.disabled">
                        none
                      </Typography>
                    ) : (
                      <Stack direction="row" spacing={0.5} sx={{ flexWrap: "wrap" }} useFlexGap>
                        <Chip size="small" variant="outlined" label={row.decisions} />
                        {row.outcomes.consent > 0 ? (
                          <Chip size="small" color="success" variant="outlined" label={`${row.outcomes.consent} for`} />
                        ) : null}
                        {row.outcomes.dissent > 0 ? (
                          <Chip size="small" color="error" variant="outlined" label={`${row.outcomes.dissent} against`} />
                        ) : null}
                        {row.outcomes.abstain > 0 ? (
                          <Chip size="small" variant="outlined" label={`${row.outcomes.abstain} abstained`} />
                        ) : null}
                        {row.outcomes.pending > 0 ? (
                          <Chip size="small" color="warning" variant="outlined" label={`${row.outcomes.pending} waiting`} />
                        ) : null}
                      </Stack>
                    )}
                  </TableCell>
                  <TableCell>
                    {row.minute_status ? (
                      <Chip
                        size="small"
                        variant={row.minute_status === "final" ? "filled" : "outlined"}
                        color={row.minute_status === "final" ? "success" : "default"}
                        label={row.minute_status}
                      />
                    ) : row.state === "ended" ? (
                      <Typography variant="caption" color="warning.main">
                        none
                      </Typography>
                    ) : (
                      <Typography variant="caption" color="text.disabled">
                        —
                      </Typography>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      </Box>

      {/* ── Who turns up ────────────────────────────────────────────── */}
      <Box>
        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
          Attendance, person by person
        </Typography>
        <Box sx={{ overflowX: "auto" }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Who</TableCell>
                <TableCell align="right">Invited</TableCell>
                <TableCell align="right">Present</TableCell>
                <TableCell align="right">Absent</TableCell>
                <TableCell align="right">Not recorded</TableCell>
                <TableCell align="right">Rate</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data.attendance.map((row) => (
                <TableRow key={row.employee} hover>
                  <TableCell>{withCode(row.name, row.employee_code)}</TableCell>
                  <TableCell align="right">{row.invited}</TableCell>
                  <TableCell align="right">{row.present}</TableCell>
                  <TableCell align="right">{row.absent}</TableCell>
                  <TableCell align="right">{row.unmarked}</TableCell>
                  <TableCell align="right">
                    {/* Null where nothing was ever marked. A register nobody
                        took is not evidence of absence, so it shows as a dash
                        rather than as nought per cent. */}
                    {row.rate === null ? (
                      <Typography variant="caption" color="text.secondary">
                        —
                      </Typography>
                    ) : (
                      <Typography
                        variant="body2"
                        sx={{ fontWeight: 600, color: row.rate < 0.6 ? "warning.main" : "inherit" }}
                      >
                        {Math.round(row.rate * 100)}%
                      </Typography>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      </Box>

      {/* ── What people disagreed with ──────────────────────────────── */}
      <Box>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 1 }}>
          <ThumbDownIcon fontSize="small" color="action" />
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
            Dissents
          </Typography>
        </Stack>
        {data.dissents.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            Nobody has disagreed with a decision.
          </Typography>
        ) : (
          <Stack spacing={1.5}>
            {/* The reason is the point. A count says somebody objected; what
                they objected to, and why, is the thing worth reading. */}
            {data.dissents.map((row, index) => (
              <Box
                key={`${row.employee}-${index}`}
                sx={{ p: 1.5, borderRadius: 2, border: "1px solid", borderColor: "divider" }}
              >
                <Stack direction="row" spacing={1} sx={{ alignItems: "baseline", flexWrap: "wrap" }} useFlexGap>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {withCode(row.name, row.employee_code)}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {row.meeting_title}
                  </Typography>
                  <Box sx={{ flex: 1 }} />
                  {row.answered_at ? (
                    <Typography variant="caption" color="text.secondary">
                      <DateText value={row.answered_at} withTime />
                    </Typography>
                  ) : null}
                </Stack>
                <Typography variant="body2" sx={{ mt: 0.5, fontStyle: "italic" }}>
                  {row.decision}
                </Typography>
                <Typography variant="body2" sx={{ mt: 0.5 }}>
                  {row.reason}
                </Typography>
              </Box>
            ))}
          </Stack>
        )}
      </Box>
    </Stack>
  );
}
