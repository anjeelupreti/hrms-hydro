"use client";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
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
 * Choosing who a notice is for, as a table you can actually read.
 *
 * **A department is often the wrong shape.** It covers "everybody in accounts";
 * it does not cover the four people running a shutdown, who are in four
 * different departments. So this picks named people, filtered by department and
 * company and searchable by name — because finding four among a hundred by
 * scrolling is not finding them.
 *
 * 🔴 **This used to be a dialog opened from inside the compose dialog.** A
 * modal on top of a modal, reached by a button whose label was the only clue it
 * existed, so the thing most people saw was the department dropdown and they
 * reasonably concluded that was all there was. It sits inline in the composer
 * now: the list is the control, not a thing you have to go and find.
 *
 * Selection is held by the caller. The chosen stay pinned above the table as
 * chips, because a filter moving underneath a selection is how somebody loses
 * track of who they have already picked.
 */
export default function AudienceTable({
  value,
  onChange,
  maxHeight = 340,
}: {
  value: number[];
  onChange: (ids: number[]) => void;
  maxHeight?: number;
}) {
  const [search, setSearch] = useState("");
  const [department, setDepartment] = useState<number | null>(null);
  const [company, setCompany] = useState<number | null>(null);

  const { data, isPending } = useEmployees({
    page: 1,
    pageSize: 200,
    search: search || undefined,
    department: department ?? undefined,
    company: company ?? undefined,
  });
  const people = data?.results ?? [];

  function toggle(id: number) {
    onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  }

  /** Everybody currently listed — what "select all" means when a filter is on. */
  const shownIds = people.map((p) => p.id);
  const allShownChosen = shownIds.length > 0 && shownIds.every((id) => value.includes(id));

  return (
    <Stack spacing={1.5}>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
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
          sx={{ minWidth: { sm: 180 } }}
        />
        <CompanyPicker
          label="Company"
          value={company}
          onChange={setCompany}
          placeholder="Any"
          size="small"
          sx={{ minWidth: { sm: 180 } }}
        />
      </Stack>

      {value.length > 0 ? (
        <Stack direction="row" spacing={0.5} sx={{ flexWrap: "wrap", alignItems: "center" }} useFlexGap>
          {value.map((id) => {
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
          <Button size="small" onClick={() => onChange([])}>
            Clear
          </Button>
        </Stack>
      ) : null}

      {isPending ? (
        <Skeleton variant="rounded" height={maxHeight} />
      ) : people.length === 0 ? (
        <Alert severity="info">Nobody matches that.</Alert>
      ) : (
        <Box sx={{ maxHeight, overflowY: "auto", border: "1px solid", borderColor: "divider", borderRadius: 1.5 }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell padding="checkbox">
                  <Checkbox
                    checked={allShownChosen}
                    indeterminate={!allShownChosen && shownIds.some((id) => value.includes(id))}
                    onChange={() =>
                      onChange(
                        allShownChosen
                          ? value.filter((id) => !shownIds.includes(id))
                          : Array.from(new Set([...value, ...shownIds]))
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
                  selected={value.includes(person.id)}
                  sx={{ cursor: "pointer" }}
                  onClick={() => toggle(person.id)}
                >
                  <TableCell padding="checkbox">
                    <Checkbox checked={value.includes(person.id)} />
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

      <Typography variant="caption" color="text.secondary">
        {value.length === 0
          ? "Nobody picked — the department above decides who gets it."
          : `${value.length} ${value.length === 1 ? "person" : "people"} picked.`}
      </Typography>
    </Stack>
  );
}
