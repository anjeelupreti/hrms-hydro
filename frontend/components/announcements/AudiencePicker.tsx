"use client";

import GroupsIcon from "@mui/icons-material/Groups";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useState } from "react";

import { CompanyPicker, DepartmentPicker } from "@/components/common/pickers";
import { useEmployees } from "@/hooks/useEmployees";
import { withCode } from "@/lib/people";

/**
 * Choosing who a notice is for.
 *
 * **A department is often the wrong shape.** It covers "everybody in
 * accounts"; it does not cover the four people running a shutdown, who are in
 * four different departments. So this picks named people, filtered by
 * department and company and searchable by name — because finding four people
 * among a hundred by scrolling is not finding them.
 *
 * Wide on purpose. The previous control was a single-line multiselect, and a
 * list of twelve names in a 400px box is a list nobody can check before
 * pressing send.
 */
export default function AudiencePicker({
  open,
  value,
  onChange,
  onClose,
}: {
  open: boolean;
  value: number[];
  onChange: (ids: number[]) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const [department, setDepartment] = useState<number | null>(null);
  const [company, setCompany] = useState<number | null>(null);
  const [chosen, setChosen] = useState<number[]>(value);
  const [seeded, setSeeded] = useState(false);

  // Seeded when the dialog opens, rather than in an effect that would fight
  // every tick of the checkbox.
  if (open && !seeded) {
    setSeeded(true);
    setChosen(value);
  }
  if (!open && seeded) setSeeded(false);

  const { data, isPending } = useEmployees({
    page: 1,
    pageSize: 200,
    search: search || undefined,
    department: department ?? undefined,
    company: company ?? undefined,
  });
  const people = data?.results ?? [];

  function toggle(id: number) {
    setChosen((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id]
    );
  }

  /** Everybody currently listed — what "select all" means when a filter is on. */
  const shownIds = people.map((p) => p.id);
  const allShownChosen = shownIds.length > 0 && shownIds.every((id) => chosen.includes(id));

  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
          <GroupsIcon color="action" />
          <Box sx={{ flex: 1 }}>
            <Typography variant="h6">Who is this for?</Typography>
            <Typography variant="body2" color="text.secondary">
              Pick the people. Leave it empty to use the department instead.
            </Typography>
          </Box>
          <Chip color={chosen.length ? "primary" : "default"} label={`${chosen.length} chosen`} />
        </Stack>
      </DialogTitle>

      <DialogContent dividers>
        {/* Filters first, then the search, then the list — the same
            arrangement every other list in the product uses. */}
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ mb: 2 }}>
          <TextField
            size="small"
            fullWidth
            placeholder="Search by name or code"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <DepartmentPicker
            value={department}
            onChange={setDepartment}
            placeholder="Any department"
            size="small"
            sx={{ minWidth: { sm: 200 } }}
          />
          <CompanyPicker
            label="Company"
            value={company}
            onChange={setCompany}
            placeholder="Any"
            size="small"
            sx={{ minWidth: { sm: 200 } }}
          />
        </Stack>

        {chosen.length > 0 ? (
          <Stack direction="row" spacing={0.5} sx={{ mb: 2, flexWrap: "wrap" }} useFlexGap>
            {/* The chosen stay visible while the filter moves under them —
                otherwise somebody filters to another department and cannot
                tell what they have already picked. */}
            {chosen.map((id) => {
              const person = people.find((p) => p.id === id);
              return (
                <Chip
                  key={id}
                  size="small"
                  label={person ? withCode(person.full_name, person.employee_code) : `#${id}`}
                  onDelete={() => toggle(id)}
                />
              );
            })}
          </Stack>
        ) : null}

        {isPending ? (
          <Skeleton variant="rounded" height={320} />
        ) : people.length === 0 ? (
          <Alert severity="info">Nobody matches that.</Alert>
        ) : (
          <Box sx={{ maxHeight: 420, overflowY: "auto" }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell padding="checkbox">
                    <Checkbox
                      checked={allShownChosen}
                      indeterminate={!allShownChosen && shownIds.some((id) => chosen.includes(id))}
                      onChange={() =>
                        setChosen((current) =>
                          allShownChosen
                            ? current.filter((id) => !shownIds.includes(id))
                            : Array.from(new Set([...current, ...shownIds]))
                        )
                      }
                    />
                  </TableCell>
                  <TableCell>Name</TableCell>
                  <TableCell>Code</TableCell>
                  <TableCell>Department</TableCell>
                  <TableCell>Designation</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {people.map((person) => (
                  <TableRow
                    key={person.id}
                    hover
                    sx={{ cursor: "pointer" }}
                    onClick={() => toggle(person.id)}
                  >
                    <TableCell padding="checkbox">
                      <Checkbox checked={chosen.includes(person.id)} />
                    </TableCell>
                    <TableCell>{person.full_name}</TableCell>
                    <TableCell>{person.employee_code}</TableCell>
                    <TableCell>{person.department_name ?? "—"}</TableCell>
                    <TableCell>{person.designation_title ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        )}
      </DialogContent>

      <DialogActions>
        <Button onClick={() => setChosen([])} sx={{ mr: "auto" }} disabled={chosen.length === 0}>
          Clear
        </Button>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          onClick={() => {
            onChange(chosen);
            onClose();
          }}
        >
          Use {chosen.length} {chosen.length === 1 ? "person" : "people"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
