"use client";

import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Button from "@mui/material/Button";
import Skeleton from "@mui/material/Skeleton";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";

import DateText from "@/components/common/DateText";
import { useAnnouncementReceipts } from "@/hooks/useCollaboration";
import { withCode } from "@/lib/people";

/**
 * Who has read a notice and who has not — the author's own view.
 *
 * **The counts are public; the names are not.** "Twelve of forty have read it"
 * is a fact about the notice. A list of who has *not* is a fact about people,
 * and only the person who asked the question has any business with it — the
 * endpoint refuses everybody else.
 *
 * Unread first, because the list exists to be acted on: the people who have
 * already read it are the ones nobody needs to do anything about.
 */
export default function ReadReceipts({
  announcementId,
  onClose,
}: {
  announcementId: number | null;
  onClose: () => void;
}) {
  const { data, isPending } = useAnnouncementReceipts(announcementId);

  if (announcementId === null) return null;

  const unread = (data ?? []).filter((r) => r.seen_at === null).length;

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        Who has read it
        {data ? (
          <Typography variant="body2" color="text.secondary">
            {unread === 0
              ? "Everybody it went to has opened it."
              : `${unread} of ${data.length} have not opened it yet.`}
          </Typography>
        ) : null}
      </DialogTitle>
      <DialogContent dividers>
        {isPending ? (
          <Skeleton variant="rounded" height={220} />
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Who</TableCell>
                <TableCell>Opened</TableCell>
                <TableCell>Confirmed</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(data ?? []).map((row) => (
                <TableRow key={row.employee} hover>
                  <TableCell>{withCode(row.employee_name, row.employee_code)}</TableCell>
                  <TableCell>
                    {row.seen_at ? (
                      <DateText value={row.seen_at} withTime />
                    ) : (
                      <Chip size="small" variant="outlined" color="warning" label="Not yet" />
                    )}
                  </TableCell>
                  <TableCell>
                    {row.acknowledged_at ? <DateText value={row.acknowledged_at} withTime /> : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
