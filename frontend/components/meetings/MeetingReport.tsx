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
 * **Three questions, none answerable from a single meeting.** Who turns up,
 * whether decisions actually get answered, and what people have disagreed with
 * — the last being the one a board asks for and the one nothing in the product
 * could produce before this.
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

      {/* ── Who turns up ────────────────────────────────────────────── */}
      <Box>
        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
          Attendance
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
