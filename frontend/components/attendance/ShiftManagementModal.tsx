"use client";

import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useState } from "react";
import type { GridColDef } from "@mui/x-data-grid";
import DataGrid from "@/components/common/LazyDataGrid";

import DateField from "@/components/common/DateField";
import { useShifts, useSaveShift, useDeleteShift, useShiftAssignments, useSaveShiftAssignment, useDeleteShiftAssignment } from "@/hooks/useAttendance";
import type { Shift, ShiftAssignment } from "@/types/attendance";
import EmployeeLink from "@/components/common/EmployeeLink";
import { EmployeePicker, ShiftPicker } from "@/components/common/pickers";
import { todayIso } from "@/lib/format/period";

type Props = {
  open: boolean;
  onClose: () => void;
};

export default function ShiftManagementModal({ open, onClose }: Props) {
  const [tab, setTab] = useState(0);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle>Shift Management</DialogTitle>
      <DialogContent sx={{ minHeight: 400 }}>
        <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ borderBottom: 1, borderColor: "divider", mb: 2 }}>
          <Tab label="Roster (Assignments)" />
          <Tab label="Shift Definitions" />
        </Tabs>
        
        {tab === 0 && <ShiftAssignmentsTab />}
        {tab === 1 && <ShiftDefinitionsTab />}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

function ShiftDefinitionsTab() {
  const { data, isLoading } = useShifts();
  const del = useDeleteShift();
  const [creating, setCreating] = useState(false);

  const shifts = data?.results ?? [];

  const columns: GridColDef<Shift>[] = [
    { field: "name", headerName: "Shift Name", flex: 1 },
    { field: "start_time", headerName: "Start Time", width: 120 },
    { field: "end_time", headerName: "End Time", width: 120 },
    { field: "grace_period_minutes", headerName: "Grace (mins)", width: 120 },
    {
      field: "actions",
      headerName: "",
      width: 60,
      sortable: false,
      renderCell: (params) => (
        <IconButton size="small" color="error" onClick={() => del.mutate(params.row.id)}>
          <DeleteIcon fontSize="small" />
        </IconButton>
      ),
    },
  ];

  return (
    <Box>
      <Stack direction="row" sx={{ justifyContent: "space-between", mb: 2 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>Available Shifts</Typography>
        <Button variant="contained" size="small" startIcon={<AddIcon />} onClick={() => setCreating(true)}>
          New Shift
        </Button>
      </Stack>
      <DataGrid
        rows={shifts}
        columns={columns}
        loading={isLoading}
        autoHeight
        hideFooter
        disableRowSelectionOnClick
      />
      {creating && <CreateShiftDialog onClose={() => setCreating(false)} />}
    </Box>
  );
}

function CreateShiftDialog({ onClose }: { onClose: () => void }) {
  const save = useSaveShift();
  const [name, setName] = useState("");
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("17:00");
  const [grace, setGrace] = useState("15");
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    if (!name || !start || !end) return;
    try {
      await save.mutateAsync({ values: { name, start_time: start, end_time: end, grace_period_minutes: parseInt(grace, 10) } });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create shift.");
    }
  }

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>New Shift</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField label="Name (e.g. Morning Shift)" value={name} onChange={(e) => setName(e.target.value)} fullWidth />
          <Stack direction="row" spacing={2}>
            <TextField label="Start Time" type="time" value={start} onChange={(e) => setStart(e.target.value)} fullWidth slotProps={{ inputLabel: { shrink: true } }} />
            <TextField label="End Time" type="time" value={end} onChange={(e) => setEnd(e.target.value)} fullWidth slotProps={{ inputLabel: { shrink: true } }} />
          </Stack>
          <TextField label="Grace period (minutes)" type="number" value={grace} onChange={(e) => setGrace(e.target.value)} fullWidth />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={submit} disabled={save.isPending}>
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function ShiftAssignmentsTab() {
  const { data: assignmentsData, isLoading } = useShiftAssignments();
  const del = useDeleteShiftAssignment();
  const [assigning, setAssigning] = useState(false);

  const { data: shiftsData } = useShifts();
  const shifts = shiftsData?.results ?? [];
  const assignments = assignmentsData?.results ?? [];

  const columns: GridColDef<ShiftAssignment>[] = [
    {
      field: "employee_name",
      headerName: "Employee",
      flex: 1,
      minWidth: 160,
      renderCell: (params) => <EmployeeLink id={params.row.employee} name={params.value as string} />,
    },
    { 
      field: "shift", 
      headerName: "Shift", 
      flex: 1,
      valueGetter: (_, row) => shifts.find((s) => s.id === row.shift)?.name ?? `Unknown (${row.shift})`,
    },
    { field: "start_date", headerName: "From", width: 120 },
    { field: "end_date", headerName: "Until", width: 120, valueGetter: (_, row) => row.end_date ?? "Ongoing" },
    {
      field: "actions",
      headerName: "",
      width: 60,
      sortable: false,
      renderCell: (params) => (
        <IconButton size="small" color="error" onClick={() => del.mutate(params.row.id)}>
          <DeleteIcon fontSize="small" />
        </IconButton>
      ),
    },
  ];

  return (
    <Box>
      <Stack direction="row" sx={{ justifyContent: "space-between", mb: 2 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>Shift Roster</Typography>
        <Button variant="contained" size="small" startIcon={<AddIcon />} onClick={() => setAssigning(true)}>
          Assign Shift
        </Button>
      </Stack>
      <DataGrid
        rows={assignments}
        columns={columns}
        loading={isLoading}
        autoHeight
        hideFooter
        disableRowSelectionOnClick
      />
      {assigning && <AssignShiftDialog onClose={() => setAssigning(false)} />}
    </Box>
  );
}

function AssignShiftDialog({ onClose }: { onClose: () => void }) {
  const save = useSaveShiftAssignment();
  
  const [employee, setEmployee] = useState<number | "">("");
  const [shift, setShift] = useState<number | "">("");
  const [startDate, setStartDate] = useState(todayIso());
  const [endDate, setEndDate] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    if (!employee || !shift || !startDate) return;
    try {
      await save.mutateAsync({ 
        values: { 
          employee: Number(employee), 
          shift: Number(shift), 
          start_date: startDate, 
          end_date: endDate || null 
        } 
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not assign shift.");
    }
  }

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Assign Shift</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <Stack spacing={2} sx={{ mt: 1 }}>
          <EmployeePicker value={employee || null} onChange={(id) => setEmployee(id ?? 0)} required />
          <ShiftPicker value={shift || null} onChange={(id) => setShift(id ?? 0)} required />
          <Stack direction="row" spacing={2}>
            <DateField label="Start Date" value={startDate} onChange={setStartDate} />
            <DateField label="End Date (optional)" value={endDate} onChange={setEndDate} />
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={submit} disabled={save.isPending}>
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
}
