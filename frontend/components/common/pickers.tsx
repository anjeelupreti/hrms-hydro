"use client";

import type { SxProps, Theme } from "@mui/material/styles";

import { useEntitySearch, type PickerOption } from "@/hooks/useEntitySearch";
import EntityPicker from "@/components/common/EntityPicker";
import type { Company } from "@/types/companies";
import type { Department, Designation, EmployeeListItem } from "@/types/employees";

/**
 * Ready-made pickers, one per collection the UI asks a human to choose from.
 *
 * Each is a thin binding of {@link EntityPicker} to an endpoint and a row
 * shape, so a call site stays a one-liner and no page has to know how search
 * or selection-resolution works. Add a new one here rather than reaching for
 * `<TextField select>` — see EntityPicker for why that stopped being safe.
 */

type Common = {
  label?: string;
  disabled?: boolean;
  required?: boolean;
  error?: boolean;
  helperText?: React.ReactNode;
  autoFocus?: boolean;
  /** Defer the request until a dialog is actually on screen. */
  enabled?: boolean;
  /** `small` for a filter bar, `medium` (default) for a form. */
  size?: "small" | "medium";
  sx?: SxProps<Theme>;
  /** Overrides the default "Type to search…" — filters read better as "All". */
  placeholder?: string;
  /**
   * Drop these rows from the options.
   *
   * For "add someone who is not already here" — a roster excludes its current
   * participants. Filtering client-side is right for *removal*: unlike the old
   * load-then-filter it cannot hide a row the server matched, it only takes
   * away ones the caller already knows about.
   */
  excludeIds?: number[];
};

type SingleBinding = Common & { multiple?: false; value: number | null; onChange: (v: number | null) => void };
type MultiBinding = Common & { multiple: true; value: number[]; onChange: (v: number[]) => void; max?: number };
type Binding = SingleBinding | MultiBinding;

/** Normalise either binding into the id list the search hook needs. */
function idsOf(props: Binding): number[] {
  if (props.multiple === true) return props.value;
  return props.value === null ? [] : [props.value];
}

function bind(props: Binding) {
  return props.multiple === true
    ? ({ multiple: true, value: props.value, onChange: props.onChange, max: props.max } as const)
    : ({ multiple: false, value: props.value, onChange: props.onChange } as const);
}

/* ── People ───────────────────────────────────────────────────────────────── */

const employeeOption = (e: EmployeeListItem): PickerOption => ({
  id: e.id,
  label: e.full_name,
  // Two people share a name more often than teams expect; the code and role
  // are what let you tell them apart without opening a profile.
  secondary: [e.employee_code, e.designation_title, e.department_name].filter(Boolean).join(" · "),
  avatarUrl: e.photo,
});

export function EmployeePicker(props: Binding & { departmentId?: number }) {
  const { label = "Employee", disabled, required, error, helperText, autoFocus, enabled, size, sx, placeholder, excludeIds } = props;
  const search = useEntitySearch<EmployeeListItem>({
    endpoint: "/api/proxy/employees/employees",
    toOption: employeeOption,
    selectedIds: idsOf(props),
    enabled,
    params: { department: props.departmentId },
  });

  return (
    <EntityPicker
      {...bind(props)}
      label={label}
      options={excludeIds?.length ? search.options.filter((o) => !excludeIds.includes(o.id)) : search.options}
      inputValue={search.query}
      onInputChange={search.setQuery}
      loading={search.loading}
      hasMore={search.hasMore}
      total={search.total}
      showAvatars
      disabled={disabled}
      required={required}
      error={error}
      helperText={helperText}
      autoFocus={autoFocus}
      size={size}
      sx={sx}
      placeholder={placeholder}
    />
  );
}

/* ── Org structure ────────────────────────────────────────────────────────── */

export function DepartmentPicker(props: Binding) {
  const { label = "Department", disabled, required, error, helperText, enabled, size, sx, placeholder, excludeIds } = props;
  const search = useEntitySearch<Department>({
    endpoint: "/api/proxy/employees/departments",
    toOption: (d) => ({ id: d.id, label: d.name, secondary: d.code }),
    selectedIds: idsOf(props),
    enabled,
  });

  return (
    <EntityPicker
      {...bind(props)}
      label={label}
      options={excludeIds?.length ? search.options.filter((o) => !excludeIds.includes(o.id)) : search.options}
      inputValue={search.query}
      onInputChange={search.setQuery}
      loading={search.loading}
      hasMore={search.hasMore}
      total={search.total}
      disabled={disabled}
      required={required}
      error={error}
      helperText={helperText}
      size={size}
      sx={sx}
      placeholder={placeholder}
    />
  );
}

/**
 * One of the group's operating companies.
 *
 * Used twice on the employee form — once for the company that employs somebody
 * and once, in multiple mode, for the others they also work for. Searching
 * rather than a plain `<select>`: a group with thirty project companies has a
 * dropdown nobody can find anything in.
 */
export function CompanyPicker(props: Binding) {
  const { label = "Company", disabled, required, error, helperText, enabled, size, sx, placeholder, excludeIds } = props;
  const search = useEntitySearch<Company>({
    endpoint: "/api/proxy/companies/companies",
    toOption: (c) => ({
      id: c.id,
      label: c.name,
      // The code is what payroll exports and employee codes are keyed on, and
      // two project companies on the same river have very similar names.
      secondary: [c.code, c.project_stage_display].filter(Boolean).join(" · "),
    }),
    selectedIds: idsOf(props),
    enabled,
  });

  return (
    <EntityPicker
      {...bind(props)}
      label={label}
      options={excludeIds?.length ? search.options.filter((o) => !excludeIds.includes(o.id)) : search.options}
      inputValue={search.query}
      onInputChange={search.setQuery}
      loading={search.loading}
      hasMore={search.hasMore}
      total={search.total}
      disabled={disabled}
      required={required}
      error={error}
      helperText={helperText}
      size={size}
      sx={sx}
      placeholder={placeholder}
    />
  );
}

export function DesignationPicker(props: Binding & { departmentId?: number }) {
  const { label = "Designation", disabled, required, error, helperText, enabled, size, sx, placeholder, excludeIds } = props;
  const search = useEntitySearch<Designation>({
    endpoint: "/api/proxy/employees/designations",
    toOption: (d) => ({ id: d.id, label: d.title }),
    selectedIds: idsOf(props),
    enabled,
    params: { department: props.departmentId },
  });

  return (
    <EntityPicker
      {...bind(props)}
      label={label}
      options={excludeIds?.length ? search.options.filter((o) => !excludeIds.includes(o.id)) : search.options}
      inputValue={search.query}
      onInputChange={search.setQuery}
      loading={search.loading}
      hasMore={search.hasMore}
      total={search.total}
      disabled={disabled}
      required={required}
      error={error}
      helperText={helperText}
      size={size}
      sx={sx}
      placeholder={placeholder}
    />
  );
}

/* ── CRM ──────────────────────────────────────────────────────────────────── */

type ClientRow = { id: number; name: string; industry?: string | null };

export function ClientPicker(props: Binding) {
  const { label = "Client", disabled, required, error, helperText, enabled, size, sx, placeholder, excludeIds } = props;
  const search = useEntitySearch<ClientRow>({
    endpoint: "/api/proxy/crm/clients",
    toOption: (c) => ({ id: c.id, label: c.name, secondary: c.industry ?? undefined }),
    selectedIds: idsOf(props),
    enabled,
  });

  return (
    <EntityPicker
      {...bind(props)}
      label={label}
      options={excludeIds?.length ? search.options.filter((o) => !excludeIds.includes(o.id)) : search.options}
      inputValue={search.query}
      onInputChange={search.setQuery}
      loading={search.loading}
      hasMore={search.hasMore}
      total={search.total}
      disabled={disabled}
      required={required}
      error={error}
      helperText={helperText}
      size={size}
      sx={sx}
      placeholder={placeholder}
    />
  );
}

type ProjectRow = { id: number; name: string; client_name?: string | null };

export function ProjectPicker(props: Binding & { clientId?: number }) {
  const { label = "Project", disabled, required, error, helperText, enabled, size, sx, placeholder, excludeIds } = props;
  const search = useEntitySearch<ProjectRow>({
    endpoint: "/api/proxy/projects/projects",
    toOption: (p) => ({ id: p.id, label: p.name, secondary: p.client_name ?? undefined }),
    selectedIds: idsOf(props),
    enabled,
    params: { client: props.clientId },
  });

  return (
    <EntityPicker
      {...bind(props)}
      label={label}
      options={excludeIds?.length ? search.options.filter((o) => !excludeIds.includes(o.id)) : search.options}
      inputValue={search.query}
      onInputChange={search.setQuery}
      loading={search.loading}
      hasMore={search.hasMore}
      total={search.total}
      disabled={disabled}
      required={required}
      error={error}
      helperText={helperText}
      size={size}
      sx={sx}
      placeholder={placeholder}
    />
  );
}

type TaskRow = { id: number; title: string; project_name?: string; status?: string };

/**
 * A task, for booking hours against.
 *
 * **Scoped to one project, and disabled until one is chosen.** A task list
 * across every project is both unreadable and wrong — hours belong to the
 * project the task is on, and offering a task from a different one invites an
 * entry the server would have to refuse.
 *
 * `nested=1` deliberately: the board hides sub-tasks, but a *step* is exactly
 * the size of thing somebody books two hours against, so this is the one place
 * that wants the flat list.
 */
export function TaskPicker(props: Binding & { projectId?: number | null }) {
  const { label = "Task", disabled, required, error, helperText, enabled, size, sx, placeholder, excludeIds } = props;
  const projectId = props.projectId ?? null;
  const search = useEntitySearch<TaskRow>({
    endpoint: "/api/proxy/projects/tasks",
    toOption: (t) => ({ id: t.id, label: t.title, secondary: t.project_name }),
    selectedIds: idsOf(props),
    // Never fetch every task in the company while no project is chosen.
    enabled: enabled !== false && projectId != null,
    params: { project: projectId ?? undefined, nested: 1 },
  });

  return (
    <EntityPicker
      {...bind(props)}
      label={label}
      options={excludeIds?.length ? search.options.filter((o) => !excludeIds.includes(o.id)) : search.options}
      inputValue={search.query}
      onInputChange={search.setQuery}
      loading={search.loading}
      hasMore={search.hasMore}
      total={search.total}
      disabled={disabled || projectId == null}
      required={required}
      error={error}
      helperText={helperText ?? (projectId == null ? "Pick a project first" : undefined)}
      size={size}
      sx={sx}
      placeholder={placeholder}
    />
  );
}

/* ── Time & leave ─────────────────────────────────────────────────────────── */

type LeaveTypeRow = { id: number; name: string; code: string };

export function LeaveTypePicker(props: Binding) {
  const { label = "Leave type", disabled, required, error, helperText, enabled, size, sx, placeholder, excludeIds } = props;
  const search = useEntitySearch<LeaveTypeRow>({
    endpoint: "/api/proxy/leave/types",
    toOption: (t) => ({ id: t.id, label: t.name, secondary: t.code }),
    selectedIds: idsOf(props),
    enabled,
  });

  return (
    <EntityPicker
      {...bind(props)}
      label={label}
      options={excludeIds?.length ? search.options.filter((o) => !excludeIds.includes(o.id)) : search.options}
      inputValue={search.query}
      onInputChange={search.setQuery}
      loading={search.loading}
      hasMore={search.hasMore}
      total={search.total}
      disabled={disabled}
      required={required}
      error={error}
      helperText={helperText}
      size={size}
      sx={sx}
      placeholder={placeholder}
    />
  );
}

type ShiftRow = { id: number; name: string; start_time: string; end_time: string };

export function ShiftPicker(props: Binding) {
  const { label = "Shift", disabled, required, error, helperText, enabled, size, sx, placeholder, excludeIds } = props;
  const search = useEntitySearch<ShiftRow>({
    endpoint: "/api/proxy/attendance/shifts",
    toOption: (s) => ({ id: s.id, label: s.name, secondary: `${s.start_time}–${s.end_time}` }),
    selectedIds: idsOf(props),
    enabled,
  });

  return (
    <EntityPicker
      {...bind(props)}
      label={label}
      options={excludeIds?.length ? search.options.filter((o) => !excludeIds.includes(o.id)) : search.options}
      inputValue={search.query}
      onInputChange={search.setQuery}
      loading={search.loading}
      hasMore={search.hasMore}
      total={search.total}
      disabled={disabled}
      required={required}
      error={error}
      helperText={helperText}
      size={size}
      sx={sx}
      placeholder={placeholder}
    />
  );
}
