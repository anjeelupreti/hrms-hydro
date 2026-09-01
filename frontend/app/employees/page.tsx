"use client";
import AccountTreeIcon from "@mui/icons-material/AccountTree";

import AddIcon from "@mui/icons-material/Add";
import ChatBubbleOutlineIcon from "@mui/icons-material/ChatBubble";
import EditIcon from "@mui/icons-material/Edit";
import EmailIcon from "@mui/icons-material/Email";
import PaymentsIcon from "@mui/icons-material/Payments";
import PeopleIcon from "@mui/icons-material/People";
import TimelineIcon from "@mui/icons-material/Timeline";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import Avatar from "@mui/material/Avatar";
import Button from "@mui/material/Button";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import Skeleton from "@mui/material/Skeleton";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { DataGrid, type GridColDef } from "@mui/x-data-grid";

import StateChip, { EMPLOYMENT_TONE } from "@/components/common/StateChip";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, Suspense } from "react";

import CountFilterBar from "@/components/common/CountFilterBar";
import DateText from "@/components/common/DateText";
import ListPagination from "@/components/common/ListPagination";
import EmptyState from "@/components/common/EmptyState";
import RecordGrid, { type RecordView } from "@/components/common/RecordGrid";
import StaffCard from "@/components/common/StaffCard";
import SearchField from "@/components/common/SearchField";
import ViewSwitch, { useViewMode } from "@/components/common/ViewSwitch";
import EmployeeLink from "@/components/common/EmployeeLink";
import ExportButton from "@/components/common/ExportButton";
import EmployeeFormDialog from "@/components/employees/EmployeeFormDialog";
import ImportEmployeesDialog from "@/components/employees/ImportEmployeesDialog";
import LifecycleEventDialog from "@/components/employees/LifecycleEventDialog";
import SalaryStructureDialog from "@/components/payroll/SalaryStructureDialog";
import PageContainer from "@/components/shell/PageContainer";
import PageHeader from "@/components/shell/PageHeader";
import { useCreateConversation } from "@/hooks/useChat";
import { useEmployees, useEmployeeStatusCounts } from "@/hooks/useEmployees";
import { useCan, useCanCreate, useMe } from "@/hooks/useMe";
import { employeeHref } from "@/lib/employeeProfile";
import { useUIStore } from "@/lib/store/ui";
import type { EmployeeListItem, EmploymentStatus } from "@/types/employees";
import { CompanyPicker, DepartmentPicker, DesignationPicker } from "@/components/common/pickers";

function initials(name: string) {
  return name.split(" ").slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("");
}

// The state mapping lives in `StateChip`, so this page and the dashboard
// cannot come to different colours for the same employee.

function EmployeesContent() {
  const { data: me } = useMe();
  const canManage = useCan("people.manage");
  // Editing and creating are different rights. An officer granted
  // `people.manage` keeps the record current and does not add people —
  // mirroring `accounts.policy.can_create`, which refuses it at the API.
  const canCreate = useCanCreate("people.manage");
  const createConversation = useCreateConversation();
  const openChatConversation = useUIStore((s) => s.openChatConversation);

  async function messageEmployee(row: EmployeeListItem) {
    if (!row.user_id || row.user_id === me?.id) return;
    const conv = await createConversation.mutateAsync({ type: "dm", member_ids: [row.user_id] });
    openChatConversation(conv.id);
  }

  const router = useRouter();
  const searchParams = useSearchParams();
  const [search, setSearch] = useState(() => searchParams.get("search") ?? "");
  const [department, setDepartment] = useState<number | "">("");
  // Seeded from the URL, because the companies page links here with it —
  // "18 on payroll" is only useful if clicking it shows those eighteen.
  // Matches secondments as well as the payroll, so the list is wider than the
  // headcount; `EmployeeFilterSet.filter_company` is where that is decided.
  const [company, setCompany] = useState<number | "">(() => {
    const value = Number(searchParams.get("company"));
    return Number.isFinite(value) && value > 0 ? value : "";
  });
  const [designation, setDesignation] = useState<number | "">("");
  const [status, setStatus] = useState<EmploymentStatus | "">("");
  // The roster excludes leavers by default: "All 102" on a workforce of 87 is
  // not a useful number, and a company with real turnover would open its people
  // page on a list where the leavers crowd out the staff. Past employees are
  // not deleted and not archived — they *left*, and `employment_status` says
  // so, which makes this a view over that field rather than a second flag.
  const [past, setPast] = useState(false);
  const [paginationModel, setPaginationModel] = useState({ page: 0, pageSize: 25 });
  // Table by default here: a roster is read column-wise — who is in which
  // department, on what status — and 106 people is a lot of cards.
  const { mode: view, setMode: setView } = useViewMode("employees", "table");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [editingEmployeeId, setEditingEmployeeId] = useState<number | null>(null);
  const [salaryDialogEmployee, setSalaryDialogEmployee] = useState<EmployeeListItem | null>(null);
  const [lifecycleDialogEmployee, setLifecycleDialogEmployee] = useState<EmployeeListItem | null>(null);

  const { data: statusCounts } = useEmployeeStatusCounts({ search, department, designation, company });
  const { data: employees, isLoading } = useEmployees({
    page: paginationModel.page + 1,
    pageSize: paginationModel.pageSize,
    search: search || undefined,
    department: department || undefined,
    designation: designation || undefined,
    company: company || undefined,
    employment_status: status || undefined,
    past: past || undefined,
  });

  function openCreate() {
    setEditingEmployeeId(null);
    setDialogOpen(true);
  }

  function openEdit(row: EmployeeListItem) {
    setEditingEmployeeId(row.id);
    setDialogOpen(true);
  }

  // One description, rendered as cards or as compact rows.
  //
  // A card has a whole surface and a table row has a line, so the card carries
  // more rather than less: the table shows department, role and status, and the
  // card adds who they report to, when they joined, and how to reach them.
  // Showing the same four facts in both made the card view a worse table.
  const employeeRecord: RecordView<EmployeeListItem> = {
    key: (person) => person.id,
    person: (row) => ({ name: row.full_name, photo: row.photo }),
    title: (person) => person.full_name,
    subtitle: (person) => person.employee_code,
    badge: (person) => (
      <StateChip
        label={person.employment_status.replace(/_/g, " ")}
        tone={EMPLOYMENT_TONE[person.employment_status]}
      />
    ),
    facts: (person) => [
      { label: "Department", value: person.department_name ?? "—" },
      { label: "Role", value: person.designation_title ?? "—" },
    ],
    cardFacts: (person) => [
      { label: "Reports to", value: person.manager_name ?? "—" },
      {
        label: "Joined",
        value: person.date_joined ? <DateText value={person.date_joined} /> : "—",
      },
      { label: "Email", value: person.email || "—" },
      { label: "Phone", value: person.phone || "—" },
    ],
    onOpen: (person) => router.push(employeeHref(person.id)),
  };

  const columns: GridColDef<EmployeeListItem>[] = [
    { field: "employee_code", headerName: "Code", width: 100 },
    {
      field: "full_name",
      headerName: "Name",
      flex: 1,
      minWidth: 200,
      renderCell: (params) => (
        <Stack direction="row" spacing={1.25} sx={{ alignItems: "center", height: "100%" }}>
          <Avatar src={params.row.photo ?? undefined} sx={{ width: 30, height: 30, fontSize: 13, bgcolor: "transparent", color: "primary.main", border: "1.5px solid", borderColor: "primary.main" }}>
            {initials(params.value)}
          </Avatar>
          <EmployeeLink id={params.row.id} name={params.value} />
        </Stack>
      ),
    },
    { field: "email", headerName: "Email", flex: 1, minWidth: 200 },
    { field: "department_name", headerName: "Department", flex: 1, minWidth: 140 },
    { field: "designation_title", headerName: "Designation", flex: 1, minWidth: 160 },
    {
      field: "employment_status",
      headerName: "Status",
      width: 130,
      renderCell: (params) => (
        <StateChip
          label={String(params.value).replace(/_/g, " ")}
          tone={EMPLOYMENT_TONE[params.value as EmploymentStatus]}
        />
      ),
    },
    {
      field: "actions",
      headerName: "Actions",
      width: canManage ? 210 : 100,
      sortable: false,
      filterable: false,
      renderCell: (params: { row: EmployeeListItem }) => (
        <Stack direction="row" spacing={0.25} sx={{ height: "100%", alignItems: "center" }}>
          <Tooltip title="Message">
            <span>
              <IconButton
                size="small"
                color="primary"
                disabled={params.row.user_id === me?.id || createConversation.isPending}
                onClick={() => messageEmployee(params.row)}
              >
                <ChatBubbleOutlineIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title="Email">
            <IconButton size="small" href={`mailto:${params.row.email}`}>
              <EmailIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          {canManage && (
            <>
              <Tooltip title="Edit employee">
                <IconButton size="small" onClick={() => openEdit(params.row)}>
                  <EditIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <Tooltip title="Salary structure">
                <IconButton size="small" onClick={() => setSalaryDialogEmployee(params.row)}>
                  <PaymentsIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <Tooltip title="Lifecycle event">
                <IconButton size="small" onClick={() => setLifecycleDialogEmployee(params.row)}>
                  <TimelineIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </>
          )}
        </Stack>
      ),
    } satisfies GridColDef<EmployeeListItem>,
  ];

  return (
    <PageContainer>
      <PageHeader
        title="Employees"
        subtitle="Company directory and records"
        icon={<PeopleIcon />}
        actions={
          <>
            <ExportButton
              path="employees/employees"
              filters={[
                {
                  type: "select",
                  param: "employment_status",
                  label: "Status",
                  options: [
                    { value: "active", label: "Active" },
                    { value: "on_leave", label: "On Leave" },
                    { value: "resigned", label: "Resigned" },
                    { value: "terminated", label: "Terminated" },
                  ],
                },
              ]}
            />
            <Button component={Link} href="/employees/lifecycle" startIcon={<TimelineIcon />}>
              Lifecycle
            </Button>
            <Button component={Link} href="/employees/org-chart" startIcon={<AccountTreeIcon />}>
              Org chart
            </Button>
            {canCreate && (
              <Button startIcon={<UploadFileIcon />} onClick={() => setImporting(true)}>
                Import
              </Button>
            )}
            {canCreate && (
              <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>
                Add Employee
              </Button>
            )}
          </>
        }
      />

      <Card sx={{ p: 2, mb: 2 }}>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2} useFlexGap sx={{ flexWrap: "wrap" }}>
        <SearchField
          value={search}
          onChange={setSearch}
          placeholder="Search employees…"
          label="Search employees by name, code or email"
          sx={{ width: "100%", maxWidth: { sm: 260 } }}
        />
        <DepartmentPicker
          value={department === "" ? null : department}
          onChange={(id) => setDepartment(id ?? "")}
          placeholder="All"
          size="small"
          sx={{ maxWidth: { sm: 200 } }}
        />
        <DesignationPicker
          value={designation === "" ? null : designation}
          onChange={(id) => setDesignation(id ?? "")}
          placeholder="All"
          size="small"
          sx={{ maxWidth: { sm: 200 } }}
        />
        <CompanyPicker
          label="Company"
          value={company === "" ? null : company}
          onChange={(id) => setCompany(id ?? "")}
          placeholder="All"
          size="small"
          sx={{ maxWidth: { sm: 220 } }}
        />
        </Stack>

        {/* The status dropdown became this. A count nobody can click and a
            filter that shows no count were two controls answering one
            question; now the number *is* the way in. Counts come from the
            server so they describe the whole directory, not the loaded page. */}
        {/* The roster, or the people who have left. Picking a specific status
            below still works and overrides this — asking for "Terminated" by
            name is somebody who knows what they want. */}
        <Tabs
          value={past ? 1 : 0}
          onChange={(_e, v) => {
            setPast(v === 1);
            setStatus("");
          }}
          sx={{ mt: 1 }}
        >
          <Tab label="Current" />
          <Tab
            label={`Past employees${
              statusCounts ? ` (${(statusCounts.resigned ?? 0) + (statusCounts.terminated ?? 0)})` : ""
            }`}
          />
        </Tabs>

        <Box sx={{ mt: 2 }}>
          <CountFilterBar
            ariaLabel="Filter employees by employment status"
            value={status}
            onChange={(next) => setStatus(next)}
            loading={isLoading}
            options={[
              { value: "", label: "All", count: statusCounts?.total },
              { value: "active", label: "Active", count: statusCounts?.active },
              { value: "on_leave", label: "On leave", count: statusCounts?.on_leave, tone: "info" },
              // Not `danger`. A suspension usually ends with the person coming
              // back, and colouring it like a termination reads as an exit.
              { value: "suspended", label: "Suspended", count: statusCounts?.suspended, tone: "warning" },
              { value: "resigned", label: "Resigned", count: statusCounts?.resigned },
              { value: "terminated", label: "Terminated", count: statusCounts?.terminated, tone: "danger" },
            ]}
          />
        </Box>
      </Card>

      <Stack
        direction="row"
        sx={{ alignItems: "center", justifyContent: "flex-end", mb: 1.5 }}
      >
        <ViewSwitch value={view} onChange={setView} />
      </Stack>

      {view === "table" ? (
        <DataGrid
          rows={employees?.results ?? []}
          columns={columns}
          loading={isLoading}
          paginationMode="server"
          rowCount={employees?.count ?? 0}
          paginationModel={paginationModel}
          onPaginationModelChange={setPaginationModel}
          pageSizeOptions={[10, 25, 50, 100]}
          disableRowSelectionOnClick
          autoHeight
          rowHeight={56}
          // **The row is the link.** Only the name was clickable before, and
          // the actions column sits at the far right — so the natural gesture,
          // clicking the row you are reading, did nothing at all. Every other
          // view of a person here opens their profile; the default one did not.
          //
          // The buttons in the actions column already `stopPropagation`, so
          // "message" and "edit" still do their own thing.
          onRowClick={(params) => router.push(employeeHref(params.id as number))}
          sx={{ "& .MuiDataGrid-row": { cursor: "pointer" } }}
        />
      ) : view === "cards" ? (
        /* `StaffCard`, the same component the dashboard's people strips use.
            The generic record card is the right shape for a project, an invoice
            or a ticket — a title, a subtitle and two facts in a box — and the
            wrong one for a roster, which is the list where the reader is
            looking for a face. */
        isLoading ? (
          <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: BADGE_COLUMNS }}>
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} variant="rounded" height={300} />
            ))}
          </Box>
        ) : (employees?.results ?? []).length === 0 ? (
          <EmptyState
            title={search ? `Nobody matches “${search}”` : "No employees yet"}
            description={
              search
                ? "Try a name, an employee code or an email address."
                : "Add the first person, or import a spreadsheet."
            }
          />
        ) : (
          <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: BADGE_COLUMNS }}>
            {(employees?.results ?? []).map((person) => (
              <StaffCard
                key={person.id}
                name={person.full_name}
                photo={person.photo}
                role={person.designation_title}
                code={person.employee_code}
                maxFacts={8}
                facts={[
                  { label: "Team", value: person.department_name ?? "—" },
                  {
                    label: "Status",
                    // Sentence case: the raw enum reads "on_leave", and
                    // lower-casing it to "on leave" still looks like a database
                    // value sitting on a printed badge.
                    value:
                      person.employment_status.replace(/_/g, " ").charAt(0).toUpperCase() +
                      person.employment_status.replace(/_/g, " ").slice(1),
                  },
                  { label: "Post", value: person.corporate_post_name ?? "—" },
                  { label: "Role", value: person.corporate_role_name ?? "—" },
                  { label: "Reports to", value: person.manager_name ?? "—" },
                  { label: "Joined", value: person.date_joined ? <DateText value={person.date_joined} /> : "—" },
                  { label: "Email", value: person.email || "—" },
                  { label: "Phone", value: person.phone || "—" },
                ]}
                // An address rather than a handler, so a card behaves like the
                // link it looks like: ⌘-click opens a colleague in a new tab.
                href={employeeHref(person.id)}
              />
            ))}
          </Box>
        )
      ) : (
        <RecordGrid
          rows={employees?.results ?? []}
          view={employeeRecord}
          variant={view}
          loading={isLoading}
          filtered={Boolean(search || status || department || designation)}
          empty={{
            title: search ? `Nobody matches “${search}”` : "No employees yet",
            description: search
              ? "Try a name, an employee code or an email address."
              : "Add the first person, or import a spreadsheet.",
          }}
        />
      )}

      {/* The table brings DataGrid's own footer; the card and list views had
          none at all, so a 201-person roster showed 25 people and stopped. */}
      {view !== "table" ? (
        <ListPagination
          page={paginationModel.page + 1}
          pageSize={paginationModel.pageSize}
          count={employees?.count ?? 0}
          noun="employees"
          onPageChange={(next) => setPaginationModel((m) => ({ ...m, page: next - 1 }))}
          onPageSizeChange={(size) => setPaginationModel({ page: 0, pageSize: size })}
        />
      ) : null}

      <EmployeeFormDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        employeeId={editingEmployeeId}
      />

      <SalaryStructureDialog
        open={Boolean(salaryDialogEmployee)}
        onClose={() => setSalaryDialogEmployee(null)}
        employeeId={salaryDialogEmployee?.id ?? null}
        employeeName={salaryDialogEmployee?.full_name ?? ""}
      />

      <LifecycleEventDialog
        open={Boolean(lifecycleDialogEmployee)}
        onClose={() => setLifecycleDialogEmployee(null)}
        employeeId={lifecycleDialogEmployee?.id ?? null}
        employeeName={lifecycleDialogEmployee?.full_name ?? ""}
      />
      {importing && <ImportEmployeesDialog onClose={() => setImporting(false)} />}
    </PageContainer>
  );
}

/** Auto-fitting so the roster fills the page at any width, and a badge never
 *  stretches so wide that the photograph floats in the middle of nothing. */
const BADGE_COLUMNS = "repeat(auto-fill, minmax(216px, 1fr))";

export default function EmployeesPage() {
  return (
    <Suspense>
      <EmployeesContent />
    </Suspense>
  );
}
